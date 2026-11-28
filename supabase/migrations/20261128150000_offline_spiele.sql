-- ---------------------------------------------------------------------------
-- Offline-Spiele (v3.25)
--
-- Ohne Netz legt das Gerät ein Spiel selbst an (Nummer vom Gerät), zählt lokal
-- und lädt es später in einem Stück hoch. Gilt nur für Spiele aus Host und
-- eigenen Gästen – genau die, die create_match ohnehin erlaubt.
--
-- 1. create_match bekommt p_id (optional): die Nummer vom Gerät.
-- 2. import_match legt das Spiel an und spielt die Tore der Reihe nach über
--    record_goal ein. Damit gelten exakt dieselben Regeln wie beim Live-Zählen.
--    Alles in einer Transaktion: entweder das ganze Spiel oder nichts.
--    Wiederholbar: Ist das Spiel schon da (z. B. Antwort ging verloren), kommt
--    nur der Stand zurück.
-- ---------------------------------------------------------------------------

drop function public.create_match(text, text, smallint, smallint, uuid, jsonb, text, jsonb);

create function public.create_match(
  p_mode          text,
  p_detail        text,
  p_goals_per_set smallint,
  p_sets_to_win   smallint,
  p_group_id      uuid,
  p_players       jsonb,
  p_category      text default 'ranked',
  p_rules         jsonb default null,
  p_id            uuid  default null
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
  -- p_id: Nummer vom Gerät (Offline-Spiel). Sonst vergibt die Datenbank eine.
  insert into public.matches
    (id, host_id, mode, detail, goals_per_set, sets_to_win, group_id,
     state, join_code, started_at, category)
  values
    (coalesce(p_id, gen_random_uuid()), me, p_mode, p_detail,
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
revoke execute on function public.create_match(text, text, smallint, smallint, uuid, jsonb, text, jsonb, uuid) from public, anon;
grant execute on function public.create_match(text, text, smallint, smallint, uuid, jsonb, text, jsonb, uuid) to authenticated;

create function public.import_match(
  p_id            uuid,
  p_mode          text,
  p_detail        text,
  p_goals_per_set smallint,
  p_sets_to_win   smallint,
  p_players       jsonb,
  p_category      text,
  p_rules         jsonb,
  p_goals         jsonb,
  p_started_at    timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := public.my_player_id();
  m      public.matches;
  g      jsonb;
  t0     timestamptz;
  gt     timestamptz;
  lastt  timestamptz;
begin
  if me is null then
    raise exception 'Zum Spielen wird erst ein Nickname benötigt' using errcode = 'P0001';
  end if;
  if p_id is null then
    raise exception 'Spiel-Nummer fehlt' using errcode = 'P0001';
  end if;
  if p_goals is null or jsonb_typeof(p_goals) <> 'array' then
    raise exception 'Tore fehlen' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_goals) > 1000 then
    raise exception 'Zu viele Tore' using errcode = 'P0001';
  end if;

  -- Zeitangaben vom Gerät nur in vernünftigen Grenzen übernehmen
  t0 := least(now(), greatest(now() - interval '60 days', coalesce(p_started_at, now())));

  select * into m from public.matches where id = p_id;
  if m.id is not null then
    if m.host_id <> me then
      raise exception 'Diese Spiel-Nummer ist schon vergeben' using errcode = 'P0001';
    end if;
    -- Schon hochgeladen (Tore da oder nicht mehr laufend): nichts doppelt eintragen
    if m.state <> 'running'
       or exists (select 1 from public.goals where match_id = p_id) then
      return public.match_state(p_id);
    end if;
    -- Sonst: Anlegen klappte noch online, die Tore kamen offline dazu → einspielen
  else
    perform public.create_match(p_mode, p_detail, p_goals_per_set, p_sets_to_win,
      null, p_players, p_category, p_rules, p_id);
  end if;

  lastt := t0;
  for g in select value from jsonb_array_elements(p_goals) loop
    perform public.record_goal(p_id, (g->>'team')::smallint,
      nullif(g->>'scorer', '')::uuid, g->>'position', coalesce((g->>'own')::boolean, false));
    -- Zeit des Tors: aufsteigend, nicht vor dem Spielbeginn, nicht in der Zukunft
    gt := least(now(), greatest(lastt, coalesce(to_timestamp((g->>'t')::double precision / 1000), lastt)));
    lastt := gt;
    update public.goals set t = gt
     where match_id = p_id
       and (set_no, seq) = (select set_no, seq from public.goals
                             where match_id = p_id order by set_no desc, seq desc limit 1);
  end loop;

  -- Zeiten von Sätzen und Spiel aus den Toren ableiten
  update public.match_sets s
     set started_at = coalesce((select min(x.t) from public.goals x
                                 where x.match_id = s.match_id and x.set_no = s.set_no), lastt),
         finished_at = case when s.winner_team is not null then
                         (select max(x.t) from public.goals x
                           where x.match_id = s.match_id and x.set_no = s.set_no) end
   where s.match_id = p_id;
  update public.matches
     set started_at = t0, created_at = t0,
         finished_at = case when finished_at is not null then lastt end
   where id = p_id;

  return public.match_state(p_id);
end;
$$;
revoke execute on function public.import_match(uuid, text, text, smallint, smallint, jsonb, text, jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.import_match(uuid, text, text, smallint, smallint, jsonb, text, jsonb, jsonb, timestamptz) to authenticated;
