-- Prüfung Spielregeln: Vorsprung, Obergrenze, Unentschieden im Entscheidungssatz,
-- Regeln beim Anlegen und im laufenden Spiel ändern, Einzel/Doppel in der Lobby.

\set QUIET on
\pset tuples_only on
\pset border 0

create table t7 (name text primary key, id uuid);
create table t7c (name text primary key, code text);
grant select on t7, t7c to authenticated;

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
  ('cccc0000-0000-4000-8000-00000000000c','c@x.org');
\set H 'aaaa0000-0000-4000-8000-00000000000a'
\set B 'bbbb0000-0000-4000-8000-00000000000b'
\set C 'cccc0000-0000-4000-8000-00000000000c'

-- Einzel H gegen Gast Jan mit Regeln; Name im Merkzettel
create function r_new(nm text, gps int, stw int, rules jsonb) returns void language plpgsql as $$
begin
  insert into t7 select nm, (create_match('single','simple',gps::smallint,stw::smallint,null, jsonb_build_array(
      jsonb_build_object('player_id',(select id from t7 where name='Host'),'team',1),
      jsonb_build_object('player_id',(select id from t7 where name='Jan'),'team',2)), 'ranked', rules)).id;
end $$;
grant execute on function r_new(text,int,int,jsonb) to authenticated;
grant insert on t7 to authenticated;
-- Folge von Toren: '1122…' = Team 1, Team 1, Team 2, …
create function r_goals(nm text, seq text) returns void language plpgsql as $$
begin
  for i in 1..length(seq) loop
    perform record_goal((select id from t7 where name=nm), substr(seq,i,1)::smallint);
  end loop;
end $$;
grant execute on function r_goals(text,text) to authenticated;
create function r_st(nm text) returns text language sql as $$
  select (match_state((select id from t7 where name=nm))->>'state') || ' ' ||
         coalesce((select string_agg(score1||':'||score2||'/'||coalesce(winner_team::text,'-'), ' ' order by set_no)
                     from match_sets where match_id=(select id from t7 where name=nm)),'')
$$;

\echo
select '== Vorbereitung ==';
select htst('Konten', 'super', $$insert into players (user_id,nickname,kind) values
  ('aaaa0000-0000-4000-8000-00000000000a','Host','account'),
  ('bbbb0000-0000-4000-8000-00000000000b','Basti','account'),
  ('cccc0000-0000-4000-8000-00000000000c','Chris','account')$$, 'ok');
select htst('Gast Jan', :'H', $$insert into players (owner_id,nickname,kind)
  select id,'Jan','guest' from players where nickname='Host'$$, 'ok');
insert into t7 select nickname, id from players;

\echo
select '== Ohne Regeln: wie bisher ==';
select htst('Satz bis 5, ein Satz', :'H', $$select r_new('A',5,1,null)$$, 'ok');
select htst('5:4', :'H', $$select r_goals('A','111122221')$$, 'ok');
select htxt('Beendet bei 5:4', 'super', $$select r_st('A')$$, 'confirmed 5:4/1');

\echo
select '== Zwei Tore Vorsprung im Entscheidungssatz ==';
select htst('Satz bis 5, ein Satz = Entscheidungssatz, Vorsprung 2', :'H', $$select r_new('B',5,1,'{"win_by":2}')$$, 'ok');
select htst('5:4', :'H', $$select r_goals('B','111122221')$$, 'ok');
select htxt('Läuft weiter bei 5:4', 'super', $$select r_st('B')$$, 'running 5:4/-');
select htst('5:5, 6:5', :'H', $$select r_goals('B','21')$$, 'ok');
select htxt('Läuft weiter bei 6:5', 'super', $$select r_st('B')$$, 'running 6:5/-');
select htst('7:5', :'H', $$select r_goals('B','1')$$, 'ok');
select htxt('Beendet bei 7:5', 'super', $$select r_st('B')$$, 'confirmed 7:5/1');

