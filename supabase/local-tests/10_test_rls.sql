-- Prüfung der Zugriffsregeln aus Paket 4.
-- A = Host (Oliver), B = Mitspieler (Basti), C = Fremder (Chris), Jan = Gruppen-Gast.
--
-- Zwei Dinge, die die Testform bestimmen:
--
-- 1. Row Level Security wirft bei SELECT, UPDATE und DELETE keinen Fehler, sondern
--    blendet Zeilen aus. Nur INSERT mit verletztem WITH CHECK läuft auf einen Fehler.
--    Deshalb wird je nach Fall auf Fehler, auf betroffene Zeilen oder auf ein
--    Abfrageergebnis geprüft.
--
-- 2. Ein Test wie "C darf X nicht ändern" ist wertlos, wenn C die Zeile gar nicht
--    sehen kann – dann trifft das UPDATE einfach nichts, aus dem falschen Grund.
--    Darum liegen alle IDs in der Hilfstabelle t_ids, die als Superuser gefüllt wird.
--    Die Testnutzer bekommen die IDs also geschenkt und müssen trotzdem scheitern.

\set QUIET on
\pset tuples_only on
\pset border 0

create table t_ids (name text primary key, id uuid);
grant select on t_ids to authenticated, anon;

create function t_role(uid text) returns text language sql immutable as $$
  select case when uid = 'super' then 'postgres'
              when uid is null then 'anon'
              else 'authenticated' end
$$;

create function tst(label text, uid text, sql text, expect text)
returns text language plpgsql as $$
declare res text; msg text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
    execute 'set local role ' || t_role(uid);
    execute sql;
    res := 'ok';
  exception when others then
    res := 'err'; msg := sqlerrm;
  end;
  reset role;
  if res = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || res ||
         coalesce(': ' || left(msg, 95), '') || ')';
end $$;

create function trows(label text, uid text, sql text, expect bigint)
returns text language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
  execute 'set local role ' || t_role(uid);
  execute sql;
  get diagnostics n = row_count;
  reset role;
  if n = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ' Zeilen, waren ' || n || ')';
exception when others then
  reset role;
  return 'FAIL  ' || label || '  (Fehler: ' || left(sqlerrm, 95) || ')';
end $$;

create function tcount(label text, uid text, sql text, expect bigint)
returns text language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
  execute 'set local role ' || t_role(uid);
  execute sql into n;
  reset role;
  if n = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || n || ')';
exception when others then
  reset role;
  return 'FAIL  ' || label || '  (Fehler: ' || left(sqlerrm, 95) || ')';
end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@example.org'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@example.org'),
  ('cccccccc-0000-4000-8000-000000000003', 'c@example.org');

\echo
select '== Spielerprofile ==';

-- Mit RETURNING, weil der Client immer insert().select() macht
select trows('A legt eigenes Profil an (mit RETURNING)', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into players (user_id, nickname, kind)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'Oliver', 'account') returning id$$, 1);
select trows('B legt eigenes Profil an (mit RETURNING)', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$insert into players (user_id, nickname, kind)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'Basti', 'account') returning id$$, 1);
select trows('C legt eigenes Profil an (mit RETURNING)', 'cccccccc-0000-4000-8000-000000000003',
  $$insert into players (user_id, nickname, kind)
    values ('cccccccc-0000-4000-8000-000000000003', 'Chris', 'account') returning id$$, 1);

insert into t_ids select nickname, id from players;

select tst('C kann kein Profil auf fremde Konto-ID anlegen', 'cccccccc-0000-4000-8000-000000000003',
  $$insert into players (user_id, nickname, kind)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'Falsch', 'account')$$, 'err');
select tst('Zweites Profil für dasselbe Konto wird abgewiesen',
  'cccccccc-0000-4000-8000-000000000003',
  $$insert into players (user_id, nickname, kind)
    values ('cccccccc-0000-4000-8000-000000000003', 'Chris2', 'account')$$, 'err');
select tst('Nickname doppelt (andere Schreibweise) wird abgewiesen', 'super',
  $$insert into players (nickname, kind, owner_id)
    select 'oliver', 'guest', id from t_ids where name = 'Oliver'$$, 'err');
select tst('Konto-Profil mit owner_id verletzt die Formprüfung', 'super',
  $$insert into players (nickname, kind, owner_id)
    select 'Krumm', 'account', id from t_ids where name = 'Oliver'$$, 'err');
select tst('Nickname zu kurz wird abgewiesen', 'super',
  $$insert into players (nickname, kind, owner_id)
    select 'Jo', 'guest', id from t_ids where name = 'Oliver'$$, 'err');

