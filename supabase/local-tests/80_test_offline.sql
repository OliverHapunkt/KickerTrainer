-- Prüfung der Offline-Spiele (v3.25): create_match mit p_id, import_match.
-- Eigenes Testgerüst wie 20_test_matches.sql.

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
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set B 'bbbbbbbb-0000-4000-8000-00000000000b'
\set C 'cccccccc-0000-4000-8000-00000000000c'

\echo
select '== Vorbereitung ==';
select ftst('Host legt Nickname an', :'H',
  $$insert into players (user_id, nickname, kind)
    values ('11111111-0000-4000-8000-000000000001', 'Oliver', 'account')$$, 'ok');
select ftst('Fremder legt Nickname an', :'F',
  $$insert into players (user_id, nickname, kind)
    values ('22222222-0000-4000-8000-000000000002', 'Fremd', 'account')$$, 'ok');
select ftst('Host legt Gäste an', :'H',
  $$insert into players (owner_id, nickname, kind)
    select (select id from players where nickname='Oliver'), n, 'guest'
      from (values ('Jan'),('Tim'),('Mara')) v(n)$$, 'ok');
insert into t2 select nickname, id from players;

-- Einzel Oliver gegen Jan, Satz bis 3, ein Gewinnsatz: 3:1, Tore mit Zeiten
create function lineup1() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('player_id',(select id from t2 where name='Oliver'),'team',1),
    jsonb_build_object('player_id',(select id from t2 where name='Jan'),'team',2)) $$;
create function goals1() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('team',1,'t', extract(epoch from now() - interval '3 hours 50 minutes')*1000),
    jsonb_build_object('team',2,'t', extract(epoch from now() - interval '3 hours 40 minutes')*1000),
    jsonb_build_object('team',1,'t', extract(epoch from now() - interval '3 hours 30 minutes')*1000),
    jsonb_build_object('team',1,'t', extract(epoch from now() - interval '3 hours 20 minutes')*1000)) $$;
grant execute on function lineup1() to authenticated;
grant execute on function goals1() to authenticated;

\echo
select '== create_match mit Nummer vom Gerät ==';
select ftst('create_match nimmt p_id an', :'H',
  $$select create_match('single','simple',3::smallint,1::smallint,null, lineup1(),
      'casual', null, 'cccccccc-0000-4000-8000-00000000000c')$$, 'ok');
select fnum('Spiel trägt die Nummer vom Gerät', 'super',
  $$select count(*) from matches where id = 'cccccccc-0000-4000-8000-00000000000c'$$, 1);
select ftst('create_match ohne p_id geht weiter', :'H',
  $$select create_match('single','simple',3::smallint,1::smallint,null, lineup1())$$, 'ok');

\echo
select '== Offline-Spiel hochladen ==';
select fjson('Import: Spiel ist durch', :'H',
  $$select import_match('aaaaaaaa-0000-4000-8000-00000000000a','single','simple',3::smallint,1::smallint,
      lineup1(),'ranked',null, goals1(), now() - interval '4 hours')$$, 'match_done', 'true');
select fnum('Stand 3:1 im Satz', 'super',
  $$select count(*) from match_sets where match_id='aaaaaaaa-0000-4000-8000-00000000000a'
      and score1=3 and score2=1 and winner_team=1$$, 1);
select fnum('Vier Tor-Zeilen', 'super',
  $$select count(*) from goals where match_id='aaaaaaaa-0000-4000-8000-00000000000a'$$, 4);
select fnum('Host plus Gast: sofort bestätigt', 'super',
  $$select count(*) from matches where id='aaaaaaaa-0000-4000-8000-00000000000a' and state='confirmed'$$, 1);
select fnum('Spielbeginn vom Gerät übernommen', 'super',
  $$select count(*) from matches where id='aaaaaaaa-0000-4000-8000-00000000000a'
      and started_at < now() - interval '3 hours 55 minutes' and created_at = started_at$$, 1);
