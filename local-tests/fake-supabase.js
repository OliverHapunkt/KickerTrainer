/* Ersatz für supabase-js im Browsertest.
   Bildet nur die Aufrufe nach, die die App macht, und spiegelt die Spiellogik
   aus record_goal/undo_goal. KEIN Supabase – die Serverlogik selbst ist mit
   SQL-Tests geprüft (supabase/local-tests). */
(function(){
  // Schlüssel = echte Tabellennamen, sonst gehen Abfragen ins Leere
const DB = {players:[], matches:[], match_players:[], match_sets:[], goals:[]};
  const UID = '11111111-0000-4000-8000-000000000001';
  let seq = 0;
  const uid = () => 'id-' + (++seq);
  window.__fake = {DB, offline:false, calls:[]};

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
        return Promise.resolve(res(made));
      }
      if(this.upd){ const a=this._rows; a.forEach(r=>Object.assign(r,this.upd)); return Promise.resolve(res(a)) }
      if(this.del){ const a=this._rows; DB[this.t]=rows(this.t).filter(r=>!a.includes(r)); return Promise.resolve(res(a)) }
      return Promise.resolve(res(this._rows));
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
  const RPC = {
    match_state: a => res(state(a.p_match)),
    create_match: a => {
      const need = a.p_mode==='single'?1:2;
      const n1=a.p_players.filter(p=>p.team===1).length, n2=a.p_players.filter(p=>p.team===2).length;
      if(n1!==need||n2!==need) return res(null,{message:'Teamgröße',code:'P0001'});
      const m={id:uid(),host_id:DB.players.find(p=>p.user_id===UID).id,mode:a.p_mode,detail:a.p_detail,
        goals_per_set:a.p_goals_per_set,sets_to_win:a.p_sets_to_win,state:'running',
        join_code:null,started_at:new Date().toISOString(),rev:1};
      DB.matches.push(m);
      a.p_players.forEach(p=>DB.match_players.push({match_id:m.id,player_id:p.player_id,team:p.team,
        position:(a.p_detail==='full'&&a.p_mode==='double')?p.position:null,
        is_host:p.player_id===m.host_id}));
      DB.match_sets.push({match_id:m.id,set_no:1,score1:0,score2:0,winner_team:null});
      return res(m);
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
        if(wins>=m.sets_to_win) m.state='finished';
        else DB.match_sets.push({match_id:m.id,set_no:cur.set_no+1,score1:0,score2:0,winner_team:null});
      }
      return res(state(m.id));
    },
    undo_goal: a => {
      const m=DB.matches.find(x=>x.id===a.p_match);
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
      if(m.state==='finished')m.state='running';
      return res(state(m.id));
    }
  };

  window.supabase = {createClient(){ return {
    auth:{
      getSession:()=>Promise.resolve(res({session:{user:{id:UID,email:'test@example.org'}}})),
      onAuthStateChange(){}, signOut(){return Promise.resolve(res(null))}
    },
    from:t=>new Q(t),
    rpc:(name,args)=>{ window.__fake.calls.push(name);
      if(window.__fake.offline) return Promise.resolve(res(null,{message:'Failed to fetch'}));
      return Promise.resolve(RPC[name]?RPC[name](args||{}):res(null,{message:'rpc '+name+' fehlt'})) }
  }}};
})();
