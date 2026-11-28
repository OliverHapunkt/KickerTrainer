-- ---------------------------------------------------------------------------
-- Rückgängig auch bei Erfassung „Einfach“ richtig (v3.23)
--
-- Bisher speicherte nur „Voll“ einzelne Tor-Zeilen. Bei „Einfach“ kannte
-- undo_goal das letzte Tor nicht und nahm bei Gleichstand ein Tor von Team 1
-- zurück, auch wenn Team 2 zuletzt getroffen hatte.
-- Jetzt schreibt record_goal immer eine Tor-Zeile (ohne Schütze, wenn „Einfach“).
-- undo_goal löscht die letzte Zeile unabhängig von der Erfassung.
-- Spiele, die vor dieser Migration liefen, haben keine Zeilen: dort gilt wie
-- bisher die Schätzung (Team mit dem höheren Stand).
-- Sonst unverändert gegenüber 20261126140000 (record_goal) und
-- 20261027220000 (undo_goal).
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

  -- Jedes Tor bekommt eine Zeile, auch bei Erfassung „Einfach“. Dann weiß
  -- „Rückgängig“ immer, welches Team zuletzt getroffen hat. Schütze und
  -- Position werden nur bei „Voll“ gespeichert.
  select coalesce(max(seq), 0) + 1 into nextq
    from public.goals where match_id = p_match and set_no = cur.set_no;
  insert into public.goals
    (match_id, set_no, seq, team, scorer_id, scorer_position, own_goal, t)
  values
    (p_match, cur.set_no, nextq, p_team,
     case when m.detail = 'full' and p_scorer is not null and exists (
            select 1 from public.match_players
             where match_id = p_match and player_id = p_scorer)
          then p_scorer end,
     case when m.detail = 'full' and m.mode = 'double' and p_position in ('off', 'def') then p_position end,
     case when m.detail = 'full' then coalesce(p_own, false) else false end, now());

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

create or replace function public.undo_goal(p_match uuid)
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
  if m.state = 'running' then
    null;   -- der Normalfall
  elsif m.state in ('finished', 'confirmed', 'disputed') then
    if m.finished_at is null or m.finished_at < now() - interval '2 hours' then
      raise exception 'Die Korrekturzeit von 2 Stunden ist abgelaufen' using errcode = 'P0001';
    end if;
  else
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

  -- Das letzte Tor des Satzes steht als Zeile da (seit v3.23 auch bei „Einfach“).
  -- Älteres Spiel ohne Zeilen: lastteam bleibt null, siehe unten.
  delete from public.goals
   where match_id = p_match and set_no = tgt.set_no
     and seq = (select max(seq) from public.goals
                 where match_id = p_match and set_no = tgt.set_no)
  returning team into lastteam;
  if lastteam is null then
    lastteam := case when tgt.score1 >= tgt.score2 then 1 else 2 end;
  end if;

  update public.match_sets
     set score1 = greatest(0, score1 - case when lastteam = 1 then 1 else 0 end),
         score2 = greatest(0, score2 - case when lastteam = 2 then 1 else 0 end),
         winner_team = null, finished_at = null
   where match_id = p_match and set_no = tgt.set_no;

  -- War das Spiel schon durch, läuft es wieder – und rev zählt hoch, damit
  -- bereits abgegebene Bestätigungen zur alten Fassung verfallen.
  update public.matches
     set state = 'running', finished_at = null, rated = false, rev = rev + 1
   where id = p_match and state in ('finished', 'confirmed', 'disputed');

  return public.match_state(p_match);
end;
$$;
