-- Prüfung von Lobby und Beitritt per Code (Schritt 3b).
-- H = Host, B und C = Mitspieler mit eigenem Konto, D = Unbeteiligter.

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

insert into auth.users (id, email) values
  ('aaaa1111-0000-4000-8000-00000000000a', 'h@example.org'),
  ('bbbb2222-0000-4000-8000-00000000000b', 'b@example.org'),
  ('cccc3333-0000-4000-8000-00000000000c', 'c@example.org'),
  ('dddd4444-0000-4000-8000-00000000000d', 'd@example.org');

\set H 'aaaa1111-0000-4000-8000-00000000000a'
\set B 'bbbb2222-0000-4000-8000-00000000000b'
\set C 'cccc3333-0000-4000-8000-00000000000c'
\set D 'dddd4444-0000-4000-8000-00000000000d'

\echo
select '== Vorbereitung ==';
select gtst('H legt Nickname an', :'H', $$insert into players (user_id,nickname,kind)
  values ('aaaa1111-0000-4000-8000-00000000000a','Host','account')$$, 'ok');
select gtst('B legt Nickname an', :'B', $$insert into players (user_id,nickname,kind)
  values ('bbbb2222-0000-4000-8000-00000000000b','Basti','account')$$, 'ok');
select gtst('C legt Nickname an', :'C', $$insert into players (user_id,nickname,kind)
  values ('cccc3333-0000-4000-8000-00000000000c','Chris','account')$$, 'ok');
select gtst('D legt Nickname an', :'D', $$insert into players (user_id,nickname,kind)
  values ('dddd4444-0000-4000-8000-00000000000d','Dani','account')$$, 'ok');
select gtst('H legt einen Gast an', :'H', $$insert into players (owner_id,nickname,kind)
  select id,'Jan','guest' from players where nickname='Host'$$, 'ok');
insert into t3 select nickname, id from players;

\echo
select '== Lobby öffnen ==';
select gtst('Doppel-Lobby öffnen', :'H',
  $$select create_lobby('double','full',5::smallint,2::smallint,null)$$, 'ok');
insert into t3 select 'Spiel', id from matches;
insert into t3c select 'Spiel', join_code from matches;
select gnum('Beitrittscode hat 6 Ziffern', 'super',
  $$select count(*) from matches where join_code ~ '^[0-9]{6}$' and state='lobby'$$, 1);
select gnum('Nur der Host ist drin', 'super', $$select count(*) from match_players$$, 1);
select gnum('Noch kein Satz angelegt', 'super', $$select count(*) from match_sets$$, 0);
select gtxt('Host steht im Sturm von Team 1', 'super',
  $$select position from match_players where player_id=(select id from t3 where name='Host')$$, 'off');

\echo
select '== Beitreten ==';
select gmsg('Falscher Code nennt keine Einzelheiten', :'B',
  $$select join_match_by_code('000000')$$, 'Kein offenes Spiel mit diesem Code');
select gmsg('Leerer Code ebenso', :'B', $$select join_match_by_code('')$$, 'Kein offenes Spiel');

select gtst('B tritt mit dem richtigen Code bei', :'B',
  $$select join_match_by_code((select code from t3c where name='Spiel'))$$, 'ok');
select gtxt('B landet in Team 2', 'super',
  $$select team::text from match_players where player_id=(select id from t3 where name='Basti')$$, '2');
select gtxt('B bekommt Sturm', 'super',
  $$select position from match_players where player_id=(select id from t3 where name='Basti')$$, 'off');

select gtst('Zweiter Beitritt desselben Spielers ist kein Fehler', :'B',
  $$select join_match_by_code((select code from t3c where name='Spiel'))$$, 'ok');
select gnum('…und legt keinen zweiten Platz an', 'super',
  $$select count(*) from match_players where player_id=(select id from t3 where name='Basti')$$, 1);

select gnum('B sieht die Mitspieler jetzt', :'B',
  $$select count(*) from players where nickname in ('Host','Basti')$$, 2);
select gnum('D sieht von dem Spiel nichts', :'D', $$select count(*) from matches$$, 0);

select gtst('C tritt bei', :'C',
  $$select join_match_by_code((select code from t3c where name='Spiel'))$$, 'ok');
select gtxt('C füllt Team 1 auf', 'super',
  $$select team::text from match_players where player_id=(select id from t3 where name='Chris')$$, '1');
select gtxt('C bekommt die Abwehr', 'super',
  $$select position from match_players where player_id=(select id from t3 where name='Chris')$$, 'def');

\echo
select '== Starten ==';
select gmsg('Mit drei Spielern lässt sich nicht starten', :'H',
  $$select start_match((select id from t3 where name='Spiel'))$$, 'Es fehlen noch Spieler');
