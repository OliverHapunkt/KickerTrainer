-- ===========================================================================
-- Hotfix zu v3.20.0: recompute_ratings() scheiterte auf Supabase
--
-- Supabase lädt für API-Anfragen pg_safeupdate. Die Erweiterung bricht jedes
-- DELETE ohne WHERE ab – auch innerhalb von Funktionen und Triggern. Weil die
-- Neuberechnung per Trigger an jeder Bestätigung hängt, scheiterte damit
--   - jedes „Ergebnis bestätigen" („DELETE requires a WHERE clause"),
--   - und das letzte Tor jedes Spiels gegen Gäste (das bestätigt sofort).
-- Lokal fiel es nicht auf: Das Test-Postgres hat die Erweiterung nicht. Neu
-- dafür: supabase/local-tests/check_safeupdate.py prüft alle Migrationen.
-- Inhalt sonst unverändert.
-- ===========================================================================

create or replace function public.recompute_ratings()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       record;
  v_kind  text;
  t1      uuid[];
  t2      uuid[];
  r1      double precision;
  r2      double precision;
  e1      double precision;
  s1      double precision;
  pid     uuid;
  sc      double precision;
  ex      double precision;
  k       double precision;
  cur     double precision;
  g       integer;
  pr      record;
begin
  -- Nie zwei Neuberechnungen gleichzeitig
  perform pg_advisory_xact_lock(hashtext('kt_recompute_ratings'));

  -- „where true“: Supabase bricht DELETE ohne WHERE ab (pg_safeupdate), auch hier drin
  delete from public.rating_history where true;
  delete from public.ratings where true;
  delete from public.team_ratings where true;

  for m in
    select mm.id, mm.mode, coalesce(mm.finished_at, mm.started_at, mm.created_at) as at,
           (select count(*) from public.match_sets s where s.match_id = mm.id and s.winner_team = 1) as w1,
           (select count(*) from public.match_sets s where s.match_id = mm.id and s.winner_team = 2) as w2
      from public.matches mm
     where mm.state = 'confirmed' and mm.category = 'ranked'
     order by coalesce(mm.finished_at, mm.started_at, mm.created_at), mm.id
  loop
    continue when m.w1 = m.w2;                      -- ohne Sieger nichts zu werten
    v_kind := case when m.mode = 'single' then 'single' else 'double' end;
    t1 := array(select player_id from public.match_players where match_id = m.id and team = 1 order by player_id);
    t2 := array(select player_id from public.match_players where match_id = m.id and team = 2 order by player_id);
    continue when cardinality(t1) = 0 or cardinality(t2) = 0;

    insert into public.ratings (player_id, kind)
      select unnest(t1 || t2), v_kind
      on conflict do nothing;

    -- Stärken VOR dem Spiel festhalten, erst dann ändern
    select avg(rating) into r1 from public.ratings where kind = v_kind and player_id = any (t1);
    select avg(rating) into r2 from public.ratings where kind = v_kind and player_id = any (t2);
    e1 := 1.0 / (1.0 + power(10.0, (r2 - r1) / 400.0));
    s1 := case when m.w1 > m.w2 then 1.0 else 0.0 end;

    foreach pid in array t1 || t2 loop
      if pid = any (t1) then sc := s1; ex := e1; else sc := 1.0 - s1; ex := 1.0 - e1; end if;
      select rating, games into cur, g from public.ratings where player_id = pid and kind = v_kind;
      k := case when g < 10 then 48.0 else 24.0 end;
      insert into public.rating_history (match_id, player_id, kind, before, after, at)
        values (m.id, pid, v_kind, cur, cur + k * (sc - ex), m.at);
      update public.ratings
         set rating = cur + k * (sc - ex), games = games + 1,
             wins = wins + (sc = 1.0)::int, updated_at = now()
       where player_id = pid and kind = v_kind;
    end loop;

    -- Feste Paarungen: eigene Wertung, Paar gegen Paar
    if v_kind = 'double' and cardinality(t1) = 2 and cardinality(t2) = 2 then
      insert into public.team_ratings (p1, p2) values (t1[1], t1[2]), (t2[1], t2[2])
        on conflict do nothing;
      select rating into r1 from public.team_ratings where p1 = t1[1] and p2 = t1[2];
      select rating into r2 from public.team_ratings where p1 = t2[1] and p2 = t2[2];
      e1 := 1.0 / (1.0 + power(10.0, (r2 - r1) / 400.0));
      for pr in select t1[1] as a, t1[2] as b, s1 as sc, e1 as ex
                union all select t2[1], t2[2], 1.0 - s1, 1.0 - e1 loop
        update public.team_ratings
           set rating = rating + (case when games < 10 then 48.0 else 24.0 end) * (pr.sc - pr.ex),
               games = games + 1, wins = wins + (pr.sc = 1.0)::int
         where p1 = pr.a and p2 = pr.b;
      end loop;
    end if;
  end loop;

  -- matches.rated = ist ins Elo eingegangen
  update public.matches mm set rated = x.r
    from (select mm2.id, exists (select 1 from public.rating_history h where h.match_id = mm2.id) as r
            from public.matches mm2) x
   where x.id = mm.id and mm.rated is distinct from x.r;
end;
$$;
revoke execute on function public.recompute_ratings() from public, anon, authenticated;
