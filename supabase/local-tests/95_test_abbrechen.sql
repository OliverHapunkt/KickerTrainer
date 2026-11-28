-- Prüfung Abbrechen und Löschen mit Zustimmung (v3.27): request_end, answer_end.
-- Testgerüst wie 30_test_lobby.sql.

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

select gtst('Nicknames', 'super', $$insert into players (user_id,nickname,kind) values
  ('aaaa1111-0000-4000-8000-00000000000a','Host','account'),
  ('bbbb2222-0000-4000-8000-00000000000b','Basti','account'),
  ('cccc3333-0000-4000-8000-00000000000c','Chris','account'),
  ('dddd4444-0000-4000-8000-00000000000d','Dani','account'),
  ('eeee5555-0000-4000-8000-00000000000e','Emil','account')$$, 'ok');
select gtst('Gäste des Hosts', :'H', $$insert into players (owner_id,nickname,kind)
  select id, n, 'guest' from players, (values ('Jan'),('Tim')) v(n) where nickname='Host'$$, 'ok');
insert into t3 select nickname, id from players;

-- Spiel mit fester Aufstellung anlegen und starten (als Superuser: wie Lobby + start_match)
create function mk(p_name text, p_mode text, p_lineup text[][]) returns uuid language plpgsql as $$
declare m uuid; i int;
begin
  insert into matches (host_id, mode, detail, goals_per_set, sets_to_win, state, join_code, started_at)
  values ((select id from t3 where name='Host'), p_mode, 'simple', 2, 1, 'running', null, now()) returning id into m;
  for i in 1..array_length(p_lineup, 1) loop
    insert into match_players (match_id, player_id, team, is_host)
    values (m, (select id from t3 where name=p_lineup[i][1]), p_lineup[i][2]::smallint, p_lineup[i][1]='Host');
  end loop;
  insert into match_sets (match_id, set_no, started_at) values (m, 1, now());
  insert into t3 values (p_name, m);
  return m;
end $$;
create function st(p_name text) returns text language sql as $$
  select coalesce((select state || coalesce('/' || end_req, '') from matches where id=(select id from t3 where name=p_name)), 'weg') $$;
grant execute on function st(text) to authenticated;

\echo
select '== Host gegen Gäste: Host entscheidet allein ==';
select mk('G1','single', array[['Host','1'],['Jan','2']]);
select gtxt('Host bricht ab: sofort', :'H', $$select request_end((select id from t3 where name='G1'),'cancel')$$, 'done');
select gtxt('Spiel abgebrochen', 'super', $$select st('G1')$$, 'cancelled');
select mk('G2','single', array[['Host','1'],['Jan','2']]);
select gtst('G2 zu Ende spielen', :'H', $$select record_goal((select id from t3 where name='G2'),1::smallint) from generate_series(1,2)$$, 'ok');
select gtxt('… bestätigt (nur Gast)', 'super', $$select st('G2')$$, 'confirmed');
select gmsg('Beendetes Spiel abbrechen geht nicht', :'H', $$select request_end((select id from t3 where name='G2'),'cancel')$$, 'beendetes Spiel kannst du löschen');
select gtxt('Host löscht: sofort', :'H', $$select request_end((select id from t3 where name='G2'),'delete')$$, 'done');
select gtxt('Spiel weg', 'super', $$select st('G2')$$, 'weg');
select gnum('Tore und Sätze mit weg', 'super', $$select (select count(*) from goals where match_id=(select id from t3 where name='G2'))
  + (select count(*) from match_sets where match_id=(select id from t3 where name='G2'))$$, 0);

\echo
select '== Lobby ==';
select gtst('Lobby', :'H', $$select create_lobby('single','simple',2::smallint,1::smallint,null)$$, 'ok');
insert into t3 select 'Lob', id from matches where state='lobby';
insert into t3c select 'Lob', join_code from matches where state='lobby';
select gtst('Basti tritt bei', :'B', $$select join_match_by_code((select code from t3c where name='Lob'))$$, 'ok');
select gmsg('Basti kann die Lobby nicht schließen', :'B', $$select request_end((select id from t3 where name='Lob'),'cancel')$$, 'schließt der Host');
select gtxt('Host schließt sie sofort', :'H', $$select request_end((select id from t3 where name='Lob'),'cancel')$$, 'done');
select gnum('… Code entwertet', 'super', $$select count(*) from matches where id=(select id from t3 where name='Lob') and join_code is null and state='cancelled'$$, 1);

\echo
select '== Laufendes Doppel: Abbruch braucht die Gegenseite ==';
select mk('R1','double', array[['Host','1'],['Chris','1'],['Basti','2'],['Dani','2']]);
select gmsg('Emil spielt nicht mit', :'E', $$select request_end((select id from t3 where name='R1'),'cancel')$$, 'nicht mit');
select gmsg('Löschen eines laufenden Spiels', :'B', $$select request_end((select id from t3 where name='R1'),'delete')$$, 'laufendes Spiel brichst du ab');
select gtxt('Basti beantragt Abbruch', :'B', $$select request_end((select id from t3 where name='R1'),'cancel')$$, 'requested');
select gtxt('Spiel läuft weiter, Anfrage offen', 'super', $$select st('R1')$$, 'running/cancel');
select gnum('Mitspieler sehen die Anfrage', :'C', $$select count(*) from matches where end_req='cancel'
  and end_req_by=(select id from t3 where name='Basti')$$, 1);
