-- ---------------------------------------------------------------------------
-- Abbrechen und Löschen mit Zustimmung, Schreibrechte dicht (v3.27)
--
-- Entscheidungen Oliver 28.11.2026:
--   * Abbrechen (ohne Wertung) darf jeder Mitspieler beantragen, die Gegenseite
--     stimmt zu. Gegen reine Gäste entscheidet der Host allein.
--   * Ein beendetes Spiel löschen: einer beantragt, eine Person mit Konto aus
--     dem anderen Team stimmt zu. Endgültig: Spiel, Tore, Bestätigungen weg,
--     die Elo-Wertung wird neu gerechnet (Trigger matches_recompute_ratings_del).
--
-- Lücke geschlossen: Bisher durfte der Host matches, match_sets und goals direkt
-- schreiben – an allen Prüfungen vorbei. Er hätte ein Spiel gegen Konten selbst
-- auf „bestätigt“ setzen (Elo ohne Zustimmung), Stände nachträglich ändern oder
-- Spiele allein löschen können. Die App tat das nicht, die Schnittstelle erlaubte
-- es. Jetzt gehen alle Schreibvorgänge über geprüfte Funktionen. Direkt bleibt
-- nur die Aufstellung in der offenen Lobby (Host).
-- ---------------------------------------------------------------------------

-- 1. Direkte Schreibrechte entziehen -------------------------------------------
drop policy matches_insert on public.matches;
drop policy matches_update on public.matches;
drop policy matches_delete on public.matches;
drop policy ms_insert on public.match_sets;
drop policy ms_update on public.match_sets;
drop policy ms_delete on public.match_sets;
drop policy goals_insert on public.goals;
drop policy goals_update on public.goals;
drop policy goals_delete on public.goals;

-- Aufstellung: nur solange die Lobby offen ist
create function public.in_lobby(p_match uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.matches where id = p_match and state = 'lobby') $$;
revoke execute on function public.in_lobby(uuid) from public, anon;
grant execute on function public.in_lobby(uuid) to authenticated;

drop policy mp_insert on public.match_players;
drop policy mp_update on public.match_players;
drop policy mp_delete on public.match_players;
create policy mp_insert on public.match_players
  for insert to authenticated
  with check (public.is_match_host(match_id) and public.in_lobby(match_id));
create policy mp_update on public.match_players
  for update to authenticated
  using (public.is_match_host(match_id) and public.in_lobby(match_id))
  with check (public.is_match_host(match_id) and public.in_lobby(match_id));
create policy mp_delete on public.match_players
  for delete to authenticated
  using (public.is_match_host(match_id) and public.in_lobby(match_id));

-- 2. Offene Anfrage am Spiel ----------------------------------------------------
alter table public.matches
  add column end_req    text check (end_req is null or end_req in ('cancel', 'delete')),
  add column end_req_by uuid references public.players (id) on delete set null,
  add column end_req_at timestamptz;

