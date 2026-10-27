/* Ersatz für supabase-js im Browsertest.
   Bildet nur die Aufrufe nach, die die App macht, und spiegelt die Spiellogik
   aus record_goal/undo_goal. KEIN Supabase – die Serverlogik selbst ist mit
   SQL-Tests geprüft (supabase/local-tests). */
(function(){
  // Schlüssel = echte Tabellennamen, sonst gehen Abfragen ins Leere
  const EMPTY = {players:[], matches:[], match_players:[], match_sets:[], goals:[], match_confirmations:[]};
  // Datenbank und angemeldetes Konto überleben einen Neustart der Seite. Nur so
  // lassen sich zwei Personen nacheinander in derselben Umgebung nachstellen.
  let DB, seq;
  try{ const raw = JSON.parse(localStorage.getItem('__fakedb') || 'null');
       DB = raw ? raw.db : JSON.parse(JSON.stringify(EMPTY)); seq = raw ? raw.seq : 0; }
  catch(e){ DB = JSON.parse(JSON.stringify(EMPTY)); seq = 0 }
  function persist(){ try{ localStorage.setItem('__fakedb', JSON.stringify({db:DB, seq})) }catch(e){} }
  const uid = () => { seq++; persist(); return 'id-' + seq };
  // Konto bei JEDEM Zugriff frisch lesen, nicht einmal beim Laden: Im Test werden
  // die Startskripte in fester Reihenfolge ausgeführt, und das Konto wird danach gesetzt.
  const UID = () => { try{ return localStorage.getItem('__fakeuid') ||
    '11111111-0000-4000-8000-000000000001' }catch(e){ return '11111111-0000-4000-8000-000000000001' } };
  window.__fake = {get DB(){return DB}, offline:false, calls:[], persist,
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
            if(DB.players.some(p=>p.nickname.toLowerCase()===String(r.nickname).toLowerCase() && !p.deleted_at)) return '__dup';
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
      if(this.upd){ const a=this._rows; a.forEach(r=>Object.assign(r,this.upd)); persist(); return Promise.resolve(res(a)) }
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
    single(){ return this._run().then(r=>r.error?r:(r.data&&r.data.length?res(r.data[0]):res(null,{message:'no rows'}))) }
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
  function settle(id){
    const m = DB.matches.find(x=>x.id===id);
    if(!m || !['finished','confirmed','disputed'].includes(m.state)) return;
    if(DB.match_confirmations.some(c=>c.match_id===id&&c.rev===m.rev&&c.decision==='reject')){
      m.state='disputed'; return }
    if(teamDone(id,1)&&teamDone(id,2)){ m.state='confirmed'; return }
    m.state='finished';
  }

  const RPC = {
    match_state: a => res(state(a.p_match)),
    create_match: a => {
      const need = a.p_mode==='single'?1:2;
      const n1=a.p_players.filter(p=>p.team===1).length, n2=a.p_players.filter(p=>p.team===2).length;
      if(n1!==need||n2!==need) return res(null,{message:'Teamgröße',code:'P0001'});
      const m={id:uid(),host_id:DB.players.find(p=>p.user_id===UID()).id,mode:a.p_mode,detail:a.p_detail,
        goals_per_set:a.p_goals_per_set,sets_to_win:a.p_sets_to_win,state:'running',
        join_code:null,started_at:new Date().toISOString(),rev:1};
      DB.matches.push(m);
      a.p_players.forEach(p=>DB.match_players.push({match_id:m.id,player_id:p.player_id,team:p.team,
        position:(a.p_detail==='full'&&a.p_mode==='double')?p.position:null,
        is_host:p.player_id===m.host_id}));
      DB.match_sets.push({match_id:m.id,set_no:1,score1:0,score2:0,winner_team:null});
      persist(); return res(m);
    },
    record_goal: a => {
      const m=DB.matches.find(x=>x.id===a.p_match);
      if(m.state!=='running') return res(null,{message:'Das Spiel läuft nicht mehr',code:'P0001'});
      const cur=DB.match_sets.filter(s=>s.match_id===m.id&&s.winner_team==null).sort((x,y)=>x.set_no-y.set_no)[0];
      if(m.detail==='full') DB.goals.push({match_id:m.id,set_no:cur.set_no,
        seq:DB.goals.filter(g=>g.match_id===m.id&&g.set_no===cur.set_no).length+1,
        team:a.p_team,scorer_id:a.p_scorer||null,scorer_position:m.mode==='double'?a.p_position:null,
        own_goal:!!a.p_own});
      if(a.p_team===1)cur.score1++;else cur.score2++;
      if(Math.max(cur.score1,cur.score2)>=m.goals_per_set){
        cur.winner_team=cur.score1>cur.score2?1:2;
        const wins=DB.match_sets.filter(s=>s.match_id===m.id&&s.winner_team===cur.winner_team).length;
        if(wins>=m.sets_to_win){ m.state='finished'; m.finished_at=new Date().toISOString(); settle(m.id) }
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
      m.state='running'; m.finished_at=null; m.rated=false; m.rev=(m.rev||1)+1;
      persist(); return res(m);
    },
    create_lobby: a => {
      const me = DB.players.find(p=>p.user_id===UID());
      if(!me) return res(null,{message:'Zum Spielen wird erst ein Nickname benötigt',code:'P0001'});
      const m={id:uid(),host_id:me.id,mode:a.p_mode,detail:a.p_detail,
        goals_per_set:a.p_goals_per_set,sets_to_win:a.p_sets_to_win,state:'lobby',
        join_code:String(Math.floor(Math.random()*1e6)).padStart(6,'0'),
        created_at:new Date().toISOString(),rev:1};
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
    undo_goal: a => {
      const m=DB.matches.find(x=>x.id===a.p_match);
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
      if(m.detail==='full'){
        const gs=DB.goals.filter(g=>g.match_id===m.id&&g.set_no===tgt.set_no).sort((x,y)=>y.seq-x.seq);
        if(gs[0]){team=gs[0].team;DB.goals=DB.goals.filter(g=>g!==gs[0])}
      }
      if(team==null) team=tgt.score1>=tgt.score2?1:2;
      if(team===1)tgt.score1=Math.max(0,tgt.score1-1);else tgt.score2=Math.max(0,tgt.score2-1);
      tgt.winner_team=null;
      if(['finished','confirmed','disputed'].includes(m.state)){
        m.state='running'; m.finished_at=null; m.rev=(m.rev||1)+1;
      }
      persist(); return res(state(m.id));
    }
  };

  window.supabase = {createClient(){ return {
    auth:{
      getSession:()=>Promise.resolve(res({session:{user:{id:UID(),email:UID().slice(0,4)+'@example.org'}}})),
      onAuthStateChange(){}, signOut(){return Promise.resolve(res(null))}
    },
    from:t=>new Q(t),
    rpc:(name,args)=>{ window.__fake.calls.push(name);
      if(window.__fake.offline) return Promise.resolve(res(null,{message:'Failed to fetch'}));
      return Promise.resolve(RPC[name]?RPC[name](args||{}):res(null,{message:'rpc '+name+' fehlt'})) }
  }}};
})();
