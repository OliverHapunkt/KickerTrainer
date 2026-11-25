-- ===========================================================================
-- Paket 4, Schritt 5: Elo
--
-- Drei Wertungen: Einzel, Doppel persönlich (über alle Partner), feste
-- Doppel-Paarung. Gewertet werden nur Spiele mit state = 'confirmed' UND
-- category = 'ranked'. Satz- und Torabstand zählen nicht, nur Sieg/Niederlage.
--
-- Rechenweg: IMMER komplett neu aus dem Spielverlauf (recompute_ratings), in
-- Spielreihenfolge. Ein Trigger auf matches löst das aus, sobald ein Spiel in
-- 'confirmed' hinein- oder herausfällt (Bestätigung, Korrektur, Abbruch) oder
-- sich die Kategorie eines bestätigten Spiels ändert. Damit gibt es keinen
-- Sonderweg für Korrekturen und keine Rundungsdrift. Bei Hobby-Mengen dauert das
-- Millisekunden; ab einigen zehntausend Spielen wäre inkrementell nötig.
--
-- Parameter: Start 1000, K = 24, in den ersten 10 Spielen je Wertung K = 48.
-- Doppel: Teamstärke = Mittelwert beider Spieler. Jeder Spieler bekommt
-- K_eigen × (Ergebnis − Erwartung) – Erwartung ist für beide gleich, das K
-- ist das eigene. So holt ein Neuer schnell auf, ohne dass sein Partner mit
-- dem großen K mitgerissen wird.
--
-- Der Client schreibt nie. Tabellen nur lesbar, und nur wie die Spieler selbst.
-- ===========================================================================

create table public.ratings (
  player_id  uuid not null references public.players (id),
  kind       text not null check (kind in ('single', 'double')),
  rating     double precision not null default 1000,
  games      integer not null default 0,
  wins       integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, kind)
);

-- Feste Paarung, p1 < p2 damit jede Paarung genau eine Zeile hat
create table public.team_ratings (
  p1         uuid not null references public.players (id),
  p2         uuid not null references public.players (id),
  rating     double precision not null default 1000,
  games      integer not null default 0,
  wins       integer not null default 0,
  primary key (p1, p2),
  check (p1 < p2)
);

-- Verlauf je Spiel und Spieler: Grundlage für die Kurve und „+12" je Spiel
create table public.rating_history (
  match_id  uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id),
  kind      text not null check (kind in ('single', 'double')),
  before    double precision not null,
  after     double precision not null,
  at        timestamptz not null,
  primary key (match_id, player_id)
);
create index rating_history_player_idx on public.rating_history (player_id, at);

alter table public.ratings        enable row level security;
alter table public.team_ratings   enable row level security;
alter table public.rating_history enable row level security;

-- Sichtbar wie der Spieler selbst. Die Unterabfrage läuft mit den Rechten des
-- Lesenden, also greift die Regel auf players mit.
create policy ratings_select on public.ratings for select to authenticated
  using (exists (select 1 from public.players p where p.id = ratings.player_id));
create policy team_ratings_select on public.team_ratings for select to authenticated
  using (exists (select 1 from public.players p where p.id = team_ratings.p1)
     and exists (select 1 from public.players p where p.id = team_ratings.p2));
create policy rating_history_select on public.rating_history for select to authenticated
  using (public.can_see_match(match_id));

revoke all on public.ratings, public.team_ratings, public.rating_history from anon, authenticated;
grant select on public.ratings, public.team_ratings, public.rating_history to authenticated;

-- ---------------------------------------------------------------------------
-- Neu rechnen
-- ---------------------------------------------------------------------------
create function public.recompute_ratings()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       record;
  v_kind  text;
  t1      uuid[];
  t2      uuid[];
  r1      double precision;
  r2      double precision;
  e1      double precision;
  s1      double precision;
  pid     uuid;
  sc      double precision;
  ex      double precision;
  k       double precision;
  cur     double precision;
  g       integer;
  pr      record;
