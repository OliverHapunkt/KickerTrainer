-- Prüfung von Bestätigung und Korrektur (Schritt 4).
-- H = Host, B und C = Mitspieler mit Konto, D = Unbeteiligter, Jan = Gast.

\set QUIET on
\pset tuples_only on
\pset border 0

create table t4 (name text primary key, id uuid);
create table t4c (name text primary key, code text);
grant select on t4, t4c to authenticated;

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
  ('cccc0000-0000-4000-8000-00000000000c','c@x.org'),
  ('dddd0000-0000-4000-8000-00000000000d','d@x.org');
\set H 'aaaa0000-0000-4000-8000-00000000000a'
\set B 'bbbb0000-0000-4000-8000-00000000000b'
\set C 'cccc0000-0000-4000-8000-00000000000c'
\set D 'dddd0000-0000-4000-8000-00000000000d'

\echo
select '== Vorbereitung ==';
select htst('Profile anlegen', 'super', $$insert into players (user_id,nickname,kind) values
  ('aaaa0000-0000-4000-8000-00000000000a','Host','account'),
  ('bbbb0000-0000-4000-8000-00000000000b','Basti','account'),
  ('cccc0000-0000-4000-8000-00000000000c','Chris','account'),
  ('dddd0000-0000-4000-8000-00000000000d','Dani','account')$$, 'ok');
select htst('Gast anlegen', :'H', $$insert into players (owner_id,nickname,kind)
  select id,'Jan','guest' from players where nickname='Host'$$, 'ok');
insert into t4 select nickname, id from players;

\echo
select '== Nur Gäste: gilt sofort als bestätigt ==';
select htst('Einzel Host gegen Gast, Satz bis 1', :'H',
  $$select create_match('single','simple',1::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t4 where name='Host'),'team',1),
      jsonb_build_object('player_id',(select id from t4 where name='Jan'),'team',2)))$$, 'ok');
insert into t4 select 'G1', id from matches;
select htst('Ein Tor beendet das Spiel', :'H',
  $$select record_goal((select id from t4 where name='G1'), 1::smallint)$$, 'ok');
select htxt('Zustand ist sofort bestätigt', 'super',
  $$select state from matches where id=(select id from t4 where name='G1')$$, 'confirmed');
select hnum('Ohne dass jemand bestätigt hätte', 'super',
  $$select count(*) from match_confirmations$$, 0);

\echo
select '== Mit Mitspieler: wartet auf die Gegenseite ==';
select htst('Doppel-Lobby', :'H', $$select create_lobby('double','simple',1::smallint,1::smallint,null)$$, 'ok');
insert into t4 select 'G2', id from matches where mode='double';
insert into t4c select 'G2', join_code from matches where mode='double';
select htst('B tritt bei', :'B', $$select join_match_by_code((select code from t4c where name='G2'))$$, 'ok');
select htst('C tritt bei', :'C', $$select join_match_by_code((select code from t4c where name='G2'))$$, 'ok');
select htst('Host setzt seinen Gast auf den vierten Platz', :'H',
  $$insert into match_players (match_id, player_id, team)
    select (select id from t4 where name='G2'), (select id from t4 where name='Jan'),
           case when (select count(*) from match_players where match_id=(select id from t4 where name='G2') and team=1)<2
                then 1 else 2 end$$, 'ok');
select htst('Start', :'H', $$select start_match((select id from t4 where name='G2'))$$, 'ok');
select htst('Ein Tor beendet das Spiel', :'H',
  $$select record_goal((select id from t4 where name='G2'), 1::smallint)$$, 'ok');

select htxt('Zustand bleibt beendet', 'super',
  $$select state from matches where id=(select id from t4 where name='G2')$$, 'finished');
select htxt('Team des Hosts gilt als bestätigt', 'super',
  $$select team_confirmed((select id from t4 where name='G2'),1::smallint)::text$$, 'true');
select htxt('Das andere Team noch nicht', 'super',
  $$select team_confirmed((select id from t4 where name='G2'),2::smallint)::text$$, 'false');

select hmsg('Unbeteiligte können nicht bestätigen', :'D',
  $$select confirm_match((select id from t4 where name='G2'),'ok')$$, 'nicht mitgespielt');
select hmsg('anon erst recht nicht', null,
  $$select confirm_match((select id from t4 where name='G2'),'ok')$$, 'ermission');

-- Die Verteilung steht fest: Host und C in Team 1, B und der Gast in Team 2.
select htxt('B ist in Team 2', 'super',
  $$select team::text from match_players where match_id=(select id from t4 where name='G2')
      and player_id=(select id from t4 where name='Basti')$$, '2');
select htst('B bestätigt für Team 2', :'B',
  $$select confirm_match((select id from t4 where name='G2'),'ok')$$, 'ok');
select htxt('Damit ist das Spiel bestätigt', 'super',
  $$select state from matches where id=(select id from t4 where name='G2')$$, 'confirmed');
select htxt('C muss nicht mehr bestätigen (sein Team ist das des Hosts)', 'super',
  $$select team_confirmed((select id from t4 where name='G2'),1::smallint)::text$$, 'true');

\echo
select '== Widerspruch ==';
select htst('Zweite Lobby', :'H', $$select create_lobby('single','simple',1::smallint,1::smallint,null)$$, 'ok');
insert into t4 select 'G3', id from matches where mode='single' and state='lobby';
insert into t4c select 'G3', join_code from matches where mode='single' and state='lobby';
select htst('B tritt bei', :'B', $$select join_match_by_code((select code from t4c where name='G3'))$$, 'ok');
select htst('Start', :'H', $$select start_match((select id from t4 where name='G3'))$$, 'ok');
select htst('Tor beendet das Spiel', :'H',
  $$select record_goal((select id from t4 where name='G3'), 1::smallint)$$, 'ok');
