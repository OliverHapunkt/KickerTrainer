-- Paket 4, Schritt 4: Bestätigung des Ergebnisses und Korrektur
--
-- Ein Spiel zählt erst, wenn beide Seiten das Ergebnis bestätigt haben. Nur der
-- Host zählt die Tore – also braucht es eine Gegenprobe, sonst stünde das Elo
-- aller Beteiligten auf dem Wort einer einzigen Person.
--
-- Wann gilt ein Team als bestätigt:
--   * Das Team des Hosts: automatisch. Er hat das Ergebnis selbst eingetragen
--   * Ein Team ohne Konto-Spieler (nur Gäste): automatisch. Der Host steht dafür
--     ein – sonst könnte ein Spiel mit Gästen nie gewertet werden
--   * Jedes andere Team: mindestens ein 'ok' von einem seiner Konto-Spieler
-- Sagt irgendjemand 'reject', ist das Spiel strittig und wird nicht gewertet.
--
-- Die Bestätigung hängt an matches.rev. Ändert der Host nachträglich etwas,
-- zählt rev hoch und alle alten Bestätigungen verfallen automatisch – sie
-- gehören dann zu einer anderen Fassung des Ergebnisses. Deshalb werden sie
-- nicht gelöscht: So bleibt nachvollziehbar, wer was wann bestätigt hat.

-- ---------------------------------------------------------------------------
-- Gilt dieses Team für die aktuelle Fassung als bestätigt?
-- ---------------------------------------------------------------------------
create function public.team_confirmed(p_match uuid, p_team smallint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select * from public.matches where id = p_match),
  -- Wer aus diesem Team kann überhaupt bestätigen? Gäste nicht, gelöschte Konten
  -- auch nicht (die haben keine user_id mehr).
  able as (
    select mp.player_id
      from public.match_players mp
      join public.players p on p.id = mp.player_id
     where mp.match_id = p_match and mp.team = p_team
       and p.kind = 'account' and p.user_id is not null)
  select
    -- Team des Hosts, oder niemand darin, der bestätigen könnte
    exists (select 1 from public.match_players mp, m
             where mp.match_id = p_match and mp.team = p_team and mp.player_id = m.host_id)
    or not exists (select 1 from able)
    or exists (select 1 from public.match_confirmations c, m
                where c.match_id = p_match and c.rev = m.rev and c.decision = 'ok'
                  and c.player_id in (select player_id from able))
$$;

