-- Prüfung Elo (Schritt 5): Werte nachgerechnet, nur bestätigt + Wertung, Korrektur,
-- Doppel und Paarungen, Sichtbarkeit, kein Schreiben vom Client, Rangliste.

\set QUIET on
\pset tuples_only on
\pset border 0

create table t6 (name text primary key, id uuid);
create table t6c (name text primary key, code text);
grant select on t6, t6c to authenticated;

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
  ('dddd0000-0000-4000-8000-00000000000d','d@x.org');
\set H 'aaaa0000-0000-4000-8000-00000000000a'
\set B 'bbbb0000-0000-4000-8000-00000000000b'
\set D 'dddd0000-0000-4000-8000-00000000000d'

-- Ein Einzel-Spiel bis 1 Tor als H gegen einen Gast; winner = 1 (H) oder 2
create function e_single(guest text, winner int, cat text default 'ranked') returns uuid
language plpgsql as $$
declare m uuid;
begin
  select (create_match('single','simple',1::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t6 where name='Host'),'team',1),
      jsonb_build_object('player_id',(select id from t6 where name=guest),'team',2)), cat)).id into m;
  perform record_goal(m, winner::smallint);
  return m;
end $$;
grant execute on function e_single(text,int,text) to authenticated;
create function e_many(guest text, n int) returns void language plpgsql as $$
begin for i in 1..n loop perform e_single(guest, 1); end loop; end $$;
grant execute on function e_many(text,int) to authenticated;
create function e_r(nick text, k text) returns int language sql as $$
  select round(rating)::int from ratings r join players p on p.id=r.player_id where p.nickname=nick and r.kind=k
$$;

\echo
select '== Vorbereitung ==';
select htst('Profile', 'super', $$insert into players (user_id,nickname,kind) values
  ('aaaa0000-0000-4000-8000-00000000000a','Host','account'),
  ('bbbb0000-0000-4000-8000-00000000000b','Basti','account'),
  ('dddd0000-0000-4000-8000-00000000000d','Dani','account')$$, 'ok');
select htst('Gäste Jan, Kim, Lu', 'super', $$insert into players (owner_id,nickname,kind)
  select id, x, 'guest' from players, unnest(array['Jan','Kim','Lu']) x where nickname='Host'$$, 'ok');
insert into t6 select nickname, id from players;

\echo
select '== Erstes Spiel: Neuling-K 48 ==';
select htst('H schlägt Jan', :'H', $$select e_single('Jan',1)$$, 'ok');
select htxt('Spiel ist bestätigt (Gast)', 'super', $$select state from matches$$, 'confirmed');
select hnum('H: 1000 + 48·0,5 = 1024', 'super', $$select e_r('Host','single')$$, 1024);
select hnum('Jan: 976', 'super', $$select e_r('Jan','single')$$, 976);
select hnum('Zwei Verlaufszeilen', 'super', $$select count(*) from rating_history$$, 2);
select htxt('matches.rated gesetzt', 'super', $$select bool_and(rated)::text from matches$$, 'true');
select hnum('Spiele und Siege gezählt', 'super',
  $$select games*10+wins from ratings r join players p on p.id=r.player_id where p.nickname='Host'$$, 11);

\echo
select '== Zweites Spiel: Erwartung berücksichtigt ==';
select htst('H schlägt Jan erneut', :'H', $$select e_single('Jan',1)$$, 'ok');
-- E = 1/(1+10^((976-1024)/400)) = 0,5687 → +48·0,4313 = +20,7
select hnum('H: 1044,7 → 1045', 'super', $$select e_r('Host','single')$$, 1045);
select hnum('Jan: 955', 'super', $$select e_r('Jan','single')$$, 955);
select hnum('Summe bleibt 2000 (gleiches K)', 'super',
  $$select round(sum(rating))::int from ratings where kind='single'$$, 2000);

\echo
select '== Locker zählt nicht ==';
select htst('Lockeres Spiel, Jan gewinnt', :'H', $$select e_single('Jan',2,'casual')$$, 'ok');
select hnum('H unverändert', 'super', $$select e_r('Host','single')$$, 1045);
select htxt('Lockeres Spiel nicht gewertet', 'super', $$select rated::text from matches where category='casual'$$, 'false');
select htst('Nachträglich auf Wertung stellen', 'super', $$update matches set category='ranked' where category='casual'$$, 'ok');
select hnum('…dann zählt es: H verliert Punkte', 'super', $$select (e_r('Host','single') < 1045)::int$$, 1);
select htst('Und zurück auf locker', 'super', $$update matches set category='casual' where id=(select id from matches order by created_at desc limit 1)$$, 'ok');
select hnum('…H wieder 1045', 'super', $$select e_r('Host','single')$$, 1045);

