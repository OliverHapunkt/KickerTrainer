-- Paket 4, Schritt 3b: Lobby und Beitritt per Code
--
-- Bisher (3a) legte create_match ein Spiel direkt als 'running' an – das reicht,
-- solange nur der Host und seine Gäste mitspielen. Für Mitspieler mit eigenem
-- Konto braucht es einen Zwischenzustand: die Lobby.
--
-- Ablauf: create_lobby → andere treten mit join_match_by_code bei → der Host
-- ordnet die Teams zu (direkt über match_players, dafür gibt es schon Regeln)
-- → start_match prüft die Aufstellung und startet.
--
-- Warum der Beitritt eine Funktion mit erhöhten Rechten ist: Wer beitreten will,
-- darf das Spiel vorher nicht sehen. Ein direktes INSERT würde voraussetzen, dass
-- man die Spiel-ID kennt und lesen darf – und wäre damit durchprobierbar.
-- Die Funktion gibt bei falschem Code bewusst immer dieselbe Meldung zurück.
--
-- Offen bleibt: Eine Begrenzung der Versuche gibt es nicht. Der Code gilt nur
-- in der Lobby und höchstens 12 Stunden, und wer sich hineinrät, landet
-- sichtbar in der Liste des Hosts und kann entfernt werden. Mehr Schutz wäre
-- eine eigene Tabelle für Fehlversuche – das lohnt erst bei mehr Nutzern.

-- ---------------------------------------------------------------------------
-- Lobby öffnen: Spiel ohne Aufstellung, mit Beitrittscode
-- ---------------------------------------------------------------------------
create function public.create_lobby(
  p_mode          text,
  p_detail        text,
  p_goals_per_set smallint,
  p_sets_to_win   smallint,
  p_group_id      uuid
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
  if p_group_id is not null and not public.is_group_member(p_group_id) then
    raise exception 'Du bist nicht in dieser Gruppe' using errcode = 'P0001';
  end if;

  for i in 1..5 loop
    begin
      insert into public.matches
        (host_id, mode, detail, goals_per_set, sets_to_win, group_id, state, join_code)
      values
        (me, p_mode, p_detail,
         greatest(1, least(50, coalesce(p_goals_per_set, 5))),
         greatest(1, least(5,  coalesce(p_sets_to_win, 2))),
         p_group_id, 'lobby', public.gen_code(6, '0123456789'))
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

revoke execute on function public.create_lobby(text, text, smallint, smallint, uuid) from public, anon;
grant execute on function public.create_lobby(text, text, smallint, smallint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Einem Spiel per Code beitreten
-- ---------------------------------------------------------------------------
create function public.join_match_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   uuid := public.my_player_id();
  m    public.matches;
  cap    int;
  n1     int;
  n2     int;
  v_team smallint;   -- nicht "team": das ist zugleich ein Spaltenname und wäre mehrdeutig
begin
  if me is null then
    raise exception 'Zum Mitspielen wird erst ein Nickname benötigt' using errcode = 'P0001';
  end if;

  select * into m from public.matches
   where join_code = btrim(coalesce(p_code, ''))
     and state = 'lobby'
     and (code_expires_at is null or code_expires_at > now());

  -- Bewusst dieselbe Meldung für „gibt es nicht“, „abgelaufen“ und „schon gestartet“:
  -- sonst ließe sich herauslesen, welche Codes existieren.
  if m.id is null then
    raise exception 'Kein offenes Spiel mit diesem Code' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.match_players where match_id = m.id and player_id = me) then
    return m.id;   -- schon drin: kein Fehler, einfach weiterleiten
  end if;

  cap := case when m.mode = 'single' then 1 else 2 end;
  select count(*) filter (where team = 1), count(*) filter (where team = 2)
    into n1, n2 from public.match_players where match_id = m.id;

  if n1 + n2 >= cap * 2 then
    raise exception 'Das Spiel ist schon voll' using errcode = 'P0001';
  end if;

  -- In das Team mit weniger Leuten; bei Gleichstand ins zweite, weil der Host im ersten steht
  v_team := case when n1 <= n2 and n1 < cap then 1 else 2 end;
  if v_team = 2 and n2 >= cap then v_team := 1; end if;

  insert into public.match_players (match_id, player_id, team, position, is_host)
  values (m.id, me, v_team,
          case when m.detail = 'full' and m.mode = 'double' then
            case when exists (select 1 from public.match_players mp
                               where mp.match_id = m.id and mp.team = v_team and mp.position = 'off')
                 then 'def' else 'off' end
          end,
          false);

  return m.id;
end;
$$;

revoke execute on function public.join_match_by_code(text) from public, anon;
grant execute on function public.join_match_by_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Lobby verlassen (nicht als Host – der bricht ab oder startet)
-- ---------------------------------------------------------------------------
create function public.leave_match(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_player_id();
  m  public.matches;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return; end if;
  if m.state <> 'lobby' then
    raise exception 'Das Spiel läuft schon' using errcode = 'P0001';
  end if;
  if m.host_id = me then
    raise exception 'Der Host kann die Lobby nur abbrechen' using errcode = 'P0001';
  end if;
  delete from public.match_players where match_id = p_match and player_id = me;
end;
$$;

revoke execute on function public.leave_match(uuid) from public, anon;
grant execute on function public.leave_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Spiel aus der Lobby heraus starten
-- Prüft die Aufstellung erst hier – vorher darf sie unvollständig sein.
-- ---------------------------------------------------------------------------
create function public.start_match(p_match uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m    public.matches;
  need int;
  n1   int;
  n2   int;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;
  if m.host_id <> public.my_player_id() then
    raise exception 'Nur der Host startet das Spiel' using errcode = '42501';
  end if;
  if m.state <> 'lobby' then
    raise exception 'Das Spiel läuft schon' using errcode = 'P0001';
  end if;

  need := case when m.mode = 'single' then 1 else 2 end;
  select count(*) filter (where team = 1), count(*) filter (where team = 2)
    into n1, n2 from public.match_players where match_id = p_match;
  if n1 <> need or n2 <> need then
    raise exception 'Es fehlen noch Spieler (% und % von je %)', n1, n2, need
      using errcode = 'P0001';
  end if;

  -- Im Doppel mit genauer Erfassung muss je Team einmal Sturm und einmal Abwehr stehen
  if m.mode = 'double' and m.detail = 'full' then
    if exists (select 1 from public.match_players
                where match_id = p_match
                group by team
               having count(*) filter (where position = 'off') <> 1
                   or count(*) filter (where position = 'def') <> 1) then
      raise exception 'Je Team werden Sturm und Abwehr gebraucht' using errcode = 'P0001';
    end if;
  end if;

  update public.matches
     set state = 'running', join_code = null, started_at = now()
   where id = p_match
  returning * into m;

  insert into public.match_sets (match_id, set_no, started_at)
  values (p_match, 1, now())
  on conflict do nothing;

  return m;
end;
$$;

revoke execute on function public.start_match(uuid) from public, anon;
grant execute on function public.start_match(uuid) to authenticated;