begin
  -- Nie zwei Neuberechnungen gleichzeitig
  perform pg_advisory_xact_lock(hashtext('kt_recompute_ratings'));

  delete from public.rating_history;
  delete from public.ratings;
  delete from public.team_ratings;

  for m in
    select mm.id, mm.mode, coalesce(mm.finished_at, mm.started_at, mm.created_at) as at,
           (select count(*) from public.match_sets s where s.match_id = mm.id and s.winner_team = 1) as w1,
           (select count(*) from public.match_sets s where s.match_id = mm.id and s.winner_team = 2) as w2
      from public.matches mm
     where mm.state = 'confirmed' and mm.category = 'ranked'
     order by coalesce(mm.finished_at, mm.started_at, mm.created_at), mm.id
  loop
    continue when m.w1 = m.w2;                      -- ohne Sieger nichts zu werten
    v_kind := case when m.mode = 'single' then 'single' else 'double' end;
    t1 := array(select player_id from public.match_players where match_id = m.id and team = 1 order by player_id);
    t2 := array(select player_id from public.match_players where match_id = m.id and team = 2 order by player_id);
    continue when cardinality(t1) = 0 or cardinality(t2) = 0;

    insert into public.ratings (player_id, kind)
      select unnest(t1 || t2), v_kind
      on conflict do nothing;

    -- Stärken VOR dem Spiel festhalten, erst dann ändern
    select avg(rating) into r1 from public.ratings where kind = v_kind and player_id = any (t1);
    select avg(rating) into r2 from public.ratings where kind = v_kind and player_id = any (t2);
    e1 := 1.0 / (1.0 + power(10.0, (r2 - r1) / 400.0));
    s1 := case when m.w1 > m.w2 then 1.0 else 0.0 end;

    foreach pid in array t1 || t2 loop
      if pid = any (t1) then sc := s1; ex := e1; else sc := 1.0 - s1; ex := 1.0 - e1; end if;
      select rating, games into cur, g from public.ratings where player_id = pid and kind = v_kind;
      k := case when g < 10 then 48.0 else 24.0 end;
      insert into public.rating_history (match_id, player_id, kind, before, after, at)
        values (m.id, pid, v_kind, cur, cur + k * (sc - ex), m.at);
      update public.ratings
         set rating = cur + k * (sc - ex), games = games + 1,
             wins = wins + (sc = 1.0)::int, updated_at = now()
       where player_id = pid and kind = v_kind;
    end loop;

    -- Feste Paarungen: eigene Wertung, Paar gegen Paar
    if v_kind = 'double' and cardinality(t1) = 2 and cardinality(t2) = 2 then
      insert into public.team_ratings (p1, p2) values (t1[1], t1[2]), (t2[1], t2[2])
        on conflict do nothing;
      select rating into r1 from public.team_ratings where p1 = t1[1] and p2 = t1[2];
      select rating into r2 from public.team_ratings where p1 = t2[1] and p2 = t2[2];
      e1 := 1.0 / (1.0 + power(10.0, (r2 - r1) / 400.0));
      for pr in select t1[1] as a, t1[2] as b, s1 as sc, e1 as ex
                union all select t2[1], t2[2], 1.0 - s1, 1.0 - e1 loop
        update public.team_ratings
           set rating = rating + (case when games < 10 then 48.0 else 24.0 end) * (pr.sc - pr.ex),
               games = games + 1, wins = wins + (pr.sc = 1.0)::int
         where p1 = pr.a and p2 = pr.b;
      end loop;
    end if;
  end loop;

  -- matches.rated = ist ins Elo eingegangen
  update public.matches mm set rated = x.r
    from (select mm2.id, exists (select 1 from public.rating_history h where h.match_id = mm2.id) as r
            from public.matches mm2) x
   where x.id = mm.id and mm.rated is distinct from x.r;
end;
$$;
revoke execute on function public.recompute_ratings() from public, anon, authenticated;

create function public.ratings_on_match_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_ratings();
  return null;
end;
$$;
revoke execute on function public.ratings_on_match_change() from public, anon, authenticated;

-- Nur wenn sich an der Wertbarkeit etwas ändert. Das Setzen von rated in
-- recompute_ratings() fällt nicht darunter – keine Rekursion.
create trigger matches_recompute_ratings
  after update of state, category on public.matches
  for each row
  when ((old.state = 'confirmed') is distinct from (new.state = 'confirmed')
     or (new.state = 'confirmed' and old.category is distinct from new.category))
  execute function public.ratings_on_match_change();

create trigger matches_recompute_ratings_del
  after delete on public.matches
  for each row when (old.state = 'confirmed')
  execute function public.ratings_on_match_change();

