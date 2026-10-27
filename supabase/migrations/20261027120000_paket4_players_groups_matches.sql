-- Paket 4: Spieler, Gruppen, Spiele (die Spielen-Hälfte der App)
--
-- Dieser Teil der Datenbank ist von den Trainingsdaten (sessions, shots) bewusst
-- getrennt: Trainingsdaten gehören einer Person allein, Spieldaten gehören mehreren
-- Personen gemeinsam. Das ändert Sichtbarkeit und Löschregeln.
--
-- GRUNDREGEL FÜR FREMDSCHLÜSSEL
-- Außer players.user_id zeigt KEINE Spalte auf auth.users, sondern immer auf players.
-- Grund: players-Zeilen werden nie gelöscht, sondern beim Löschen eines Kontos nur
-- anonymisiert. Damit kann das Löschen eines Kontos nie an einem Fremdschlüssel
-- scheitern, und die Elo-Bilanz der Mitspieler bleibt korrekt.
--
-- NICHT in dieser Migration, bewusst:
--   * Elo-Tabellen – kommen mit dem Elo-Schritt, damit ihre Form dem tatsächlichen
--     Verfahren folgt und keine toten Tabellen entstehen
--   * Serverfunktionen zum Erstellen, Beitreten per Code und Bestätigen – kommen mit
--     den jeweiligen Oberflächen-Schritten
-- Die Zugriffsregeln hier verbieten den Beitritt per Code absichtlich: Er läuft später
-- ausschließlich über eine Funktion mit erhöhten Rechten, damit niemand Codes oder
-- Spiele durchprobieren kann.

-- ---------------------------------------------------------------------------
-- Codes für Einladung und Spielbeitritt
-- ---------------------------------------------------------------------------
-- Entropie aus gen_random_uuid() (kryptografisch sicher). Der Modulo erzeugt eine
-- minimale Ungleichverteilung, die bei Einladungscodes ohne Bedeutung ist.
-- Alphabet ohne I, L, O, 0, 1 – diese Zeichen werden beim Abtippen verwechselt.
create function public.gen_code(len int, alphabet text)
returns text
language sql
volatile
set search_path = ''
as $$
  with raw as (select decode(replace(gen_random_uuid()::text, '-', ''), 'hex') as b)
  select string_agg(substr(alphabet, 1 + (get_byte(raw.b, g) % char_length(alphabet)), 1),
                    '' order by g)
    from raw, generate_series(0, least(len, 16) - 1) as g;
$$;

-- Wird als Spalten-Default ausgeführt und läuft damit mit den Rechten des
-- Einfügenden – angemeldete Nutzer brauchen das Ausführungsrecht. Die Funktion
-- gibt nur eine Zufallsfolge zurück und verrät nichts.
revoke execute on function public.gen_code(int, text) from public, anon;
grant execute on function public.gen_code(int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- groups: Gruppe (Verein, Stammtisch)
-- Kein owner_id: Die Rolle steht am Mitglied, sonst gäbe es zwei Quellen für
-- dieselbe Wahrheit.
-- ---------------------------------------------------------------------------
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 40),
  invite_code text not null unique
                default public.gen_code(8, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- players: eine Zeile je spielfähiger Person – registriertes Konto oder Gast.
-- Alles Weitere (Spiele, Tore, Elo) verweist auf players.id, nie auf auth.users.
-- Dadurch bleibt der Elo-Verlauf eines Gastes erhalten, wenn er später ein Konto
-- bekommt, und ein gelöschtes Konto reißt keine Löcher in die Spielhistorie.
-- ---------------------------------------------------------------------------
create table public.players (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references auth.users (id) on delete set null,
  owner_id       uuid references public.players (id),   -- Gast eines Hosts
  group_id       uuid references public.groups (id) on delete set null,  -- Gast einer Gruppe
  nickname       text not null check (char_length(btrim(nickname)) between 3 and 20),
  kind           text not null check (kind in ('account', 'guest')),
  ranking_opt_in boolean not null default false,        -- Zustimmung allgemeine Rangliste
  deleted_at     timestamptz,                           -- anonymisiert, Spiele bleiben
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Absichtlich locker formuliert: Nach dem Löschen eines Kontos wird user_id null,
  -- und ein Gruppen-Gast verliert group_id, wenn die Gruppe gelöscht wird. Beides
  -- darf nicht am CHECK scheitern. Die strengere Form (Konto hat user_id, Gast hat
  -- genau eine Zuordnung) erzwingen die Zugriffsregeln beim Anlegen.
  constraint players_shape check (
    (kind = 'account' and owner_id is null and group_id is null)
    or (kind = 'guest' and user_id is null
        and not (owner_id is not null and group_id is not null))
  )
);

-- Nickname eindeutig, aber nur unter den aktiven: Gelöschte heißen alle gleich.
create unique index players_nickname_key
  on public.players (lower(btrim(nickname))) where deleted_at is null;
create index players_owner_idx on public.players (owner_id) where owner_id is not null;
create index players_group_idx on public.players (group_id) where group_id is not null;

-- ---------------------------------------------------------------------------
-- group_members: Mitgliedschaft samt Rolle. Gäste sind ebenfalls Mitglieder,
-- damit sie in der Gruppen-Rangliste auftauchen.
-- ---------------------------------------------------------------------------
create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  player_id uuid not null references public.players (id),
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  added_by  uuid references public.players (id),
  joined_at timestamptz not null default now(),
  primary key (group_id, player_id)
);

