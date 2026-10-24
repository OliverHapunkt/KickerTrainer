-- Phase 1: Konten, Sessions und Schüsse (Cloud-Backup/Sync der eigenen Trainingsdaten)
--
-- Grundregel: Jeder Nutzer sieht und ändert ausschließlich seine eigenen Zeilen
-- (Row Level Security). Löscht ein Nutzer sein Konto (auth.users), verschwinden
-- alle seine Daten per ON DELETE CASCADE.
--
-- Abgleich mit dem Client (index.html, localStorage-Schema v2):
--   sessions: { id, start, d, cfg, note, x }
--   shots:    { s, t, d, st, k, g, l, h, rt, late, sig, end, auto }
-- Die Session-ID des Clients ist nur kurz (Date.now().toString(36)) und daher nur
-- pro Nutzer eindeutig -> Primärschlüssel immer zusammen mit user_id.
-- Der Dedup-Schlüssel des Imports (s|t|st) entspricht dem Primärschlüssel von shots.

-- ---------------------------------------------------------------------------
-- Hilfsfunktion: updated_at automatisch setzen (für inkrementellen Sync)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: ein Profil je Konto (wird in Phase 2 für Gruppen und Ranglisten genutzt)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 2 and 30),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sessions: ein Trainingsblock
-- ---------------------------------------------------------------------------
create table public.sessions (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,                       -- Client-ID, nur pro Nutzer eindeutig
  started_at timestamptz not null,
  discipline text,                                -- s3, s2, p53, p25, p23, k53
  cfg        jsonb not null default '{}'::jsonb,  -- komplette Trainingskonfiguration
  note       text,
  excluded   boolean not null default false,      -- Session zählt nicht in der Statistik
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------------------------------------------------------------------------
-- shots: eine Einzelaktion (Schuss oder Pass)
-- Bewusst ohne Fremdschlüssel auf sessions: Der Client kann Schüsse ohne
-- Session-Eintrag enthalten (Altdaten), der Upload soll daran nicht scheitern.
-- ---------------------------------------------------------------------------
create table public.shots (
  user_id    uuid not null references auth.users (id) on delete cascade,
  session_id text not null,
  t          bigint not null,                     -- Zeitstempel in ms seit 1970, wie im Client
  kind       text not null check (kind in ('shot', 'pass')),
  discipline text,
  technique  text,
  target     text,                                -- '0'..'5', 'wall' oder 'lane'
  landed     smallint,                            -- getroffenes Segment, 0 = daneben
  hit        boolean,
  rt         integer,                             -- Reaktionszeit in ms
  late       boolean,
  signal     boolean not null default false,      -- Training "auf Signal"
  is_end     boolean not null default true,       -- Wiederholung abgeschlossen
  auto       boolean not null default false,      -- von der Schusserkennung gezählt
  extra      jsonb not null default '{}'::jsonb,  -- Reserve für künftige Felder
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id, t, kind)
);

create index shots_user_t_idx on public.shots (user_id, t desc);
create index sessions_user_started_idx on public.sessions (user_id, started_at desc);
create index sessions_user_updated_idx on public.sessions (user_id, updated_at);
create index shots_user_updated_idx on public.shots (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- updated_at-Trigger
-- ---------------------------------------------------------------------------
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger sessions_set_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();
create trigger shots_set_updated_at before update on public.shots
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profil automatisch anlegen, sobald ein Konto entsteht
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Zugriffsregeln (Row Level Security)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.shots    enable row level security;

-- Nicht angemeldete Besucher bekommen gar keinen Zugriff
revoke all on table public.profiles, public.sessions, public.shots from anon;

-- profiles: eigenes Profil lesen und ändern (Anlegen übernimmt der Trigger, Löschen das Konto)
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- sessions: volle Kontrolle über eigene Zeilen
create policy sessions_select_own on public.sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sessions_insert_own on public.sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sessions_update_own on public.sessions
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sessions_delete_own on public.sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- shots: volle Kontrolle über eigene Zeilen
create policy shots_select_own on public.shots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy shots_insert_own on public.shots
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy shots_update_own on public.shots
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy shots_delete_own on public.shots
  for delete to authenticated using ((select auth.uid()) = user_id);