select fnum('Spielende = Zeit des letzten Tors', 'super',
  $$select count(*) from matches where id='aaaaaaaa-0000-4000-8000-00000000000a'
      and finished_at between now() - interval '3 hours 21 minutes' and now() - interval '3 hours 19 minutes'$$, 1);
select fnum('Tor-Zeiten aufsteigend vom Gerät', 'super',
  $$select count(*) from goals where match_id='aaaaaaaa-0000-4000-8000-00000000000a'
      and t < now() - interval '3 hours'$$, 4);
select fnum('Satzzeiten aus den Toren', 'super',
  $$select count(*) from match_sets where match_id='aaaaaaaa-0000-4000-8000-00000000000a'
      and started_at < finished_at and finished_at < now() - interval '3 hours'$$, 1);

select fjson('Zweiter Upload (Antwort verloren): nur der Stand', :'H',
  $$select import_match('aaaaaaaa-0000-4000-8000-00000000000a','single','simple',3::smallint,1::smallint,
      lineup1(),'ranked',null, goals1(), now() - interval '4 hours')$$, 'match_done', 'true');
select fnum('Keine doppelten Tore', 'super',
  $$select count(*) from goals where match_id='aaaaaaaa-0000-4000-8000-00000000000a'$$, 4);
select fnum('Kein zweites Spiel', 'super',
  $$select count(*) from matches where id='aaaaaaaa-0000-4000-8000-00000000000a'$$, 1);

select ftst('Fremder kann die Nummer nicht übernehmen', :'F',
  $$select import_match('aaaaaaaa-0000-4000-8000-00000000000a','single','simple',3::smallint,1::smallint,
      jsonb_build_array(jsonb_build_object('player_id',(select id from t2 where name='Fremd'),'team',1),
                        jsonb_build_object('player_id',(select id from t2 where name='Fremd'),'team',2)),
      'ranked',null, '[]'::jsonb)$$, 'err');
select ftst('Fremder kann die Gäste des Hosts nicht einsetzen', :'F',
  $$select import_match('dddddddd-0000-4000-8000-00000000000d','single','simple',3::smallint,1::smallint,
      jsonb_build_array(jsonb_build_object('player_id',(select id from t2 where name='Fremd'),'team',1),
                        jsonb_build_object('player_id',(select id from t2 where name='Jan'),'team',2)),
      'ranked',null, '[]'::jsonb)$$, 'err');
select ftst('Anonym geht nicht', null,
  $$select import_match('eeeeeeee-0000-4000-8000-00000000000e','single','simple',3::smallint,1::smallint,
      lineup1(),'ranked',null, '[]'::jsonb)$$, 'err');

\echo
select '== Unstimmige Daten: alles oder nichts ==';
select ftst('Tor nach Spielende wird abgewiesen', :'H',
  $$select import_match('ffffffff-0000-4000-8000-00000000000f','single','simple',3::smallint,1::smallint,
      lineup1(),'ranked',null, goals1() || jsonb_build_array(jsonb_build_object('team',2)))$$, 'err');
select fnum('… und hinterlässt kein halbes Spiel', 'super',
  $$select count(*) from matches where id='ffffffff-0000-4000-8000-00000000000f'$$, 0);
select ftst('Unbekanntes Team wird abgewiesen', :'H',
  $$select import_match('ffffffff-0000-4000-8000-00000000000f','single','simple',3::smallint,1::smallint,
      lineup1(),'ranked',null, jsonb_build_array(jsonb_build_object('team',3)))$$, 'err');
select ftst('Tore müssen eine Liste sein', :'H',
  $$select import_match('ffffffff-0000-4000-8000-00000000000f','single','simple',3::smallint,1::smallint,
      lineup1(),'ranked',null, '{}'::jsonb)$$, 'err');