select gmsg('Dani (eigenes Team) kann nicht zustimmen', :'D', $$select answer_end((select id from t3 where name='R1'), true)$$, 'Gegenseite');
select gmsg('Basti stimmt sich nicht selbst zu', :'B', $$select answer_end((select id from t3 where name='R1'), true)$$, 'Zustimmen muss die Gegenseite');
select gtxt('Chris lehnt ab', :'C', $$select answer_end((select id from t3 where name='R1'), false)$$, 'rejected');
select gtxt('Spiel läuft, Anfrage weg', 'super', $$select st('R1')$$, 'running');
select gmsg('Ohne Anfrage keine Antwort', :'C', $$select answer_end((select id from t3 where name='R1'), true)$$, 'keine offene Anfrage');
select gtxt('Basti beantragt erneut', :'B', $$select request_end((select id from t3 where name='R1'),'cancel')$$, 'requested');
select gtxt('Host beantragt dasselbe = Zustimmung', :'H', $$select request_end((select id from t3 where name='R1'),'cancel')$$, 'done');
select gtxt('Abgebrochen', 'super', $$select st('R1')$$, 'cancelled');

select mk('R2','double', array[['Host','1'],['Chris','1'],['Basti','2'],['Dani','2']]);
select gtxt('Host beantragt Abbruch', :'H', $$select request_end((select id from t3 where name='R2'),'cancel')$$, 'requested');
select gmsg('Host kann gegen Konten nicht mehr allein abbrechen', :'H', $$select answer_end((select id from t3 where name='R2'), true)$$, 'Zustimmen muss die Gegenseite');
select gtxt('Dani stimmt zu', :'D', $$select answer_end((select id from t3 where name='R2'), true)$$, 'done');
select gtxt('Abgebrochen', 'super', $$select st('R2')$$, 'cancelled');

\echo
select '== Gegner nur Gäste, Antrag vom Partner des Hosts: Host entscheidet ==';
select mk('R3','double', array[['Host','1'],['Basti','1'],['Jan','2'],['Tim','2']]);
select gtxt('Basti beantragt', :'B', $$select request_end((select id from t3 where name='R3'),'cancel')$$, 'requested');
select gtxt('Host stimmt zu', :'H', $$select answer_end((select id from t3 where name='R3'), true)$$, 'done');
select gtxt('Abgebrochen', 'super', $$select st('R3')$$, 'cancelled');

\echo
select '== Überholte Anfrage ==';
select mk('R4','single', array[['Host','1'],['Basti','2']]);
select gtxt('Basti beantragt Abbruch', :'B', $$select request_end((select id from t3 where name='R4'),'cancel')$$, 'requested');
select gtst('Host spielt zu Ende', :'H', $$select record_goal((select id from t3 where name='R4'),1::smallint) from generate_series(1,2)$$, 'ok');
select gtxt('Antwort auf überholte Anfrage', :'H', $$select answer_end((select id from t3 where name='R4'), true)$$, 'stale');
select gtxt('Spiel beendet, nicht abgebrochen', 'super', $$select st('R4')$$, 'finished');

\echo
select '== Bestätigtes Spiel löschen, Elo wird neu gerechnet ==';
select gtst('Basti bestätigt R4', :'B', $$select confirm_match((select id from t3 where name='R4'),'ok')$$, 'ok');
select gtxt('R4 bestätigt', 'super', $$select st('R4')$$, 'confirmed');
select gnum('Elo für Basti vorhanden', 'super', $$select count(*) from ratings where player_id=(select id from t3 where name='Basti')$$, 1);
select gtxt('Basti beantragt Löschen', :'B', $$select request_end((select id from t3 where name='R4'),'delete')$$, 'requested');
select gtxt('… und zieht zurück', :'B', $$select answer_end((select id from t3 where name='R4'), false)$$, 'withdrawn');
select gtxt('Anfrage weg', 'super', $$select st('R4')$$, 'confirmed');
select gtxt('Basti beantragt erneut', :'B', $$select request_end((select id from t3 where name='R4'),'delete')$$, 'requested');
select gtxt('Host stimmt zu', :'H', $$select answer_end((select id from t3 where name='R4'), true)$$, 'done');
select gtxt('R4 endgültig weg', 'super', $$select st('R4')$$, 'weg');
select gnum('Bestätigungen und Tore weg', 'super', $$select (select count(*) from match_confirmations where match_id=(select id from t3 where name='R4'))
  + (select count(*) from goals where match_id=(select id from t3 where name='R4'))$$, 0);
select gnum('Elo-Verlauf weg', 'super', $$select count(*) from rating_history where match_id=(select id from t3 where name='R4')$$, 0);
select gnum('Wertung neu gerechnet: keine Spiele mehr', 'super',
  $$select count(*) from ratings where player_id=(select id from t3 where name='Basti') and games > 0$$, 0);

\echo
select '== Direkt an den Funktionen vorbei geht nichts ==';
select gmsg('end_execute ist nicht aufrufbar', :'H', $$select end_execute((select id from t3 where name='R1'),'delete')$$, 'permission denied');
select gnum('Host kann Anfrage nicht selbst eintragen', :'H',
  $$with u as (update matches set end_req='cancel' where id=(select id from t3 where name='R1') returning 1) select count(*) from u$$, 0);