create index group_members_player_idx on public.group_members (player_id);
-- Höchstens ein Owner je Gruppe. Besitzübertragung heißt deshalb: erst abgeben, dann übernehmen.
create unique index group_members_one_owner on public.group_members (group_id) where role = 'owner';

-- ---------------------------------------------------------------------------
-- matches: ein Spiel – die gewertete Einheit. Besteht aus Sätzen.
-- ---------------------------------------------------------------------------
create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references public.players (id),  -- verwaltet das Spiel, zählt
  mode            text not null check (mode in ('single', 'double')),
  detail          text not null default 'simple' check (detail in ('simple', 'full')),
  goals_per_set   smallint not null default 5 check (goals_per_set between 1 and 50),
  sets_to_win     smallint not null default 2 check (sets_to_win between 1 and 5),
  state           text not null default 'lobby'
                    check (state in ('lobby', 'running', 'finished',
                                     'confirmed', 'disputed', 'cancelled')),
  join_code       text default public.gen_code(6, '0123456789'),
  code_expires_at timestamptz not null default now() + interval '12 hours',
  group_id        uuid references public.groups (id) on delete set null,
  rated           boolean not null default false,   -- ins Elo eingegangen
  rev             integer not null default 1 check (rev >= 1),  -- zählt bei Korrekturen hoch
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Der Beitrittscode gilt nur in der Lobby und wird danach auf null gesetzt.
  constraint matches_code_only_in_lobby check (join_code is null or state = 'lobby')
);

-- Kein zweites offenes Spiel mit demselben Code.
create unique index matches_join_code_key on public.matches (join_code) where join_code is not null;
create index matches_host_idx on public.matches (host_id);
create index matches_group_idx on public.matches (group_id) where group_id is not null;

-- ---------------------------------------------------------------------------
-- match_players: wer spielt mit, in welchem Team, auf welcher Position.
-- position ist die AKTUELLE Position und wird vom Tausch-Knopf umgeschaltet.
-- Nur bei detail='full' und mode='double' gesetzt; das erzwingt die Anwendung,
-- weil ein CHECK dafür auf matches zugreifen müsste.
-- ---------------------------------------------------------------------------
create table public.match_players (
  match_id  uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id),
  team      smallint not null check (team in (1, 2)),
  position  text check (position is null or position in ('off', 'def')),  -- off = Sturm, def = Abwehr
  is_host   boolean not null default false,
  primary key (match_id, player_id)
);

create index match_players_player_idx on public.match_players (player_id);

-- ---------------------------------------------------------------------------
-- match_sets: ein Satz. score1/score2 sind MASSGEBLICH für den Spielstand,
-- in beiden Erfassungstiefen. Dadurch funktioniert sowohl live mittippen als
-- auch am Ende eintragen – es ist dasselbe Feld.
-- ---------------------------------------------------------------------------
create table public.match_sets (
  match_id    uuid not null references public.matches (id) on delete cascade,
  set_no      smallint not null check (set_no between 1 and 9),
  score1      smallint not null default 0 check (score1 >= 0),
  score2      smallint not null default 0 check (score2 >= 0),
  winner_team smallint check (winner_team is null or winner_team in (1, 2)),
  started_at  timestamptz,
  finished_at timestamptz,
  primary key (match_id, set_no)
);