\echo
select '== Laufendes Spiel, Regeln, Erweitert ==';
select fjson('Halbes Spiel läuft danach online weiter', :'H',
  $$select import_match('bbbbbbbb-0000-4000-8000-00000000000b','double','full',5::smallint,2::smallint,
      jsonb_build_array(
        jsonb_build_object('player_id',(select id from t2 where name='Oliver'),'team',1,'position','off'),
        jsonb_build_object('player_id',(select id from t2 where name='Jan'),'team',1,'position','def'),
        jsonb_build_object('player_id',(select id from t2 where name='Tim'),'team',2,'position','off'),
        jsonb_build_object('player_id',(select id from t2 where name='Mara'),'team',2,'position','def')),
      'ranked', jsonb_build_object('win_by',2,'scope','all'),
      jsonb_build_array(
        jsonb_build_object('team',1,'scorer',(select id from t2 where name='Oliver'),'position','off'),
        jsonb_build_object('team',1,'scorer',(select id from t2 where name='Tim'),'position','off','own',true),
        jsonb_build_object('team',2,'scorer',(select id from t2 where name='Mara'),'position','def')))$$,
  'score1', '2');
select fnum('Läuft noch', 'super',
  $$select count(*) from matches where id='bbbbbbbb-0000-4000-8000-00000000000b' and state='running' and finished_at is null$$, 1);
select fnum('Regel 2 Tore Vorsprung übernommen', 'super',
  $$select count(*) from matches where id='bbbbbbbb-0000-4000-8000-00000000000b' and win_by=2 and win_by_scope='all'$$, 1);
select fnum('Schützen und Eigentor gespeichert', 'super',
  $$select count(*) from goals where match_id='bbbbbbbb-0000-4000-8000-00000000000b'
      and scorer_id is not null and (own_goal = (scorer_id = (select id from t2 where name='Tim')))$$, 3);
select fjson('Online weiterzählen', :'H',
  $$select record_goal('bbbbbbbb-0000-4000-8000-00000000000b', 1::smallint)$$, 'score1', '3');
select fjson('Erneuter Upload ändert nichts mehr', :'H',
  $$select import_match('bbbbbbbb-0000-4000-8000-00000000000b','double','full',5::smallint,2::smallint,
      '[]'::jsonb,'ranked',null, jsonb_build_array(jsonb_build_object('team',2)))$$, 'score2', '1');
select fjson('Rückgängig klappt nach dem Upload', :'H',
  $$select undo_goal('bbbbbbbb-0000-4000-8000-00000000000b')$$, 'score1', '2');

\echo
select '== Online angelegt, offline gezählt ==';
select fjson('Leeres Spiel mit gleicher Nummer bekommt die Tore', :'H',
  $$select import_match('cccccccc-0000-4000-8000-00000000000c','single','simple',3::smallint,1::smallint,
      lineup1(),'casual',null, goals1())$$, 'match_done', 'true');
select fnum('Kein zweites Spiel angelegt', 'super',
  $$select count(*) from matches where id='cccccccc-0000-4000-8000-00000000000c'$$, 1);

\echo
select '== Zeiten vom Gerät begrenzt ==';
select ftst('Zeit in der Zukunft', :'H',
  $$select import_match('99999999-0000-4000-8000-000000000009','single','simple',3::smallint,1::smallint,
      lineup1(),'ranked',null, jsonb_build_array(jsonb_build_object('team',1,'t', extract(epoch from now() + interval '5 days')*1000)),
      now() - interval '400 days')$$, 'ok');
select fnum('Beginn höchstens 60 Tage zurück', 'super',
  $$select count(*) from matches where id='99999999-0000-4000-8000-000000000009'
      and started_at between now() - interval '61 days' and now() - interval '59 days'$$, 1);
select fnum('Tor nicht in der Zukunft', 'super',
  $$select count(*) from goals where match_id='99999999-0000-4000-8000-000000000009' and t <= now()$$, 1);