revoke execute on function public.team_confirmed(uuid, smallint) from public, anon;
grant execute on function public.team_confirmed(uuid, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- Zustand eines beendeten Spiels aus den Bestätigungen ableiten
--
-- Wird an zwei Stellen gebraucht: wenn jemand bestätigt, UND wenn das Spiel
-- endet. Ohne den zweiten Aufruf bliebe ein Spiel, bei dem beide Teams
-- automatisch als bestätigt gelten (Host plus reine Gäste), für immer auf
-- 'finished' stehen – und wäre damit nie wertbar.
-- ---------------------------------------------------------------------------
create function public.settle_match(p_match uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or m.state not in ('finished', 'disputed', 'confirmed') then
    return coalesce(m.state, 'unbekannt');
  end if;

  if exists (select 1 from public.match_confirmations
              where match_id = p_match and rev = m.rev and decision = 'reject') then
    if m.state <> 'disputed' then
      update public.matches set state = 'disputed' where id = p_match;
    end if;
    return 'disputed';
  end if;

  if public.team_confirmed(p_match, 1::smallint)
     and public.team_confirmed(p_match, 2::smallint) then
    if m.state <> 'confirmed' then
      update public.matches set state = 'confirmed' where id = p_match;
    end if;
    return 'confirmed';
  end if;

  if m.state <> 'finished' then
    update public.matches set state = 'finished' where id = p_match;
  end if;
  return 'finished';
end;
$$;

revoke execute on function public.settle_match(uuid) from public, anon;
grant execute on function public.settle_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Ergebnis bestätigen oder widersprechen
-- ---------------------------------------------------------------------------
create function public.confirm_match(
  p_match    uuid,
  p_decision text,
  p_comment  text default null
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
    raise exception 'Kein Spielerprofil' using errcode = 'P0001';
  end if;
  if p_decision not in ('ok', 'reject') then
    raise exception 'Unbekannte Entscheidung' using errcode = 'P0001';
  end if;

  select * into m from public.matches where id = p_match;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;
  if m.state not in ('finished', 'disputed') then
    raise exception 'In diesem Zustand gibt es nichts zu bestätigen' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.match_players
                  where match_id = p_match and player_id = me) then
    raise exception 'Du hast bei diesem Spiel nicht mitgespielt' using errcode = '42501';
  end if;
  if exists (select 1 from public.match_confirmations
              where match_id = p_match and player_id = me and rev = m.rev) then
    raise exception 'Du hast dich zu dieser Fassung schon geäußert' using errcode = 'P0001';
  end if;

  insert into public.match_confirmations (match_id, player_id, rev, decision, comment)
  values (p_match, me, m.rev, p_decision, nullif(btrim(coalesce(p_comment, '')), ''));

  perform public.settle_match(p_match);
  select * into m from public.matches where id = p_match;
  return m;
end;
$$;

revoke execute on function public.confirm_match(uuid, text, text) from public, anon;
grant execute on function public.confirm_match(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Ergebnis korrigieren: Spiel wieder aufnehmen
--
-- Innerhalb von 2 Stunden nach Spielende. Danach ist das Ergebnis endgültig –
-- sonst könnte jemand Wochen später an gewerteten Spielen drehen.
-- Das Spiel geht zurück auf 'running', der Host korrigiert mit den normalen
-- Mitteln (Tor zählen, zurücknehmen) und beendet es erneut. rev zählt hoch,
-- damit alle Bestätigungen der alten Fassung verfallen.
-- ---------------------------------------------------------------------------
create function public.reopen_match(p_match uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;
  if m.host_id <> public.my_player_id() then
    raise exception 'Nur der Host kann das Ergebnis korrigieren' using errcode = '42501';
  end if;
  if m.state not in ('finished', 'confirmed', 'disputed') then
    raise exception 'In diesem Zustand nicht möglich' using errcode = 'P0001';
  end if;
  if m.finished_at is null or m.finished_at < now() - interval '2 hours' then
    raise exception 'Die Korrekturzeit von 2 Stunden ist abgelaufen' using errcode = 'P0001';
  end if;

  -- Der letzte Satz wird wieder der laufende. Ohne das stünde das Spiel auf
  -- 'running', hätte aber keinen laufenden Satz: match_state meldete Satz null
  -- und Stand 0:0, obwohl die Sätze noch gespeichert sind. Der Stand bleibt
  -- stehen wie er war – der Host korrigiert ihn mit Zurücknehmen und Zählen.
  delete from public.match_sets
   where match_id = p_match and winner_team is null and score1 = 0 and score2 = 0
     and set_no > 1;
  update public.match_sets
     set winner_team = null, finished_at = null
   where match_id = p_match
     and set_no = (select max(set_no) from public.match_sets where match_id = p_match);

  update public.matches
     set state = 'running', finished_at = null, rated = false, rev = rev + 1
   where id = p_match
  returning * into m;
  return m;
end;
$$;

revoke execute on function public.reopen_match(uuid) from public, anon;
grant execute on function public.reopen_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- undo_goal: Zurücknehmen ist die Korrektur
--
-- Zwei Änderungen gegenüber Migration 20261027170000:
--
-- 1. Es zählt rev hoch, wenn ein beendetes Spiel wieder aufgemacht wird. Vorher
--    fehlte das: Hatte schon jemand bestätigt und der Host nahm danach ein Tor
--    zurück, galt die alte Bestätigung weiter – sie gehörte dann aber zu einem
--    anderen Ergebnis.
--
-- 2. Es geht auch bei 'confirmed' und 'disputed', solange die Korrekturzeit von
--    2 Stunden läuft. Grund: Ein Spiel aus Host und Gästen steht sofort auf
--    'confirmed'. Müsste der Host dort erst „wieder aufmachen“, wäre das reine
--    Umständlichkeit – es hat ja niemand zugestimmt, der überstimmt werden
--    könnte. Nach den 2 Stunden ist auch Zurücknehmen vorbei.
-- ---------------------------------------------------------------------------
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

  -- War das Spiel schon durch, läuft es wieder – und rev zählt hoch, damit
  -- bereits abgegebene Bestätigungen zur alten Fassung verfallen.
  update public.matches
     set state = 'running', finished_at = null, rated = false, rev = rev + 1
   where id = p_match and state in ('finished', 'confirmed', 'disputed');

  return public.match_state(p_match);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_goal: am Spielende die Bestätigungslage auswerten
--
-- Ein Spiel aus Host und Gästen gilt sofort als bestätigt. Ohne diesen Aufruf
-- bliebe es auf 'finished' hängen und wäre nie wertbar.
-- Sonst unverändert gegenüber Migration 20261027170000.
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

  if greatest(s1, s2) >= m.goals_per_set then
    update public.match_sets
       set winner_team = case when s1 > s2 then 1 else 2 end, finished_at = now()
     where match_id = p_match and set_no = cur.set_no;

    select count(*) into wins from public.match_sets
     where match_id = p_match and winner_team = case when s1 > s2 then 1 else 2 end;

    if wins >= m.sets_to_win then
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