-- ---------------------------------------------------------------------------
-- goals: einzelne Tore, nur bei detail='full'. Die Summe soll zum Satzergebnis
-- passen; maßgeblich bleibt match_sets (bewusst nicht per CHECK erzwungen, damit
-- der Host beim Nachtragen nicht gegen eine Zwischenstands-Prüfung läuft).
-- scorer_position ist bewusst redundant: Sie macht "Tore je Position" zu einer
-- einfachen Abfrage und bleibt brauchbar, wenn ein Tausch vergessen wurde.
-- ---------------------------------------------------------------------------
create table public.goals (
  match_id        uuid not null,
  set_no          smallint not null,
  seq             integer not null check (seq >= 1),  -- Reihenfolge im Satz, erlaubt Rückgängig
  team            smallint not null check (team in (1, 2)),
  scorer_id       uuid references public.players (id),  -- null = unbekannt
  scorer_position text check (scorer_position is null or scorer_position in ('off', 'def')),
  own_goal        boolean not null default false,
  t               timestamptz not null default now(),
  primary key (match_id, set_no, seq),
  foreign key (match_id, set_no)
    references public.match_sets (match_id, set_no) on delete cascade
);

-- ---------------------------------------------------------------------------
-- match_confirmations: Bestätigung des Ergebnisses, je Fassung (rev).
-- Eine Korrektur zählt rev hoch, damit alte Bestätigungen verfallen statt
-- gelöscht zu werden – so bleibt nachvollziehbar, wer was bestätigt hat.
-- ---------------------------------------------------------------------------
create table public.match_confirmations (
  match_id  uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id),
  rev       integer not null check (rev >= 1),
  decision  text not null check (decision in ('ok', 'reject')),
  comment   text check (comment is null or char_length(comment) <= 200),
  at        timestamptz not null default now(),
  primary key (match_id, player_id, rev)
);

-- ---------------------------------------------------------------------------
-- updated_at-Trigger (set_updated_at() stammt aus Phase 1)
-- ---------------------------------------------------------------------------
create trigger groups_set_updated_at before update on public.groups
  for each row execute function public.set_updated_at();
create trigger players_set_updated_at before update on public.players
  for each row execute function public.set_updated_at();
create trigger matches_set_updated_at before update on public.matches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen für die Zugriffsregeln
--
-- Alle mit erhöhten Rechten (security definer): Sie fragen genau die Tabellen ab,
-- deren Zugriffsregeln sie bestimmen. Ohne erhöhte Rechte würden sich die Regeln
-- endlos selbst aufrufen.
-- ---------------------------------------------------------------------------

-- Die eigene player_id, oder null, solange noch kein Nickname gesetzt ist.
create function public.my_player_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.players where user_id = (select auth.uid())
$$;

create function public.is_group_member(g uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.group_members
                  where group_id = g and player_id = public.my_player_id())
$$;

create function public.is_group_admin(g uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.group_members
                  where group_id = g and player_id = public.my_player_id()
                    and role in ('owner', 'admin'))
$$;

create function public.is_group_owner(g uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.group_members
                  where group_id = g and player_id = public.my_player_id()
                    and role = 'owner')
$$;

create function public.is_match_host(m uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.matches
                  where id = m and host_id = public.my_player_id())
$$;

create function public.plays_in_match(m uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.match_players
                  where match_id = m and player_id = public.my_player_id())
$$;

-- Ein Spiel sieht, wer mitspielt, es hostet, oder in der Gruppe des Spiels ist.
-- Wird für die Kindtabellen (Aufstellung, Sätze, Tore, Bestätigungen) gebraucht.
create function public.can_see_match(m uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.matches mm
                  where mm.id = m
                    and ( mm.host_id = public.my_player_id()
                       or (mm.group_id is not null and public.is_group_member(mm.group_id))))
      or public.plays_in_match(m)
$$;

