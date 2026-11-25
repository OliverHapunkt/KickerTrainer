-- ===========================================================================
-- Spielregeln je Spiel, Unentschieden, Regeln ändern, Gäste ohne Elo
--
-- Spielkulturen unterscheiden sich je Spielstätte. Darum hat jedes Spiel
-- eigene Regeln (die App speichert sie als Vorlagen):
--   win_by       1 = ein Tor reicht, 2 = zwei Tore Vorsprung
--   win_by_scope 'decider' = nur im Entscheidungssatz, 'all' = in jedem Satz
--   goal_cap     Obergrenze: wer sie zuerst erreicht, gewinnt den Satz (null = keine)
--   draw_at      Entscheidungssatz endet bei draw_at:draw_at unentschieden (null = nie)
-- Entscheidungssatz = beide Teams haben je sets_to_win − 1 Sätze.
-- Ein unentschiedener Satz hat winner_team = 0 und beendet das Spiel als Remis.
--
-- Elo (Entscheidung 25.11.: Option A): Ein Spiel zählt nur, wenn in JEDEM Team
-- mindestens ein Konto spielt – sonst hat niemand auf der Gegenseite bestätigt.
-- Gäste bekommen kein Elo. Remis zählt 0,5.
-- ===========================================================================

alter table public.matches
  add column win_by       smallint not null default 1 check (win_by in (1, 2)),
  add column win_by_scope text     not null default 'decider' check (win_by_scope in ('decider', 'all')),
  add column goal_cap     smallint check (goal_cap is null or goal_cap between 2 and 60),
  add column draw_at      smallint check (draw_at is null or draw_at between 1 and 49);

alter table public.match_sets drop constraint match_sets_winner_team_check;
alter table public.match_sets add constraint match_sets_winner_team_check
  check (winner_team is null or winner_team in (0, 1, 2));

alter table public.ratings      add column draws integer not null default 0;
alter table public.team_ratings add column draws integer not null default 0;

-- ---------------------------------------------------------------------------
-- Ist der Satz bei diesem Stand zu Ende? 1/2 = Sieger, 0 = unentschieden, null = weiter
-- ---------------------------------------------------------------------------
create function public.set_end(m public.matches, p_set smallint, s1 smallint, s2 smallint)
returns smallint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w1 int; w2 int; decider boolean; lead int;
begin
  select count(*) filter (where winner_team = 1), count(*) filter (where winner_team = 2)
    into w1, w2
    from public.match_sets where match_id = m.id and set_no < p_set;
  decider := w1 = m.sets_to_win - 1 and w2 = m.sets_to_win - 1;

  if m.draw_at is not null and decider and s1 = m.draw_at and s2 = m.draw_at then
    return 0;
  end if;
  if m.goal_cap is not null and greatest(s1, s2) >= m.goal_cap and s1 <> s2 then
    return case when s1 > s2 then 1 else 2 end;
  end if;
  lead := case when m.win_by = 2 and (m.win_by_scope = 'all' or decider) then 2 else 1 end;
  if greatest(s1, s2) >= m.goals_per_set and abs(s1 - s2) >= lead then
    return case when s1 > s2 then 1 else 2 end;
  end if;
  return null;