\echo
select '== Korrektur nimmt die Wertung zurück ==';
insert into t6 select 'M2', id from matches where category='ranked' order by created_at desc limit 1;
select htst('H nimmt das letzte Tor zurück', :'H', $$select undo_goal((select id from t6 where name='M2'))$$, 'ok');
select htxt('Spiel läuft wieder', 'super', $$select state from matches where id=(select id from t6 where name='M2')$$, 'running');
select hnum('H zurück auf 1024', 'super', $$select e_r('Host','single')$$, 1024);
select htxt('…und nicht mehr rated', 'super', $$select rated::text from matches where id=(select id from t6 where name='M2')$$, 'false');
select htst('Diesmal gewinnt Jan', :'H', $$select record_goal((select id from t6 where name='M2'), 2::smallint)$$, 'ok');
-- E(H) = 0,5687 → H −48·0,5687 = −27,3 → 996,7
select hnum('H: 997', 'super', $$select e_r('Host','single')$$, 997);
select hnum('Jan: 1003', 'super', $$select e_r('Jan','single')$$, 1003);

\echo
select '== Doppel und Paarung ==';
select htst('Doppel H+Jan gegen Kim+Lu, H-Team gewinnt', :'H',
  $$select record_goal((create_match('double','simple',1::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t6 where name='Host'),'team',1,'position','off'),
      jsonb_build_object('player_id',(select id from t6 where name='Jan'),'team',1,'position','def'),
      jsonb_build_object('player_id',(select id from t6 where name='Kim'),'team',2,'position','off'),
      jsonb_build_object('player_id',(select id from t6 where name='Lu'),'team',2,'position','def')))).id, 1::smallint)$$, 'ok');
select hnum('Doppel getrennt vom Einzel: H 1024', 'super', $$select e_r('Host','double')$$, 1024);
select hnum('Einzel von H unberührt', 'super', $$select e_r('Host','single')$$, 997);
select hnum('Jan im Doppel 1024', 'super', $$select e_r('Jan','double')$$, 1024);
select hnum('Kim 976', 'super', $$select e_r('Kim','double')$$, 976);
select hnum('Zwei Paarungen', 'super', $$select count(*) from team_ratings$$, 2);
select hnum('Paarung H+Jan 1024', 'super',
  $$select round(rating)::int from team_ratings t where (select id from t6 where name='Host') in (p1,p2)$$, 1024);

\echo
select '== Mit Konto-Mitspieler: erst nach Bestätigung ==';
select htst('Lobby', :'H', $$select create_lobby('single','simple',1::smallint,1::smallint,null)$$, 'ok');
insert into t6 select 'L', id from matches where state='lobby';
insert into t6c select 'L', join_code from matches where state='lobby';
select htst('B tritt bei', :'B', $$select join_match_by_code((select code from t6c where name='L'))$$, 'ok');
select htst('Start', :'H', $$select start_match((select id from t6 where name='L'))$$, 'ok');
select htst('B gewinnt', :'H', $$select record_goal((select id from t6 where name='L'), 2::smallint)$$, 'ok');
select hnum('Unbestätigt: B hat noch keine Wertung', 'super', $$select count(*) from ratings r join players p on p.id=r.player_id where p.nickname='Basti'$$, 0);
select htst('B bestätigt', :'B', $$select confirm_match((select id from t6 where name='L'), 'ok')$$, 'ok');
select htxt('Bestätigt', 'super', $$select state from matches where id=(select id from t6 where name='L')$$, 'confirmed');
select hnum('Jetzt hat B eine Wertung', 'super', $$select (e_r('Basti','single') > 1000)::int$$, 1);

\echo
select '== Sichtbarkeit und Schreibschutz ==';
select hnum('B sieht die Einzel-Wertung von H (gemeinsames Spiel)', :'B',
  $$select count(*) from ratings r where r.player_id=(select id from t6 where name='Host') and kind='single'$$, 1);
select hnum('B sieht Jan nicht (kein gemeinsames Spiel)', :'B',
  $$select count(*) from ratings r where r.player_id=(select id from t6 where name='Jan')$$, 0);