select htst('B widerspricht', :'B',
  $$select confirm_match((select id from t4 where name='G3'),'reject','Das war 0:1')$$, 'ok');
select htxt('Spiel ist strittig', 'super',
  $$select state from matches where id=(select id from t4 where name='G3')$$, 'disputed');
select htxt('Der Kommentar ist gespeichert', 'super',
  $$select comment from match_confirmations where decision='reject'$$, 'Das war 0:1');
select hmsg('Zweimal äußern geht nicht', :'B',
  $$select confirm_match((select id from t4 where name='G3'),'ok')$$, 'schon geäußert');

\echo
select '== Korrektur innerhalb von 2 Stunden ==';
select hmsg('Ein Mitspieler kann nicht korrigieren', :'B',
  $$select reopen_match((select id from t4 where name='G3'))$$, 'Nur der Host');
select htst('Host nimmt das Spiel wieder auf', :'H',
  $$select reopen_match((select id from t4 where name='G3'))$$, 'ok');
select htxt('Spiel läuft wieder', 'super',
  $$select state from matches where id=(select id from t4 where name='G3')$$, 'running');
select htxt('rev ist hochgezählt', 'super',
  $$select rev::text from matches where id=(select id from t4 where name='G3')$$, '2');
select hnum('Die alte Bestätigung gilt nicht mehr für die aktuelle Fassung', 'super',
  $$select count(*) from match_confirmations c join matches m on m.id=c.match_id
     where c.match_id=(select id from t4 where name='G3') and c.rev=m.rev$$, 0);
select hnum('…bleibt aber als Verlauf erhalten', 'super',
  $$select count(*) from match_confirmations
     where match_id=(select id from t4 where name='G3')$$, 1);

-- Ohne diesen Schritt gäbe es ein laufendes Spiel ohne laufenden Satz: der
-- Zählbildschirm zeigte Satz null und Stand 0:0.
select htxt('Der letzte Satz ist wieder der laufende', 'super',
  $$select set_no::text from match_sets where match_id=(select id from t4 where name='G3')
      and winner_team is null$$, '1');
select htxt('Der bisherige Stand bleibt stehen', :'H',
  $$select (match_state((select id from t4 where name='G3')) ->> 'score1')$$, '1');

select htst('Host korrigiert: anderes Team gewinnt', :'H',
  $$select undo_goal((select id from t4 where name='G3'))$$, 'ok');
select htst('Tor für das andere Team', :'H',
  $$select record_goal((select id from t4 where name='G3'), 2::smallint)$$, 'ok');
select htxt('Wieder beendet und wartet auf Bestätigung', 'super',
  $$select state from matches where id=(select id from t4 where name='G3')$$, 'finished');
select htst('B bestätigt die neue Fassung', :'B',
  $$select confirm_match((select id from t4 where name='G3'),'ok')$$, 'ok');
select htxt('Jetzt bestätigt', 'super',
  $$select state from matches where id=(select id from t4 where name='G3')$$, 'confirmed');

\echo
select '== Korrekturzeit abgelaufen ==';
select htst('Spielende drei Stunden zurückdatieren', 'super',
  $$update matches set finished_at = now() - interval '3 hours'
     where id=(select id from t4 where name='G3')$$, 'ok');
select hmsg('Danach ist das Ergebnis endgültig', :'H',
  $$select reopen_match((select id from t4 where name='G3'))$$, 'Korrekturzeit');
select hmsg('Auch Zurücknehmen geht dann nicht mehr', :'H',
  $$select undo_goal((select id from t4 where name='G3'))$$, 'Korrekturzeit');

\echo
select '== Rückgängig vor der Bestätigung zählt rev hoch ==';
select htst('Dritte Lobby', :'H', $$select create_lobby('single','simple',2::smallint,1::smallint,null)$$, 'ok');
insert into t4 select 'G4', id from matches where mode='single' and state='lobby';
insert into t4c select 'G4', join_code from matches where mode='single' and state='lobby';
select htst('C tritt bei', :'C', $$select join_match_by_code((select code from t4c where name='G4'))$$, 'ok');
select htst('Start', :'H', $$select start_match((select id from t4 where name='G4'))$$, 'ok');
select htst('Erstes Tor', :'H',
  $$select record_goal((select id from t4 where name='G4'), 1::smallint)$$, 'ok');
select htst('Zweites Tor beendet das Spiel', :'H',
  $$select record_goal((select id from t4 where name='G4'), 1::smallint)$$, 'ok');
select htxt('rev ist 1', 'super',
  $$select rev::text from matches where id=(select id from t4 where name='G4')$$, '1');
select htst('Host nimmt das letzte Tor zurück', :'H',
  $$select undo_goal((select id from t4 where name='G4'))$$, 'ok');
select htxt('rev ist jetzt 2', 'super',
  $$select rev::text from matches where id=(select id from t4 where name='G4')$$, '2');
select htxt('und das Spiel läuft wieder', 'super',
  $$select state from matches where id=(select id from t4 where name='G4')$$, 'running');

\echo
select '== Sichtbarkeit der Bestätigungen ==';
select hnum('B sieht die Bestätigungen seiner Spiele', :'B',
  $$select count(*) from match_confirmations$$, 3);
select hnum('D sieht keine', :'D', $$select count(*) from match_confirmations$$, 0);
select htst('anon sieht gar nichts', null, $$select count(*) from match_confirmations$$, 'err');