-- Wer muss zustimmen, wenn p_by etwas beantragt? Die Konten des anderen Teams.
-- Hat das andere Team keine (nur Gäste), entscheidet der Host – außer er hat
-- selbst beantragt, dann niemand.
create function public.end_approvers(p_match uuid, p_by uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with req as (select team from public.match_players where match_id = p_match and player_id = p_by),
  other as (
    select mp.player_id from public.match_players mp
      join public.players p on p.id = mp.player_id
     where mp.match_id = p_match and mp.team <> (select team from req)
       and p.kind = 'account' and p.deleted_at is null)
  select player_id from other
  union all
  select m.host_id from public.matches m
   where m.id = p_match and m.host_id <> p_by and not exists (select 1 from other)
$$;
revoke execute on function public.end_approvers(uuid, uuid) from public, anon;
grant execute on function public.end_approvers(uuid, uuid) to authenticated;

-- Ausführen (nur intern)
create function public.end_execute(p_match uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'cancel' then
    update public.matches
       set state = 'cancelled', join_code = null, end_req = null, end_req_by = null, end_req_at = null
     where id = p_match;
  else
    delete from public.matches where id = p_match;   -- Tore, Sätze, Bestätigungen per Kaskade
  end if;
end;
$$;
revoke execute on function public.end_execute(uuid, text) from public, anon, authenticated;

-- Passt die Anfrage noch zum Zustand des Spiels?
create function public.end_fits(p_state text, p_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select case p_kind when 'cancel' then p_state in ('lobby', 'running')
                         when 'delete' then p_state in ('finished', 'confirmed', 'disputed')
                         else false end $$;

-- 3. Beantragen -----------------------------------------------------------------
-- Ergebnis: 'done' (sofort ausgeführt) oder 'requested' (wartet auf Zustimmung)
create function public.request_end(p_match uuid, p_kind text)
returns text
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
  if not exists (select 1 from public.match_players where match_id = p_match and player_id = me) then
    raise exception 'Du spielst in diesem Spiel nicht mit' using errcode = '42501';
  end if;
  if p_kind not in ('cancel', 'delete') then
    raise exception 'Unbekannte Anfrage' using errcode = 'P0001';
  end if;
  if not public.end_fits(m.state, p_kind) then
    raise exception '%', case p_kind
      when 'cancel' then 'Abbrechen geht nur, solange das Spiel läuft. Ein beendetes Spiel kannst du löschen'
      else 'Löschen geht erst, wenn das Spiel beendet ist. Ein laufendes Spiel brichst du ab' end
      using errcode = 'P0001';
  end if;

  -- Lobby: noch nichts gespielt. Der Host schließt sie, alle anderen steigen aus.
  if m.state = 'lobby' then
    if m.host_id <> me then
      raise exception 'Die Lobby schließt der Host. Du kannst aussteigen' using errcode = '42501';
    end if;
    perform public.end_execute(p_match, 'cancel');
    return 'done';
  end if;

  -- Die Gegenseite hat dasselbe schon beantragt: Das ist die Zustimmung
  if m.end_req = p_kind and m.end_req_by is not null
     and me in (select public.end_approvers(p_match, m.end_req_by)) then
    perform public.end_execute(p_match, p_kind);
    return 'done';
  end if;

  -- Niemand muss zustimmen (Host gegen reine Gäste)
  if not exists (select 1 from public.end_approvers(p_match, me)) then
    perform public.end_execute(p_match, p_kind);
    return 'done';
  end if;

  update public.matches set end_req = p_kind, end_req_by = me, end_req_at = now() where id = p_match;
  return 'requested';
end;
$$;
revoke execute on function public.request_end(uuid, text) from public, anon;
grant execute on function public.request_end(uuid, text) to authenticated;

-- 4. Antworten ------------------------------------------------------------------
-- Ergebnis: 'done', 'rejected', 'withdrawn' oder 'stale' (Anfrage passte nicht mehr)
create function public.answer_end(p_match uuid, p_ok boolean)
returns text
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
  if m.end_req is null then
    raise exception 'Es gibt keine offene Anfrage' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.match_players where match_id = p_match and player_id = me) then
    raise exception 'Du spielst in diesem Spiel nicht mit' using errcode = '42501';
  end if;

  if not public.end_fits(m.state, m.end_req) then
    update public.matches set end_req = null, end_req_by = null, end_req_at = null where id = p_match;
    return 'stale';
  end if;

  if me = m.end_req_by then
    if coalesce(p_ok, false) then
      raise exception 'Zustimmen muss die Gegenseite' using errcode = '42501';
    end if;
    update public.matches set end_req = null, end_req_by = null, end_req_at = null where id = p_match;
    return 'withdrawn';
  end if;

  if me not in (select public.end_approvers(p_match, m.end_req_by)) then
    raise exception 'Darüber entscheidet die Gegenseite' using errcode = '42501';
  end if;

  if coalesce(p_ok, false) then
    perform public.end_execute(p_match, m.end_req);
    return 'done';
  end if;
  update public.matches set end_req = null, end_req_by = null, end_req_at = null where id = p_match;
  return 'rejected';
end;
$$;
revoke execute on function public.answer_end(uuid, boolean) from public, anon;
grant execute on function public.answer_end(uuid, boolean) to authenticated;
