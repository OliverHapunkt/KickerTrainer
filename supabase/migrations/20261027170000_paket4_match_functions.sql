-- Paket 4, Schritt 3a: Funktionen zum Erfassen eines Spiels
--
-- Warum Funktionen und nicht direkte INSERTs über die Zugriffsregeln:
--
--   create_match  Spiel, Aufstellung und erster Satz müssen zusammen entstehen.
--                 Bricht etwas ab, soll kein halbes Spiel übrig bleiben.
--   record_goal   Satzstand und Tor-Zeile müssen zusammen geschrieben werden.
--                 Zwei getrennte Aufrufe würden bei wackliger Verbindung
--                 auseinanderlaufen, und maßgeblich ist der Satzstand.
--                 Die Funktion erkennt außerdem Satz- und Spielende und legt
--                 den nächsten Satz an – der Client muss diese Regeln nicht kennen.
--   undo_goal     Spiegelbild dazu.
--
-- Noch nicht enthalten: Beitritt per Code (Schritt 3b) und Bestätigung (Schritt 4).
-- Deshalb legt create_match das Spiel direkt als 'running' ohne Beitrittscode an.

-- ---------------------------------------------------------------------------
-- Darf ich diesen Spieler in ein Spiel stellen?
-- Ich selbst, ein Gast von mir, oder ein Gast einer Gruppe, in der ich bin.
-- Fremde Konten kommen später über den Beitritt per Code dazu, nicht hierüber.
-- ---------------------------------------------------------------------------
create function public.can_use_player(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.players x
     where x.id = p and x.deleted_at is null
       and ( x.id = public.my_player_id()
          or (x.kind = 'guest' and x.owner_id = public.my_player_id())
          or (x.kind = 'guest' and x.group_id is not null
              and public.is_group_member(x.group_id))))
$$;

revoke execute on function public.can_use_player(uuid) from public, anon;
grant execute on function public.can_use_player(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Spiel anlegen: Spiel + Aufstellung + erster Satz in einem Schritt
-- p_players: [{"player_id":"…","team":1,"position":"off"}, …]
-- ---------------------------------------------------------------------------
create function public.create_match(
  p_mode          text,
  p_detail        text,
  p_goals_per_set smallint,
  p_sets_to_win   smallint,
  p_group_id      uuid,
  p_players       jsonb
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
     state, join_code, started_at)
  values
    (me, p_mode, p_detail,
     greatest(1, least(50, coalesce(p_goals_per_set, 5))),
     greatest(1, least(5,  coalesce(p_sets_to_win, 2))),
     p_group_id, 'running', null, now())
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

revoke execute on function public.create_match(text, text, smallint, smallint, uuid, jsonb)
  from public, anon;
grant execute on function public.create_match(text, text, smallint, smallint, uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Stand eines Spiels als jsonb – was der Zählbildschirm braucht
-- ---------------------------------------------------------------------------
create function public.match_state(p_match uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select * from public.matches where id = p_match),
  s as (select * from public.match_sets where match_id = p_match),
  w as (select count(*) filter (where winner_team = 1) as sets1,
               count(*) filter (where winner_team = 2) as sets2 from s),
  cur as (select * from s where winner_team is null order by set_no limit 1)
  select jsonb_build_object(
    'state',      (select state from m),
    'set_no',     (select set_no from cur),
    'score1',     coalesce((select score1 from cur), 0),
    'score2',     coalesce((select score2 from cur), 0),
    'sets1',      (select sets1 from w),
    'sets2',      (select sets2 from w),
    'match_done', (select state from m) <> 'running',
    'sets',       coalesce((select jsonb_agg(jsonb_build_object(
                     'set_no', set_no, 'score1', score1, 'score2', score2,
                     'winner_team', winner_team) order by set_no) from s), '[]'::jsonb))
$$;

revoke execute on function public.match_state(uuid) from public, anon;
grant execute on function public.match_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Ein Tor zählen
-- p_team ist immer das Team, das den Punkt bekommt. p_own markiert ein Eigentor,
-- der Schütze gehört dann zum anderen Team.
-- ---------------------------------------------------------------------------
create function public.record_goal(
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

  -- Tor-Zeile nur bei genauer Erfassung
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

  -- Satz gewonnen?
  if greatest(s1, s2) >= m.goals_per_set then
    update public.match_sets
       set winner_team = case when s1 > s2 then 1 else 2 end, finished_at = now()
     where match_id = p_match and set_no = cur.set_no;

    select count(*) into wins from public.match_sets
     where match_id = p_match and winner_team = case when s1 > s2 then 1 else 2 end;

    if wins >= m.sets_to_win then
      update public.matches set state = 'finished', finished_at = now() where id = p_match;
    else
      insert into public.match_sets (match_id, set_no, started_at)
      values (p_match, cur.set_no + 1, now());
    end if;
  end if;

  return public.match_state(p_match);
end;
$$;

revoke execute on function public.record_goal(uuid, smallint, uuid, text, boolean)
  from public, anon;
grant execute on function public.record_goal(uuid, smallint, uuid, text, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Letztes Tor zurücknehmen
-- Geht auch über ein Satzende hinweg: Der eben angelegte nächste Satz wird dann
-- wieder entfernt und der vorherige Satz läuft weiter.
-- ---------------------------------------------------------------------------
create function public.undo_goal(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m   public.matches;
  tgt public.match_sets;
  lastteam smallint;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;
  if m.host_id <> public.my_player_id() then
    raise exception 'Nur der Host zählt die Tore' using errcode = '42501';
  end if;
  if m.state not in ('running', 'finished') then
    raise exception 'In diesem Zustand nicht möglich' using errcode = 'P0001';
  end if;

  -- Leeren Folgesatz wegräumen, damit der vorherige Satz wieder der laufende ist
  delete from public.match_sets
   where match_id = p_match and winner_team is null and score1 = 0 and score2 = 0
     and set_no > 1
     and exists (select 1 from public.match_sets s2
                  where s2.match_id = p_match and s2.set_no = public.match_sets.set_no - 1
                    and s2.winner_team is not null);

  select * into tgt from public.match_sets
   where match_id = p_match and (score1 + score2) > 0
   order by set_no desc limit 1;
  if tgt.set_no is null then
    raise exception 'Es gibt kein Tor zum Zurücknehmen' using errcode = 'P0001';
  end if;

  if m.detail = 'full' then
    delete from public.goals
     where match_id = p_match and set_no = tgt.set_no
       and seq = (select max(seq) from public.goals
                   where match_id = p_match and set_no = tgt.set_no)
    returning team into lastteam;
  end if;
  if lastteam is null then
    lastteam := case when tgt.score1 >= tgt.score2 then 1 else 2 end;
  end if;

  update public.match_sets
     set score1 = greatest(0, score1 - case when lastteam = 1 then 1 else 0 end),
         score2 = greatest(0, score2 - case when lastteam = 2 then 1 else 0 end),
         winner_team = null, finished_at = null
   where match_id = p_match and set_no = tgt.set_no;

  -- Das Spiel war vielleicht schon beendet: Es läuft wieder
  update public.matches
     set state = 'running', finished_at = null, rated = false
   where id = p_match and state = 'finished';

  return public.match_state(p_match);
end;
$$;

revoke execute on function public.undo_goal(uuid) from public, anon;
grant execute on function public.undo_goal(uuid) to authenticated;
