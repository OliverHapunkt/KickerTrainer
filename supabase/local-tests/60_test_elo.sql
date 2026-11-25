-- Prüfung Elo: Werte nachgerechnet, nur bestätigt + Wertung + Konto auf beiden Seiten
-- (Option A), Remis, Korrektur, Doppel und Paarungen, Sichtbarkeit, Rangliste.

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
  ('cccc0000-0000-4000-8000-00000000000c','c@x.org'),
  ('dddd0000-0000-4000-8000-00000000000d','d@x.org'),
  ('eeee0000-0000-4000-8000-00000000000e','e@x.org'),
  ('ffff0000-0000-4000-8000-00000000000f','f@x.org');
\set H 'aaaa0000-0000-4000-8000-00000000000a'
\set B 'bbbb0000-0000-4000-8000-00000000000b'
\set C 'cccc0000-0000-4000-8000-00000000000c'
\set D 'dddd0000-0000-4000-8000-00000000000d'

-- Ein bestätigtes Spiel direkt anlegen (Elo hängt nur am Ergebnis, nicht am Weg).
-- result: 1 = Team a gewinnt, 2 = Team b, 0 = Remis. Zeit = clock_timestamp(),
-- damit die Reihenfolge auch innerhalb einer Schleife stimmt.
create function e_game(a text[], b text[], result int, cat text default 'ranked') returns uuid
language plpgsql as $$
declare m uuid := gen_random_uuid(); t timestamptz := clock_timestamp();
begin
  insert into matches (id, host_id, mode, state, category, started_at, join_code)
    values (m, (select id from t6 where name = a[1]),
            case when cardinality(a) = 1 then 'single' else 'double' end, 'running', cat, t, null);
  insert into match_players (match_id, player_id, team, is_host)
    select m, (select id from t6 where name = x), 1, x = a[1] from unnest(a) x
    union all select m, (select id from t6 where name = x), 2, false from unnest(b) x;
  insert into match_sets (match_id, set_no, score1, score2, winner_team)
    values (m, 1, case when result = 2 then 0 else 1 end, case when result = 1 then 0 else 1 end, result);
  update matches set state = 'confirmed', finished_at = t where id = m;
  return m;
end $$;
create function e_r(nick text, k text) returns int language sql as $$
  select round(rating)::int from ratings r join players p on p.id=r.player_id where p.nickname=nick and r.kind=k
$$;

\echo
select '== Vorbereitung ==';
select htst('Konten H, B, C, D, E, F', 'super', $$insert into players (user_id,nickname,kind) values
  ('aaaa0000-0000-4000-8000-00000000000a','Host','account'),
  ('bbbb0000-0000-4000-8000-00000000000b','Basti','account'),
  ('cccc0000-0000-4000-8000-00000000000c','Chris','account'),
  ('dddd0000-0000-4000-8000-00000000000d','Dani','account'),
  ('eeee0000-0000-4000-8000-00000000000e','Emma','account'),
  ('ffff0000-0000-4000-8000-00000000000f','Finn','account')$$, 'ok');
select htst('Gäste Jan, Kim', 'super', $$insert into players (owner_id,nickname,kind)
  select id, x, 'guest' from players, unnest(array['Jan','Kim']) x where nickname='Host'$$, 'ok');
insert into t6 select nickname, id from players;

\echo
select '== Option A: Spiele gegen Gäste zählen nicht ==';
select htst('H schlägt Gast Jan – echter Ablauf', :'H',
  $$select record_goal((create_match('single','simple',1::smallint,1::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t6 where name='Host'),'team',1),
      jsonb_build_object('player_id',(select id from t6 where name='Jan'),'team',2)))).id, 1::smallint)$$, 'ok');
select htxt('Spiel ist bestätigt', 'super', $$select state from matches$$, 'confirmed');
select hnum('…aber keine Wertung entstanden', 'super', $$select count(*) from ratings$$, 0);
select htxt('…und nicht rated', 'super', $$select rated::text from matches$$, 'false');
select htst('Doppel H+B gegen Jan+Kim (nur Gäste)', 'super', $$select e_game(array['Host','Basti'], array['Jan','Kim'], 1)$$, 'ok');
select hnum('…zählt nicht: keine Wertung', 'super', $$select count(*) from ratings$$, 0);
select htst('Wieder entfernen', 'super', $$delete from matches where mode='double'$$, 'ok');
select htst('Doppel H+Jan gegen B+Kim: Konto auf beiden Seiten', 'super', $$select e_game(array['Host','Jan'], array['Basti','Kim'], 1)$$, 'ok');
select hnum('Zählt: H im Doppel 1024', 'super', $$select e_r('Host','double')$$, 1024);
select hnum('B 976', 'super', $$select e_r('Basti','double')$$, 976);
select hnum('Gäste bekommen keine Wertung', 'super',
  $$select count(*) from ratings r join players p on p.id=r.player_id where p.kind='guest'$$, 0);
select hnum('Keine Paarung mit Gast', 'super', $$select count(*) from team_ratings$$, 0);