\echo
select '== Sichtbarkeit ohne Berührungspunkt ==';

select tcount('A sieht das eigene Profil', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select count(*) from players where nickname = 'Oliver'$$, 1);
select tcount('C sieht A nicht (kein Spiel, keine Gruppe, kein Opt-in)',
  'cccccccc-0000-4000-8000-000000000003',
  $$select count(*) from players where nickname = 'Oliver'$$, 0);
select tcount('B sieht A noch nicht', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$select count(*) from players where nickname = 'Oliver'$$, 0);
select trows('C kann A nicht ändern, obwohl er die ID kennt',
  'cccccccc-0000-4000-8000-000000000003',
  $$update players set nickname = 'Gekapert'
     where id = (select id from t_ids where name = 'Oliver')$$, 0);
select trows('C kann A nicht löschen', 'cccccccc-0000-4000-8000-000000000003',
  $$delete from players where id = (select id from t_ids where name = 'Oliver')$$, 0);

select trows('A stimmt der allgemeinen Rangliste zu', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update players set ranking_opt_in = true where nickname = 'Oliver'$$, 1);
select tcount('C sieht A nach dem Opt-in', 'cccccccc-0000-4000-8000-000000000003',
  $$select count(*) from players where nickname = 'Oliver'$$, 1);
select trows('A widerruft das Opt-in', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update players set ranking_opt_in = false where nickname = 'Oliver'$$, 1);
select tcount('C sieht A danach wieder nicht', 'cccccccc-0000-4000-8000-000000000003',
  $$select count(*) from players where nickname = 'Oliver'$$, 0);

\echo
select '== Gruppe ==';

select tst('A legt eine Gruppe an (create_group)', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select create_group('Stammtisch')$$, 'ok');

insert into t_ids select 'Gruppe', id from groups where name = 'Stammtisch';

select tst('Direktes INSERT auf groups ist nicht erlaubt',
  'bbbbbbbb-0000-4000-8000-000000000002',
  $$insert into groups (name) values ('Direkt')$$, 'err');
