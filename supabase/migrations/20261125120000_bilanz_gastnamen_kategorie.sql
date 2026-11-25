-- ===========================================================================
-- Bilanz (Gegner-Statistik): Gastnamen je Besitzer, Kategorie, Spielverlauf
--
-- 1. Gastnamen waren über ALLE Spieler eindeutig. Legte irgendwer einen Gast
--    „Frank" an, konnte niemand sonst mehr einen „Frank" anlegen – und der Gast
--    sperrte sogar den Nickname „Frank" für ein echtes Konto. Über die
--    Fehlermeldung ließ sich zudem ausprobieren, welche Namen es gibt.
--    Jetzt: Konto-Nicknames bleiben weltweit eindeutig, Gastnamen nur je
--    Besitzer bzw. je Gruppe. Zwei Franks bei verschiedenen Hosts sind zwei
--    getrennte Zeilen mit eigener ID.
-- 2. Gastnamen ab 2 Zeichen (Kürzel wie „JK"), Konten weiter 3–20.
-- 3. matches.category: 'ranked' (zählt für die Wertung) oder 'casual' (locker,
--    nur für die eigene Bilanz). Fällt VOR dem Spiel. Elo (Schritt 5) wertet nur
--    'ranked'. Bestehende Spiele werden 'ranked' – so war es bisher gemeint.
-- 4. my_match_history(): alle eigenen beendeten Spiele in einem Aufruf.
-- ===========================================================================

-- 1. Eindeutigkeit ----------------------------------------------------------
drop index public.players_nickname_key;

create unique index players_account_nick_key
  on public.players (lower(btrim(nickname)))
  where kind = 'account' and deleted_at is null;

create unique index players_guest_owner_nick_key
  on public.players (owner_id, lower(btrim(nickname)))
  where kind = 'guest' and owner_id is not null and deleted_at is null;

create unique index players_guest_group_nick_key
  on public.players (group_id, lower(btrim(nickname)))
  where kind = 'guest' and group_id is not null and deleted_at is null;

-- 2. Länge --------------------------------------------------------------------
alter table public.players drop constraint players_nickname_check;
alter table public.players add constraint players_nickname_check check (
  char_length(btrim(nickname)) <= 20
  and char_length(btrim(nickname)) >= case when kind = 'guest' then 2 else 3 end
);

-- 3. Kategorie ----------------------------------------------------------------
alter table public.matches
  add column category text not null default 'ranked'
  check (category in ('casual', 'ranked'));

-- Neue Fassungen mit Kategorie. Alte Signaturen entfernen, sonst wäre ein Aufruf
-- ohne p_category mehrdeutig. Inhalt sonst unverändert.
drop function public.create_match(text, text, smallint, smallint, uuid, jsonb);
drop function public.create_lobby(text, text, smallint, smallint, uuid);

create function public.create_match(
  p_mode          text,
  p_detail        text,
  p_goals_per_set smallint,
  p_sets_to_win   smallint,
  p_group_id      uuid,
  p_players       jsonb,
  p_category      text default 'ranked'
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

  return m;
end;
$$;
revoke execute on function public.create_match(text, text, smallint, smallint, uuid, jsonb, text)
  from public, anon;
grant execute on function public.create_match(text, text, smallint, smallint, uuid, jsonb, text)
  to authenticated;

create function public.create_lobby(
  p_mode          text,
  p_detail        text,
  p_goals_per_set smallint,
  p_sets_to_win   smallint,
  p_group_id      uuid,
  p_category      text default 'ranked'
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

  return m;
end;
$$;
revoke execute on function public.create_lobby(text, text, smallint, smallint, uuid, text)
  from public, anon;
grant execute on function public.create_lobby(text, text, smallint, smallint, uuid, text)
  to authenticated;

-- 4. Spielverlauf ---------------------------------------------------------------
-- Alle eigenen Spiele mit Ergebnis (finished, confirmed, disputed), neueste zuerst.
-- Enthält nur, was ich ohnehin sehen darf: Spiele, in denen ich mitspiele, und
-- die Nicknames der Beteiligten. Keine user_id, keine E-Mail.
-- Form je Spiel:
--   id, me (meine player_id), at, mode, detail, category, state, host (bin ich Host), team (mein Team),
--   players [{id, nick, kind, team, pos, del}], sets [[score1, score2, winner]],
--   goals [[set_no, team, scorer, position, own_goal]] (nur detail = 'full')
create function public.my_match_history()
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
                    'pos', x.position, 'del', p.deleted_at is not null)
                    order by x.team, x.position nulls last), '[]'::jsonb)
                   from public.match_players x join public.players p on p.id = x.player_id
                  where x.match_id = m.id),
    'sets',     (select coalesce(jsonb_agg(jsonb_build_array(s.score1, s.score2, s.winner_team)
                    order by s.set_no), '[]'::jsonb)
                   from public.match_sets s where s.match_id = m.id),
    'goals',    case when m.detail = 'full' then
                  (select coalesce(jsonb_agg(jsonb_build_array(g.set_no, g.team, g.scorer_id,
                      g.scorer_position, g.own_goal) order by g.set_no, g.seq), '[]'::jsonb)
                     from public.goals g where g.match_id = m.id)
                else '[]'::jsonb end
  ) order by coalesce(m.finished_at, m.started_at, m.created_at) desc), '[]'::jsonb)
  from mine m
$$;
revoke execute on function public.my_match_history() from public, anon;
grant execute on function public.my_match_history() to authenticated;
