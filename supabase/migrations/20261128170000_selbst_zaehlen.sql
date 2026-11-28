-- ---------------------------------------------------------------------------
-- Jeder zählt am eigenen Handy (v3.26)
--
-- Bisher zählte nur der Host. Jetzt kann jeder Mitspieler mit Konto selbst
-- zählen – Entscheidungen Oliver 28.11.2026:
--   * device in match_players: 'own' = eigenes Handy (nur eigene Tore),
--     'team' = Team-Handy (Tore des eigenen Teams, Schütze wählbar),
--     null = zählt nicht (der Host zählt)
--   * Je Team entweder ein Team-Handy oder eigene Handys – nie beides,
--     sonst landet dasselbe Tor zweimal
--   * Nie Tore für den Gegner. Ein Eigentor des Gegners trägt das Team ein,
--     das den Punkt bekommt
--   * Zurücknehmen (immer nur das letzte Tor des Spiels): Host, wer es
--     eingetragen hat, der Schütze, das Team-Handy dieses Teams. Gegner nie
--   * Der Host darf immer alles – er ist der Rückfall, wenn ein Handy kein
--     Netz hat
--   * Position tauschen („ich übernehme vorne“) darf das Team selbst
-- goals.by_player hält fest, wer das Tor eingetragen hat.
-- record_goal sperrt das Spiel (for update): Tippen zwei Handys gleichzeitig,
-- werden die Tore nacheinander gezählt statt sich zu überschreiben.
-- ---------------------------------------------------------------------------

alter table public.match_players
  add column device text check (device is null or device in ('own', 'team'));

