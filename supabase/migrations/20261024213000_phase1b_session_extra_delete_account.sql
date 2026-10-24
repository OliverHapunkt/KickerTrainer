-- Phase 1b: Zusatzfelder für Sessions und Konto-Löschfunktion
--
-- 1) sessions.extra: Der Client speichert an Sessions weitere Felder (z. B. end, reps).
--    Sie landen verlustfrei in dieser Spalte, genau wie shots.extra.
-- 2) delete_my_account(): Löscht das Konto des angemeldeten Nutzers samt aller Daten.
--    Ein Nutzer kann auth.users nicht direkt ändern, deshalb eine Funktion mit
--    erhöhten Rechten (security definer), die nur die eigene Zeile löscht.
--    ON DELETE CASCADE entfernt Profil, Sessions und Schüsse.

alter table public.sessions
  add column extra jsonb not null default '{}'::jsonb;

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Nicht angemeldet' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
