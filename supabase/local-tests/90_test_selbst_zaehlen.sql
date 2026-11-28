-- Prüfung „Jeder zählt am eigenen Handy“ (v3.26): set_device, record_goal und
-- undo_goal mit Mitzählern, swap_positions. Testgerüst wie 30_test_lobby.sql.

\set QUIET on
\pset tuples_only on
\pset border 0

create table t3 (name text primary key, id uuid);
-- Codes getrennt ablegen: Wer beitreten will, darf das Spiel vorher nicht sehen
-- und kann den Code also nicht selbst aus matches lesen. Genau das ist gewollt.
create table t3c (name text primary key, code text);
grant select on t3, t3c to authenticated;

create function g_role(uid text) returns text language sql immutable as $$
  select case when uid = 'super' then 'postgres' when uid is null then 'anon' else 'authenticated' end
$$;

create function gtst(label text, uid text, sql text, expect text)
returns text language plpgsql as $$
declare res text; msg text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
    execute 'set local role ' || g_role(uid);
    execute sql; res := 'ok';
  exception when others then res := 'err'; msg := sqlerrm; end;
  reset role;
  if res = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || res ||
         coalesce(': ' || left(msg, 95), '') || ')';
end $$;

create function gmsg(label text, uid text, sql text, needle text)
returns text language plpgsql as $$
declare msg text := '';
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
    execute 'set local role ' || g_role(uid);
    execute sql;
  exception when others then msg := sqlerrm; end;
  reset role;
  if msg like '%' || needle || '%' then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (Meldung: ' || coalesce(nullif(msg,''),'kein Fehler') || ')';
end $$;

create function gnum(label text, uid text, sql text, expect bigint)
returns text language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
  execute 'set local role ' || g_role(uid);
  execute sql into n;
  reset role;
  if n = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || n || ')';
exception when others then
  reset role;
  return 'FAIL  ' || label || '  (Fehler: ' || left(sqlerrm, 95) || ')';
end $$;