\echo
select '== Nur im Entscheidungssatz, nicht im ersten ==';
select htst('Bis 3, zwei Gewinnsätze, Vorsprung 2 nur Entscheidung', :'H', $$select r_new('C',3,2,'{"win_by":2,"scope":"decider"}')$$, 'ok');
select htst('Satz 1: 3:2', :'H', $$select r_goals('C','11221')$$, 'ok');
select htxt('Satz 1 endet bei 3:2', 'super', $$select r_st('C')$$, 'running 3:2/1 0:0/-');
select htst('Satz 2: 2:3', :'H', $$select r_goals('C','11222')$$, 'ok');
select htst('Satz 3 (Entscheidung): 3:2', :'H', $$select r_goals('C','11221')$$, 'ok');
select htxt('Entscheidungssatz läuft bei 3:2 weiter', 'super', $$select r_st('C')$$, 'running 3:2/1 2:3/2 3:2/-');
select htst('4:2', :'H', $$select r_goals('C','1')$$, 'ok');
select htxt('Beendet 2:1 Sätze', 'super', $$select r_st('C')$$, 'confirmed 3:2/1 2:3/2 4:2/1');

\echo
select '== Vorsprung in jedem Satz, Obergrenze ==';
select htst('Bis 5, jeder Satz, Obergrenze 8', :'H', $$select r_new('D',5,1,'{"win_by":2,"scope":"all","cap":8}')$$, 'ok');
select htst('7:7', :'H', $$select r_goals('D','12121212121212')$$, 'ok');
select htxt('7:7 läuft', 'super', $$select r_st('D')$$, 'running 7:7/-');
select htst('8:7', :'H', $$select r_goals('D','2')$$, 'ok');
select htxt('Obergrenze: 7:8 beendet, Jan gewinnt', 'super', $$select r_st('D')$$, 'confirmed 7:8/2');

\echo
select '== Unentschieden bei 4:4 im Entscheidungssatz ==';
select htst('Bis 5, zwei Gewinnsätze, Remis bei 4', :'H', $$select r_new('E',5,2,'{"draw_at":4}')$$, 'ok');
select htst('Satz 1: 4:4 ist KEIN Remis (kein Entscheidungssatz)', :'H', $$select r_goals('E','11112222')$$, 'ok');
select htxt('Satz 1 läuft bei 4:4', 'super', $$select r_st('E')$$, 'running 4:4/-');
select htst('5:4, Satz 2 an Jan', :'H', $$select r_goals('E','1'||'22222')$$, 'ok');
select htst('Entscheidung 4:4', :'H', $$select r_goals('E','12121212')$$, 'ok');
select htxt('Remis: Satz 3 mit Sieger 0, Spiel vorbei', 'super', $$select r_st('E')$$, 'confirmed 5:4/1 0:5/2 4:4/0');
select hnum('Spielstand meldet das Ende', :'H', $$select (match_state((select id from t7 where name='E'))->>'match_done')::boolean::int$$, 1);
select htst('Rückgängig nach dem Remis', :'H', $$select undo_goal((select id from t7 where name='E'))$$, 'ok');
-- Seit v3.23 hat auch die einfache Erfassung Tor-Zeilen: Das letzte Tor (Team 2) wird zurückgenommen
select htxt('Läuft wieder bei 4:3', 'super', $$select r_st('E')$$, 'running 5:4/1 0:5/2 4:3/-');
select htst('Wieder 4:4', :'H', $$select r_goals('E','2')$$, 'ok');
select htxt('Wieder Remis', 'super', $$select r_st('E')$$, 'confirmed 5:4/1 0:5/2 4:4/0');
select htxt('Bilanz-Verlauf liefert den Remis-Satz', :'H',
  $$select (x->'sets'->2)::text from jsonb_array_elements(my_match_history()) x where x->>'id'=(select id from t7 where name='E')::text$$, '[4, 4, 0]');

\echo
select '== Ungültige Regeln ==';
select htst('Obergrenze nicht über dem Satzziel', :'H', $$select r_new('X1',5,1,'{"win_by":2,"cap":5}')$$, 'err');
select htst('Remis nicht unter dem Satzziel', :'H', $$select r_new('X2',5,1,'{"draw_at":5}')$$, 'err');
select htst('Unbekannter Bereich', :'H', $$select r_new('X3',5,1,'{"win_by":2,"scope":"halb"}')$$, 'err');

