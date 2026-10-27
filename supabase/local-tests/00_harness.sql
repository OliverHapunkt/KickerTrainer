-- Minimaler Ersatz für das, was Supabase mitbringt. KEIN Supabase, nur genug,
-- damit die Migrationen laufen und die Zugriffsregeln geprüft werden können.
-- Rollen gelten clusterweit und überleben ein neu angelegtes Testschema
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema auth;
create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase liest die Nutzer-ID aus dem JWT. Lokal aus einer Sitzungsvariable.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select on table auth.users to authenticated;

-- Supabase vergibt auf neue Tabellen im Schema public automatisch Rechte an
-- anon und authenticated. Die Migrationen nehmen anon diese Rechte wieder weg –
-- das wird hier nachgebaut, damit genau das geprüft werden kann.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
