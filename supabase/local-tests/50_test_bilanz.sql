-- Prüfung der Bilanz-Grundlagen: Gastnamen je Besitzer, Kategorie, Spielverlauf.
-- H und B = Konten, D = Unbeteiligter. Frank gibt es bei H und bei B als Gast.

\set QUIET on
\pset tuples_only on
\pset border 0

create table t5 (name text primary key, id uuid);
create table t5c (name text primary key, code text);
grant select on t5, t5c to authenticated;

create function h_role(uid text) returns text language sql immutable as $$
  select case when uid = 'super' then 'postgres' when uid is null then 'anon' else 'authenticated' end
$$;
create function htst(label text, uid text, sql text, expect text)
returns text language plpgsql as $$
declare res text; msg text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
    execute 'set local role ' || h_role(uid);
    execute sql; res := 'ok';
  exception when others then res := 'err'; msg := sqlerrm; end;
  reset role;
  if res = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || res ||
         coalesce(': ' || left(msg, 95), '') || ')';
end $$;
create function hmsg(label text, uid text, sql text, needle text)
returns text language plpgsql as $$
declare msg text := '';
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
    execute 'set local role ' || h_role(uid);
    execute sql;
  exception when others then msg := sqlerrm; end;
  reset role;
  if msg like '%' || needle || '%' then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (Meldung: ' || coalesce(nullif(msg,''),'kein Fehler') || ')';
end $$;
create function htxt(label text, uid text, sql text, expect text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
  execute 'set local role ' || h_role(uid);
  execute sql into v;
  reset role;
  if coalesce(v,'null') = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || coalesce(v,'null') || ')';
exception when others then
  reset role; return 'FAIL  ' || label || '  (Fehler: ' || left(sqlerrm, 95) || ')';
end $$;
create function hnum(label text, uid text, sql text, expect bigint)
returns text language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
  execute 'set local role ' || h_role(uid);
  execute sql into n;
  reset role;
  if n = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || n || ')';
exception when others then
  reset role; return 'FAIL  ' || label || '  (Fehler: ' || left(sqlerrm, 95) || ')';
end $$;

insert into auth.users (id, email) values
  ('aaaa0000-0000-4000-8000-00000000000a','h@x.org'),
  ('bbbb0000-0000-4000-8000-00000000000b','b@x.org'),
  ('dddd0000-0000-4000-8000-00000000000d','d@x.org'),
  ('eeee0000-0000-4000-8000-00000000000e','e@x.org');
\set H 'aaaa0000-0000-4000-8000-00000000000a'
\set B 'bbbb0000-0000-4000-8000-00000000000b'
\set D 'dddd0000-0000-4000-8000-00000000000d'
\set E 'eeee0000-0000-4000-8000-00000000000e'

\echo
select '== Vorbereitung ==';
select htst('Profile H, B, D', 'super', $$insert into players (user_id,nickname,kind) values
  ('aaaa0000-0000-4000-8000-00000000000a','Host','account'),
  ('bbbb0000-0000-4000-8000-00000000000b','Basti','account'),
  ('dddd0000-0000-4000-8000-00000000000d','Dani','account')$$, 'ok');
insert into t5 select nickname, id from players;

\echo
select '== Gastnamen: eindeutig nur je Besitzer ==';
select htst('H legt Gast Frank an', :'H', $$insert into players (owner_id,nickname,kind)
  values ((select id from t5 where name='Host'),'Frank','guest')$$, 'ok');
select htst('B legt ebenfalls einen Gast Frank an', :'B', $$insert into players (owner_id,nickname,kind)
  values ((select id from t5 where name='Basti'),'Frank','guest')$$, 'ok');
select hnum('Es gibt zwei getrennte Franks', 'super',
  $$select count(*) from players where nickname='Frank' and kind='guest'$$, 2);
select htst('H kann keinen zweiten Frank anlegen', :'H', $$insert into players (owner_id,nickname,kind)
  values ((select id from t5 where name='Host'),'frank ','guest')$$, 'err');
select htst('…aber Frank M.', :'H', $$insert into players (owner_id,nickname,kind)
  values ((select id from t5 where name='Host'),'Frank M.','guest')$$, 'ok');
select htst('Konto darf Frank heißen, obwohl es Gäste Frank gibt', :'E',
  $$insert into players (user_id,nickname,kind) values ('eeee0000-0000-4000-8000-00000000000e','Frank','account')$$, 'ok');
select htst('Ein zweites Konto Frank geht nicht', 'super',
  $$update players set nickname='FRANK' where nickname='Dani'$$, 'err');
select htst('Ein Gast darf heißen wie ein Konto', :'H', $$insert into players (owner_id,nickname,kind)
  values ((select id from t5 where name='Host'),'Basti','guest')$$, 'ok');
select htst('Gastkürzel mit 2 Zeichen', :'H', $$insert into players (owner_id,nickname,kind)
  values ((select id from t5 where name='Host'),'JK','guest')$$, 'ok');
select htst('Gast mit 1 Zeichen nicht', :'H', $$insert into players (owner_id,nickname,kind)
  values ((select id from t5 where name='Host'),'J','guest')$$, 'err');
select htst('Konto mit 2 Zeichen nicht', 'super',
  $$update players set nickname='Da' where nickname='Dani'$$, 'err');
select htst('Gruppe anlegen', :'H', $$select create_group('Stammtisch')$$, 'ok');
insert into t5 select 'Grp', id from groups;
select htst('Gruppen-Gast Frank neben dem Host-Gast Frank', :'H', $$insert into players (group_id,nickname,kind)
  values ((select id from t5 where name='Grp'),'Frank','guest')$$, 'ok');
select htst('Zweiter Gruppen-Gast Frank nicht', :'H', $$insert into players (group_id,nickname,kind)
  values ((select id from t5 where name='Grp'),'Frank','guest')$$, 'err');
insert into t5 select 'FrankH', id from players where nickname='Frank' and owner_id=(select id from t5 where name='Host');
insert into t5 select 'FrankB', id from players where nickname='Frank' and owner_id=(select id from t5 where name='Basti');
select hnum('H sieht den Frank von B nicht', :'H',
  $$select count(*) from players where id=(select id from t5 where name='FrankB')$$, 0);

\echo
select '== Kategorie ==';
select htst('Spiel ohne Kategorie (alter Aufruf)', :'H',
  $$select create_match('single','simple',1::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t5 where name='Host'),'team',1),
      jsonb_build_object('player_id',(select id from t5 where name='FrankH'),'team',2)))$$, 'ok');
