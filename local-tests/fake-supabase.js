/* Ersatz für supabase-js im Browsertest.
   Bildet nur die Aufrufe nach, die die App macht, und spiegelt die Spiellogik
   aus record_goal/undo_goal. KEIN Supabase – die Serverlogik selbst ist mit
   SQL-Tests geprüft (supabase/local-tests). */
(function(){
  // Schlüssel = echte Tabellennamen, sonst gehen Abfragen ins Leere
  const EMPTY = {players:[], matches:[], match_players:[], match_sets:[], goals:[], match_confirmations:[],
                 ratings:[], team_ratings:[], rating_history:[]};
  // Datenbank und angemeldetes Konto überleben einen Neustart der Seite. Nur so
  // lassen sich zwei Personen nacheinander in derselben Umgebung nachstellen.
  let DB, seq;
  try{ const raw = JSON.parse(localStorage.getItem('__fakedb') || 'null');
       DB = raw ? raw.db : JSON.parse(JSON.stringify(EMPTY)); seq = raw ? raw.seq : 0; }
  catch(e){ DB = JSON.parse(JSON.stringify(EMPTY)); seq = 0 }
  for(const k of Object.keys(EMPTY)) if(!DB[k]) DB[k] = [];
  function persist(){ try{ localStorage.setItem('__fakedb', JSON.stringify({db:DB, seq})) }catch(e){} }
  const uid = () => { seq++; persist(); return 'id-' + seq };
  // Konto bei JEDEM Zugriff frisch lesen, nicht einmal beim Laden: Im Test werden
  // die Startskripte in fester Reihenfolge ausgeführt, und das Konto wird danach gesetzt.
  const UID = () => { try{ return localStorage.getItem('__fakeuid') ||
    '11111111-0000-4000-8000-000000000001' }catch(e){ return '11111111-0000-4000-8000-000000000001' } };
  window.__fake = {get DB(){return DB}, offline:false, calls:[], persist, recompute:()=>{recompute();persist()},
    setUid(u){ try{ localStorage.setItem('__fakeuid', u) }catch(e){} },
    reset(){ DB = JSON.parse(JSON.stringify(EMPTY)); seq = 0; persist() }};

  const res = (data, error) => ({data: data === undefined ? null : data, error: error || null});

  function rows(table){ return DB[table] || [] }

  class Q {
    constructor(table){ this.t = table; this.f = []; this.ord = null; this.lim = null; this.sel = null }
    select(s){ this.sel = s; return this }
    eq(k,v){ this.f.push(r=>r[k] === v); return this }
    is(k,v){ this.f.push(r=>(r[k] === undefined ? null : r[k]) === v); return this }
    in(k,v){ this.f.push(r=>v.includes(r[k])); return this }
    not(k,op,v){ this.f.push(r=>op==='is' ? (r[k] === undefined ? null : r[k]) !== v : r[k] !== v); return this }
    order(k,o){ this.ord = [k, !o || o.ascending !== false]; return this }
    limit(n){ this.lim = n; return this }
    range(){ return this }
    get _rows(){
      let a = rows(this.t).filter(r=>this.f.every(fn=>fn(r)));
      if(this.ord){ const [k,asc]=this.ord; a=a.slice().sort((x,y)=>(x[k]>y[k]?1:x[k]<y[k]?-1:0)*(asc?1:-1)) }
      if(this.lim != null) a = a.slice(0, this.lim);
      return a;
    }
    _run(){
      if(window.__fake.offline) return Promise.resolve(res(null,{message:'Failed to fetch'}));
      if(this.ins){
        const made = this.ins.map(v=>{
          const r = Object.assign({id:uid()}, v);
          if(this.t === 'players'){
            // Wie die Indizes: Konten weltweit eindeutig, Gäste je Besitzer bzw. Gruppe
            const nk = x => String(x.nickname).trim().toLowerCase();
            if(DB.players.some(p=>!p.deleted_at && nk(p)===nk(r) && p.kind===r.kind
               && (r.kind==='account' || (r.owner_id ? p.owner_id===r.owner_id : p.group_id===r.group_id)))) return '__dup';
            r.deleted_at = r.deleted_at || null; r.ranking_opt_in = !!r.ranking_opt_in;
          }
          return r;
        });
        if(made.includes('__dup'))
          return Promise.resolve(res(null,{message:'duplicate key value violates unique constraint', code:'23505'}));
        made.forEach(r=>rows(this.t).push(r));
        persist();
        return Promise.resolve(res(made));
      }
      if(this.upd){ const a=this._rows; a.forEach(r=>Object.assign(r,this.upd)); if(this.t==='matches') recompute(); persist(); return Promise.resolve(res(a)) }
      if(this.del){ const a=this._rows; DB[this.t]=rows(this.t).filter(r=>!a.includes(r)); persist(); return Promise.resolve(res(a)) }
      // Eingebettete Unterabfrage wie select('...,match_sets(...)') nachbilden:
      // PostgREST hängt die verknüpften Zeilen an. Reicht für match_id-Beziehungen.
      let out = this._rows;
      const emb = /([a-z_]+)\s*\(/.exec(String(this.sel||''));
      if(emb && DB[emb[1]]){
        const tbl = emb[1];
        out = out.map(r=>Object.assign({}, r, {[tbl]: DB[tbl].filter(x=>x.match_id===r.id)}));
      }
      return Promise.resolve(res(out));
    }
    then(ok, no){ return this._run().then(ok, no) }
    single(){ return this._run().then(r=>r.error?r:(r.data&&r.data.length?res(r.data[0]):res(null,{message:'JSON object requested, multiple (or no) rows returned',code:'PGRST116'}))) }
    maybeSingle(){ return this._run().then(r=>r.error?r:res((r.data&&r.data[0])||null)) }
    insert(v){ this.ins = Array.isArray(v)?v:[v]; return this }
    update(v){ this.upd = v; return this }
    delete(){ this.del = true; return this }
    upsert(){ this.ups = true; return this }
  }

  /* ---- Spiellogik, gespiegelt aus den SQL-Funktionen ---- */
  function state(id){
    const m = DB.matches.find(x=>x.id===id);
    const ss = DB.match_sets.filter(s=>s.match_id===id).sort((a,b)=>a.set_no-b.set_no);
    const cur = ss.find(s=>s.winner_team==null);
    return {state:m.state, set_no:cur?cur.set_no:null,
      score1:cur?cur.score1:0, score2:cur?cur.score2:0,
      sets1:ss.filter(s=>s.winner_team===1).length, sets2:ss.filter(s=>s.winner_team===2).length,
      match_done:m.state!=='running',
      sets:ss.map(s=>({set_no:s.set_no,score1:s.score1,score2:s.score2,winner_team:s.winner_team}))};
  }
  // Spiegelt team_confirmed() und settle_match() aus der Datenbank
  function teamDone(id, t){
    const m = DB.matches.find(x=>x.id===id);
    const ps = DB.match_players.filter(p=>p.match_id===id && p.team===t);
    if(ps.some(p=>p.player_id===m.host_id)) return true;
    const able = ps.filter(p=>{const q=DB.players.find(y=>y.id===p.player_id);
      return q && q.kind==='account' && !q.deleted_at && q.user_id});
    if(!able.length) return true;
    return DB.match_confirmations.some(c=>c.match_id===id && c.rev===m.rev
      && c.decision==='ok' && able.some(a=>a.player_id===c.player_id));
  }
  /* Spiegelt set_end(): 1/2 Sieger, 0 Remis, null weiter */
  function setEnd(m,setNo,s1,s2){
    const prev=DB.match_sets.filter(x=>x.match_id===m.id&&x.set_no<setNo);
    const w1=prev.filter(x=>x.winner_team===1).length,w2=prev.filter(x=>x.winner_team===2).length;
    const dec=w1===m.sets_to_win-1&&w2===m.sets_to_win-1;
    if(m.draw_at!=null&&dec&&s1===m.draw_at&&s2===m.draw_at) return 0;
    if(m.goal_cap!=null&&Math.max(s1,s2)>=m.goal_cap&&s1!==s2) return s1>s2?1:2;
    const lead=(m.win_by===2&&(m.win_by_scope==='all'||dec))?2:1;
    if(Math.max(s1,s2)>=m.goals_per_set&&Math.abs(s1-s2)>=lead) return s1>s2?1:2;
    return null;
  }
  function applyRules(m,r){ if(!r) return;
    m.win_by=r.win_by||1; m.win_by_scope=r.scope||'decider'; m.goal_cap=r.cap??null; m.draw_at=r.draw_at??null }
  /* Spiegelt recompute_ratings(): komplett neu aus allen bestätigten Wertungsspielen */
  function recompute(){
    DB.ratings=[]; DB.team_ratings=[]; DB.rating_history=[];
    const at=m=>m.finished_at||m.started_at||m.created_at;
    const ms=DB.matches.filter(m=>m.state==='confirmed'&&(m.category||'ranked')==='ranked')
      .sort((a,b)=>at(a)<at(b)?-1:at(a)>at(b)?1:(a.id<b.id?-1:1));
    const R=(pid,k)=>{let r=DB.ratings.find(x=>x.player_id===pid&&x.kind===k);
      if(!r){r={player_id:pid,kind:k,rating:1000,games:0,wins:0,draws:0};DB.ratings.push(r)}return r};
    for(const m of ms){
      const ss=DB.match_sets.filter(x=>x.match_id===m.id);
      const w1=ss.filter(x=>x.winner_team===1).length,w2=ss.filter(x=>x.winner_team===2).length;
      const draw=ss.some(x=>x.winner_team===0);
      if(w1===w2&&!draw) continue;
      const k=m.mode==='single'?'single':'double';
      const acc=id=>{const p=DB.players.find(y=>y.id===id);return p&&p.kind==='account'};
      const t1=DB.match_players.filter(x=>x.match_id===m.id&&x.team===1).map(x=>x.player_id).filter(acc).sort();
      const t2=DB.match_players.filter(x=>x.match_id===m.id&&x.team===2).map(x=>x.player_id).filter(acc).sort();
      if(!t1.length||!t2.length) continue;   // Option A: Gast-Seite zählt nicht
      const avg=t=>t.reduce((a,p)=>a+R(p,k).rating,0)/t.length;
      const r1=avg(t1),r2=avg(t2),e1=1/(1+Math.pow(10,(r2-r1)/400)),s1=draw?0.5:w1>w2?1:0;
      for(const p of t1.concat(t2)){
        const sc=t1.includes(p)?s1:1-s1, ex=t1.includes(p)?e1:1-e1, r=R(p,k), K=r.games<10?48:24, b=r.rating;
        r.rating=b+K*(sc-ex); r.games++; if(sc===1)r.wins++; if(sc===0.5)r.draws=(r.draws||0)+1;
        DB.rating_history.push({match_id:m.id,player_id:p,kind:k,before:b,after:r.rating,at:at(m)});
      }
      if(k==='double'&&t1.length===2&&t2.length===2){
        const T=t=>{let r=DB.team_ratings.find(x=>x.p1===t[0]&&x.p2===t[1]);if(!r){r={p1:t[0],p2:t[1],rating:1000,games:0,wins:0};DB.team_ratings.push(r)}return r};
        const a=T(t1),b=T(t2),e=1/(1+Math.pow(10,(b.rating-a.rating)/400));
        for(const [x,sc,ex] of [[a,s1,e],[b,1-s1,1-e]]){x.rating+=(x.games<10?48:24)*(sc-ex);x.games++;if(sc===1)x.wins++}
      }
    }
    DB.matches.forEach(m=>{m.rated=DB.rating_history.some(h=>h.match_id===m.id)});
  }
  function settle(id){
    const m = DB.matches.find(x=>x.id===id);
    if(!m || !['finished','confirmed','disputed'].includes(m.state)) return;
    if(DB.match_confirmations.some(c=>c.match_id===id&&c.rev===m.rev&&c.decision==='reject')){
      m.state='disputed'; recompute(); return }
    if(teamDone(id,1)&&teamDone(id,2)){ m.state='confirmed'; recompute(); return }
    m.state='finished'; recompute();
  }

  const RPC = {
    match_state: a => res(state(a.p_match)),
    update_match_rules: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      const m = DB.matches.find(x=>x.id===a.p_match);
      if(!m) return res(null,{message:'Spiel nicht gefunden',code:'P0001'});
      if(m.host_id!==me.id) return res(null,{message:'Nur der Host ändert die Regeln',code:'42501'});
      if(!['lobby','running'].includes(m.state)) return res(null,{message:'Das Spiel ist schon vorbei',code:'P0001'});
      if(m.state==='running'&&a.p_mode&&a.p_mode!==m.mode) return res(null,{message:'Einzel oder Doppel nur in der Lobby',code:'P0001'});
      if(m.state==='running'&&a.p_category&&a.p_category!==m.category) return res(null,{message:'Die Art wird vor dem Spiel festgelegt',code:'P0001'});
      const n=Object.assign({},m);
      if(a.p_mode)n.mode=a.p_mode; if(a.p_detail)n.detail=a.p_detail; if(a.p_gps)n.goals_per_set=a.p_gps;
      if(a.p_stw)n.sets_to_win=a.p_stw; if(a.p_win_by)n.win_by=a.p_win_by; if(a.p_scope)n.win_by_scope=a.p_scope;
      if(a.p_category)n.category=a.p_category;
      n.goal_cap=a.p_clear_cap?null:(a.p_cap??m.goal_cap); n.draw_at=a.p_clear_draw?null:(a.p_draw_at??m.draw_at);
      if(n.goal_cap!=null&&n.goal_cap<=n.goals_per_set) return res(null,{message:'Die Obergrenze muss über dem Satzziel liegen',code:'P0001'});
      if(n.mode!==m.mode){const need=n.mode==='single'?1:2;
        if([1,2].some(t=>DB.match_players.filter(x=>x.match_id===m.id&&x.team===t).length>need))
          return res(null,{message:'Für Einzel erst einen Spieler je Team entfernen',code:'P0001'})}
      if(m.state==='running'){
        const ss=DB.match_sets.filter(x=>x.match_id===m.id);
        if(Math.max(ss.filter(x=>x.winner_team===1).length,ss.filter(x=>x.winner_team===2).length)>=n.sets_to_win)
          return res(null,{message:'So wäre das Spiel schon entschieden',code:'P0001'});
        const cur=ss.filter(x=>x.winner_team==null).sort((x,y)=>x.set_no-y.set_no)[0];
        if(cur&&setEnd(n,cur.set_no,cur.score1,cur.score2)!==null)
          return res(null,{message:'So wäre der laufende Satz ('+cur.score1+' : '+cur.score2+') schon entschieden',code:'P0001'});
      }
      Object.assign(m,n);
      const mps=DB.match_players.filter(x=>x.match_id===m.id);
      if(m.mode==='single') mps.forEach(x=>{x.position=null});
      else if(m.detail==='full') [1,2].forEach(t=>{const ps=mps.filter(x=>x.team===t);
        if(ps.length===2&&ps[0].position===ps[1].position){ps[0].position='off';ps[1].position='def'}
        else ps.forEach((x,i)=>{if(!x.position)x.position=i?'def':'off'})});
      persist(); return res(m);
    },
    my_ratings: () => {
      const me = DB.players.find(p=>p.user_id===UID()); if(!me) return res({});
      const one=k=>{const r=DB.ratings.find(x=>x.player_id===me.id&&x.kind===k);return r?{rating:Math.round(r.rating),games:r.games,wins:r.wins,draws:r.draws||0}:null};
      return res({me:me.id, single:one('single'), double:one('double'),
        teams:DB.team_ratings.filter(t=>t.p1===me.id||t.p2===me.id).map(t=>{const o=DB.players.find(p=>p.id===(t.p1===me.id?t.p2:t.p1));
          return {partner:o.id,nick:o.nickname,kind:o.kind,rating:Math.round(t.rating),games:t.games,wins:t.wins}}),
        history:DB.rating_history.filter(h=>h.player_id===me.id).map(h=>({at:h.at,kind:h.kind,after:Math.round(h.after),
          delta:Math.round(h.after-h.before),match:h.match_id}))});
    },
    leaderboard: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      const ok=p=>p&&p.kind==='account'&&p.ranking_opt_in&&!p.deleted_at;
      if(a.p_kind==='team') return res(DB.team_ratings.filter(t=>t.games>=10&&ok(DB.players.find(p=>p.id===t.p1))&&ok(DB.players.find(p=>p.id===t.p2)))
        .sort((x,y)=>y.rating-x.rating).map(t=>({id:t.p1+'+'+t.p2,nick:DB.players.find(p=>p.id===t.p1).nickname+' & '+DB.players.find(p=>p.id===t.p2).nickname,
          rating:Math.round(t.rating),games:t.games,wins:t.wins,me:!!me&&(t.p1===me.id||t.p2===me.id)})));
      return res(DB.ratings.filter(r=>r.kind===a.p_kind&&r.games>=10&&ok(DB.players.find(p=>p.id===r.player_id)))
        .sort((x,y)=>y.rating-x.rating).map(r=>{const p=DB.players.find(q=>q.id===r.player_id);
          return {id:p.id,nick:p.nickname,rating:Math.round(r.rating),games:r.games,wins:r.wins,me:!!me&&p.id===me.id}}));
    },
    // Spiegelt my_match_history(): eigene Spiele mit Ergebnis, neueste zuerst
    my_match_history: () => {
      const me = DB.players.find(p=>p.user_id===UID()); if(!me) return res([]);
      const ids = DB.match_players.filter(x=>x.player_id===me.id).map(x=>x.match_id);
      const at = m => m.finished_at || m.started_at || m.created_at;
      const out = DB.matches.filter(m=>ids.includes(m.id) && ['finished','confirmed','disputed'].includes(m.state))
        .sort((a,b)=>at(a)<at(b)?1:-1).map(m=>({id:m.id, me:me.id, at:at(m), mode:m.mode, detail:m.detail,
          category:m.category||'ranked', state:m.state, host:m.host_id===me.id,
          team:DB.match_players.find(x=>x.match_id===m.id&&x.player_id===me.id).team,
          players:DB.match_players.filter(x=>x.match_id===m.id).map(x=>{const p=DB.players.find(y=>y.id===x.player_id)||{};
            const r=DB.ratings.find(y=>y.player_id===x.player_id&&y.kind===(m.mode==='single'?'single':'double'));
            return {id:x.player_id, nick:p.nickname, kind:p.kind, team:x.team, pos:x.position, del:!!p.deleted_at,
                    elo:r?Math.round(r.rating):null}}),
          elo:(h=>h?Math.round(h.after-h.before):null)(DB.rating_history.find(h=>h.match_id===m.id&&h.player_id===me.id)),
          sets:DB.match_sets.filter(x=>x.match_id===m.id).sort((a,b)=>a.set_no-b.set_no).map(x=>[x.score1,x.score2,x.winner_team]),
          goals:m.detail==='full' ? DB.goals.filter(g=>g.match_id===m.id).map(g=>[g.set_no,g.team,g.scorer_id,g.scorer_position,g.own_goal]) : []}));
      return res(out);
    },
    create_match: a => {
      const need = a.p_mode==='single'?1:2;
      const n1=a.p_players.filter(p=>p.team===1).length, n2=a.p_players.filter(p=>p.team===2).length;
      if(n1!==need||n2!==need) return res(null,{message:'Teamgröße',code:'P0001'});
      if(a.p_id && DB.matches.some(x=>x.id===a.p_id)) return res(null,{message:'duplicate key',code:'23505'});
      const m={id:a.p_id||uid(),host_id:DB.players.find(p=>p.user_id===UID()).id,mode:a.p_mode,detail:a.p_detail,
        goals_per_set:a.p_goals_per_set,sets_to_win:a.p_sets_to_win,state:'running',category:a.p_category||'ranked',
        join_code:null,started_at:new Date().toISOString(),rev:1,win_by:1,win_by_scope:'decider',goal_cap:null,draw_at:null};
      applyRules(m,a.p_rules);
      DB.matches.push(m);
      a.p_players.forEach(p=>DB.match_players.push({match_id:m.id,player_id:p.player_id,team:p.team,
        position:(a.p_detail==='full'&&a.p_mode==='double')?p.position:null,
        is_host:p.player_id===m.host_id}));
      DB.match_sets.push({match_id:m.id,set_no:1,score1:0,score2:0,winner_team:null});
      persist(); return res(m);
    },
    // Wie import_match: anlegen, Tore der Reihe nach einspielen; alles oder nichts
    import_match: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      const ex = DB.matches.find(x=>x.id===a.p_id);
      if(ex){
        if(ex.host_id !== me.id) return res(null,{message:'Diese Spiel-Nummer ist schon vergeben',code:'P0001'});
        if(ex.state !== 'running' || DB.goals.some(g=>g.match_id===ex.id)) return res(state(ex.id));
      }
      const backup = JSON.stringify(DB);
      window.__fake.imports = (window.__fake.imports||0) + 1;
      if(!ex){ const r = RPC.create_match(a); if(r.error) return r }
      for(const g of a.p_goals){
        const r = RPC.record_goal({p_match:a.p_id, p_team:g.team, p_scorer:g.scorer, p_position:g.position, p_own:g.own});
        if(r.error){ DB = JSON.parse(backup); persist(); return r }
      }
      const m = DB.matches.find(x=>x.id===a.p_id);
      m.started_at = a.p_started_at; persist();
      return res(state(a.p_id));
    },
    record_goal: a => {
      const m=DB.matches.find(x=>x.id===a.p_match);
      const meP=DB.players.find(p=>p.user_id===UID());
      let scorer=a.p_scorer||null;
      if(meP && m.host_id!==meP.id){
        const mine=DB.match_players.find(x=>x.match_id===m.id&&x.player_id===meP.id);
        if(!mine||!mine.device) return res(null,{message:'Nur der Host zählt die Tore',code:'42501'});
        if(mine.team!==a.p_team) return res(null,{message:'Du zählst nur Tore für dein Team',code:'42501'});
        if(m.detail==='full'){
          const tm=id=>(DB.match_players.find(x=>x.match_id===m.id&&x.player_id===id)||{}).team;
          if(a.p_own){ if(!scorer||tm(scorer)===mine.team) return res(null,{message:'Beim Eigentor steht der Schütze im anderen Team',code:'P0001'}) }
          else if(mine.device==='own'){ if(scorer&&scorer!==meP.id) return res(null,{message:'Mit dem eigenen Handy zählst du nur deine eigenen Tore',code:'42501'}); scorer=meP.id }
          else if(scorer&&tm(scorer)!==mine.team) return res(null,{message:'Der Schütze muss in deinem Team spielen',code:'42501'});
        }
      }
      let pos=a.p_position||null;
      if(!pos&&scorer&&m.detail==='full'&&m.mode==='double') pos=(DB.match_players.find(x=>x.match_id===m.id&&x.player_id===scorer)||{}).position||null;
      a=Object.assign({},a,{p_scorer:scorer,p_position:pos,by:meP?meP.id:null});
      if(m.state!=='running') return res(null,{message:'Das Spiel läuft nicht mehr',code:'P0001'});
      const cur=DB.match_sets.filter(s=>s.match_id===m.id&&s.winner_team==null).sort((x,y)=>x.set_no-y.set_no)[0];
      // seit v3.23 immer eine Tor-Zeile; Schütze/Position/Eigentor nur bei „Voll“
      const fullM=m.detail==='full';
      DB.goals.push({match_id:m.id,set_no:cur.set_no,
        seq:DB.goals.filter(g=>g.match_id===m.id&&g.set_no===cur.set_no).length+1,
        team:a.p_team,scorer_id:fullM?(a.p_scorer||null):null,scorer_position:fullM&&m.mode==='double'?a.p_position:null,
        own_goal:fullM&&!!a.p_own,by_player:a.by});
      if(a.p_team===1)cur.score1++;else cur.score2++;
      const sw=setEnd(m,cur.set_no,cur.score1,cur.score2);
      if(sw!==null){
        cur.winner_team=sw;
        const wins=DB.match_sets.filter(s=>s.match_id===m.id&&s.winner_team===sw).length;
        if(sw===0||wins>=m.sets_to_win){ m.state='finished'; m.finished_at=new Date().toISOString(); settle(m.id) }
        else DB.match_sets.push({match_id:m.id,set_no:cur.set_no+1,score1:0,score2:0,winner_team:null});
      }
      persist(); return res(state(m.id));
    },
    team_confirmed: a => res(teamDone(a.p_match, a.p_team)),
    confirm_match: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      const m = DB.matches.find(x=>x.id===a.p_match);
      if(!m) return res(null,{message:'Spiel nicht gefunden',code:'P0001'});
      if(!['finished','disputed'].includes(m.state))
        return res(null,{message:'In diesem Zustand gibt es nichts zu bestätigen',code:'P0001'});
      if(!DB.match_players.some(p=>p.match_id===m.id&&p.player_id===me.id))
        return res(null,{message:'Du hast bei diesem Spiel nicht mitgespielt',code:'42501'});
      if(DB.match_confirmations.some(c=>c.match_id===m.id&&c.player_id===me.id&&c.rev===m.rev))
        return res(null,{message:'Du hast dich zu dieser Fassung schon geäußert',code:'P0001'});
      DB.match_confirmations.push({match_id:m.id,player_id:me.id,rev:m.rev,
        decision:a.p_decision,comment:a.p_comment||null,at:new Date().toISOString()});
      settle(m.id); persist();
      return res(DB.matches.find(x=>x.id===m.id));
    },
    reopen_match: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      const m = DB.matches.find(x=>x.id===a.p_match);
      if(!m) return res(null,{message:'Spiel nicht gefunden',code:'P0001'});
      if(m.host_id!==me.id) return res(null,{message:'Nur der Host kann das Ergebnis korrigieren',code:'42501'});
      if(!['finished','confirmed','disputed'].includes(m.state))
        return res(null,{message:'In diesem Zustand nicht möglich',code:'P0001'});
      if(!m.finished_at || Date.parse(m.finished_at) < Date.now()-7200000)
        return res(null,{message:'Die Korrekturzeit von 2 Stunden ist abgelaufen',code:'P0001'});
      // Letzten Satz wieder zum laufenden machen, Stand bleibt stehen
      DB.match_sets=DB.match_sets.filter(s=>!(s.match_id===m.id&&s.winner_team==null&&s.score1===0&&s.score2===0&&s.set_no>1));
      const last=DB.match_sets.filter(s=>s.match_id===m.id).sort((x,y)=>y.set_no-x.set_no)[0];
      if(last) last.winner_team=null;
      m.state='running'; m.finished_at=null; m.rated=false; m.rev=(m.rev||1)+1; recompute();
      persist(); return res(m);
    },
    create_lobby: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      if(!me) return res(null,{message:'Zum Spielen wird erst ein Nickname benötigt',code:'P0001'});
      const m={id:uid(),host_id:me.id,mode:a.p_mode,detail:a.p_detail,
        goals_per_set:a.p_goals_per_set,sets_to_win:a.p_sets_to_win,state:'lobby',category:a.p_category||'ranked',
        join_code:String(Math.floor(Math.random()*1e6)).padStart(6,'0'),
        created_at:new Date().toISOString(),rev:1,win_by:1,win_by_scope:'decider',goal_cap:null,draw_at:null};
      applyRules(m,a.p_rules);
      DB.matches.push(m);
      DB.match_players.push({match_id:m.id,player_id:me.id,team:1,
        position:(a.p_detail==='full'&&a.p_mode==='double')?'off':null,is_host:true});
      persist(); return res(m);
    },
    join_match_by_code: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      if(!me) return res(null,{message:'Zum Mitspielen wird erst ein Nickname benötigt',code:'P0001'});
      const m = DB.matches.find(x=>x.join_code===String(a.p_code||'').trim() && x.state==='lobby');
      if(!m) return res(null,{message:'Kein offenes Spiel mit diesem Code',code:'P0001'});
      if(DB.match_players.some(p=>p.match_id===m.id&&p.player_id===me.id)) return res(m.id);
      const cap=m.mode==='single'?1:2;
      const ps=DB.match_players.filter(p=>p.match_id===m.id);
      const n1=ps.filter(p=>p.team===1).length, n2=ps.filter(p=>p.team===2).length;
      if(n1+n2>=cap*2) return res(null,{message:'Das Spiel ist schon voll',code:'P0001'});
      let t=(n1<=n2&&n1<cap)?1:2; if(t===2&&n2>=cap)t=1;
      const taken=ps.filter(p=>p.team===t).map(p=>p.position);
      DB.match_players.push({match_id:m.id,player_id:me.id,team:t,
        position:(m.detail==='full'&&m.mode==='double')?(taken.includes('off')?'def':'off'):null,is_host:false});
      persist(); return res(m.id);
    },
    leave_match: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      const m = DB.matches.find(x=>x.id===a.p_match);
      if(!m) return res(null);
      if(m.state!=='lobby') return res(null,{message:'Das Spiel läuft schon',code:'P0001'});
      if(m.host_id===me.id) return res(null,{message:'Der Host kann die Lobby nur abbrechen',code:'P0001'});
      DB.match_players=DB.match_players.filter(p=>!(p.match_id===m.id&&p.player_id===me.id));
      persist(); return res(null);
    },
    start_match: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      const m = DB.matches.find(x=>x.id===a.p_match);
      if(!m) return res(null,{message:'Spiel nicht gefunden',code:'P0001'});
      if(m.host_id!==me.id) return res(null,{message:'Nur der Host startet das Spiel',code:'42501'});
      if(m.state!=='lobby') return res(null,{message:'Das Spiel läuft schon',code:'P0001'});
      const need=m.mode==='single'?1:2;
      const ps=DB.match_players.filter(p=>p.match_id===m.id);
      const n1=ps.filter(p=>p.team===1).length, n2=ps.filter(p=>p.team===2).length;
      if(n1!==need||n2!==need) return res(null,{message:'Es fehlen noch Spieler ('+n1+' und '+n2+' von je '+need+')',code:'P0001'});
      if(m.mode==='double'&&m.detail==='full'){
        for(const t of [1,2]){ const q=ps.filter(p=>p.team===t);
          if(q.filter(p=>p.position==='off').length!==1||q.filter(p=>p.position==='def').length!==1)
            return res(null,{message:'Je Team werden Sturm und Abwehr gebraucht',code:'P0001'}) }
      }
      m.state='running'; m.join_code=null; m.started_at=new Date().toISOString();
      if(!DB.match_sets.some(s=>s.match_id===m.id))
        DB.match_sets.push({match_id:m.id,set_no:1,score1:0,score2:0,winner_team:null});
      persist(); return res(m);
    },
    // Wie request_end/answer_end/end_approvers
    request_end: a => {
      const me=DB.players.find(p=>p.user_id===UID()), m=DB.matches.find(x=>x.id===a.p_match);
      if(!m) return res(null,{message:'Spiel nicht gefunden',code:'P0001'});
      if(!DB.match_players.some(x=>x.match_id===m.id&&x.player_id===me.id)) return res(null,{message:'Du spielst in diesem Spiel nicht mit',code:'42501'});
      if(!endFits(m.state,a.p_kind)) return res(null,{message:a.p_kind==='cancel'?'Abbrechen geht nur, solange das Spiel läuft. Ein beendetes Spiel kannst du löschen':'Löschen geht erst, wenn das Spiel beendet ist. Ein laufendes Spiel brichst du ab',code:'P0001'});
      if(m.state==='lobby'){ if(m.host_id!==me.id) return res(null,{message:'Die Lobby schließt der Host. Du kannst aussteigen',code:'42501'}); endExec(m,'cancel'); return res('done') }
      if(m.end_req===a.p_kind&&m.end_req_by&&approvers(m.id,m.end_req_by).includes(me.id)){ endExec(m,a.p_kind); return res('done') }
      if(!approvers(m.id,me.id).length){ endExec(m,a.p_kind); return res('done') }
      m.end_req=a.p_kind; m.end_req_by=me.id; m.end_req_at=new Date().toISOString(); persist(); return res('requested');
    },
    answer_end: a => {
      const me=DB.players.find(p=>p.user_id===UID()), m=DB.matches.find(x=>x.id===a.p_match);
      if(!m) return res(null,{message:'Spiel nicht gefunden',code:'P0001'});
      if(!m.end_req) return res(null,{message:'Es gibt keine offene Anfrage',code:'P0001'});
      const clear=()=>{m.end_req=null;m.end_req_by=null;m.end_req_at=null;persist()};
      if(!endFits(m.state,m.end_req)){ clear(); return res('stale') }
      if(me.id===m.end_req_by){ if(a.p_ok) return res(null,{message:'Zustimmen muss die Gegenseite',code:'42501'}); clear(); return res('withdrawn') }
      if(!approvers(m.id,m.end_req_by).includes(me.id)) return res(null,{message:'Darüber entscheidet die Gegenseite',code:'42501'});
      if(a.p_ok){ endExec(m,m.end_req); return res('done') }
      clear(); return res('rejected');
    },
    set_device: a => {
      const meP=DB.players.find(p=>p.user_id===UID());
      const m=DB.matches.find(x=>x.id===a.p_match);
      const mine=DB.match_players.find(x=>x.match_id===a.p_match&&x.player_id===meP.id);
      if(!mine) return res(null,{message:'Du spielst in diesem Spiel nicht mit',code:'42501'});
      if(!['lobby','running'].includes(m.state)) return res(null,{message:'Das Spiel läuft nicht mehr',code:'P0001'});
      let d=a.p_device||null; if(m.mode==='single'&&d==='team') d='own';
      if(d){ const mate=DB.match_players.find(x=>x.match_id===m.id&&x.team===mine.team&&x.player_id!==meP.id&&x.device);
        const nick=mate&&(DB.players.find(p=>p.id===mate.player_id)||{}).nickname;
        if(mate&&mate.device==='team') return res(null,{message:nick+' zählt schon mit dem Team-Handy für euch',code:'P0001'});
        if(mate&&d==='team') return res(null,{message:nick+' zählt schon selbst. Dann zählt jeder seine eigenen Tore',code:'P0001'}); }
      mine.device=d; persist(); return res(null);
    },
    swap_positions: a => {
      const meP=DB.players.find(p=>p.user_id===UID());
      const m=DB.matches.find(x=>x.id===a.p_match);
      if(m.host_id!==meP.id&&!DB.match_players.some(x=>x.match_id===m.id&&x.player_id===meP.id&&x.team===a.p_team))
        return res(null,{message:'Nur das eigene Team tauscht seine Positionen',code:'42501'});
      DB.match_players.filter(x=>x.match_id===m.id&&x.team===a.p_team&&x.position)
        .forEach(x=>{x.position=x.position==='off'?'def':'off'});
      persist(); return res(null);
    },
    undo_goal: a => {
      const m=DB.matches.find(x=>x.id===a.p_match);
      const meP=DB.players.find(p=>p.user_id===UID());
      if(m && meP && m.host_id!==meP.id){
        const mine=DB.match_players.find(x=>x.match_id===m.id&&x.player_id===meP.id);
        if(!mine||!mine.device) return res(null,{message:'Nur der Host zählt die Tore',code:'42501'});
        if(m.state!=='running') return res(null,{message:'Korrigieren kann nach Spielende nur der Host',code:'42501'});
        const lg=DB.goals.filter(g=>g.match_id===m.id).sort((x,y)=>y.set_no-x.set_no||y.seq-x.seq)[0];
        if(!lg) return res(null,{message:'Es gibt kein Tor zum Zurücknehmen',code:'P0001'});
        if(!(lg.by_player===meP.id||(lg.scorer_id===meP.id&&!lg.own_goal)||(mine.device==='team'&&mine.team===lg.team)))
          return res(null,{message:'Das letzte Tor hat jemand anderes eingetragen',code:'42501'});
      }
      if(m && m.state!=='running'){
        if(!['finished','confirmed','disputed'].includes(m.state))
          return res(null,{message:'In diesem Zustand nicht möglich',code:'P0001'});
        if(!m.finished_at || Date.parse(m.finished_at) < Date.now()-7200000)
          return res(null,{message:'Die Korrekturzeit von 2 Stunden ist abgelaufen',code:'P0001'});
      }
      DB.match_sets=DB.match_sets.filter(s=>!(s.match_id===m.id&&s.winner_team==null&&s.score1===0&&s.score2===0&&s.set_no>1));
      const tgt=DB.match_sets.filter(s=>s.match_id===m.id&&(s.score1+s.score2)>0).sort((x,y)=>y.set_no-x.set_no)[0];
      if(!tgt) return res(null,{message:'Es gibt kein Tor zum Zurücknehmen',code:'P0001'});
      let team=null;
      { const gs=DB.goals.filter(g=>g.match_id===m.id&&g.set_no===tgt.set_no).sort((x,y)=>y.seq-x.seq);
        if(gs[0]){team=gs[0].team;DB.goals=DB.goals.filter(g=>g!==gs[0])} }
      if(team==null) team=tgt.score1>=tgt.score2?1:2;
      if(team===1)tgt.score1=Math.max(0,tgt.score1-1);else tgt.score2=Math.max(0,tgt.score2-1);
      tgt.winner_team=null;
      if(['finished','confirmed','disputed'].includes(m.state)){
        m.state='running'; m.finished_at=null; m.rev=(m.rev||1)+1;
      }
      persist(); return res(state(m.id));
    }
  };

  function endFits(st,k){ return k==='cancel'?['lobby','running'].includes(st):k==='delete'?['finished','confirmed','disputed'].includes(st):false }
  function approvers(mid, by){
    const m=DB.matches.find(x=>x.id===mid), mp=DB.match_players.filter(x=>x.match_id===mid);
    const t=(mp.find(x=>x.player_id===by)||{}).team;
    const other=mp.filter(x=>x.team!==t).filter(x=>{const p=DB.players.find(y=>y.id===x.player_id)||{};return p.kind==='account'&&!p.deleted_at}).map(x=>x.player_id);
    return other.length?other:(m.host_id!==by?[m.host_id]:[]);
  }
  function endExec(m,k){
    if(k==='cancel'){ m.state='cancelled'; m.join_code=null; m.end_req=null; m.end_req_by=null; m.end_req_at=null }
    else{ const id=m.id; const was=m.state;
      DB.matches=DB.matches.filter(x=>x.id!==id);
      for(const t of ['match_players','match_sets','goals','match_confirmations','rating_history']) DB[t]=DB[t].filter(x=>x.match_id!==id);
      if(was==='confirmed') recompute(); }
    persist();
  }
  const ME = () => { let e=null; try{ e=localStorage.getItem('__fakeemail') }catch(x){}
    return {id:UID(), email:e||UID().slice(0,4)+'@example.org'} };
  window.supabase = {createClient(){ return {
    auth:{
      getSession:()=>Promise.resolve(res({session:{access_token:'fake|'+UID()+'|'+ME().email,user:ME()}})),
      onAuthStateChange(){}, signOut(){return Promise.resolve(res(null))},
      // Code-Anmeldung (code-login.test im Browser): Token = 'fake|<uid>|<email>'
      setSession(s){ const p=String(s&&s.access_token||'').split('|');
        if(p[0]!=='fake'||!p[1]) return Promise.resolve(res(null,{message:'Invalid session'}));
        try{localStorage.setItem('__fakeuid',p[1]);localStorage.setItem('__fakeemail',p[2]||'')}catch(e){}
        return Promise.resolve(res({session:{access_token:s.access_token,user:ME()},user:ME()})) },
      // Nach „E-Mail hinzufügen“ liefert der Server die neue Adresse beim nächsten Auffrischen
      refreshSession(){ if(window.__fake.linked){try{localStorage.setItem('__fakeemail',window.__fake.linked)}catch(e){} window.__fake.linked=null}
        return Promise.resolve(res({session:{user:ME()},user:ME()})) },
      signInWithOtp(){ return Promise.resolve(res({})) },
      verifyOtp({email}){ window.__fake.linked=email; return Promise.resolve(res({session:{access_token:'otp|'+email},user:{id:'otp-'+email,email}})) }
    },
    from:t=>new Q(t),
    rpc:(name,args)=>{ window.__fake.calls.push(name);
      if(window.__fake.offline) return Promise.resolve(res(null,{message:'Failed to fetch'}));
      return Promise.resolve(RPC[name]?RPC[name](args||{}):res(null,{message:'rpc '+name+' fehlt'})) }
  }}};
})();