alter table public.goals
  add column by_player uuid references public.players (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Wie zähle ich mit? Nur für mich selbst, in Lobby oder laufendem Spiel.
-- ---------------------------------------------------------------------------
create function public.set_device(p_match uuid, p_device text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   uuid := public.my_player_id();
  m    public.matches;
  mine public.match_players;
  mate record;
  dev  text := nullif(p_device, '');
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;
  select * into mine from public.match_players where match_id = p_match and player_id = me;
  if mine.player_id is null then
    raise exception 'Du spielst in diesem Spiel nicht mit' using errcode = '42501';
  end if;
  if m.state not in ('lobby', 'running') then
    raise exception 'Das Spiel läuft nicht mehr' using errcode = 'P0001';
  end if;
  if dev is not null and dev not in ('own', 'team') then
    raise exception 'Unbekannte Zählweise' using errcode = 'P0001';
  end if;
  if m.mode = 'single' and dev = 'team' then dev := 'own'; end if;   -- im Einzel dasselbe

  if dev is not null then
    select mp.device, p.nickname into mate
      from public.match_players mp join public.players p on p.id = mp.player_id
     where mp.match_id = p_match and mp.team = mine.team and mp.player_id <> me
       and mp.device is not null
     limit 1;
    if mate.device = 'team' then
      raise exception '% zählt schon mit dem Team-Handy für euch', mate.nickname using errcode = 'P0001';
    end if;
    if dev = 'team' and mate.device = 'own' then
      raise exception '% zählt schon selbst. Dann zählt jeder seine eigenen Tore', mate.nickname using errcode = 'P0001';
    end if;
  end if;

  update public.match_players set device = dev
   where match_id = p_match and player_id = me;
end;
$$;
revoke execute on function public.set_device(uuid, text) from public, anon;
grant execute on function public.set_device(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Sturm und Abwehr eines Teams tauschen: Host oder jemand aus dem Team
-- ---------------------------------------------------------------------------
create function public.swap_positions(p_match uuid, p_team smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_player_id();
  m  public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;
  if m.host_id <> me and not exists (select 1 from public.match_players
       where match_id = p_match and player_id = me and team = p_team) then
    raise exception 'Nur das eigene Team tauscht seine Positionen' using errcode = '42501';
  end if;
  if m.state not in ('lobby', 'running') then
    raise exception 'Das Spiel läuft nicht mehr' using errcode = 'P0001';
  end if;
  if m.mode <> 'double' or m.detail <> 'full' then
    raise exception 'Positionen gibt es nur im Doppel mit Erfassung „Erweitert“' using errcode = 'P0001';
  end if;
  update public.match_players
     set position = case position when 'off' then 'def' when 'def' then 'off' end
   where match_id = p_match and team = p_team and position is not null;
end;
$$;
revoke execute on function public.swap_positions(uuid, smallint) from public, anon;
grant execute on function public.swap_positions(uuid, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- Tor zählen: wie bisher, plus Mitzählen vom eigenen Handy
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
  me     uuid := public.my_player_id();
  m      public.matches;
  mine   public.match_players;
  sc     public.match_players;
  cur    public.match_sets;
  nextq  int;
  s1     smallint;
  s2     smallint;
  wins   int;
  sw     smallint;
  scorer uuid := p_scorer;
  pos    text := p_position;
  own    boolean := coalesce(p_own, false);
begin
  -- Sperre: gleichzeitige Tore von zwei Handys werden nacheinander gezählt
  select * into m from public.matches where id = p_match for update;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;
  if p_team not in (1, 2) then
    raise exception 'Unbekanntes Team' using errcode = 'P0001';
  end if;

  if m.host_id <> me then
    select * into mine from public.match_players where match_id = p_match and player_id = me;
    if mine.player_id is null or mine.device is null then
      raise exception 'Nur der Host zählt die Tore' using errcode = '42501';
    end if;
    if mine.team <> p_team then
      raise exception 'Du zählst nur Tore für dein Team' using errcode = '42501';
    end if;
    if m.detail = 'full' then
      if own then
        -- Eigentor des Gegners: Schütze muss im anderen Team stehen
        if scorer is null or not exists (select 1 from public.match_players
             where match_id = p_match and player_id = scorer and team <> mine.team) then
          raise exception 'Beim Eigentor steht der Schütze im anderen Team' using errcode = 'P0001';
        end if;
      elsif mine.device = 'own' then
        if scorer is not null and scorer <> me then
          raise exception 'Mit dem eigenen Handy zählst du nur deine eigenen Tore' using errcode = '42501';
        end if;
        scorer := me;
      else
        if scorer is not null and not exists (select 1 from public.match_players
             where match_id = p_match and player_id = scorer and team = mine.team) then
          raise exception 'Der Schütze muss in deinem Team spielen' using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  if m.state <> 'running' then
    raise exception 'Das Spiel läuft nicht mehr' using errcode = 'P0001';
  end if;

  select * into cur from public.match_sets
   where match_id = p_match and winner_team is null order by set_no limit 1;
  if cur.set_no is null then
    raise exception 'Kein laufender Satz' using errcode = 'P0001';
  end if;

  -- Position: ohne Angabe die aktuelle des Schützen (eigenes Handy schickt keine)
  if m.detail = 'full' and m.mode = 'double' and pos is null and scorer is not null then
    select * into sc from public.match_players where match_id = p_match and player_id = scorer;
    pos := sc.position;
  end if;

  select coalesce(max(seq), 0) + 1 into nextq
    from public.goals where match_id = p_match and set_no = cur.set_no;
  insert into public.goals
    (match_id, set_no, seq, team, scorer_id, scorer_position, own_goal, t, by_player)
  values
    (p_match, cur.set_no, nextq, p_team,
     case when m.detail = 'full' and scorer is not null and exists (
            select 1 from public.match_players
             where match_id = p_match and player_id = scorer)
          then scorer end,
     case when m.detail = 'full' and m.mode = 'double' and pos in ('off', 'def') then pos end,
     case when m.detail = 'full' then own else false end, now(), me);

  update public.match_sets
     set score1 = score1 + case when p_team = 1 then 1 else 0 end,
         score2 = score2 + case when p_team = 2 then 1 else 0 end
   where match_id = p_match and set_no = cur.set_no
  returning score1, score2 into s1, s2;

  sw := public.set_end(m, cur.set_no, s1, s2);
  if sw is not null then
    update public.match_sets
       set winner_team = sw, finished_at = now()
     where match_id = p_match and set_no = cur.set_no;

    select count(*) into wins from public.match_sets
     where match_id = p_match and winner_team = sw;

    if sw = 0 or wins >= m.sets_to_win then
      update public.matches set state = 'finished', finished_at = now() where id = p_match;
      perform public.settle_match(p_match);
    else
      insert into public.match_sets (match_id, set_no, started_at)
      values (p_match, cur.set_no + 1, now());
    end if;
  end if;

  return public.match_state(p_match);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rückgängig: der Host wie bisher; Mitspieler nur das letzte Tor, nur im
-- laufenden Spiel und nur, wenn es „ihres“ ist
-- ---------------------------------------------------------------------------
create or replace function public.undo_goal(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   uuid := public.my_player_id();
  m    public.matches;
  mine public.match_players;
  lg   public.goals;
  tgt  public.match_sets;
  lastteam smallint;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null then
    raise exception 'Spiel nicht gefunden' using errcode = 'P0001';
  end if;

  if m.host_id <> me then
    select * into mine from public.match_players where match_id = p_match and player_id = me;
    if mine.player_id is null or mine.device is null then
      raise exception 'Nur der Host zählt die Tore' using errcode = '42501';
    end if;
    if m.state <> 'running' then
      raise exception 'Korrigieren kann nach Spielende nur der Host' using errcode = '42501';
    end if;
    select * into lg from public.goals where match_id = p_match
     order by set_no desc, seq desc limit 1;
    if lg.match_id is null then
      raise exception 'Es gibt kein Tor zum Zurücknehmen' using errcode = 'P0001';
    end if;
    if not (lg.by_player = me
            or (lg.scorer_id = me and not lg.own_goal)
            or (mine.device = 'team' and mine.team = lg.team)) then
      raise exception 'Das letzte Tor hat jemand anderes eingetragen'
        using errcode = '42501';
    end if;
  elsif m.state = 'running' then
    null;
  elsif m.state in ('finished', 'confirmed', 'disputed') then
    if m.finished_at is null or m.finished_at < now() - interval '2 hours' then
      raise exception 'Die Korrekturzeit von 2 Stunden ist abgelaufen' using errcode = 'P0001';
    end if;
  else
    raise exception 'In diesem Zustand nicht möglich' using errcode = 'P0001';
  end if;

  -- Ab hier wie 20261128120000_undo_einfach.sql
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

  update public.matches
     set state = 'running', finished_at = null, rated = false, rev = rev + 1
   where id = p_match and state in ('finished', 'confirmed', 'disputed');

  return public.match_state(p_match);
end;
$$;