end;
$$;
revoke execute on function public.set_end(public.matches, smallint, smallint, smallint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tor zählen: Satzende nach den Regeln
-- ---------------------------------------------------------------------------
create or replace function public.record_goal(
  p_match    uuid,
  p_team     smallint,
  p_scorer   uuid default null,
  p_position text default null,
  p_own      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m      public.matches;
  cur    public.match_sets;
  nextq  int;
  s1     smallint;
  s2     smallint;
  wins   int;
  sw     smallint;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;
  if m.host_id <> public.my_player_id() then
    raise exception 'Nur der Host zählt die Tore' using errcode = '42501';
  end if;
  if m.state <> 'running' then
    raise exception 'Das Spiel läuft nicht mehr' using errcode = 'P0001';
  end if;
  if p_team not in (1, 2) then
    raise exception 'Unbekanntes Team' using errcode = 'P0001';
  end if;

  select * into cur from public.match_sets
   where match_id = p_match and winner_team is null order by set_no limit 1;
  if cur.set_no is null then
    raise exception 'Kein laufender Satz' using errcode = 'P0001';
  end if;

  if m.detail = 'full' then
    select coalesce(max(seq), 0) + 1 into nextq
      from public.goals where match_id = p_match and set_no = cur.set_no;
    insert into public.goals
      (match_id, set_no, seq, team, scorer_id, scorer_position, own_goal, t)
    values
      (p_match, cur.set_no, nextq, p_team,
       case when p_scorer is not null and exists (
              select 1 from public.match_players
               where match_id = p_match and player_id = p_scorer)
            then p_scorer end,
       case when m.mode = 'double' and p_position in ('off', 'def') then p_position end,
       coalesce(p_own, false), now());
  end if;

  update public.match_sets
     set score1 = score1 + case when p_team = 1 then 1 else 0 end,
         score2 = score2 + case when p_team = 2 then 1 else 0 end
   where match_id = p_match and set_no = cur.set_no
  returning score1, score2 into s1, s2;

  -- Satzende nach den Regeln dieses Spiels (Vorsprung, Obergrenze, Unentschieden)
  sw := public.set_end(m, cur.set_no, s1, s2);
  if sw is not null then
    update public.match_sets
       set winner_team = sw, finished_at = now()
     where match_id = p_match and set_no = cur.set_no;

    select count(*) into wins from public.match_sets
     where match_id = p_match and winner_team = sw;

    -- Unentschiedener Entscheidungssatz beendet das Spiel als Remis
    if sw = 0 or wins >= m.sets_to_win then
      update public.matches set state = 'finished', finished_at = now() where id = p_match;
      perform public.settle_match(p_match);   -- neu: Host plus Gäste gilt sofort als bestätigt
    else
      insert into public.match_sets (match_id, set_no, started_at)
      values (p_match, cur.set_no + 1, now());
    end if;
  end if;

  return public.match_state(p_match);
end;
$$;

-- ---------------------------------------------------------------------------
-- Regeln ändern. Lobby: alles inkl. Einzel/Doppel und Art. Laufendes Spiel:
-- Tore, Sätze, Vorsprung, Obergrenze, Unentschieden, Erfassung – solange der
-- aktuelle Stand damit nicht rückwirkend schon entschieden wäre.
-- null = unverändert lassen; p_clear_cap / p_clear_draw schalten die Option ab.
-- ---------------------------------------------------------------------------
create function public.update_match_rules(
  p_match      uuid,
  p_mode       text     default null,
  p_detail     text     default null,
  p_gps        smallint default null,
  p_stw        smallint default null,
  p_win_by     smallint default null,
  p_scope      text     default null,
  p_cap        smallint default null,
  p_draw_at    smallint default null,
  p_category   text     default null,
  p_clear_cap  boolean  default false,
  p_clear_draw boolean  default false
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m   public.matches;
  n   public.matches;
  cur public.match_sets;
  w1  int; w2 int; need int;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;
  if m.host_id <> public.my_player_id() then
    raise exception 'Nur der Host ändert die Regeln' using errcode = '42501';
  end if;
  if m.state not in ('lobby', 'running') then
    raise exception 'Das Spiel ist schon vorbei' using errcode = 'P0001';
  end if;
  if m.state = 'running' and (p_mode is not null and p_mode <> m.mode) then
    raise exception 'Einzel oder Doppel nur in der Lobby' using errcode = 'P0001';
  end if;
  if m.state = 'running' and (p_category is not null and p_category <> m.category) then
    raise exception 'Die Art wird vor dem Spiel festgelegt' using errcode = 'P0001';
  end if;

  n := m;
  n.mode          := coalesce(p_mode, m.mode);
  n.detail        := coalesce(p_detail, m.detail);
  n.goals_per_set := coalesce(p_gps, m.goals_per_set);
  n.sets_to_win   := coalesce(p_stw, m.sets_to_win);
  n.win_by        := coalesce(p_win_by, m.win_by);
  n.win_by_scope  := coalesce(p_scope, m.win_by_scope);
  n.goal_cap      := case when p_clear_cap then null else coalesce(p_cap, m.goal_cap) end;
  n.draw_at       := case when p_clear_draw then null else coalesce(p_draw_at, m.draw_at) end;
  n.category      := coalesce(p_category, m.category);

  if n.mode not in ('single', 'double') or n.detail not in ('simple', 'full')
     or n.win_by not in (1, 2) or n.win_by_scope not in ('decider', 'all')
     or n.category not in ('casual', 'ranked') then
    raise exception 'Unbekannte Einstellung' using errcode = 'P0001';
  end if;
  if n.goals_per_set not between 1 and 50 or n.sets_to_win not between 1 and 5 then
    raise exception 'Unzulässige Tor- oder Satzzahl' using errcode = 'P0001';
  end if;
  if n.goal_cap is not null and n.goal_cap <= n.goals_per_set then
    raise exception 'Die Obergrenze muss über dem Satzziel liegen' using errcode = 'P0001';
  end if;
  if n.draw_at is not null and n.draw_at >= n.goals_per_set then
    raise exception 'Unentschieden muss unter dem Satzziel liegen' using errcode = 'P0001';
  end if;

  -- Einzel/Doppel: Aufstellung muss passen
  if n.mode <> m.mode then
    need := case when n.mode = 'single' then 1 else 2 end;
    if exists (select 1 from public.match_players where match_id = p_match
                group by team having count(*) > need) then
      raise exception 'Für Einzel erst einen Spieler je Team entfernen' using errcode = 'P0001';
    end if;
  end if;

  -- Laufend: nichts darf rückwirkend entschieden sein
  if m.state = 'running' then
    select count(*) filter (where winner_team = 1), count(*) filter (where winner_team = 2)
      into w1, w2 from public.match_sets where match_id = p_match;
    if greatest(w1, w2) >= n.sets_to_win then
      raise exception 'So wäre das Spiel schon entschieden (Sätze % : %)', w1, w2 using errcode = 'P0001';
    end if;
    select * into cur from public.match_sets
     where match_id = p_match and winner_team is null order by set_no limit 1;
    if cur.set_no is not null and public.set_end(n, cur.set_no, cur.score1, cur.score2) is not null then
      raise exception 'So wäre der laufende Satz (% : %) schon entschieden', cur.score1, cur.score2
        using errcode = 'P0001';
    end if;
  end if;

  update public.matches
     set mode = n.mode, detail = n.detail, goals_per_set = n.goals_per_set,
         sets_to_win = n.sets_to_win, win_by = n.win_by, win_by_scope = n.win_by_scope,
         goal_cap = n.goal_cap, draw_at = n.draw_at, category = n.category
   where id = p_match
  returning * into m;

  -- Positionen nachziehen: nur bei Doppel + Erweitert, je Team Sturm vor Abwehr
  if m.mode = 'double' and m.detail = 'full' then
    update public.match_players mp
       set position = x.pos
      from (select player_id, team,
                   case when row_number() over (partition by team
                          order by (position = 'def') nulls last, is_host desc, player_id) = 1
                        then 'off' else 'def' end as pos
              from public.match_players where match_id = p_match) x
     where mp.match_id = p_match and mp.player_id = x.player_id and mp.position is distinct from x.pos
       and (mp.position is null or exists (select 1 from public.match_players y
              where y.match_id = p_match and y.team = mp.team and y.player_id <> mp.player_id
                and y.position is not distinct from mp.position));
  elsif m.mode = 'single' then
    update public.match_players set position = null where match_id = p_match and position is not null;
  end if;

  return m;
end;
$$;
revoke execute on function public.update_match_rules(uuid, text, text, smallint, smallint, smallint, text, smallint, smallint, text, boolean, boolean) from public, anon;
grant execute on function public.update_match_rules(uuid, text, text, smallint, smallint, smallint, text, smallint, smallint, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Elo: nur Spiele mit Konto auf beiden Seiten, Gäste ohne Wertung, Remis 0,5
-- ---------------------------------------------------------------------------
create or replace function public.recompute_ratings()
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
  perform pg_advisory_xact_lock(hashtext('kt_recompute_ratings'));

  -- „where true“: Supabase bricht DELETE ohne WHERE ab (pg_safeupdate), auch hier drin
  delete from public.rating_history where true;
  delete from public.ratings where true;
  delete from public.team_ratings where true;

  for m in
    select mm.id, mm.mode, coalesce(mm.finished_at, mm.started_at, mm.created_at) as at,
           (select count(*) from public.match_sets s where s.match_id = mm.id and s.winner_team = 1) as w1,
           (select count(*) from public.match_sets s where s.match_id = mm.id and s.winner_team = 2) as w2,
           exists (select 1 from public.match_sets s where s.match_id = mm.id and s.winner_team = 0) as draw
      from public.matches mm
     where mm.state = 'confirmed' and mm.category = 'ranked'
     order by coalesce(mm.finished_at, mm.started_at, mm.created_at), mm.id
  loop
    continue when m.w1 = m.w2 and not m.draw;
    v_kind := case when m.mode = 'single' then 'single' else 'double' end;
    -- Nur Konten (auch gelöschte: ihre Spiele bleiben gültig). Gäste werden nicht gewertet.
    t1 := array(select mp.player_id from public.match_players mp join public.players p on p.id = mp.player_id
                 where mp.match_id = m.id and mp.team = 1 and p.kind = 'account' order by mp.player_id);
    t2 := array(select mp.player_id from public.match_players mp join public.players p on p.id = mp.player_id
                 where mp.match_id = m.id and mp.team = 2 and p.kind = 'account' order by mp.player_id);
    -- Option A: ohne Konto auf einer Seite hat niemand gegengeprüft – zählt nicht
    continue when cardinality(t1) = 0 or cardinality(t2) = 0;

    insert into public.ratings (player_id, kind)
      select unnest(t1 || t2), v_kind
      on conflict do nothing;

    select avg(rating) into r1 from public.ratings where kind = v_kind and player_id = any (t1);
    select avg(rating) into r2 from public.ratings where kind = v_kind and player_id = any (t2);
    e1 := 1.0 / (1.0 + power(10.0, (r2 - r1) / 400.0));
    s1 := case when m.draw then 0.5 when m.w1 > m.w2 then 1.0 else 0.0 end;

    foreach pid in array t1 || t2 loop
      if pid = any (t1) then sc := s1; ex := e1; else sc := 1.0 - s1; ex := 1.0 - e1; end if;
      select rating, games into cur, g from public.ratings where player_id = pid and kind = v_kind;
      k := case when g < 10 then 48.0 else 24.0 end;
      insert into public.rating_history (match_id, player_id, kind, before, after, at)
        values (m.id, pid, v_kind, cur, cur + k * (sc - ex), m.at);
      update public.ratings
         set rating = cur + k * (sc - ex), games = games + 1,
             wins = wins + (sc = 1.0)::int, draws = draws + (sc = 0.5)::int, updated_at = now()
       where player_id = pid and kind = v_kind;
    end loop;

    -- Feste Paarungen nur, wenn beide Seiten aus zwei Konten bestehen
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
               games = games + 1, wins = wins + (pr.sc = 1.0)::int, draws = draws + (pr.sc = 0.5)::int
         where p1 = pr.a and p2 = pr.b;
      end loop;
    end if;
  end loop;

  update public.matches mm set rated = x.r
    from (select mm2.id, exists (select 1 from public.rating_history h where h.match_id = mm2.id) as r
            from public.matches mm2) x
   where x.id = mm.id and mm.rated is distinct from x.r;
end;
$$;
revoke execute on function public.recompute_ratings() from public, anon, authenticated;

-- Trigger: Regeländerungen an bestätigten Spielen gibt es nicht (nur lobby/running),
-- der bestehende Trigger auf state/category reicht.


-- ---------------------------------------------------------------------------
-- Anlegen mit Regeln (p_rules: {win_by, scope, cap, draw_at}), sonst unverändert
-- ---------------------------------------------------------------------------
drop function public.create_match(text, text, smallint, smallint, uuid, jsonb, text);

create function public.create_match(
  p_mode          text,
  p_detail        text,
  p_goals_per_set smallint,
  p_sets_to_win   smallint,
  p_group_id      uuid,
  p_players       jsonb,
  p_category      text default 'ranked',
  p_rules         jsonb default null
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   uuid := public.my_player_id();
  m    public.matches;
  need int  := case when p_mode = 'single' then 1 else 2 end;
  n1   int;
  n2   int;
  bad  uuid;
begin
  if me is null then
    raise exception 'Zum Spielen wird erst ein Nickname benötigt' using errcode = 'P0001';
  end if;
  if p_mode not in ('single', 'double') then
    raise exception 'Unbekannter Modus' using errcode = 'P0001';
  end if;
  if p_detail not in ('simple', 'full') then
    raise exception 'Unbekannte Erfassungstiefe' using errcode = 'P0001';
  end if;
  if p_category is null or p_category not in ('casual', 'ranked') then
    raise exception 'Unbekannte Kategorie' using errcode = 'P0001';
  end if;
  if p_group_id is not null and not public.is_group_member(p_group_id) then
    raise exception 'Du bist nicht in dieser Gruppe' using errcode = 'P0001';
  end if;

  -- Aufstellung prüfen, bevor irgendetwas entsteht
  select count(*) filter (where team = 1), count(*) filter (where team = 2)
    into n1, n2
    from jsonb_to_recordset(p_players) as x(player_id uuid, team smallint, position text);

  if n1 <> need or n2 <> need then
    raise exception 'Für % werden % Spieler je Team gebraucht (sind % und %)',
      case when p_mode = 'single' then 'Einzel' else 'Doppel' end, need, n1, n2
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from jsonb_to_recordset(p_players) as x(player_id uuid, team smallint, position text)
                  where x.player_id = me) then
    raise exception 'Du musst selbst mitspielen' using errcode = 'P0001';
  end if;

  select x.player_id into bad
    from jsonb_to_recordset(p_players) as x(player_id uuid, team smallint, position text)
   where not public.can_use_player(x.player_id)
   limit 1;
  if bad is not null then
    raise exception 'Unbekannter Spieler in der Aufstellung' using errcode = 'P0001';
  end if;

  -- Kein Beitrittscode: In diesem Schritt spielen nur der Host und seine Gäste.
  insert into public.matches
    (host_id, mode, detail, goals_per_set, sets_to_win, group_id,
     state, join_code, started_at, category)
  values
    (me, p_mode, p_detail,
     greatest(1, least(50, coalesce(p_goals_per_set, 5))),
     greatest(1, least(5,  coalesce(p_sets_to_win, 2))),
     p_group_id, 'running', null, now(), p_category)
  returning * into m;

  insert into public.match_players (match_id, player_id, team, position, is_host)
  select m.id, x.player_id, x.team,
         case when p_detail = 'full' and p_mode = 'double' then x.position else null end,
         x.player_id = me
    from jsonb_to_recordset(p_players) as x(player_id uuid, team smallint, position text);

  insert into public.match_sets (match_id, set_no, started_at)
  values (m.id, 1, now());

  -- Regeln (Vorsprung, Obergrenze, Unentschieden) über dieselbe Prüfung wie beim Ändern
  if p_rules is not null and p_rules <> '{}'::jsonb then
    m := public.update_match_rules(m.id,
      p_win_by  => (p_rules->>'win_by')::smallint,
      p_scope   => p_rules->>'scope',
      p_cap     => (p_rules->>'cap')::smallint,
      p_draw_at => (p_rules->>'draw_at')::smallint);
  end if;

  return m;
end;
$$;
revoke execute on function public.create_match(text, text, smallint, smallint, uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.create_match(text, text, smallint, smallint, uuid, jsonb, text, jsonb) to authenticated;

drop function public.create_lobby(text, text, smallint, smallint, uuid, text);

create function public.create_lobby(
  p_mode          text,
  p_detail        text,
  p_goals_per_set smallint,
  p_sets_to_win   smallint,
  p_group_id      uuid,
  p_category      text default 'ranked',
  p_rules         jsonb default null
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_player_id();
  m  public.matches;
begin
  if me is null then
    raise exception 'Zum Spielen wird erst ein Nickname benötigt' using errcode = 'P0001';
  end if;
  if p_mode not in ('single', 'double') or p_detail not in ('simple', 'full') then
    raise exception 'Unbekannte Einstellung' using errcode = 'P0001';
  end if;
  if p_category is null or p_category not in ('casual', 'ranked') then
    raise exception 'Unbekannte Kategorie' using errcode = 'P0001';
  end if;
  if p_group_id is not null and not public.is_group_member(p_group_id) then
    raise exception 'Du bist nicht in dieser Gruppe' using errcode = 'P0001';
  end if;

  for i in 1..5 loop
    begin
      insert into public.matches
        (host_id, mode, detail, goals_per_set, sets_to_win, group_id, state, join_code, category)
      values
        (me, p_mode, p_detail,
         greatest(1, least(50, coalesce(p_goals_per_set, 5))),
         greatest(1, least(5,  coalesce(p_sets_to_win, 2))),
         p_group_id, 'lobby', public.gen_code(6, '0123456789'), p_category)
      returning * into m;
      exit;
    exception when unique_violation then
      if i = 5 then raise; end if;   -- Code gerade vergeben: neu ziehen
    end;
  end loop;

  -- Der Host ist immer dabei und steht auf Platz 1
  insert into public.match_players (match_id, player_id, team, position, is_host)
  values (m.id, me, 1, case when p_detail = 'full' and p_mode = 'double' then 'off' end, true);

  -- Regeln (Vorsprung, Obergrenze, Unentschieden) über dieselbe Prüfung wie beim Ändern
  if p_rules is not null and p_rules <> '{}'::jsonb then
    m := public.update_match_rules(m.id,
      p_win_by  => (p_rules->>'win_by')::smallint,
      p_scope   => p_rules->>'scope',
      p_cap     => (p_rules->>'cap')::smallint,
      p_draw_at => (p_rules->>'draw_at')::smallint);
  end if;

  return m;
end;
$$;
revoke execute on function public.create_lobby(text, text, smallint, smallint, uuid, text, jsonb) from public, anon;
grant execute on function public.create_lobby(text, text, smallint, smallint, uuid, text, jsonb) to authenticated;

-- my_ratings / leaderboard: Unentschieden mitliefern
create or replace function public.my_ratings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.my_player_id() as id)
  select jsonb_build_object(
    'me', (select id from me),
    'single', (select jsonb_build_object('rating', round(rating)::int, 'games', games, 'wins', wins, 'draws', draws)
                 from public.ratings where player_id = (select id from me) and kind = 'single'),
    'double', (select jsonb_build_object('rating', round(rating)::int, 'games', games, 'wins', wins, 'draws', draws)
                 from public.ratings where player_id = (select id from me) and kind = 'double'),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
                  'partner', p.id, 'nick', p.nickname, 'kind', p.kind,
                  'rating', round(t.rating)::int, 'games', t.games, 'wins', t.wins, 'draws', t.draws, 'draws', t.draws)
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

create or replace function public.leaderboard(p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_kind in ('single', 'double') then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nick', p.nickname,
               'rating', round(r.rating)::int, 'games', r.games, 'wins', r.wins, 'draws', r.draws,
               'me', p.id = public.my_player_id()) order by r.rating desc, p.nickname)
        from public.ratings r join public.players p on p.id = r.player_id
       where r.kind = p_kind and r.games >= 10
         and p.kind = 'account' and p.ranking_opt_in and p.deleted_at is null), '[]'::jsonb)
    when p_kind = 'team' then coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id || '+' || b.id,
               'nick', a.nickname || ' & ' || b.nickname,
               'rating', round(t.rating)::int, 'games', t.games, 'wins', t.wins, 'draws', t.draws,
               'me', public.my_player_id() in (a.id, b.id)) order by t.rating desc)
        from public.team_ratings t
        join public.players a on a.id = t.p1 join public.players b on b.id = t.p2
       where t.games >= 10
         and a.kind = 'account' and a.ranking_opt_in and a.deleted_at is null
         and b.kind = 'account' and b.ranking_opt_in and b.deleted_at is null), '[]'::jsonb)
  end
$$;

-- Bestehende Spiele nach den neuen Regeln (Option A) neu werten
select public.recompute_ratings();