\echo
select '== Regeln im laufenden Spiel ändern ==';
select htst('Bis 5, zwei Gewinnsätze', :'H', $$select r_new('F',5,2,null)$$, 'ok');
select htst('Satz 1 an H, Satz 2 bei 3:2', :'H', $$select r_goals('F','11111'||'11222')$$, 'ok');
select htst('Nur der Host', :'B', $$select update_match_rules((select id from t7 where name='F'), p_gps => 7::smallint)$$, 'err');
select hmsg('Satzziel 3 wäre rückwirkend vorbei', :'H', $$select update_match_rules((select id from t7 where name='F'), p_gps => 3::smallint)$$, 'schon entschieden');
select hmsg('Nur ein Gewinnsatz: Spiel wäre vorbei', :'H', $$select update_match_rules((select id from t7 where name='F'), p_stw => 1::smallint)$$, 'schon entschieden');
select htst('Satzziel 7', :'H', $$select update_match_rules((select id from t7 where name='F'), p_gps => 7::smallint)$$, 'ok');
select htst('Bis 7 weiter: 4:3 ist kein Satzende', :'H', $$select r_goals('F','11')$$, 'ok');
select htxt('Läuft bei 4:3', 'super', $$select r_st('F')$$, 'running 5:0/1 4:3/-');
select hmsg('Art nur vor dem Spiel', :'H', $$select update_match_rules((select id from t7 where name='F'), p_category => 'casual')$$, 'vor dem Spiel');
select hmsg('Einzel/Doppel nur in der Lobby', :'H', $$select update_match_rules((select id from t7 where name='F'), p_mode => 'double')$$, 'Lobby');
select htst('Erfassung auf Erweitert', :'H', $$select update_match_rules((select id from t7 where name='F'), p_detail => 'full')$$, 'ok');
select htst('Tor mit Schütze wird jetzt gespeichert', :'H',
  $$select record_goal((select id from t7 where name='F'), 1::smallint, (select id from t7 where name='Host'))$$, 'ok');
select hnum('Genau ein Tor mit Schütze', 'super', $$select count(*) from goals where match_id=(select id from t7 where name='F') and scorer_id is not null$$, 1);
select htst('Vorsprung einschalten', :'H', $$select update_match_rules((select id from t7 where name='F'), p_win_by => 2::smallint, p_scope => 'all')$$, 'ok');
select htst('Obergrenze wieder aus', :'H', $$select update_match_rules((select id from t7 where name='F'), p_cap => 9::smallint)$$, 'ok');
select htst('…und wieder weg', :'H', $$select update_match_rules((select id from t7 where name='F'), p_clear_cap => true)$$, 'ok');
select htxt('Keine Obergrenze', 'super', $$select coalesce(goal_cap::text,'null') from matches where id=(select id from t7 where name='F')$$, 'null');
select htst('Beendetes Spiel nicht mehr ändern', :'H', $$select update_match_rules((select id from t7 where name='A'), p_gps => 7::smallint)$$, 'err');

\echo
select '== Lobby: Einzel ↔ Doppel ==';
select htst('Doppel-Lobby, erweitert', :'H', $$select create_lobby('double','full',5::smallint,1::smallint,null)$$, 'ok');
insert into t7 select 'L', id from matches where state='lobby';
insert into t7c select 'L', join_code from matches where state='lobby';
select htst('B tritt bei', :'B', $$select join_match_by_code((select code from t7c where name='L'))$$, 'ok');
select htst('C tritt bei', :'C', $$select join_match_by_code((select code from t7c where name='L'))$$, 'ok');
select hmsg('Auf Einzel geht nicht mit zwei in einem Team', :'H',
  $$select update_match_rules((select id from t7 where name='L'), p_mode => 'single')$$, 'erst einen Spieler');
select htst('C wieder raus', :'H', $$delete from match_players where match_id=(select id from t7 where name='L') and player_id=(select id from t7 where name='Chris')$$, 'ok');
select htst('Jetzt Einzel', :'H', $$select update_match_rules((select id from t7 where name='L'), p_mode => 'single')$$, 'ok');
select hnum('Positionen weg', 'super', $$select count(*) from match_players where match_id=(select id from t7 where name='L') and position is not null$$, 0);
select htst('Zurück auf Doppel', :'H', $$select update_match_rules((select id from t7 where name='L'), p_mode => 'double')$$, 'ok');
select hnum('Positionen wieder gesetzt', 'super', $$select count(*) from match_players where match_id=(select id from t7 where name='L') and position is not null$$, 2);
select htst('In der Lobby auch die Art ändern', :'H', $$select update_match_rules((select id from t7 where name='L'), p_category => 'casual')$$, 'ok');
select htxt('…locker', 'super', $$select category from matches where id=(select id from t7 where name='L')$$, 'casual');
select htst('Code bleibt gültig', 'super', $$select 1/(count(*))::int from matches where id=(select id from t7 where name='L') and join_code is not null$$, 'ok');