select hnum('D sieht gar nichts', :'D', $$select count(*) from ratings$$, 0);
select hnum('D sieht keinen Verlauf', :'D', $$select count(*) from rating_history$$, 0);
select hnum('B sieht den Verlauf nur seines Spiels', :'B', $$select count(distinct match_id) from rating_history$$, 1);
select htst('H kann seine Wertung nicht ändern', :'H', $$update ratings set rating=3000$$, 'err');
select hnum('…tatsächlich unverändert', 'super', $$select (e_r('Host','single') < 3000)::int$$, 1);
select htst('H kann nichts einfügen', :'H', $$insert into ratings (player_id,kind,rating) values ((select id from t6 where name='Host'),'double',2500)$$, 'err');
select htst('H kann nicht neu rechnen lassen', :'H', $$select recompute_ratings()$$, 'err');
select htst('Ohne Anmeldung nichts', null, $$select count(*) from ratings$$, 'err');

\echo
select '== my_ratings und Spielverlauf ==';
select hnum('my_ratings: Einzel-Spiele H', :'H', $$select (my_ratings()->'single'->>'games')::int$$, 3);
select hnum('my_ratings: Verlauf 4 Einträge (3 Einzel, 1 Doppel)', :'H', $$select jsonb_array_length(my_ratings()->'history')$$, 4);
select htxt('my_ratings: Paarung mit Jan', :'H', $$select my_ratings()->'teams'->0->>'nick'$$, 'Jan');
select htxt('my_ratings ohne Wertung: null', :'D', $$select coalesce(my_ratings()->>'single','null')$$, 'null');
select hnum('Spielverlauf trägt mein Elo-Delta', :'H',
  $$select count(*) from jsonb_array_elements(my_match_history()) x where x->>'elo' is not null$$, 4);
select htxt('…lockeres Spiel ohne Delta', :'H',
  $$select coalesce(x->>'elo','null') from jsonb_array_elements(my_match_history()) x where x->>'category'='casual'$$, 'null');
select htxt('Spieler tragen ihre aktuelle Wertung', :'H',
  $$select (p->>'elo') from jsonb_array_elements(my_match_history()) x, jsonb_array_elements(x->'players') p
     where p->>'nick'='Kim' limit 1$$, '976');

\echo
select '== Ab 10 Spielen: K = 24 ==';
select htst('Acht weitere Siege gegen Jan', :'H', $$select e_many('Jan',8)$$, 'ok');
select hnum('H hat 11 Einzel', 'super', $$select games from ratings r join players p on p.id=r.player_id where p.nickname='Host' and r.kind='single'$$, 11);
select hnum('11. Spiel: Änderung höchstens 24', 'super',
  $$select (abs(after-before) <= 24)::int from rating_history h join players p on p.id=h.player_id
     where p.nickname='Host' and h.kind='single' order by h.at desc, h.match_id desc limit 1$$, 1);

\echo
select '== Rangliste ==';
select hnum('Ohne Zustimmung: leer', :'D', $$select jsonb_array_length(leaderboard('single'))$$, 0);
select htst('H stimmt zu', :'H', $$update players set ranking_opt_in=true where user_id=auth.uid()$$, 'ok');
select htxt('Jetzt steht H drin, sichtbar auch für Unbeteiligte', :'D', $$select leaderboard('single')->0->>'nick'$$, 'Host');
select hnum('Gast Jan nie in der Rangliste', :'D', $$select jsonb_array_length(leaderboard('single'))$$, 1);
select htst('B stimmt zu', :'B', $$update players set ranking_opt_in=true where user_id=auth.uid()$$, 'ok');
select hnum('B unter 10 Spielen: nicht drin', :'D', $$select jsonb_array_length(leaderboard('single'))$$, 1);
select htxt('me-Kennzeichen', :'H', $$select leaderboard('single')->0->>'me'$$, 'true');
select hnum('Paarungen: Jan ist Gast – keine', :'D', $$select jsonb_array_length(leaderboard('team'))$$, 0);
select htst('Widerruf', :'H', $$update players set ranking_opt_in=false where user_id=auth.uid()$$, 'ok');
select hnum('…und weg', :'D', $$select jsonb_array_length(leaderboard('single'))$$, 0);

\echo
select '== Konto löschen: Wertungen der anderen bleiben ==';
select hnum('Jan vorher', 'super', $$select e_r('Jan','single')$$, (select e_r('Jan','single')));
create table t6j as select e_r('Jan','single') v;
select htst('B löscht sein Konto', 'super', $$delete from auth.users where id='bbbb0000-0000-4000-8000-00000000000b'$$, 'ok');
select hnum('Jan unverändert', 'super', $$select (e_r('Jan','single') = (select v from t6j))::int$$, 1);
select hnum('Gelöschter Spieler behält seine Zeile', 'super',
  $$select count(*) from ratings r join players p on p.id=r.player_id where p.deleted_at is not null$$, 1);
