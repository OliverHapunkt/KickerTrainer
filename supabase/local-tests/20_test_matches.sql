-- Prüfung der Spiel-Funktionen (Schritt 3a).
-- Setzt 10_test_rls.sql NICHT voraus: eigene Nutzer, eigenes Testgerüst.

\set QUIET on
\pset tuples_only on
\pset border 0

create table t2 (name text primary key, id uuid);
grant select on t2 to authenticated;

create function f_role(uid text) returns text language sql immutable as $$
  select case when uid = 'super' then 'postgres' when uid is null then 'anon' else 'authenticated' end
$$;

create function ftst(label text, uid text, sql text, expect text)
returns text language plpgsql as $$
declare res text; msg text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
    execute 'set local role ' || f_role(uid);
    execute sql; res := 'ok';
  exception when others then res := 'err'; msg := sqlerrm; end;
  reset role;
  if res = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || res ||
         coalesce(': ' || left(msg, 95), '') || ')';
end $$;

-- Ruft eine Funktion auf und vergleicht einen Wert aus dem jsonb-Ergebnis
create function fjson(label text, uid text, sql text, key text, expect text)
returns text language plpgsql as $$
declare j jsonb; got text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
  execute 'set local role ' || f_role(uid);
  execute sql into j;
  reset role;
  got := coalesce(j ->> key, 'null');
  if got = expect then return 'PASS  ' || label || ' (' || key || '=' || got || ')'; end if;
  return 'FAIL  ' || label || '  (' || key || ': erwartet ' || expect || ', war ' || got || ')';
exception when others then
  reset role;
  return 'FAIL  ' || label || '  (Fehler: ' || left(sqlerrm, 95) || ')';
end $$;

create function fnum(label text, uid text, sql text, expect bigint)
returns text language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(nullif(uid,'super'), ''), true);
  execute 'set local role ' || f_role(uid);
  execute sql into n;
  reset role;
  if n = expect then return 'PASS  ' || label; end if;
  return 'FAIL  ' || label || '  (erwartet ' || expect || ', war ' || n || ')';
exception when others then
  reset role;
  return 'FAIL  ' || label || '  (Fehler: ' || left(sqlerrm, 95) || ')';
end $$;

insert into auth.users (id, email) values
  ('11111111-0000-4000-8000-000000000001', 'host@example.org'),
  ('22222222-0000-4000-8000-000000000002', 'fremd@example.org');

\set H '11111111-0000-4000-8000-000000000001'
\set F '22222222-0000-4000-8000-000000000002'

\echo
select '== Vorbereitung ==';

select ftst('Host legt Nickname an', :'H',
  $$insert into players (user_id, nickname, kind)
    values ('11111111-0000-4000-8000-000000000001', 'Oliver', 'account')$$, 'ok');
select ftst('Fremder legt Nickname an', :'F',
  $$insert into players (user_id, nickname, kind)
    values ('22222222-0000-4000-8000-000000000002', 'Fremd', 'account')$$, 'ok');
select ftst('Host legt drei Gäste an', :'H',
  $$insert into players (owner_id, nickname, kind)
    select (select id from players where nickname='Oliver'), n, 'guest'
      from (values ('Jan'),('Tim'),('Mara')) v(n)$$, 'ok');

insert into t2 select nickname, id from players;

\echo
select '== Spiel anlegen ==';

select ftst('Doppel mit falscher Teamgröße wird abgewiesen', :'H',
  $$select create_match('double','full',5::smallint,2::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t2 where name='Oliver'),'team',1,'position','off'),
      jsonb_build_object('player_id',(select id from t2 where name='Jan'),'team',2,'position','off')))$$, 'err');

select ftst('Spiel ohne eigene Teilnahme wird abgewiesen', :'H',
  $$select create_match('single','simple',5::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t2 where name='Jan'),'team',1),
      jsonb_build_object('player_id',(select id from t2 where name='Tim'),'team',2)))$$, 'err');

select ftst('Fremder kann die Gäste des Hosts nicht einsetzen', :'F',
  $$select create_match('single','simple',5::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t2 where name='Fremd'),'team',1),
      jsonb_build_object('player_id',(select id from t2 where name='Jan'),'team',2)))$$, 'err');

select ftst('Doppel, erweitert, Satz bis 3, 2 Gewinnsätze', :'H',
  $$select create_match('double','full',3::smallint,2::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t2 where name='Oliver'),'team',1,'position','off'),
      jsonb_build_object('player_id',(select id from t2 where name='Jan'),'team',1,'position','def'),
      jsonb_build_object('player_id',(select id from t2 where name='Tim'),'team',2,'position','off'),
      jsonb_build_object('player_id',(select id from t2 where name='Mara'),'team',2,'position','def')))$$, 'ok');

insert into t2 select 'Spiel', id from matches;

select fnum('Vier Spieler in der Aufstellung', 'super',
  $$select count(*) from match_players$$, 4);
select fnum('Positionen gesetzt', 'super',
  $$select count(*) from match_players where position in ('off','def')$$, 4);