\echo
select '== Remis im Elo (echter Ablauf mit Bestätigung) ==';
select htst('Lobby Einzel, Remis bei 0 (sofort)?', :'H', $$select create_lobby('single','simple',2::smallint,1::smallint,null,'ranked','{"draw_at":1}')$$, 'ok');
delete from t7c; insert into t7c select 'M', join_code from matches where state='lobby' and goals_per_set=2;
insert into t7 select 'M', id from matches where state='lobby' and goals_per_set=2;
select htst('C tritt bei', :'C', $$select join_match_by_code((select code from t7c where name='M'))$$, 'ok');
select htst('Start', :'H', $$select start_match((select id from t7 where name='M'))$$, 'ok');
select htst('1:1', :'H', $$select r_goals('M','12')$$, 'ok');
select htxt('Remis, wartet auf C', 'super', $$select r_st('M')$$, 'finished 1:1/0');
select htst('C bestätigt', :'C', $$select confirm_match((select id from t7 where name='M'), 'ok')$$, 'ok');
select htxt('H 1000 (Remis bei gleicher Stärke)', 'super',
  $$select round(rating)::text||' '||draws from ratings r join players p on p.id=r.player_id where p.nickname='Host' and r.kind='single'$$, '1000 1');

\echo
select '== Rückgängig bei „Einfach“ (v3.23) ==';
select htst('Lobby Einzel, Einfach', :'H', $$select create_lobby('single','simple',6::smallint,1::smallint,null)$$, 'ok');
delete from t7c; insert into t7c select 'U', join_code from matches where state='lobby' and goals_per_set=6;
insert into t7 select 'U', id from matches where state='lobby' and goals_per_set=6;
select htst('C tritt bei', :'C', $$select join_match_by_code((select code from t7c where name='U'))$$, 'ok');
select htst('Start', :'H', $$select start_match((select id from t7 where name='U'))$$, 'ok');
select htst('1:1, Team 2 zuletzt', :'H', $$select r_goals('U','12')$$, 'ok');
select hnum('Jedes Tor hat eine Zeile', 'super', $$select count(*) from goals where match_id=(select id from t7 where name='U')$$, 2);
select hnum('…ohne Schützen', 'super', $$select count(*) from goals where match_id=(select id from t7 where name='U') and scorer_id is not null$$, 0);
select htst('Rückgängig', :'H', $$select undo_goal((select id from t7 where name='U'))$$, 'ok');
select htxt('Team 2 zurückgenommen, nicht Team 1', 'super', $$select r_st('U')$$, 'running 1:0/-');
select htst('Noch 2, 1, 1 → 2:2? (Team 1,2,2)', :'H', $$select r_goals('U','122')$$, 'ok');
select htxt('Stand 2:2', 'super', $$select r_st('U')$$, 'running 2:2/-');
select htst('Rückgängig', :'H', $$select undo_goal((select id from t7 where name='U'))$$, 'ok');
select htxt('Letztes Tor war Team 2 → 2:1', 'super', $$select r_st('U')$$, 'running 2:1/-');
select htst('Nochmal', :'H', $$select undo_goal((select id from t7 where name='U'))$$, 'ok');
select htxt('Davor Team 2 → 2:0', 'super', $$select r_st('U')$$, 'running 2:0/-');
select hnum('Zeilen passen zum Stand', 'super', $$select count(*) from goals where match_id=(select id from t7 where name='U')$$, 2);
select htst('Alt-Spiel ohne Zeilen: Schätzung wie bisher', 'super',
  $$delete from goals where match_id=(select id from t7 where name='U')$$, 'ok');
select htst('Rückgängig ohne Zeilen geht', :'H', $$select undo_goal((select id from t7 where name='U'))$$, 'ok');
select htxt('Schätzung: Team mit höherem Stand', 'super', $$select r_st('U')$$, 'running 1:0/-');