insert into t5 select 'M1', id from matches order by created_at desc limit 1;
select htxt('…ist Wertung', 'super', $$select category from matches where id=(select id from t5 where name='M1')$$, 'ranked');
select htst('Lockeres Spiel', :'H',
  $$select create_match('single','full',2::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t5 where name='Host'),'team',1),
      jsonb_build_object('player_id',(select id from t5 where name='FrankH'),'team',2)), 'casual')$$, 'ok');
insert into t5 select 'M2', id from matches where category='casual';
select htxt('…ist locker', 'super', $$select category from matches where id=(select id from t5 where name='M2')$$, 'casual');
select htst('Unbekannte Kategorie', :'H',
  $$select create_match('single','simple',1::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t5 where name='Host'),'team',1),
      jsonb_build_object('player_id',(select id from t5 where name='FrankH'),'team',2)), 'turnier')$$, 'err');
select htst('Lobby locker', :'B', $$select create_lobby('single','simple',1::smallint,1::smallint,null,'casual')$$, 'ok');
select htxt('…ist locker', 'super', $$select category from matches where state='lobby'$$, 'casual');
select htst('Lobby ohne Kategorie', :'D', $$select create_lobby('single','simple',1::smallint,1::smallint,null)$$, 'ok');
select hnum('…ist Wertung', 'super', $$select count(*) from matches where state='lobby' and category='ranked'$$, 1);
select htst('Bestehende Spalten unverändert: Code gesetzt', 'super',
  $$select 1/(count(*))::int from matches where state='lobby' and join_code is not null having count(*)=2$$, 'ok');

\echo
select '== Spielverlauf ==';
select hnum('Laufende Spiele erscheinen nicht', :'H', $$select jsonb_array_length(my_match_history())$$, 0);
select htst('M1: ein Tor beendet das Spiel', :'H', $$select record_goal((select id from t5 where name='M1'), 2::smallint)$$, 'ok');
select htst('M2: Tor Host', :'H', $$select record_goal((select id from t5 where name='M2'), 1::smallint,
  (select id from t5 where name='Host'), null, false)$$, 'ok');
select htst('M2: Tor Host beendet', :'H', $$select record_goal((select id from t5 where name='M2'), 1::smallint,
  (select id from t5 where name='Host'), null, false)$$, 'ok');
select hnum('Zwei beendete Spiele', :'H', $$select jsonb_array_length(my_match_history())$$, 2);
select htxt('Neuestes zuerst (M2, locker)', :'H', $$select my_match_history()->0->>'category'$$, 'casual');
select htxt('Mein Team', :'H', $$select my_match_history()->0->>'team'$$, '1');
select htxt('Meine player_id steht dabei', :'H', $$select (my_match_history()->0->>'me') = (select id from t5 where name='Host')::text$$, 'true');
select htxt('Ich bin Host', :'H', $$select my_match_history()->0->>'host'$$, 'true');
select htxt('Gegner heißt Frank', :'H',
  $$select p->>'nick' from jsonb_array_elements(my_match_history()->0->'players') p where (p->>'team')='2'$$, 'Frank');
select htxt('Gegner-ID ist der eigene Frank', :'H',
  $$select (p->>'id') = (select id from t5 where name='FrankH')::text
      from jsonb_array_elements(my_match_history()->0->'players') p where (p->>'team')='2'$$, 'true');
select htxt('Sätze mit Sieger', :'H', $$select (my_match_history()->0->'sets')::text$$, '[[2, 0, 1]]');
select hnum('Tore bei Erweitert', :'H', $$select jsonb_array_length(my_match_history()->0->'goals')$$, 2);
select hnum('Keine Tore bei Einfach', :'H', $$select jsonb_array_length(my_match_history()->1->'goals')$$, 0);
select htxt('M1 von Frank gewonnen', :'H', $$select (my_match_history()->1->'sets')::text$$, '[[0, 1, 2]]');
select htxt('Keine user_id im Verlauf', :'H', $$select (my_match_history())::text like '%aaaa0000%'$$, 'false');
select hnum('Unbeteiligter sieht nichts', :'D', $$select jsonb_array_length(my_match_history())$$, 0);
select hnum('B sieht die Spiele von H nicht', :'B', $$select jsonb_array_length(my_match_history())$$, 0);
select htst('Ohne Anmeldung kein Aufruf', null, $$select my_match_history()$$, 'err');
select htst('Abgebrochenes Spiel fehlt', :'H',
  $$select create_match('single','simple',1::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t5 where name='Host'),'team',1),
      jsonb_build_object('player_id',(select id from t5 where name='FrankH'),'team',2)))$$, 'ok');
update matches set state='cancelled' where state='running';
select hnum('…weiterhin zwei', :'H', $$select jsonb_array_length(my_match_history())$$, 2);