\echo
select '== Einzel: Werte nachgerechnet ==';
select htst('H schlägt C', 'super', $$select e_game(array['Host'], array['Chris'], 1)$$, 'ok');
select hnum('H: 1000 + 48·0,5 = 1024', 'super', $$select e_r('Host','single')$$, 1024);
select hnum('C: 976', 'super', $$select e_r('Chris','single')$$, 976);
select htst('H schlägt C erneut', 'super', $$select e_game(array['Host'], array['Chris'], 1)$$, 'ok');
-- E = 1/(1+10^((976-1024)/400)) = 0,5687 → +48·0,4313 = +20,7
select hnum('H: 1044,7 → 1045', 'super', $$select e_r('Host','single')$$, 1045);
select hnum('C: 955', 'super', $$select e_r('Chris','single')$$, 955);
select hnum('Summe bleibt 2000 (gleiches K)', 'super', $$select round(sum(rating))::int from ratings where kind='single'$$, 2000);
select hnum('Spiele·10 + Siege bei H', 'super',
  $$select games*10+wins from ratings r join players p on p.id=r.player_id where p.nickname='Host' and r.kind='single'$$, 22);

\echo
select '== Remis zählt 0,5 ==';
select htst('Remis H gegen C', 'super', $$select e_game(array['Host'], array['Chris'], 0)$$, 'ok');
-- E(H) = 1/(1+10^((955-1045)/400)) = 0,6260 → 48·(0,5−0,626) = −6,0
select hnum('H verliert als Favorit 6 Punkte: 1039', 'super', $$select e_r('Host','single')$$, 1039);
select hnum('C gewinnt 6: 961', 'super', $$select e_r('Chris','single')$$, 961);
select hnum('Remis gezählt, kein Sieg', 'super',
  $$select draws*100+wins from ratings r join players p on p.id=r.player_id where p.nickname='Host' and r.kind='single'$$, 102);

\echo
select '== Locker zählt nicht, Umstellen rechnet neu ==';
select htst('Lockeres Spiel, C gewinnt', 'super', $$select e_game(array['Host'], array['Chris'], 2, 'casual')$$, 'ok');
select hnum('H unverändert', 'super', $$select e_r('Host','single')$$, 1039);
select htst('Nachträglich auf Wertung', 'super', $$update matches set category='ranked' where category='casual'$$, 'ok');
select hnum('…H verliert', 'super', $$select (e_r('Host','single') < 1039)::int$$, 1);
select htst('Zurück auf locker', 'super', $$update matches set category='casual' where id=(select id from matches order by finished_at desc limit 1)$$, 'ok');
select hnum('…H wieder 1039', 'super', $$select e_r('Host','single')$$, 1039);

\echo
select '== Doppel und Paarung ==';
select htst('H+B schlagen C+D', 'super', $$select e_game(array['Host','Basti'], array['Chris','Dani'], 1)$$, 'ok');
select hnum('Zwei Paarungen', 'super', $$select count(*) from team_ratings$$, 2);
select hnum('Paarung H+B 1024', 'super',
  $$select round(rating)::int from team_ratings t where (select id from t6 where name='Host') in (p1,p2)$$, 1024);
select hnum('Einzel von H unberührt', 'super', $$select e_r('Host','single')$$, 1039);

\echo
select '== Echter Ablauf: erst nach Bestätigung der Gegenseite ==';
select htst('Lobby', :'H', $$select create_lobby('single','simple',1::smallint,1::smallint,null)$$, 'ok');
insert into t6 select 'L', id from matches where state='lobby';
insert into t6c select 'L', join_code from matches where state='lobby';
select htst('B tritt bei', :'B', $$select join_match_by_code((select code from t6c where name='L'))$$, 'ok');
select htst('Start', :'H', $$select start_match((select id from t6 where name='L'))$$, 'ok');
select htst('B gewinnt', :'H', $$select record_goal((select id from t6 where name='L'), 2::smallint)$$, 'ok');
select hnum('Unbestätigt: B hat keine Einzel-Wertung', 'super', $$select count(*) from ratings r join players p on p.id=r.player_id where p.nickname='Basti' and r.kind='single'$$, 0);
select htst('B bestätigt', :'B', $$select confirm_match((select id from t6 where name='L'), 'ok')$$, 'ok');
select hnum('Jetzt hat B eine Einzel-Wertung über 1000', 'super', $$select (e_r('Basti','single') > 1000)::int$$, 1);
select htst('H nimmt das Tor zurück (Korrektur)', :'H', $$select undo_goal((select id from t6 where name='L'))$$, 'ok');
select hnum('…Wertung von B wieder weg', 'super', $$select count(*) from ratings r join players p on p.id=r.player_id where p.nickname='Basti' and r.kind='single'$$, 0);
select htst('Diesmal gewinnt H', :'H', $$select record_goal((select id from t6 where name='L'), 1::smallint)$$, 'ok');
select htst('B bestätigt erneut', :'B', $$select confirm_match((select id from t6 where name='L'), 'ok')$$, 'ok');
select hnum('B jetzt unter 1000', 'super', $$select (e_r('Basti','single') < 1000)::int$$, 1);