create function gtxt(label text, uid text, sql text, expect text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
  execute 'set local role ' || g_role(uid);
  execute sql into v;
  reset role;
  if coalesce(v,'null') = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || coalesce(v,'null') || ')';
exception when others then
  reset role;
  return 'FAIL  ' || label || '  (Fehler: ' || left(sqlerrm, 95) || ')';
end $$;

create function gjson(label text, uid text, sql text, key text, expect text)
returns text language plpgsql as $$
declare j jsonb; got text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
  execute 'set local role ' || g_role(uid);
  execute sql into j;
  reset role;
  got := coalesce(j ->> key, 'null');
  if got = expect then return 'PASS  ' || label || ' (' || key || '=' || got || ')'; end if;
  return 'FAIL  ' || label || '  (' || key || ': erwartet ' || expect || ', war ' || got || ')';
exception when others then
  reset role;
  return 'FAIL  ' || label || '  (Fehler: ' || left(sqlerrm, 95) || ')';
end $$;

insert into auth.users (id, email) values
  ('aaaa1111-0000-4000-8000-00000000000a', 'h@example.org'),
  ('bbbb2222-0000-4000-8000-00000000000b', 'b@example.org'),
  ('cccc3333-0000-4000-8000-00000000000c', 'c@example.org'),
  ('dddd4444-0000-4000-8000-00000000000d', 'd@example.org'),
  ('eeee5555-0000-4000-8000-00000000000e', 'e@example.org');
\set H 'aaaa1111-0000-4000-8000-00000000000a'
\set B 'bbbb2222-0000-4000-8000-00000000000b'
\set C 'cccc3333-0000-4000-8000-00000000000c'
\set D 'dddd4444-0000-4000-8000-00000000000d'
\set E 'eeee5555-0000-4000-8000-00000000000e'

\echo
select '== Vorbereitung: Doppel, Erweitert, Host+Chris gegen Basti+Dani ==';
select gtst('Nicknames', 'super', $$insert into players (user_id,nickname,kind) values
  ('aaaa1111-0000-4000-8000-00000000000a','Host','account'),
  ('bbbb2222-0000-4000-8000-00000000000b','Basti','account'),
  ('cccc3333-0000-4000-8000-00000000000c','Chris','account'),
  ('dddd4444-0000-4000-8000-00000000000d','Dani','account'),
  ('eeee5555-0000-4000-8000-00000000000e','Emil','account')$$, 'ok');
insert into t3 select nickname, id from players;
select gtst('Lobby (Satz bis 9, ein Satz)', :'H',
  $$select create_lobby('double','full',9::smallint,1::smallint,null)$$, 'ok');
insert into t3 select 'Spiel', id from matches;
insert into t3c select 'Spiel', join_code from matches;
select gtst('Basti tritt bei', :'B', $$select join_match_by_code((select code from t3c where name='Spiel'))$$, 'ok');
select gtst('Chris tritt bei', :'C', $$select join_match_by_code((select code from t3c where name='Spiel'))$$, 'ok');
select gtst('Dani tritt bei', :'D', $$select join_match_by_code((select code from t3c where name='Spiel'))$$, 'ok');
-- Aufstellung festlegen (wie der Host es in der Lobby täte)
update match_players set team = 1, position = 'def' where player_id = (select id from t3 where name='Chris');
update match_players set team = 2, position = 'off' where player_id = (select id from t3 where name='Basti');
update match_players set team = 2, position = 'def' where player_id = (select id from t3 where name='Dani');
select gnum('Aufstellung 2:2 mit Sturm/Abwehr', 'super',
  $$select count(*) from match_players where (team, position) in ((1,'off'),(1,'def'),(2,'off'),(2,'def'))$$, 4);

\echo
select '== Zählweise wählen ==';
select gtst('Basti: eigenes Handy', :'B', $$select set_device((select id from t3 where name='Spiel'),'own')$$, 'ok');
select gmsg('Dani: Team-Handy geht nicht, Basti zählt schon selbst', :'D',
  $$select set_device((select id from t3 where name='Spiel'),'team')$$, 'Basti zählt schon selbst');
select gtst('Dani: eigenes Handy', :'D', $$select set_device((select id from t3 where name='Spiel'),'own')$$, 'ok');
select gtst('Chris: Team-Handy', :'C', $$select set_device((select id from t3 where name='Spiel'),'team')$$, 'ok');
select gmsg('Unbekannte Zählweise', :'C', $$select set_device((select id from t3 where name='Spiel'),'alle')$$, 'Unbekannte');
select gmsg('Wer nicht mitspielt, kann nichts wählen', :'E',
  $$select set_device((select id from t3 where name='Spiel'),'own')$$, 'spielst in diesem Spiel nicht mit');
select gtst('Direktes Ändern der Tabelle durch Mitspieler wirkungslos', :'B',
  $$update match_players set device = 'team' where player_id = (select id from t3 where name='Dani')$$, 'ok');
select gtxt('… Dani bleibt bei „own“', 'super',
  $$select device from match_players where player_id=(select id from t3 where name='Dani')$$, 'own');
select gtst('Start', :'H', $$select start_match((select id from t3 where name='Spiel'))$$, 'ok');

\echo
select '== Eigenes Handy: nur eigene Tore ==';
select gjson('Basti zählt sein Tor', :'B',
  $$select record_goal((select id from t3 where name='Spiel'), 2::smallint)$$, 'score2', '1');
select gnum('… Schütze, Position und Eintragender gesetzt', 'super',
  $$select count(*) from goals where scorer_id=(select id from t3 where name='Basti')
      and scorer_position='off' and by_player=(select id from t3 where name='Basti')$$, 1);
select gmsg('Basti kann kein Tor für Team 1 eintragen', :'B',
  $$select record_goal((select id from t3 where name='Spiel'), 1::smallint)$$, 'nur Tore für dein Team');
select gmsg('Basti kann kein Tor für Dani eintragen', :'B',
  $$select record_goal((select id from t3 where name='Spiel'), 2::smallint, (select id from t3 where name='Dani'))$$,
  'nur deine eigenen Tore');
select gjson('Dani trägt Eigentor des Hosts ein (Punkt für Team 2)', :'D',
  $$select record_goal((select id from t3 where name='Spiel'), 2::smallint, (select id from t3 where name='Host'), null, true)$$,
  'score2', '2');
select gmsg('Eigentor mit Schützen aus dem eigenen Team abgewiesen', :'D',
  $$select record_goal((select id from t3 where name='Spiel'), 2::smallint, (select id from t3 where name='Basti'), null, true)$$,
  'Schütze im anderen Team');

\echo
select '== Team-Handy: Schütze wählbar, nur eigenes Team ==';
select gjson('Chris trägt Tor des Hosts ein', :'C',
  $$select record_goal((select id from t3 where name='Spiel'), 1::smallint, (select id from t3 where name='Host'))$$, 'score1', '1');
select gnum('… Schütze Host, Position Sturm, eingetragen von Chris', 'super',
  $$select count(*) from goals where scorer_id=(select id from t3 where name='Host') and not own_goal
      and scorer_position='off' and by_player=(select id from t3 where name='Chris')$$, 1);
select gmsg('Chris kann Basti nicht als Schützen eintragen', :'C',
  $$select record_goal((select id from t3 where name='Spiel'), 1::smallint, (select id from t3 where name='Basti'))$$,
  'in deinem Team');

\echo
select '== Rückgängig: nur das eigene ==';
select gmsg('Basti kann Chris’ Tor nicht zurücknehmen', :'B',
  $$select undo_goal((select id from t3 where name='Spiel'))$$, 'jemand anderes eingetragen');
select gmsg('Dani auch nicht', :'D', $$select undo_goal((select id from t3 where name='Spiel'))$$, 'jemand anderes');
select gjson('Chris (Team-Handy) nimmt es zurück', :'C',
  $$select undo_goal((select id from t3 where name='Spiel'))$$, 'score1', '0');
select gjson('Basti zählt', :'B', $$select record_goal((select id from t3 where name='Spiel'), 2::smallint)$$, 'score2', '3');
select gmsg('Chris kann Team 2 nichts zurücknehmen', :'C',
  $$select undo_goal((select id from t3 where name='Spiel'))$$, 'jemand anderes');
select gjson('Host darf immer', :'H', $$select undo_goal((select id from t3 where name='Spiel'))$$, 'score2', '2');
select gjson('Host trägt ein Tor von Basti ein', :'H',
  $$select record_goal((select id from t3 where name='Spiel'), 2::smallint, (select id from t3 where name='Basti'), 'off', false)$$,
  'score2', '3');
select gjson('Basti als Schütze darf es zurücknehmen', :'B',
  $$select undo_goal((select id from t3 where name='Spiel'))$$, 'score2', '2');
select gjson('Host trägt Eigentor von Basti ein', :'H',
  $$select record_goal((select id from t3 where name='Spiel'), 1::smallint, (select id from t3 where name='Basti'), 'off', true)$$,
  'score1', '1');
select gmsg('Basti kann ein Eigentor (Punkt für Gegner) nicht zurücknehmen', :'B',
  $$select undo_goal((select id from t3 where name='Spiel'))$$, 'jemand anderes');
select gmsg('Emil (spielt nicht mit) darf nichts', :'E',
  $$select record_goal((select id from t3 where name='Spiel'), 1::smallint)$$, 'Nur der Host');

\echo
select '== Position tauschen ==';
select gtst('Basti: „ich übernehme hinten“ (Team 2)', :'B',
  $$select swap_positions((select id from t3 where name='Spiel'), 2::smallint)$$, 'ok');
select gtxt('Basti steht jetzt in der Abwehr', 'super',
  $$select position from match_players where player_id=(select id from t3 where name='Basti')$$, 'def');
select gtxt('Dani im Sturm', 'super',
  $$select position from match_players where player_id=(select id from t3 where name='Dani')$$, 'off');
select gmsg('Basti tauscht nicht beim Gegner', :'B',
  $$select swap_positions((select id from t3 where name='Spiel'), 1::smallint)$$, 'eigene Team');
select gjson('Bastis nächstes Tor zählt aus der Abwehr', :'B',
  $$select record_goal((select id from t3 where name='Spiel'), 2::smallint)$$, 'score2', '3');
select gnum('… Position def gespeichert', 'super',
  $$select count(*) from goals where scorer_id=(select id from t3 where name='Basti') and scorer_position='def'$$, 1);
select gtst('Host darf jedes Team tauschen', :'H',
  $$select swap_positions((select id from t3 where name='Spiel'), 2::smallint)$$, 'ok');

\echo
select '== Zählen abschalten ==';
select gtst('Basti hört auf zu zählen', :'B', $$select set_device((select id from t3 where name='Spiel'), null)$$, 'ok');
select gmsg('… und kann dann nicht mehr eintragen', :'B',
  $$select record_goal((select id from t3 where name='Spiel'), 2::smallint)$$, 'Nur der Host');
select gtst('Jetzt geht für Dani auch das Team-Handy', :'D',
  $$select set_device((select id from t3 where name='Spiel'),'team')$$, 'ok');
select gmsg('… und Basti kann nicht mehr „eigenes Handy“', :'B',
  $$select set_device((select id from t3 where name='Spiel'),'own')$$, 'Team-Handy');

\echo
select '== Nach Spielende ==';
select gtst('Host zählt das Spiel zu Ende', :'H', $$select record_goal((select id from t3 where name='Spiel'), 1::smallint)
  from generate_series(1, 8)$$, 'ok');
select gnum('Spiel beendet', 'super', $$select count(*) from matches where state='finished'$$, 1);
select gmsg('Mitspieler korrigiert nach Spielende nicht', :'D',
  $$select undo_goal((select id from t3 where name='Spiel'))$$, 'nur der Host');
select gmsg('Zählweise nach Spielende nicht mehr änderbar', :'D',
  $$select set_device((select id from t3 where name='Spiel'), null)$$, 'läuft nicht mehr');
select gmsg('Tauschen nach Spielende nicht mehr', :'H',
  $$select swap_positions((select id from t3 where name='Spiel'), 1::smallint)$$, 'läuft nicht mehr');

\echo
select '== Einzel und Einfach ==';
select gtst('Einzel-Lobby, Erfassung Einfach', :'H',
  $$select create_lobby('single','simple',5::smallint,1::smallint,null)$$, 'ok');
delete from t3c where true;
insert into t3c select 'Einzel', join_code from matches where state='lobby';
insert into t3 select 'Einzel', id from matches where state='lobby';
select gtst('Basti tritt bei', :'B', $$select join_match_by_code((select code from t3c where name='Einzel'))$$, 'ok');
select gtst('Basti wählt Team-Handy', :'B', $$select set_device((select id from t3 where name='Einzel'),'team')$$, 'ok');
select gtxt('… im Einzel wird daraus „own“', 'super',
  $$select device from match_players where match_id=(select id from t3 where name='Einzel')
      and player_id=(select id from t3 where name='Basti')$$, 'own');
select gtst('Start', :'H', $$select start_match((select id from t3 where name='Einzel'))$$, 'ok');
select gjson('Basti zählt (Einfach: ohne Schütze)', :'B',
  $$select record_goal((select id from t3 where name='Einzel'), 2::smallint)$$, 'score2', '1');
select gnum('… Tor-Zeile ohne Schütze, aber mit Eintragendem', 'super',
  $$select count(*) from goals where match_id=(select id from t3 where name='Einzel')
      and scorer_id is null and by_player=(select id from t3 where name='Basti')$$, 1);
select gmsg('Tauschen gibt es im Einzel nicht', :'B',
  $$select swap_positions((select id from t3 where name='Einzel'), 2::smallint)$$, 'nur im Doppel');
select gjson('Basti nimmt sein Tor zurück', :'B',
  $$select undo_goal((select id from t3 where name='Einzel'))$$, 'score2', '0');