select tst('create_group ohne Namen wird abgewiesen', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$select create_group(' ')$$, 'err');
select tcount('Einladungscode hat 8 Zeichen aus dem erlaubten Alphabet', 'super',
  $$select count(*) from groups where invite_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'$$, 1);
select tcount('A ist automatisch Owner', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select count(*) from group_members gm
     where gm.player_id = (select id from t_ids where name = 'Oliver') and gm.role = 'owner'$$, 1);
select tcount('C sieht die Gruppe nicht', 'cccccccc-0000-4000-8000-000000000003',
  $$select count(*) from groups$$, 0);
select tst('C kann nicht in die fremde Gruppe eintreten, trotz bekannter ID',
  'cccccccc-0000-4000-8000-000000000003',
  $$insert into group_members (group_id, player_id)
    select (select id from t_ids where name = 'Gruppe'),
           (select id from t_ids where name = 'Chris')$$, 'err');
select tst('C kann keinen Gast in der fremden Gruppe anlegen',
  'cccccccc-0000-4000-8000-000000000003',
  $$insert into players (group_id, nickname, kind)
    select (select id from t_ids where name = 'Gruppe'), 'Eindringling', 'guest'$$, 'err');

select trows('A legt einen Gruppen-Gast an (mit RETURNING)',
  'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into players (group_id, nickname, kind)
    select (select id from t_ids where name = 'Gruppe'), 'Jan', 'guest' returning id$$, 1);

insert into t_ids select 'Jan', id from players where nickname = 'Jan';

select tcount('A sieht den Gruppen-Gast', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$select count(*) from players where nickname = 'Jan'$$, 1);
select tcount('C sieht den Gruppen-Gast nicht', 'cccccccc-0000-4000-8000-000000000003',
  $$select count(*) from players where nickname = 'Jan'$$, 0);

select trows('A nimmt B als Stellvertreter auf', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into group_members (group_id, player_id, role, added_by)
    select (select id from t_ids where name = 'Gruppe'),
           (select id from t_ids where name = 'Basti'), 'admin',
           (select id from t_ids where name = 'Oliver')$$, 1);
select tst('Auch ein Verwalter kann keinen zweiten Owner anlegen',
  'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into group_members (group_id, player_id, role)
    select (select id from t_ids where name = 'Gruppe'),
           (select id from t_ids where name = 'Chris'), 'owner'$$, 'err');
select trows('B kann sich nicht selbst zum Owner machen',
  'bbbbbbbb-0000-4000-8000-000000000002',
  $$update group_members set role = 'owner'
     where player_id = (select id from t_ids where name = 'Basti')$$, 0);
select trows('B kann den Owner nicht entfernen', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$delete from group_members
     where player_id = (select id from t_ids where name = 'Oliver')$$, 0);
select trows('B als Verwalter darf einen Gruppen-Gast umbenennen',
  'bbbbbbbb-0000-4000-8000-000000000002',
  $$update players set nickname = 'Jan K.' where nickname = 'Jan'$$, 1);
select tcount('B sieht A jetzt (gemeinsame Gruppe)', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$select count(*) from players where nickname = 'Oliver'$$, 1);
select tst('Gruppe mit Gästen ist nicht löschbar', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$delete from groups where id = (select id from t_ids where name = 'Gruppe')$$, 'err');

\echo
select '== Spiel ==';

select trows('A erstellt ein Spiel (mit RETURNING)', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into matches (host_id, mode, detail, group_id)
    select (select id from t_ids where name = 'Oliver'), 'double', 'full',
           (select id from t_ids where name = 'Gruppe') returning id, join_code$$, 1);

insert into t_ids select 'Spiel', id from matches;

select tcount('Beitrittscode hat 6 Ziffern', 'super',
  $$select count(*) from matches where join_code ~ '^[0-9]{6}$'$$, 1);
select tst('C kann kein Spiel auf fremden Host anlegen', 'cccccccc-0000-4000-8000-000000000003',
  $$insert into matches (host_id, mode)
    select (select id from t_ids where name = 'Oliver'), 'single'$$, 'err');

select trows('A stellt die Teams auf', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into match_players (match_id, player_id, team, position, is_host)
    select (select id from t_ids where name = 'Spiel'), i.id, v.team, v.pos, v.nick = 'Oliver'
      from (values ('Oliver', 1::smallint, 'off'), ('Jan', 1::smallint, 'def'),
                   ('Basti', 2::smallint, 'off'), ('Chris', 2::smallint, 'def')) as v(nick, team, pos)
      join t_ids i on i.name = v.nick$$, 4);

select tcount('B sieht A (gemeinsames Spiel)', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$select count(*) from players where nickname = 'Oliver'$$, 1);
select tcount('C sieht A (gemeinsames Spiel)', 'cccccccc-0000-4000-8000-000000000003',
  $$select count(*) from players where nickname = 'Oliver'$$, 1);
select tcount('C sieht den Gast Jan (gemeinsames Spiel)', 'cccccccc-0000-4000-8000-000000000003',
  $$select count(*) from players where nickname = 'Jan K.'$$, 1);
select tcount('C sieht das Spiel', 'cccccccc-0000-4000-8000-000000000003',
  $$select count(*) from matches$$, 1);
select trows('B kann die Aufstellung nicht ändern (nicht Host)',
  'bbbbbbbb-0000-4000-8000-000000000002',
  $$update match_players set team = 2
     where player_id = (select id from t_ids where name = 'Oliver')$$, 0);
select trows('B kann niemanden aus dem Spiel werfen', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$delete from match_players
     where player_id = (select id from t_ids where name = 'Chris')$$, 0);
select trows('A tauscht die Positionen im eigenen Team',
  'aaaaaaaa-0000-4000-8000-000000000001',
  $$update match_players set position = case position when 'off' then 'def' else 'off' end
     where team = 1$$, 2);

select trows('A legt Satz 1 an', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into match_sets (match_id, set_no)
    select (select id from t_ids where name = 'Spiel'), 1 returning match_id$$, 1);
select trows('A zählt ein Tor mit Schütze und Position',
  'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into goals (match_id, set_no, seq, team, scorer_id, scorer_position)
    select (select id from t_ids where name = 'Spiel'), 1, 1, 1,
           (select id from t_ids where name = 'Oliver'), 'def' returning seq$$, 1);
select trows('A trägt den Satzstand nach', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update match_sets set score1 = 1 where set_no = 1$$, 1);
select tst('B kann kein Tor schreiben', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$insert into goals (match_id, set_no, seq, team)
    select (select id from t_ids where name = 'Spiel'), 1, 2, 2$$, 'err');
select trows('B kann kein Tor löschen', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$delete from goals$$, 0);
select tcount('B sieht die Tore des Spiels', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$select count(*) from goals$$, 1);
select tst('Tor in einem nicht angelegten Satz wird abgewiesen',
  'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into goals (match_id, set_no, seq, team)
    select (select id from t_ids where name = 'Spiel'), 7, 1, 1$$, 'err');
select tst('Ungültige Position wird abgewiesen', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$insert into goals (match_id, set_no, seq, team, scorer_position)
    select (select id from t_ids where name = 'Spiel'), 1, 2, 1, 'mitte'$$, 'err');

\echo
select '== Bestätigung und Korrektur ==';

select trows('A beendet das Spiel und entwertet den Code',
  'aaaaaaaa-0000-4000-8000-000000000001',
  $$update matches set state = 'finished', join_code = null, finished_at = now()$$, 1);
select tst('Beitrittscode nur in der Lobby', 'aaaaaaaa-0000-4000-8000-000000000001',
  $$update matches set join_code = '123456' where state = 'finished'$$, 'err');
select trows('B bestätigt für sich selbst', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$insert into match_confirmations (match_id, player_id, rev, decision)
    select m.id, (select id from t_ids where name = 'Basti'), m.rev, 'ok'
      from matches m returning at$$, 1);
select tst('B kann nicht für A bestätigen', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$insert into match_confirmations (match_id, player_id, rev, decision)
    select m.id, (select id from t_ids where name = 'Oliver'), m.rev, 'ok' from matches m$$, 'err');
select trows('Bestätigung ist nicht änderbar', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$update match_confirmations set decision = 'reject'$$, 0);
select trows('Bestätigung ist nicht löschbar', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$delete from match_confirmations$$, 0);
select trows('A korrigiert: rev hoch, zurück auf finished',
  'aaaaaaaa-0000-4000-8000-000000000001',
  $$update matches set rev = rev + 1, rated = false$$, 1);
select tcount('Die alte Bestätigung gilt nicht für die neue Fassung', 'super',
  $$select count(*) from match_confirmations c join matches m on m.id = c.match_id
     where c.rev = m.rev$$, 0);
select trows('B bestätigt die neue Fassung', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$insert into match_confirmations (match_id, player_id, rev, decision)
    select m.id, (select id from t_ids where name = 'Basti'), m.rev, 'ok' from matches m$$, 1);

\echo
select '== Kein Zugriff ohne Anmeldung ==';

select tst('anon kommt nicht an players', null, $$select count(*) from players$$, 'err');
select tst('anon kommt nicht an matches', null, $$select count(*) from matches$$, 'err');
select tst('anon kommt nicht an goals', null, $$select count(*) from goals$$, 'err');
select tst('anon kommt nicht an groups', null, $$select count(*) from groups$$, 'err');
select tst('anon kommt nicht an group_members', null, $$select count(*) from group_members$$, 'err');
select tst('anon kommt nicht an profiles (Phase 1)', null, $$select count(*) from profiles$$, 'err');
select tst('anon kann create_group nicht aufrufen', null, $$select create_group('Hack')$$, 'err');

\echo
select '== Konto löschen ==';

-- genau das, was delete_my_account() tut
delete from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select tcount('A ist anonymisiert, nicht gelöscht', 'super',
  $$select count(*) from players where deleted_at is not null
      and nickname = 'Gelöschter Spieler' and user_id is null and kind = 'account'$$, 1);
select tcount('Das Spiel existiert weiter', 'super', $$select count(*) from matches$$, 1);
select tcount('Die Tore existieren weiter', 'super', $$select count(*) from goals$$, 1);
select tcount('Die Aufstellung ist unverändert', 'super',
  $$select count(*) from match_players$$, 4);
select tcount('Der Gruppen-Gast bleibt', 'super',
  $$select count(*) from players where nickname = 'Jan K.'$$, 1);
select tcount('B hat die Gruppe als Stellvertreter geerbt', 'super',
  $$select count(*) from group_members
     where player_id = (select id from t_ids where name = 'Basti') and role = 'owner'$$, 1);
select tcount('Genau ein Owner in der Gruppe', 'super',
  $$select count(*) from group_members where role = 'owner'$$, 1);
select tcount('Trainingsdaten von A sind weg (CASCADE auf profiles)', 'super',
  $$select count(*) from profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$, 0);
select tcount('B sieht das Spiel weiterhin', 'bbbbbbbb-0000-4000-8000-000000000002',
  $$select count(*) from matches$$, 1);

select tst('Zweites Konto löschen (gleicher Platzhaltername kollidiert nicht)',
  'super', $$delete from auth.users where id = 'cccccccc-0000-4000-8000-000000000003'$$, 'ok');
select tcount('Zwei anonymisierte Spieler mit gleichem Namen', 'super',
  $$select count(*) from players where nickname = 'Gelöschter Spieler'$$, 2);