\echo
select '== Sichtbarkeit und Schreibschutz ==';
select hnum('B sieht die Einzel-Wertung von H (gemeinsames Spiel)', :'B',
  $$select count(*) from ratings r where r.player_id=(select id from t6 where name='Host') and kind='single'$$, 1);
select hnum('B sieht E nicht (nie zusammen gespielt)', :'B',
  $$select count(*) from ratings r where r.player_id=(select id from t6 where name='Emma')$$, 0);
select hnum('F sieht gar nichts', 'ffff0000-0000-4000-8000-00000000000f', $$select count(*) from ratings$$, 0);
select hnum('F sieht keinen Verlauf', 'ffff0000-0000-4000-8000-00000000000f', $$select count(*) from rating_history$$, 0);
select htst('H kann seine Wertung nicht ändern', :'H', $$update ratings set rating=3000$$, 'err');
select hnum('…tatsächlich unverändert', 'super', $$select (e_r('Host','single') < 3000)::int$$, 1);
select htst('H kann nichts einfügen', :'H', $$insert into ratings (player_id,kind,rating) values ((select id from t6 where name='Host'),'double',2500)$$, 'err');
select htst('H kann nicht neu rechnen lassen', :'H', $$select recompute_ratings()$$, 'err');
select htst('Ohne Anmeldung nichts', null, $$select count(*) from ratings$$, 'err');

\echo
select '== my_ratings und Spielverlauf ==';
select hnum('my_ratings: Einzel-Spiele H (2 Siege, 1 Remis, 1 Lobby)', :'H', $$select (my_ratings()->'single'->>'games')::int$$, 4);
select hnum('my_ratings: Remis 1', :'H', $$select (my_ratings()->'single'->>'draws')::int$$, 1);
select htxt('my_ratings: Paarung mit Basti', :'H', $$select my_ratings()->'teams'->0->>'nick'$$, 'Basti');
select htxt('my_ratings ohne Wertung: null', 'ffff0000-0000-4000-8000-00000000000f', $$select coalesce(my_ratings()->>'single','null')$$, 'null');
select htxt('Gast-Spiel im Verlauf ohne Delta', :'H',
  $$select coalesce(x->>'elo','null') from jsonb_array_elements(my_match_history()) x
     where exists (select 1 from jsonb_array_elements(x->'players') p where p->>'nick'='Jan' and (p->>'team')::int=2) limit 1$$, 'null');
select htxt('Gast trägt kein Elo', :'H',
  $$select coalesce(p->>'elo','null') from jsonb_array_elements(my_match_history()) x, jsonb_array_elements(x->'players') p
     where p->>'nick'='Jan' limit 1$$, 'null');

\echo
select '== Ab 10 Spielen: K = 24 ==';
select htst('Sechs weitere Siege gegen C', 'super', $$select e_game(array['Host'], array['Chris'], 1) from generate_series(1,6)$$, 'ok');
select hnum('H hat 10 Einzel', 'super', $$select games from ratings r join players p on p.id=r.player_id where p.nickname='Host' and r.kind='single'$$, 10);
select htst('Elfter Sieg', 'super', $$select e_game(array['Host'], array['Chris'], 1)$$, 'ok');
select hnum('11. Spiel: Änderung höchstens 24', 'super',
  $$select (abs(after-before) <= 24)::int from rating_history h join players p on p.id=h.player_id
     where p.nickname='Host' and h.kind='single' order by h.at desc limit 1$$, 1);

\echo
select '== Rangliste ==';
select hnum('Ohne Zustimmung: leer', :'D', $$select jsonb_array_length(leaderboard('single'))$$, 0);
select htst('H stimmt zu', :'H', $$update players set ranking_opt_in=true where user_id=auth.uid()$$, 'ok');
select htxt('H steht drin, sichtbar auch für Unbeteiligte', 'ffff0000-0000-4000-8000-00000000000f', $$select leaderboard('single')->0->>'nick'$$, 'Host');
select htxt('…mit Remis-Zahl', :'D', $$select leaderboard('single')->0->>'draws'$$, '1');
select htxt('me-Kennzeichen', :'H', $$select leaderboard('single')->0->>'me'$$, 'true');
select htst('C stimmt zu', :'C', $$update players set ranking_opt_in=true where user_id=auth.uid()$$, 'ok');
select hnum('C mit 11 Spielen auch drin', :'D', $$select jsonb_array_length(leaderboard('single'))$$, 2);
select htst('Widerruf H', :'H', $$update players set ranking_opt_in=false where user_id=auth.uid()$$, 'ok');
select hnum('…nur noch C', :'D', $$select jsonb_array_length(leaderboard('single'))$$, 1);

\echo
select '== Konto löschen: Wertungen der anderen bleiben ==';
create table t6j as select e_r('Host','single') v;
select htst('C löscht sein Konto', 'super', $$delete from auth.users where id='cccc0000-0000-4000-8000-00000000000c'$$, 'ok');
select hnum('H unverändert (gelöschte Konten zählen weiter)', 'super', $$select (e_r('Host','single') = (select v from t6j))::int$$, 1);
select hnum('C nicht mehr in der Rangliste', :'D', $$select jsonb_array_length(leaderboard('single'))$$, 0);