select gmsg('Ein Mitspieler kann nicht starten', :'B',
  $$select start_match((select id from t3 where name='Spiel'))$$, 'Nur der Host');

-- Vierter Platz: der Host setzt seinen Gast ein (direkt, dafür gibt es Regeln)
select gtst('Host setzt seinen Gast auf den freien Platz', :'H',
  $$insert into match_players (match_id, player_id, team, position)
    select (select id from t3 where name='Spiel'), (select id from t3 where name='Jan'), 2, 'def'$$, 'ok');
select gtst('Jetzt startet das Spiel', :'H',
  $$select start_match((select id from t3 where name='Spiel'))$$, 'ok');
select gnum('Code ist entwertet', 'super',
  $$select count(*) from matches where join_code is null and state='running'$$, 1);
select gnum('Satz 1 ist angelegt', 'super', $$select count(*) from match_sets$$, 1);
select gmsg('Ein zweites Mal starten geht nicht', :'H',
  $$select start_match((select id from t3 where name='Spiel'))$$, 'läuft schon');
select gmsg('Der Code taugt nach dem Start nicht mehr', :'D',
  $$select join_match_by_code('123456')$$, 'Kein offenes Spiel');

\echo
select '== Zählen im Spiel mit Mitspielern ==';
select gtst('Host zählt ein Tor', :'H',
  $$select record_goal((select id from t3 where name='Spiel'), 1::smallint,
      (select id from t3 where name='Host'), 'off', false)$$, 'ok');
select gmsg('Ein Mitspieler zählt nicht', :'B',
  $$select record_goal((select id from t3 where name='Spiel'), 2::smallint)$$, 'Nur der Host');
select gnum('B sieht den Spielstand', :'B', $$select count(*) from match_sets$$, 1);
select gnum('D sieht ihn nicht', :'D', $$select count(*) from match_sets$$, 0);

\echo
select '== Verlassen ==';
select gmsg('Aus einem laufenden Spiel kann man nicht aussteigen', :'B',
  $$select leave_match((select id from t3 where name='Spiel'))$$, 'läuft schon');

select gtst('Zweite Lobby für den Austritt', :'H',
  $$select create_lobby('single','simple',5::smallint,1::smallint,null)$$, 'ok');
insert into t3 select 'Spiel2', id from matches where mode='single';
insert into t3c select 'Spiel2', join_code from matches where mode='single';
select gtst('B tritt der zweiten Lobby bei', :'B',
  $$select join_match_by_code((select code from t3c where name='Spiel2'))$$, 'ok');
select gnum('Zwei Spieler in der zweiten Lobby', 'super',
  $$select count(*) from match_players where match_id=(select id from t3 where name='Spiel2')$$, 2);
select gtst('B verlässt die Lobby', :'B',
  $$select leave_match((select id from t3 where name='Spiel2'))$$, 'ok');
select gnum('Nur noch der Host drin', 'super',
  $$select count(*) from match_players where match_id=(select id from t3 where name='Spiel2')$$, 1);
select gmsg('Der Host kann nicht einfach austreten', :'H',
  $$select leave_match((select id from t3 where name='Spiel2'))$$, 'nur abbrechen');

\echo
select '== Volle Lobby ==';
select gtst('C tritt der Einzel-Lobby bei', :'C',
  $$select join_match_by_code((select code from t3c where name='Spiel2'))$$, 'ok');
select gmsg('D findet keinen Platz mehr', :'D',
  $$select join_match_by_code((select code from t3c where name='Spiel2'))$$, 'schon voll');

\echo
select '== Host entfernt jemanden ==';
select gtst('Host wirft C aus der Lobby', :'H',
  $$delete from match_players where match_id=(select id from t3 where name='Spiel2')
      and player_id=(select id from t3 where name='Chris')$$, 'ok');
select gnum('C ist raus', 'super',
  $$select count(*) from match_players where match_id=(select id from t3 where name='Spiel2')$$, 1);
select gtst('D kann jetzt beitreten', :'D',
  $$select join_match_by_code((select code from t3c where name='Spiel2'))$$, 'ok');

\echo
select '== Kein Zugriff ohne Anmeldung ==';
select gtst('anon kann nicht beitreten', null, $$select join_match_by_code('123456')$$, 'err');
select gtst('anon kann keine Lobby öffnen', null,
  $$select create_lobby('single','simple',5::smallint,1::smallint,null)$$, 'err');
select gtst('anon kann nichts starten', null,
  $$select start_match((select id from t3 where name='Spiel2'))$$, 'err');