-- ---------------------------------------------------------------------------
-- Lesen: eigene Wertungen samt Verlauf, und die Rangliste
-- ---------------------------------------------------------------------------
-- {single:{rating,games,wins}|null, double:…, teams:[{partner, nick, rating, games, wins}],
--  history:[{at, kind, after, delta, match}]}
create function public.my_ratings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.my_player_id() as id)
  select jsonb_build_object(
    'me', (select id from me),
    'single', (select jsonb_build_object('rating', round(rating)::int, 'games', games, 'wins', wins)
                 from public.ratings where player_id = (select id from me) and kind = 'single'),
    'double', (select jsonb_build_object('rating', round(rating)::int, 'games', games, 'wins', wins)
                 from public.ratings where player_id = (select id from me) and kind = 'double'),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
                  'partner', p.id, 'nick', p.nickname, 'kind', p.kind,
                  'rating', round(t.rating)::int, 'games', t.games, 'wins', t.wins)
                  order by t.games desc, t.rating desc)
                from public.team_ratings t
                join public.players p on p.id = case when t.p1 = (select id from me) then t.p2 else t.p1 end
               where (select id from me) in (t.p1, t.p2)), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
                  'at', h.at, 'kind', h.kind, 'after', round(h.after)::int,
                  'delta', round(h.after - h.before)::int, 'match', h.match_id)
                  order by h.at, h.match_id)
                from public.rating_history h where h.player_id = (select id from me)), '[]'::jsonb))
$$;
revoke execute on function public.my_ratings() from public, anon;
grant execute on function public.my_ratings() to authenticated;

-- Allgemeine Rangliste: nur Konten mit Zustimmung, nicht gelöscht, ab 10 Spielen.
-- p_kind: 'single' | 'double' | 'team' (Paarung: beide müssen zugestimmt haben).
create function public.leaderboard(p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_kind in ('single', 'double') then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nick', p.nickname,
               'rating', round(r.rating)::int, 'games', r.games, 'wins', r.wins,
               'me', p.id = public.my_player_id()) order by r.rating desc, p.nickname)
        from public.ratings r join public.players p on p.id = r.player_id
       where r.kind = p_kind and r.games >= 10
         and p.kind = 'account' and p.ranking_opt_in and p.deleted_at is null), '[]'::jsonb)
    when p_kind = 'team' then coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id || '+' || b.id,
               'nick', a.nickname || ' & ' || b.nickname,
               'rating', round(t.rating)::int, 'games', t.games, 'wins', t.wins,
               'me', public.my_player_id() in (a.id, b.id)) order by t.rating desc)
        from public.team_ratings t
        join public.players a on a.id = t.p1 join public.players b on b.id = t.p2
       where t.games >= 10
         and a.kind = 'account' and a.ranking_opt_in and a.deleted_at is null
         and b.kind = 'account' and b.ranking_opt_in and b.deleted_at is null), '[]'::jsonb)
  end
$$;
revoke execute on function public.leaderboard(text) from public, anon;
grant execute on function public.leaderboard(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Spielverlauf um Elo erweitern: 'elo' je Spiel = meine Änderung,
-- je Spieler = aktuelle Wertung in der Art dieses Spiels (Einzel/Doppel)
-- ---------------------------------------------------------------------------
create or replace function public.my_match_history()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.my_player_id() as id),
  mine as (
    select m.*, mp.team as my_team
      from public.matches m
      join public.match_players mp on mp.match_id = m.id
     where mp.player_id = (select id from me)
       and m.state in ('finished', 'confirmed', 'disputed')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',       m.id,
    'me',       (select id from me),
    'at',       coalesce(m.finished_at, m.started_at, m.created_at),
    'mode',     m.mode,
    'detail',   m.detail,
    'category', m.category,
    'state',    m.state,
    'host',     m.host_id = (select id from me),
    'team',     m.my_team,
    'players',  (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', p.id, 'nick', p.nickname, 'kind', p.kind, 'team', x.team,
                    'pos', x.position, 'del', p.deleted_at is not null,
                    'elo', (select round(r.rating)::int from public.ratings r
                             where r.player_id = p.id
                               and r.kind = case when m.mode = 'single' then 'single' else 'double' end))
                    order by x.team, x.position nulls last), '[]'::jsonb)
                   from public.match_players x join public.players p on p.id = x.player_id
                  where x.match_id = m.id),
    'sets',     (select coalesce(jsonb_agg(jsonb_build_array(s.score1, s.score2, s.winner_team)
                    order by s.set_no), '[]'::jsonb)
                   from public.match_sets s where s.match_id = m.id),
    'elo',      (select round(rh.after - rh.before)::int from public.rating_history rh
                  where rh.match_id = m.id and rh.player_id = (select id from me)),
    'goals',    case when m.detail = 'full' then
                  (select coalesce(jsonb_agg(jsonb_build_array(g.set_no, g.team, g.scorer_id,
                      g.scorer_position, g.own_goal) order by g.set_no, g.seq), '[]'::jsonb)
                     from public.goals g where g.match_id = m.id)
                else '[]'::jsonb end
  ) order by coalesce(m.finished_at, m.started_at, m.created_at) desc), '[]'::jsonb)
  from mine m
$$;

-- Bestehende bestätigte Spiele einmal werten
select public.recompute_ratings();