-- War ich mit diesem Spieler in einem Spiel, oder habe ich ein Spiel gehostet,
-- in dem er mitspielte?
create function public.shares_match_with(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.match_players a
     where a.player_id = p
       and ( exists (select 1 from public.match_players b
                      where b.match_id = a.match_id
                        and b.player_id = public.my_player_id())
          or exists (select 1 from public.matches m
                      where m.id = a.match_id
                        and m.host_id = public.my_player_id())))
$$;

-- Sind wir in derselben Gruppe?
create function public.shares_group_with(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.group_members a
                   join public.group_members b on b.group_id = a.group_id
                  where a.player_id = p
                    and b.player_id = public.my_player_id())
$$;

revoke execute on function
  public.my_player_id(), public.is_group_member(uuid), public.is_group_admin(uuid),
  public.is_group_owner(uuid), public.is_match_host(uuid), public.plays_in_match(uuid),
  public.can_see_match(uuid), public.shares_match_with(uuid), public.shares_group_with(uuid)
  from public, anon;
grant execute on function
  public.my_player_id(), public.is_group_member(uuid), public.is_group_admin(uuid),
  public.is_group_owner(uuid), public.is_match_host(uuid), public.plays_in_match(uuid),
  public.can_see_match(uuid), public.shares_match_with(uuid), public.shares_group_with(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Gruppe anlegen
--
-- Läuft als Funktion und nicht als direktes INSERT. Zwei Gründe:
--   1. Gruppe und Owner-Mitgliedschaft entstehen in einem Schritt. Ein Trigger
--      wäre zu spät: Bei "insert ... returning" prüft Postgres die SELECT-Regel
--      für die zurückgegebene Zeile, bevor AFTER-Trigger laufen. Die Regel
--      verlangt Mitgliedschaft – die es dann noch nicht gibt. Der Client bekäme
--      also eine Fehlermeldung, obwohl die Gruppe entsteht.
--   2. Der Einladungscode kann bei einer Kollision neu gezogen werden.
-- Es gibt deshalb absichtlich keine INSERT-Regel auf groups.
-- ---------------------------------------------------------------------------
create function public.create_group(p_name text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_player_id();
  g  public.groups;
begin
  if me is null then
    raise exception 'Zum Anlegen einer Gruppe wird erst ein Nickname benötigt'
      using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Die Gruppe braucht einen Namen' using errcode = 'P0001';
  end if;

  for i in 1..5 loop
    begin
      insert into public.groups (name, invite_code)
      values (btrim(p_name), public.gen_code(8, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'))
      returning * into g;
      exit;
    exception when unique_violation then
      if i = 5 then raise; end if;   -- Code schon vergeben: neu ziehen
    end;
  end loop;

  insert into public.group_members (group_id, player_id, role, added_by)
  values (g.id, me, 'owner', me);

  return g;
end;
$$;

revoke execute on function public.create_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Eine Gruppe mit Gästen darf nicht gelöscht werden
-- Sonst blieben die Gäste ohne Zuordnung übrig und niemand käme mehr an sie heran.
-- ---------------------------------------------------------------------------
create function public.guard_group_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.players
              where group_id = old.id and deleted_at is null) then
    raise exception 'Die Gruppe hat noch Gäste. Diese zuerst übernehmen oder löschen.'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger on_group_delete before delete on public.groups
  for each row execute function public.guard_group_delete();

-- ---------------------------------------------------------------------------
-- Konto löschen: Spieler anonymisieren statt löschen
--
-- Das Elo der Mitspieler hängt an gemeinsamen Spielen. Würde die Spielerzeile
-- verschwinden, wäre ihre Bilanz falsch. Deshalb bleibt die Zeile, verliert aber
-- Namen und Kontobezug. Trainingsdaten (sessions, shots) werden dagegen per
-- CASCADE vollständig gelöscht – sie gehören nur dieser einen Person.
--
-- Diese Regel muss so in der Datenschutzerklärung stehen, sonst ist das
-- Löschversprechen der App falsch.
--
-- delete_my_account() aus Phase 1b bleibt unverändert: Es löscht die auth.users-Zeile,
-- dieser Trigger erledigt die Anonymisierung, der Fremdschlüssel setzt user_id auf null.
-- ---------------------------------------------------------------------------
create function public.handle_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid;
  g  uuid;
  heir uuid;
begin
  select id into me from public.players where user_id = old.id;
  if me is null then
    return old;
  end if;

  -- Gruppen, in denen diese Person Owner ist: dienstältester Stellvertreter erbt.
  -- Erst abgeben, dann übernehmen – sonst stolpert der Ein-Owner-Index.
  for g in select group_id from public.group_members
            where player_id = me and role = 'owner'
  loop
    select player_id into heir from public.group_members
      where group_id = g and role = 'admin'
      order by joined_at asc, player_id asc
      limit 1;
    if heir is not null then
      update public.group_members set role = 'member' where group_id = g and player_id = me;
      update public.group_members set role = 'owner'  where group_id = g and player_id = heir;
    end if;
    -- Ohne Stellvertreter bleibt die Gruppe ohne handlungsfähigen Owner bestehen.
    -- Besser als sie zu löschen: Die Spiele und Gäste der Gruppe bleiben gültig.
  end loop;

  update public.players
     set nickname       = 'Gelöschter Spieler',
         ranking_opt_in = false,
         deleted_at     = coalesce(deleted_at, now())
   where id = me;

  return old;
end;
$$;

revoke execute on function public.handle_user_deleted() from public, anon, authenticated;

create trigger on_auth_user_deleted before delete on auth.users
  for each row execute function public.handle_user_deleted();

-- ---------------------------------------------------------------------------
-- profiles.display_name entfällt
-- Die Spalte wurde von keiner Zeile Clientcode beschrieben. Die öffentliche
-- Spielidentität ist players.nickname, das private Profil bleibt profiles.
-- ---------------------------------------------------------------------------
alter table public.profiles drop column display_name;

-- ---------------------------------------------------------------------------
-- Zugriffsregeln (Row Level Security)
-- ---------------------------------------------------------------------------
alter table public.groups              enable row level security;
alter table public.players             enable row level security;
alter table public.group_members       enable row level security;
alter table public.matches             enable row level security;
alter table public.match_players       enable row level security;
alter table public.match_sets          enable row level security;
alter table public.goals               enable row level security;
alter table public.match_confirmations enable row level security;

-- Nicht angemeldete Besucher bekommen gar keinen Zugriff.
revoke all on table
  public.groups, public.players, public.group_members, public.matches,
  public.match_players, public.match_sets, public.goals, public.match_confirmations
  from anon;

-- players ---------------------------------------------------------------
-- Einen Nickname sieht man nur über diese Wege: er ist der eigene, man hat den
-- Gast angelegt oder ist in seiner Gruppe, man war mit ihm in einem Spiel, oder
-- er hat der allgemeinen Rangliste zugestimmt. E-Mail-Adressen werden nie ausgegeben.
--
-- WICHTIG: Die Regel prüft die Spalten der Zeile direkt und fragt players NICHT
-- selbst ab. Eine Regel, die ihre eigene Tabelle abfragt, sieht die gerade
-- eingefügte Zeile nicht – dann scheitert jedes "insert ... returning", also
-- jedes insert().select() des Clients. Gilt genauso für matches unten.
create policy players_select on public.players
  for select to authenticated using (
    user_id = (select auth.uid())
    or owner_id = public.my_player_id()
    or (group_id is not null and public.is_group_member(group_id))
    or ranking_opt_in
    or public.shares_match_with(id)
    or public.shares_group_with(id)
  );

-- Eigene Zeile anlegen (ein Konto hat genau eine, erzwungen durch user_id unique)
-- oder einen Gast für sich bzw. für eine Gruppe, in der man Mitglied ist.
create policy players_insert on public.players
  for insert to authenticated with check (
    (kind = 'account' and user_id = (select auth.uid())
      and owner_id is null and group_id is null)
    or (kind = 'guest' and user_id is null and deleted_at is null
      and ((owner_id = public.my_player_id() and group_id is null)
        or (group_id is not null and owner_id is null and public.is_group_member(group_id))))
  );

create policy players_update on public.players
  for update to authenticated
  using (
    user_id = (select auth.uid())
    or owner_id = public.my_player_id()
    or (group_id is not null and public.is_group_member(group_id))
  )
  with check (
    user_id = (select auth.uid())
    or owner_id = public.my_player_id()
    or (group_id is not null and public.is_group_member(group_id))
  );

-- Nur Gäste löschen, und nur solange sie nie gespielt haben: Danach greift der
-- Fremdschlüssel von match_players, und richtig ist ohnehin das Anonymisieren.
create policy players_delete on public.players
  for delete to authenticated using (
    kind = 'guest'
    and (owner_id = public.my_player_id()
      or (group_id is not null and public.is_group_admin(group_id)))
  );

-- groups ----------------------------------------------------------------
create policy groups_select on public.groups
  for select to authenticated using (public.is_group_member(id));

-- Keine INSERT-Regel: Anlegen läuft über create_group(), damit Gruppe und
-- Owner-Mitgliedschaft zusammen entstehen. Beitreten per Code bekommt später
-- ebenfalls eine eigene Funktion.
create policy groups_update on public.groups
  for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));

create policy groups_delete on public.groups
  for delete to authenticated using (public.is_group_owner(id));

-- group_members ---------------------------------------------------------
create policy gm_select on public.group_members
  for select to authenticated using (public.is_group_member(group_id));

create policy gm_insert on public.group_members
  for insert to authenticated with check (
    public.is_group_admin(group_id) and role <> 'owner'
  );

-- Rollen ändern und Besitz übertragen darf nur der Owner.
create policy gm_update on public.group_members
  for update to authenticated
  using (public.is_group_owner(group_id)) with check (public.is_group_owner(group_id));

-- Owner-Zeilen sind nicht löschbar: Besitz wird übertragen, nicht aufgegeben.
create policy gm_delete on public.group_members
  for delete to authenticated using (
    role <> 'owner'
    and (public.is_group_admin(group_id) or player_id = public.my_player_id())
  );

-- matches ---------------------------------------------------------------
-- Spalten der Zeile direkt, kein Selbstzugriff auf matches (siehe players oben).
create policy matches_select on public.matches
  for select to authenticated using (
    host_id = public.my_player_id()
    or (group_id is not null and public.is_group_member(group_id))
    or public.plays_in_match(id)
  );

create policy matches_insert on public.matches
  for insert to authenticated with check (host_id = public.my_player_id());

create policy matches_update on public.matches
  for update to authenticated
  using (host_id = public.my_player_id()) with check (host_id = public.my_player_id());

create policy matches_delete on public.matches
  for delete to authenticated using (host_id = public.my_player_id());

-- match_players, match_sets, goals: lesen alle Beteiligten, schreiben nur der Host
create policy mp_select on public.match_players
  for select to authenticated using (public.can_see_match(match_id));
create policy mp_insert on public.match_players
  for insert to authenticated with check (public.is_match_host(match_id));
create policy mp_update on public.match_players
  for update to authenticated
  using (public.is_match_host(match_id)) with check (public.is_match_host(match_id));
create policy mp_delete on public.match_players
  for delete to authenticated using (public.is_match_host(match_id));

create policy ms_select on public.match_sets
  for select to authenticated using (public.can_see_match(match_id));
create policy ms_insert on public.match_sets
  for insert to authenticated with check (public.is_match_host(match_id));
create policy ms_update on public.match_sets
  for update to authenticated
  using (public.is_match_host(match_id)) with check (public.is_match_host(match_id));
create policy ms_delete on public.match_sets
  for delete to authenticated using (public.is_match_host(match_id));

create policy goals_select on public.goals
  for select to authenticated using (public.can_see_match(match_id));
create policy goals_insert on public.goals
  for insert to authenticated with check (public.is_match_host(match_id));
create policy goals_update on public.goals
  for update to authenticated
  using (public.is_match_host(match_id)) with check (public.is_match_host(match_id));
create policy goals_delete on public.goals
  for delete to authenticated using (public.is_match_host(match_id));

-- match_confirmations: jeder bestätigt nur für sich selbst.
-- Kein update, kein delete: Eine Korrektur zählt rev hoch und erzeugt neue Zeilen.
create policy mc_select on public.match_confirmations
  for select to authenticated using (public.can_see_match(match_id));
create policy mc_insert on public.match_confirmations
  for insert to authenticated with check (
    player_id = public.my_player_id() and public.can_see_match(match_id)
  );