select fnum('Satz 1 angelegt', 'super', $$select count(*) from match_sets$$, 1);
select fnum('Kein Beitrittscode in diesem Schritt', 'super',
  $$select count(*) from matches where join_code is null and state='running'$$, 1);

\echo
select '== Tore zählen ==';

select fjson('1. Tor Team 1', :'H',
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint,
      (select id from t2 where name='Oliver'), 'off', false)$$, 'score1', '1');
select fjson('2. Tor Team 2', :'H',
  $$select record_goal((select id from t2 where name='Spiel'), 2::smallint,
      (select id from t2 where name='Tim'), 'off', false)$$, 'score2', '1');
select fjson('Eigentor zählt für das andere Team', :'H',
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint,
      (select id from t2 where name='Tim'), 'off', true)$$, 'score1', '2');
select fnum('Eigentor ist als solches gespeichert', 'super',
  $$select count(*) from goals where own_goal$$, 1);

select ftst('Fremder kann keine Tore zählen', :'F',
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint)$$, 'err');

select fjson('3. Tor Team 1 beendet Satz 1', :'H',
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint,
      (select id from t2 where name='Oliver'), 'def', false)$$, 'sets1', '1');
select fjson('Nach dem Satzende läuft Satz 2', :'H',
  $$select match_state((select id from t2 where name='Spiel'))$$, 'set_no', '2');
select fjson('Satz 2 beginnt bei 0', :'H',
  $$select match_state((select id from t2 where name='Spiel'))$$, 'score1', '0');
select fnum('Satz 1 hat einen Gewinner', 'super',
  $$select count(*) from match_sets where set_no=1 and winner_team=1$$, 1);

\echo
select '== Rückgängig ==';

select fjson('Rückgängig über das Satzende hinweg', :'H',
  $$select undo_goal((select id from t2 where name='Spiel'))$$, 'set_no', '1');
select fjson('Satz 1 steht wieder auf 2', :'H',
  $$select match_state((select id from t2 where name='Spiel'))$$, 'score1', '2');
select fjson('Kein Satz gewonnen', :'H',
  $$select match_state((select id from t2 where name='Spiel'))$$, 'sets1', '0');
select fnum('Der leere Satz 2 ist weg', 'super', $$select count(*) from match_sets$$, 1);
select fnum('Das Tor ist weg', 'super', $$select count(*) from goals$$, 3);

\echo
select '== Spielende ==';

select fjson('Satz 1 erneut gewinnen', :'H',
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint,
      (select id from t2 where name='Oliver'), 'off', false)$$, 'sets1', '1');
select fjson('Satz 2 Tor 1', :'H',
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint)$$, 'score1', '1');
select fjson('Satz 2 Tor 2', :'H',
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint)$$, 'score1', '2');
select fjson('Satz 2 Tor 3 beendet das Spiel', :'H',
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint)$$, 'match_done', 'true');
select fnum('Spiel steht auf finished', 'super',
  $$select count(*) from matches where state='finished' and finished_at is not null$$, 1);
select fnum('Kein dritter Satz angelegt', 'super', $$select count(*) from match_sets$$, 2);
select ftst('Im beendeten Spiel kein weiteres Tor', :'H',
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint)$$, 'err');
select fjson('Rückgängig macht das Spiel wieder laufend', :'H',
  $$select undo_goal((select id from t2 where name='Spiel'))$$, 'state', 'running');

\echo
select '== Einfache Erfassung schreibt keine Tor-Zeilen ==';

select ftst('Einzel, einfach, Satz bis 2', :'H',
  $$select create_match('single','simple',2::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t2 where name='Oliver'),'team',1),
      jsonb_build_object('player_id',(select id from t2 where name='Jan'),'team',2)))$$, 'ok');

insert into t2 select 'Spiel2', id from matches where mode='single';

select fnum('Keine Positionen bei Einzel', 'super',
  $$select count(*) from match_players mp join matches m on m.id=mp.match_id
     where m.mode='single' and mp.position is not null$$, 0);

select fjson('Tor im einfachen Modus', :'H',
  $$select record_goal((select id from t2 where name='Spiel2'), 2::smallint)$$, 'score2', '1');
select fnum('Keine Tor-Zeile im einfachen Modus', 'super',
  $$select count(*) from goals g join matches m on m.id=g.match_id where m.detail='simple'$$, 0);
select fjson('Zweites Tor beendet Spiel2', :'H',
  $$select record_goal((select id from t2 where name='Spiel2'), 2::smallint)$$, 'match_done', 'true');
select fjson('Rückgängig geht auch ohne Tor-Zeilen', :'H',
  $$select undo_goal((select id from t2 where name='Spiel2'))$$, 'score2', '1');

\echo
select '== Sichtbarkeit ==';

select fnum('Host sieht beide Spiele', :'H', $$select count(*) from matches$$, 2);
select fnum('Fremder sieht keines', :'F', $$select count(*) from matches$$, 0);
select fnum('Fremder sieht die Gäste nicht', :'F',
  $$select count(*) from players where kind='guest'$$, 0);
select ftst('anon kann record_goal nicht aufrufen', null,
  $$select record_goal((select id from t2 where name='Spiel'), 1::smallint)$$, 'err');
