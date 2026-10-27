'use strict';
/* KickerTrainer · Spielen-Hälfte: Spiele gegen andere
 *
 * Warum diese Hälfte anders funktioniert als das Üben:
 * Trainingsdaten gehören dir allein und liegen zuerst lokal. Spieldaten gehören
 * mehreren Personen gemeinsam – sie brauchen ein Konto, einen Server und andere
 * Regeln für Sichtbarkeit und Löschen. Deshalb ist hier der Server maßgeblich,
 * nicht der Browser.
 *
 * Stand (Schritt 3a): Spiele mit eigenen Gästen erfassen. Mitspieler mit eigenem
 * Konto (Beitritt per Code) und die Bestätigung kommen in den nächsten Schritten.
 *
 * Zählen und Netz: Jeder Tipp wirkt sofort auf dem Bildschirm und wird parallel
 * zum Server geschickt. Antwortet der Server, gilt SEIN Stand. Ist kein Netz da,
 * wandert der Tipp in eine Warteschlange und die Kopfzeile sagt das offen.
 */

const LS_PLAY = 'kt2_play';
const PL0 = () => ({uid:null, me:null, guests:[], cfg:{mode:'double',detail:'full',gps:5,stw:2,invite:false},
                    lineup:[null,null,null,null], queue:[]});
let PL = Object.assign(PL0(), load(LS_PLAY, {}));
if(!Array.isArray(PL.lineup) || PL.lineup.length !== 4) PL.lineup=[null,null,null,null];
if(!Array.isArray(PL.queue)) PL.queue=[];
if(!Array.isArray(PL.guests)) PL.guests=[];
function savePL(){ save(LS_PLAY, PL) }

let P = null;        // laufendes Spiel: {id,mode,detail,gps,stw,players,st}
let pBusy = false;
let pMeLoaded = false;   // wurde schon einmal nachgefragt, ob es ein Profil gibt?
let L = null;            // offene Lobby bzw. Spiel, in dem ich nicht der Host bin
let lobTimer = 0;

/* ---------- Zugang zum Konto ---------- */
// Die Spielen-Hälfte braucht ein Konto. Ohne Anmeldung gibt es hier nichts zu tun.
async function pSb(){
  const sb = await sbInit();
  const {data, error} = await sb.auth.getSession();
  if(error) throw error;
  if(!data.session) throw new Error('Nicht angemeldet');
  return {sb, uid:data.session.user.id};
}
function pLoggedIn(){ return !!(CL && CL.user) }

/* Mein Spielerprofil laden; legt nichts an. */
async function pLoadMe(){
  const {sb, uid} = await pSb();
  // Konto gewechselt? Dann gehört der gemerkte Stand nicht mehr hierher.
  if(PL.uid && PL.uid !== uid){ PL = Object.assign(PL0(), {uid}); savePL() }
  const {data, error} = await sb.from('players').select('id,nickname,ranking_opt_in')
    .eq('user_id', uid).maybeSingle();
  if(error) throw error;
  PL.uid = uid; PL.me = data || null;
  if(PL.me) PL.lineup[0] = PL.me.id;
  savePL();
  return PL.me;
}
async function pLoadGuests(){
  const {sb} = await pSb();
  const {data, error} = await sb.from('players').select('id,nickname')
    .eq('kind','guest').is('deleted_at', null).order('nickname');
  if(error) throw error;
  PL.guests = data || []; savePL();
  return PL.guests;
}

const NICK_HINT = 'Dein Nickname ist für Mitspieler sichtbar – nimm nicht deinen vollen Namen. '
  + '3 bis 20 Zeichen, und er muss noch frei sein.';

async function pSetNickname(){
  const cur = PL.me ? PL.me.nickname : '';
  const v = await askText(PL.me ? 'Nickname ändern' : 'Nickname wählen',
    {value:cur, placeholder:'z. B. Olli', hint:NICK_HINT, max:20, ok:'Speichern'});
  if(v === null) return false;
  const nick = v.trim();
  if(nick.length < 3){ toast('Mindestens 3 Zeichen'); return false }
  try{
    const {sb, uid} = await pSb();
    let r;
    if(PL.me) r = await sb.from('players').update({nickname:nick}).eq('id', PL.me.id).select().single();
    else r = await sb.from('players').insert({user_id:uid, nickname:nick, kind:'account'}).select().single();
    if(r.error) throw r.error;
    PL.me = {id:r.data.id, nickname:r.data.nickname, ranking_opt_in:r.data.ranking_opt_in};
    PL.lineup[0] = PL.me.id; savePL();
    toast('Nickname gespeichert');
    return true;
  }catch(e){
    toast(/duplicate|unique/i.test(String(e.message||e)) ? 'Der Nickname ist schon vergeben' : errText(e,'Nicht gespeichert'));
    return false;
  }
}

async function pAddGuest(){
  const v = await askText('Neuer Gast', {placeholder:'Vorname oder Kürzel', max:20, ok:'Anlegen',
    hint:'Gäste spielen ohne eigenes Konto mit. Nimm Vorname oder Kürzel – der Name ist für deine Mitspieler sichtbar.'});
  if(v === null) return null;
  const nick = v.trim();
  if(nick.length < 3){ toast('Mindestens 3 Zeichen'); return null }
  try{
    const {sb} = await pSb();
    const {data, error} = await sb.from('players')
      .insert({owner_id:PL.me.id, nickname:nick, kind:'guest'}).select('id,nickname').single();
    if(error) throw error;
    PL.guests.push(data); PL.guests.sort((a,b)=>a.nickname.localeCompare(b.nickname,'de')); savePL();
    return data;
  }catch(e){
    toast(/duplicate|unique/i.test(String(e.message||e)) ? 'Der Name ist schon vergeben' : errText(e,'Nicht angelegt'));
    return null;
  }
}

/* ---------- Aufstellung ---------- */
function pAll(){ return (PL.me ? [PL.me] : []).concat(PL.guests) }
function pName(id){ const p = pAll().find(x=>x.id===id); return p ? p.nickname : '–' }
function pSlots(){ return PL.cfg.mode === 'single' ? [0,2] : [0,1,2,3] }
function pSlotLabel(i){
  const team = i < 2 ? 1 : 2;
  if(PL.cfg.mode === 'single') return 'Team ' + team;
  return 'Team ' + team + ' · ' + (i % 2 === 0 ? 'Sturm' : 'Abwehr');
}
function pLineupReady(){
  const ids = pSlots().map(i=>PL.lineup[i]);
  return ids.every(Boolean) && new Set(ids).size === ids.length && ids.includes(PL.me && PL.me.id);
}

async function pPick(slot){
  const taken = pSlots().filter(i=>i!==slot).map(i=>PL.lineup[i]);
  const list = pAll().filter(p=>!taken.includes(p.id));
  const rows = list.length
    ? list.map(p=>'<button class="pickrow" data-pid="'+p.id+'">'+esc(p.nickname)
        + (p.id === (PL.me&&PL.me.id) ? '<small>du</small>' : '<small>Gast</small>') + '</button>').join('')
    : '<p class="dmsg">Noch niemand frei. Leg einen Gast an.</p>';
  let chosen = null;
  const v = await dlg('<h3 class="dtitle">' + pSlotLabel(slot) + '</h3><div class="picklist">' + rows + '</div>',
    [{t:'Neuer Gast', v:'new', cls:'primary'}, {t:'Abbrechen', v:null, cancel:true}],
    o => o.addEventListener('click', e=>{
      const b = e.target.closest('[data-pid]'); if(!b) return;
      chosen = b.dataset.pid; o.querySelector('.dbtns [data-i="1"]').click();
    }));
  if(chosen){ PL.lineup[slot] = chosen; savePL(); renderPlayHome(); return }
  if(v === 'new'){ const g = await pAddGuest(); if(g){ PL.lineup[slot] = g.id; savePL() } renderPlayHome() }
}

/* ---------- Spiel-Bildschirm ---------- */
function renderPlay(id){
  if(id === 'play') return renderPlayHome();
  const x = {groups:{t:'Gruppen',p:['Eine Gruppe ist ein Verein oder Stammtisch. Wer den Einladungscode hat, ist drin.',
      'Gemeinsame Gästeliste, Stellvertreter, eigene Rangliste je Gruppe.']},
    rank:{t:'Rangliste',p:['Wertungen aus echten Spielen: Einzel, Doppel über alle Partner, feste Doppel-Paarungen.',
      'Berechnet wird nur auf dem Server, aus dem gesamten Spielverlauf. In der allgemeinen Rangliste stehst du nur mit ausdrücklicher Zustimmung.']}}[id];
  $('#'+id+'Body').innerHTML = '<div class="card">' + x.p.map(t=>'<p class="lead">'+t+'</p>').join('')
    + '</div><p class="hint">Kommt in einem späteren Schritt. Zum Üben geht es über den Umschalter links unten.</p>';
}

function pStepHint(){
  return '<p class="hint">Mitspieler mit eigenem Konto (Beitritt per Code), die Bestätigung des Ergebnisses '
    + 'und die Wertungen kommen in den nächsten Schritten. Jetzt schon möglich: Spiele mit eigenen Gästen erfassen.</p>';
}

function renderPlayHome(){
  const el = $('#playBody');
  if(!el) return;
  if(!pLoggedIn()){
    el.innerHTML = '<div class="card"><h2>Konto nötig</h2>'
      + '<p class="lead">Spiele gehören mehreren Personen gemeinsam – sie liegen deshalb auf dem Server und nicht nur auf diesem Gerät. '
      + 'Dafür brauchst du ein Konto.</p>'
      + '<p class="hint" style="margin-bottom:12px">Das Üben bleibt davon unberührt und funktioniert weiter ohne Konto.</p>'
      + '<button class="big primary" id="pToAcct">Zur Anmeldung</button></div>' + pStepHint();
    $('#pToAcct').onclick = ()=>{ go('settings'); setTimeout(()=>$('#acct').scrollIntoView({behavior:'smooth'}), 60) };
    return;
  }
  // Konto gewechselt? Dann gehört der gemerkte Stand nicht hierher – sonst stünde
  // kurz der Nickname der vorherigen Person auf dem Bildschirm.
  const uid = CL.user && CL.user.id;
  if(uid && PL.uid && PL.uid !== uid){ PL = Object.assign(PL0(), {uid}); savePL(); pMeLoaded = false }

  // Erst klären, ob schon ein Profil existiert – sonst blitzt die Nickname-Frage
  // auch bei Leuten auf, die längst einen Nickname haben.
  if(!PL.me && !pMeLoaded){
    el.innerHTML = '<div class="card"><p class="hint" style="margin:0">Wird geladen …</p></div>';
    pLoadMe().catch(()=>{}).then(()=>{ pMeLoaded = true;
      return PL.me ? pLoadGuests().catch(()=>{}) : null; }).then(()=>renderPlayHome());
    return;
  }
  if(!PL.me){
    el.innerHTML = '<div class="card"><h2>Nickname wählen</h2>'
      + '<p class="lead">Unter diesem Namen tauchst du bei deinen Mitspielern auf.</p>'
      + '<p class="hint" style="margin-bottom:12px">' + NICK_HINT + '</p>'
      + '<button class="big primary" id="pNick">Nickname festlegen</button></div>' + pStepHint();
    $('#pNick').onclick = async ()=>{ if(await pSetNickname()) renderPlayHome() };
    return;
  }

  const c = PL.cfg, ready = pLineupReady();
  let h = '<div class="card qcard"><div class="qhead"><h2>Neues Spiel</h2>'
    + '<button class="link" id="pNick2">' + esc(PL.me.nickname) + '</button></div>';
  h += '<div class="sub"><label>Modus ' + tipBtn('pMode') + '</label><div class="chips sc" id="pcMode"></div></div>';
  h += '<div class="sub"><label>Erfassung ' + tipBtn('pDetail') + '</label><div class="chips sc" id="pcDetail"></div>'
     + '<p class="hint" id="pcDetailHint"></p></div>';
  h += '<div class="sub"><label>Satz bis … Tore</label><div class="chips sc" id="pcGps"></div></div>';
  h += '<div class="sub"><label>Spiel bis … Gewinnsätze</label><div class="chips sc" id="pcStw"></div>'
     + '<p class="hint" id="pcStwHint"></p></div>';
  h += '<div class="sub"><label>Mitspieler ' + tipBtn('pJoin') + '</label><div class="chips sc" id="pcInvite"></div>'
     + '<p class="hint" id="pcInviteHint"></p></div>';
  if(!c.invite)
    h += '<div class="sub"><label>Aufstellung ' + tipBtn('pLineup') + '</label><div class="lineup" id="pLineup"></div></div>';
  if(c.invite) h += '<button class="big primary" id="pLobby">Lobby öffnen</button>';
  else {
    h += '<button class="big primary" id="pStart"' + (ready ? '' : ' disabled') + '>Spiel starten</button>';
    if(!ready) h += '<p class="hint" style="margin-bottom:0">Alle Plätze besetzen – du musst selbst dabei sein.</p>';
  }
  h += '</div><div id="pRunning"></div>'
     + '<div class="card"><h2>Mitspielen</h2><p class="lead">Jemand anderes hostet? Dann brauchst du nur seinen sechsstelligen Code.</p>'
     + '<button class="big" id="pJoinBtn">Einem Spiel beitreten</button></div>'
     + '<div id="pRecent"></div>';
  el.innerHTML = h + pStepHint();

  $('#pNick2').onclick = async ()=>{ if(await pSetNickname()) renderPlayHome() };
  chips($('#pcMode'), [{v:'single',t:'Einzel 1:1'},{v:'double',t:'Doppel 2:2'}], v=>c.mode===v,
    v=>{ c.mode=v; if(v==='single'){PL.lineup[1]=null;PL.lineup[3]=null} savePL() }, renderPlayHome);
  chips($('#pcDetail'), [{v:'simple',t:'Einfach'},{v:'full',t:'Erweitert'}], v=>c.detail===v,
    v=>{ c.detail=v; savePL() }, renderPlayHome);
  chips($('#pcGps'), [3,5,7,10].map(n=>({v:n,t:n+' Tore'})), v=>c.gps===v, v=>{ c.gps=v; savePL() }, renderPlayHome);
  chips($('#pcStw'), [1,2,3].map(n=>({v:n,t:n===1?'Nur ein Satz':n+' Gewinnsätze'})), v=>c.stw===v,
    v=>{ c.stw=v; savePL() }, renderPlayHome);
  $('#pcDetailHint').textContent = c.detail === 'full'
    ? 'Jedes Tor einzeln mit Torschütze' + (c.mode==='double' ? ' und Position' : '') + '. Ein Tipp pro Tor.'
    : 'Nur der Spielstand. Weniger tippen, dafür keine Torschützen-Statistik.';
  $('#pcStwHint').textContent = c.stw === 1 ? 'Ein Satz bis ' + c.gps + ' Tore, dann ist Schluss.'
    : 'Wer zuerst ' + c.stw + ' Sätze hat, gewinnt – also höchstens ' + (c.stw*2-1) + ' Sätze.';

  chips($('#pcInvite'), [{v:false,t:'Nur Gäste'},{v:true,t:'Per Code einladen'}], v=>!!c.invite===v,
    v=>{ c.invite=v; savePL() }, renderPlayHome);
  $('#pcInviteHint').textContent = c.invite
    ? 'Die App zeigt einen Code. Wer ihn eingibt, spielt mit eigenem Konto mit. Freie Plätze kannst du mit Gästen auffüllen.'
    : 'Du trägst alle Mitspieler selbst ein, das Spiel beginnt sofort.';
  $('#pJoinBtn').onclick = pJoin;
  if(c.invite){ $('#pLobby').onclick = pOpenLobbyNew; pLoadRunning(); pLoadRecent();
    if(!pMeLoaded){ pMeLoaded = true; pLoadMe().then(()=>pLoadGuests()).then(()=>renderPlayHome()).catch(()=>{}) }
    return; }
  $('#pLineup').innerHTML = pSlots().map(i=>{
    const id = PL.lineup[i];
    return '<button class="slot' + (id?' set':'') + '" data-slot="' + i + '">'
      + '<small>' + pSlotLabel(i) + '</small><b>' + (id ? esc(pName(id)) : 'Wählen …') + '</b></button>';
  }).join('');
  $('#pLineup').onclick = e=>{ const b = e.target.closest('[data-slot]'); if(b) pPick(+b.dataset.slot) };
  $('#pStart').onclick = pStart;

  pLoadRunning();
  pLoadRecent();
  if(!pMeLoaded){ pMeLoaded = true; pLoadMe().then(()=>pLoadGuests()).then(()=>renderPlayHome()).catch(()=>{}) }
}

/* Meine Spiel-IDs – ich kann Host sein oder Mitspieler. */
async function pMyMatchIds(sb){
  const {data} = await sb.from('match_players').select('match_id').eq('player_id', PL.me.id);
  return (data||[]).map(x=>x.match_id);
}

/* Offene Lobby oder laufendes Spiel? Dann zuerst dorthin anbieten. */
async function pLoadRunning(){
  try{
    const {sb} = await pSb();
    const ids = await pMyMatchIds(sb);
    const el = $('#pRunning'); if(!el) return;
    if(!ids.length){ el.innerHTML=''; return }
    const {data} = await sb.from('matches')
      .select('id,host_id,mode,detail,state,started_at,created_at')
      .in('id', ids).in('state',['running','lobby'])
      .order('created_at',{ascending:false}).limit(1);
    if(!data || !data.length){ el.innerHTML=''; return }
    const m = data[0], lob = m.state === 'lobby', mine = m.host_id === PL.me.id;
    el.innerHTML = '<div class="card"><h2>'
      + (lob ? (mine ? 'Deine Lobby ist offen' : 'Du bist in einer Lobby')
             : (mine ? 'Läuft noch' : 'Ein Spiel mit dir läuft')) + '</h2><p class="lead">'
      + (m.mode==='single'?'Einzel':'Doppel') + ' vom '
      + fmtDate(Date.parse(m.started_at || m.created_at), true)
      + '</p><div class="' + (mine ? 'two' : '') + '"><button class="big primary" id="pResume">'
      + (lob ? 'Zur Lobby' : mine ? 'Fortsetzen' : 'Ansehen') + '</button>'
      + (mine ? '<button class="big" id="pDrop">Verwerfen</button>' : '') + '</div></div>';
    $('#pResume').onclick = ()=>(lob || !mine) ? pOpenLobby(m.id) : pOpen(m.id);
    const d = $('#pDrop');
    if(d) d.onclick = async ()=>{
      if(!await ask('Das Spiel wird nicht gewertet und verschwindet aus deiner Liste.',
        {title:'Spiel verwerfen?', ok:'Verwerfen', danger:true})) return;
      try{ const {sb} = await pSb(); await sb.from('matches').update({state:'cancelled', join_code:null}).eq('id', m.id); }catch(e){}
      renderPlayHome();
    };
  }catch(e){ /* offline: dann eben nicht */ }
}

async function pLoadRecent(){
  try{
    const {sb} = await pSb();
    const ids = await pMyMatchIds(sb);
    const el = $('#pRecent'); if(!el) return;
    if(!ids.length){ el.innerHTML=''; return }
    const {data} = await sb.from('matches')
      .select('id,host_id,mode,detail,state,finished_at,match_sets(set_no,score1,score2,winner_team)')
      .in('id', ids).in('state',['finished','confirmed'])
      .order('finished_at',{ascending:false}).limit(10);
    if(!data || !data.length){ el.innerHTML=''; return }
    el.innerHTML = '<div class="card"><h2>Letzte Spiele</h2>' + data.map(m=>{
      const s = (m.match_sets||[]).slice().sort((a,b)=>a.set_no-b.set_no);
      const w1 = s.filter(x=>x.winner_team===1).length, w2 = s.filter(x=>x.winner_team===2).length;
      return '<div class="mrow" data-mid="' + m.id + '"><div><b>' + w1 + ' : ' + w2 + '</b>'
        + '<small>' + (m.mode==='single'?'Einzel':'Doppel')
        + (m.host_id === PL.me.id ? '' : ' · als Mitspieler') + ' · '
        + s.map(x=>x.score1+':'+x.score2).join('  ') + '</small></div>'
        + '<span>' + (m.finished_at ? fmtDate(Date.parse(m.finished_at), true) : '') + '</span></div>';
    }).join('') + '</div>';
  }catch(e){ /* offline */ }
}

async function pStart(){
  if(pBusy) return; pBusy = true;
  ensureAudio();   // im Tap: entsperrt den Ton auf iOS
  const b = $('#pStart'); if(b) b.disabled = true;
  try{
    const {sb} = await pSb();
    const players = pSlots().map(i=>({player_id:PL.lineup[i], team:i<2?1:2,
      position:PL.cfg.mode==='double' ? (i%2===0?'off':'def') : null}));
    const {data, error} = await sb.rpc('create_match', {
      p_mode:PL.cfg.mode, p_detail:PL.cfg.detail,
      p_goals_per_set:PL.cfg.gps, p_sets_to_win:PL.cfg.stw,
      p_group_id:null, p_players:players});
    if(error) throw error;
    await pOpen(data.id);
  }catch(e){
    toast(errText(e, 'Spiel konnte nicht angelegt werden'));
  }finally{ pBusy = false; if(b) b.disabled = false }
}

/* ---------- Zählen ---------- */
async function pOpen(id){
  ensureAudio();
  try{
    const {sb} = await pSb();
    const [m, mp, st] = await Promise.all([
      sb.from('matches').select('*').eq('id', id).single(),
      sb.from('match_players').select('player_id,team,position,is_host').eq('match_id', id),
      sb.rpc('match_state', {p_match:id})]);
    if(m.error) throw m.error; if(mp.error) throw mp.error; if(st.error) throw st.error;
    // Namen der Mitspieler: Gäste stehen evtl. noch nicht im lokalen Puffer
    const ids = mp.data.map(x=>x.player_id);
    const {data:names} = await sb.from('players').select('id,nickname').in('id', ids);
    const nm = {}; (names||[]).forEach(p=>nm[p.id]=p.nickname);
    P = {id, mode:m.data.mode, detail:m.data.detail, gps:m.data.goals_per_set, stw:m.data.sets_to_win,
         players:mp.data.map(x=>Object.assign({}, x, {nickname:nm[x.player_id]||'?'})),
         st:st.data, own:false};
    PL.queue = PL.queue.filter(q=>q.match === id); savePL();
    wake(true); renderMatch(); show('match');
    pFlush();
  }catch(e){ toast(errText(e, 'Spiel konnte nicht geöffnet werden')) }
}

// Sturm immer oben, damit die Kacheln nicht je nach Datenbank-Reihenfolge springen
function pTeam(t){ return P.players.filter(p=>p.team===t)
  .slice().sort((a,b)=>(a.position==='off'?0:1)-(b.position==='off'?0:1)) }
function pSlotOf(p){ return p.position === 'off' ? 'Sturm' : p.position === 'def' ? 'Abwehr' : '' }

function renderMatch(){
  if(!P) return;
  const s = P.st, done = s.match_done;
  $('#mHead').innerHTML = '<div>' + (done ? 'Spiel beendet'
      : 'Satz ' + s.set_no + (P.stw>1 ? ' · Sätze ' + s.sets1 + ':' + s.sets2 : ''))
    + '</div><div>' + (P.mode==='single'?'Einzel':'Doppel') + ' · bis ' + P.gps + '</div>';
  $('#mScore').innerHTML = '<b>' + s.score1 + '</b><i>:</i><b>' + s.score2 + '</b>';
  const q = PL.queue.length;
  $('#mSync').textContent = q === 0 ? ''
    : q === 1 ? '1 Tipp noch nicht gespeichert – wird nachgeholt'
    : q + ' Tipps noch nicht gespeichert – werden nachgeholt';
  $('#mSync').classList.toggle('hidden', !q);

  const tile = p => '<button class="ptile" data-pid="' + p.player_id + '" data-team="' + p.team + '">'
    + '<b>' + esc(p.nickname) + '</b>' + (pSlotOf(p) ? '<small>' + pSlotOf(p) + '</small>' : '') + '</button>';
  const teamCol = t => {
    if(P.detail === 'simple')
      return '<div class="tcol"><button class="ptile big2" data-team="' + t + '"><b>Team ' + t + '</b>'
        + '<small>' + pTeam(t).map(p=>esc(p.nickname)).join(' · ') + '</small></button></div>';
    return '<div class="tcol">' + pTeam(t).map(tile).join('')
      + (P.mode==='double' ? '<button class="swapbtn" data-swap="' + t + '">' + icon('swap') + ' tauschen</button>' : '')
      + '</div>';
  };
  $('#mArea').innerHTML = teamCol(1) + '<div class="tsep"></div>' + teamCol(2);
  $('#mArea').classList.toggle('off', done);
  $('#mOwn').classList.toggle('on', !!P.own);
  $('#mOwn').classList.toggle('hidden', P.detail !== 'full' || done);
  $('#mEnd').textContent = done ? 'Auswertung' : 'Ende';
}

/* Lokale Vorhersage – dieselben Regeln wie record_goal auf dem Server.
   Sobald der Server antwortet, gilt seine Antwort. */
function pPredict(team){
  const s = P.st;
  const n1 = s.score1 + (team===1?1:0), n2 = s.score2 + (team===2?1:0);
  if(Math.max(n1,n2) >= P.gps){
    const w = n1 > n2 ? 1 : 2;
    const sets1 = s.sets1 + (w===1?1:0), sets2 = s.sets2 + (w===2?1:0);
    const over = Math.max(sets1, sets2) >= P.stw;
    P.st = Object.assign({}, s, {sets1, sets2, match_done:over,
      set_no: over ? s.set_no : s.set_no + 1, score1: over ? n1 : 0, score2: over ? n2 : 0});
  } else {
    P.st = Object.assign({}, s, {score1:n1, score2:n2});
  }
}

function pGoal(team, scorer, position){
  if(!P || P.st.match_done) return;
  const own = !!P.own; P.own = false;
  const credit = own ? (team===1?2:1) : team;
  beep(own?520:880, .07, .25);
  pPredict(credit);
  PL.queue.push({match:P.id, kind:'goal', team:credit, scorer:scorer||null,
                 position:position||null, own, t:Date.now()});
  savePL(); renderMatch(); pFlush();
}
function pUndo(){
  if(!P) return;
  if(PL.queue.length){ PL.queue.pop(); savePL(); pRefresh(); return }  // noch nicht gesendet: einfach wegnehmen
  PL.queue.push({match:P.id, kind:'undo', t:Date.now()}); savePL(); renderMatch(); pFlush();
}

/* Warteschlange abarbeiten. Streng der Reihe nach, damit die Reihenfolge stimmt. */
let pFlushing = false;
async function pFlush(){
  if(pFlushing || !P) return;
  if(!PL.queue.length) return;
  pFlushing = true;
  let last = null;
  try{
    const {sb} = await pSb();
    while(PL.queue.length){
      const a = PL.queue[0];
      if(a.match !== P.id){ PL.queue.shift(); savePL(); continue }
      const r = a.kind === 'undo'
        ? await sb.rpc('undo_goal', {p_match:a.match})
        : await sb.rpc('record_goal', {p_match:a.match, p_team:a.team, p_scorer:a.scorer,
                                       p_position:a.position, p_own:a.own});
      if(r.error){
        // Fachlicher Fehler (z. B. kein Tor zum Zurücknehmen): Tipp verwerfen, sonst blockiert er alles
        if(r.error.code === 'P0001' || r.error.code === '42501'){
          PL.queue.shift(); savePL(); toast(errText(r.error, 'Nicht übernommen')); continue;
        }
        throw r.error;   // Netzfehler: drin lassen und später erneut
      }
      PL.queue.shift(); savePL();
      last = r.data;
    }
    // Erst ganz am Ende übernehmen, und nur wenn nichts mehr aussteht. Sonst würde
    // eine ältere Serverantwort einen neueren lokalen Stand überschreiben.
    if(P && last && !PL.queue.length) P.st = last;
    renderMatch();
    if(P && P.st.match_done) pSummary();
  }catch(e){
    renderMatch();            // Warteschlange bleibt, Kopfzeile zeigt sie an
  }finally{ pFlushing = false }
}
async function pRefresh(){
  try{ const {sb} = await pSb();
    const {data, error} = await sb.rpc('match_state', {p_match:P.id});
    if(!error && P) P.st = data;
  }catch(e){}
  renderMatch();
}

/* ---------- Auswertung ---------- */
async function pSummary(){
  if(!P) return;
  let goals = [];
  if(P.detail === 'full'){
    try{ const {sb} = await pSb();
      const {data} = await sb.from('goals').select('set_no,seq,team,scorer_id,scorer_position,own_goal')
        .eq('match_id', P.id).order('set_no').order('seq');
      goals = data || [];
    }catch(e){}
  }
  const s = P.st, sets = s.sets || [];
  const w1 = s.sets1, w2 = s.sets2;
  let h = '<div class="sumhead"><div><div class="blockh">Ergebnis</div>'
    + '<div class="bigpct">' + w1 + ' : ' + w2 + '</div>'
    + '<p class="center">' + sets.map(x=>x.score1+':'+x.score2).join(' · ') + '</p></div></div>';
  h += kv('Teams', pTeam(1).map(p=>p.nickname).join(' & ') + '  gegen  ' + pTeam(2).map(p=>p.nickname).join(' & '));
  if(goals.length){
    h += '<div class="blockh">Torschützen</div>';
    for(const p of P.players){
      const g = goals.filter(x=>x.scorer_id===p.player_id && !x.own_goal).length;
      const og = goals.filter(x=>x.scorer_id===p.player_id && x.own_goal).length;
      if(g || og) h += kv(p.nickname, g + (og ? ' (+' + og + ' Eigentor' + (og>1?'e':'') + ')' : ''));
    }
    if(P.mode === 'double'){
      const off = goals.filter(x=>x.scorer_position==='off' && !x.own_goal).length;
      const def = goals.filter(x=>x.scorer_position==='def' && !x.own_goal).length;
      if(off || def){ h += '<div class="blockh">Tore je Position</div>'; h += kv('Sturm / Abwehr', off + ' / ' + def) }
    }
    const unk = goals.filter(x=>!x.scorer_id).length;
    if(unk) h += kv('Ohne Torschütze', unk);
  }
  $('#msumBody').innerHTML = '<div class="sumscroll">' + h + '</div>'
    + '<div class="sumfoot"><button class="big primary" id="msumDone">Fertig</button></div>';
  $('#msummary').classList.remove('hidden');
  $('#msumDone').onclick = ()=>{ $('#msummary').classList.add('hidden'); pClose() };
}

function pClose(){
  wake(false); P = null;
  go('play');
}

/* ---------- Bedienung Zählbildschirm ---------- */
$('#mArea').addEventListener('pointerdown', e=>{
  e.preventDefault();
  const sw = e.target.closest('[data-swap]');
  if(sw){ pSwap(+sw.dataset.swap); return }
  const t = e.target.closest('[data-team]'); if(!t || !P || P.st.match_done) return;
  const pid = t.dataset.pid || null;
  const p = pid ? P.players.find(x=>x.player_id===pid) : null;
  pGoal(+t.dataset.team, pid, p ? p.position : null);
});
function pSwap(team){
  if(!P) return;
  const ps = pTeam(team);
  if(ps.length !== 2) return;
  ps.forEach(p=>{ p.position = p.position === 'off' ? 'def' : 'off' });
  renderMatch();
  pSb().then(({sb})=>Promise.all(ps.map(p=>
    sb.from('match_players').update({position:p.position}).eq('match_id',P.id).eq('player_id',p.player_id)
  ))).catch(()=>toast('Tausch noch nicht gespeichert'));
}
$('#mUndo').onclick = ()=>pUndo();
$('#mOwn').onclick = ()=>{ if(!P) return; P.own = !P.own; renderMatch();
  if(P.own) toast('Nächster Tipp zählt als Eigentor') };
$('#mEnd').onclick = async ()=>{
  if(!P) return;
  if(P.st.match_done) return pSummary();
  if(!await ask('Das Spiel wird vorzeitig beendet und nicht gewertet.',
    {title:'Spiel beenden?', ok:'Beenden', danger:true})) return;
  try{ const {sb} = await pSb(); await sb.from('matches').update({state:'cancelled'}).eq('id', P.id) }catch(e){}
  pClose();
};
$('#mInfo').onclick = ()=>info('Zählen',
  '<p class="dmsg">Jeder Tipp auf eine Kachel zählt ein Tor für dieses Team. Bei <b>Erweitert</b> ist die angetippte Person der Torschütze.</p>'
  + '<p class="dmsg"><b>Eigentor</b>: erst antippen, dann die Person, der es passiert ist. Der Punkt geht ans andere Team.</p>'
  + '<p class="dmsg"><b>Tauschen</b> dreht Sturm und Abwehr eines Teams. Ab dann zählen Tore auf die neue Position.</p>'
  + '<p class="dmsg">Satz- und Spielende erkennt die App selbst. <b>Rückgängig</b> nimmt auch über ein Satzende hinweg zurück.</p>'
  + '<p class="dmsg">Ohne Netz zählt die App weiter und holt das Speichern später nach. Die Kopfzeile sagt, wenn etwas aussteht.</p>');

window.addEventListener('online', ()=>{ if(P) pFlush() });

/* ---------- Lobby: Mitspieler per Code ----------
   Ein Bildschirm für beide Seiten. Der Host ordnet zu und startet, die anderen
   sehen die Aufstellung und können wieder aussteigen. Solange die Lobby offen
   ist, wird alle 3 s nachgesehen, wer dazugekommen ist; läuft das Spiel, reicht
   alle 15 s – sonst würde eine halbe Stunde Spiel hunderte Abfragen kosten. */

async function pOpenLobbyNew(){
  if(pBusy) return; pBusy = true;
  const b = $('#pLobby'); if(b) b.disabled = true;
  try{
    ensureAudio();
    const {sb} = await pSb();
    const {data, error} = await sb.rpc('create_lobby', {
      p_mode:PL.cfg.mode, p_detail:PL.cfg.detail,
      p_goals_per_set:PL.cfg.gps, p_sets_to_win:PL.cfg.stw, p_group_id:null});
    if(error) throw error;
    await pOpenLobby(data.id);
  }catch(e){ toast(errText(e, 'Lobby konnte nicht geöffnet werden')) }
  finally{ pBusy = false; if(b) b.disabled = false }
}

async function pJoin(){
  const v = await askText('Einem Spiel beitreten',
    {placeholder:'6-stelliger Code', max:6, ok:'Beitreten',
     hint:'Der Code steht auf dem Gerät des Hosts. Er gilt nur, solange die Lobby offen ist.'});
  if(v === null) return;
  const code = v.replace(/\D/g, '');
  if(code.length !== 6){ toast('Der Code besteht aus 6 Ziffern'); return }
  if(!PL.me){ toast('Lege zuerst einen Nickname fest'); return }
  try{
    const {sb} = await pSb();
    const {data, error} = await sb.rpc('join_match_by_code', {p_code:code});
    if(error) throw error;
    await pOpenLobby(data);
  }catch(e){ toast(errText(e, 'Beitritt nicht möglich')) }
}

async function pLobbyLoad(id){
  const {sb} = await pSb();
  const [m, mp] = await Promise.all([
    sb.from('matches').select('id,host_id,mode,detail,goals_per_set,sets_to_win,state,join_code').eq('id', id).single(),
    sb.from('match_players').select('player_id,team,position,is_host').eq('match_id', id)]);
  if(m.error) throw m.error; if(mp.error) throw mp.error;
  const ids = mp.data.map(x=>x.player_id);
  const nm = {};
  if(ids.length){
    const {data:names} = await sb.from('players').select('id,nickname').in('id', ids);
    (names||[]).forEach(p=>nm[p.id]=p.nickname);
  }
  L = {id, host:m.data.host_id, mode:m.data.mode, detail:m.data.detail,
       gps:m.data.goals_per_set, stw:m.data.sets_to_win, state:m.data.state,
       code:m.data.join_code,
       players:mp.data.map(x=>Object.assign({}, x, {nickname:nm[x.player_id]||'?'}))};
  return L;
}
function pIsHost(){ return !!(L && PL.me && L.host === PL.me.id) }

async function pOpenLobby(id){
  try{
    await pLobbyLoad(id);
    renderLobby(); show('lobby'); pLobbyPoll();
  }catch(e){ toast(errText(e, 'Lobby konnte nicht geöffnet werden')) }
}

function pLobbyStop(){ clearTimeout(lobTimer); lobTimer = 0 }
function pLobbyPoll(){
  pLobbyStop();
  if(!L || $('#lobby').classList.contains('hidden')) return;
  lobTimer = setTimeout(async ()=>{
    if(!L || $('#lobby').classList.contains('hidden')) return;
    try{
      const before = L.state;
      await pLobbyLoad(L.id);
      // Host: sobald es läuft, direkt ins Zählen
      if(pIsHost() && L.state === 'running'){ const id = L.id; L = null; pLobbyStop(); return pOpen(id) }
      if(L.state !== before || true) renderLobby();
    }catch(e){ /* offline: beim nächsten Durchgang erneut */ }
    pLobbyPoll();
  }, L.state === 'lobby' ? 3000 : 15000);
}

function renderLobby(){
  if(!L) return;
  const host = pIsHost(), need = L.mode === 'single' ? 1 : 2;
  const pos = L.detail === 'full' && L.mode === 'double';
  $('#lobTitle').textContent = L.state === 'lobby' ? 'Lobby' : L.state === 'running' ? 'Spiel läuft' : 'Spiel';
  let h = '';

  if(L.state === 'lobby'){
    if(host && L.code)
      h += '<div class="card codecard"><h2>Code zum Beitreten</h2><div class="code">' + esc(L.code) + '</div>'
        + '<p class="hint">Die anderen öffnen die App, tippen auf „Einem Spiel beitreten“ und geben diesen Code ein. '
        + 'Mit dem Start wird er ungültig.</p></div>';
    else if(!host)
      h += '<div class="card"><h2>Du bist dabei</h2><p class="lead">Der Host stellt die Teams zusammen und startet. '
        + 'Danach zählt er die Tore – auf deinem Gerät passiert währenddessen nichts.</p></div>';
  } else if(L.state === 'running'){
    h += '<div class="card"><h2>Das Spiel läuft</h2><p class="lead">Der Host zählt die Tore. '
      + 'Sobald das Spiel vorbei ist, findest du es in deiner Liste.</p></div>';
  } else {
    h += '<div class="card"><h2>' + (L.state === 'cancelled' ? 'Abgebrochen' : 'Beendet') + '</h2>'
      + '<p class="lead">' + (L.state === 'cancelled'
        ? 'Der Host hat das Spiel abgebrochen, es wird nicht gewertet.'
        : 'Das Spiel ist durch.') + '</p></div>';
  }

  // Aufstellung, je Team
  h += '<div class="card"><h2>Aufstellung</h2>';
  for(const t of [1,2]){
    const ps = L.players.filter(p=>p.team===t);
    h += '<div class="blockh">Team ' + t + '</div>';
    for(const p of ps){
      h += '<div class="lrow"><b>' + esc(p.nickname) + (p.is_host ? ' <small>Host</small>' : '') + '</b>';
      if(host && L.state === 'lobby'){
        if(pos) h += '<button class="lbtn" data-pos="' + p.player_id + '">'
          + (p.position === 'def' ? 'Abwehr' : 'Sturm') + '</button>';
        h += '<button class="lbtn" data-team="' + p.player_id + '">Team ' + (t === 1 ? 2 : 1) + '</button>';
        if(!p.is_host) h += '<button class="lbtn del" data-rm="' + p.player_id + '" aria-label="Entfernen">✕</button>';
      } else if(pos){
        h += '<span class="lpos">' + (p.position === 'def' ? 'Abwehr' : 'Sturm') + '</span>';
      }
      h += '</div>';
    }
    for(let i = ps.length; i < need; i++){
      h += '<div class="lrow empty"><b>Noch frei</b>'
        + (host && L.state === 'lobby' ? '<button class="lbtn" data-guest="' + t + '">Gast einsetzen</button>'
                                       : '<span class="lpos">wartet</span>') + '</div>';
    }
  }
  h += '</div>';

  if(L.state === 'lobby'){
    const full = [1,2].every(t=>L.players.filter(p=>p.team===t).length === need);
    const posOk = !pos || [1,2].every(t=>{
      const ps = L.players.filter(p=>p.team===t);
      return ps.filter(p=>p.position==='off').length === 1 && ps.filter(p=>p.position==='def').length === 1;
    });
    if(host){
      h += '<button class="big primary" id="lobStart"' + (full && posOk ? '' : ' disabled') + '>Spiel starten</button>';
      if(!full) h += '<p class="hint">Es fehlen noch Mitspieler. Du kannst freie Plätze auch mit Gästen auffüllen.</p>';
      else if(!posOk) h += '<p class="hint">Je Team werden einmal Sturm und einmal Abwehr gebraucht.</p>';
      h += '<button class="big danger" id="lobCancel">Lobby abbrechen</button>';
    } else {
      h += '<button class="big" id="lobLeave">Spiel verlassen</button>';
    }
  } else {
    h += '<button class="big" id="lobBack">Zurück</button>';
  }
  $('#lobBody').innerHTML = h;

  const on = (id, fn)=>{ const e = $('#'+id); if(e) e.onclick = fn };
  on('lobStart', pStartMatch);
  on('lobCancel', pCancelLobby);
  on('lobLeave', pLeaveMatch);
  on('lobBack', ()=>{ L = null; pLobbyStop(); go('play') });
}

$('#lobBody').addEventListener('click', async e=>{
  const b = e.target.closest('[data-team],[data-pos],[data-rm],[data-guest]');
  if(!b || !L || !pIsHost() || L.state !== 'lobby') return;
  try{
    const {sb} = await pSb();
    if(b.dataset.team){
      const p = L.players.find(x=>x.player_id===b.dataset.team);
      const r = await sb.from('match_players').update({team: p.team === 1 ? 2 : 1})
        .eq('match_id', L.id).eq('player_id', p.player_id);
      if(r.error) throw r.error;
    } else if(b.dataset.pos){
      const p = L.players.find(x=>x.player_id===b.dataset.pos);
      const r = await sb.from('match_players').update({position: p.position === 'off' ? 'def' : 'off'})
        .eq('match_id', L.id).eq('player_id', p.player_id);
      if(r.error) throw r.error;
    } else if(b.dataset.rm){
      const r = await sb.from('match_players').delete()
        .eq('match_id', L.id).eq('player_id', b.dataset.rm);
      if(r.error) throw r.error;
    } else if(b.dataset.guest){
      const g = await pLobbyPickGuest();
      if(!g) return;
      const t = +b.dataset.guest;
      const taken = L.players.filter(p=>p.team===t).map(p=>p.position);
      const r = await sb.from('match_players').insert({match_id:L.id, player_id:g.id, team:t,
        position: (L.detail==='full'&&L.mode==='double') ? (taken.includes('off') ? 'def' : 'off') : null});
      if(r.error) throw r.error;
    }
    await pLobbyLoad(L.id); renderLobby();
  }catch(err){ toast(errText(err, 'Änderung nicht möglich')) }
});

/* Gast für einen freien Platz wählen – wie beim direkten Spiel, aber ohne feste Plätze */
async function pLobbyPickGuest(){
  const drin = L.players.map(p=>p.player_id);
  const list = PL.guests.filter(g=>!drin.includes(g.id));
  const rows = list.length
    ? list.map(p=>'<button class="pickrow" data-pid="'+p.id+'">'+esc(p.nickname)+'<small>Gast</small></button>').join('')
    : '<p class="dmsg">Kein freier Gast. Leg einen neuen an.</p>';
  let chosen = null;
  const v = await dlg('<h3 class="dtitle">Gast einsetzen</h3><div class="picklist">' + rows + '</div>',
    [{t:'Neuer Gast', v:'new', cls:'primary'}, {t:'Abbrechen', v:null, cancel:true}],
    o => o.addEventListener('click', ev=>{
      const b = ev.target.closest('[data-pid]'); if(!b) return;
      chosen = b.dataset.pid; o.querySelector('.dbtns [data-i="1"]').click();
    }));
  if(chosen) return PL.guests.find(g=>g.id===chosen);
  if(v === 'new') return await pAddGuest();
  return null;
}

async function pStartMatch(){
  if(!L || pBusy) return; pBusy = true;
  const b = $('#lobStart'); if(b) b.disabled = true;
  try{
    ensureAudio();
    const {sb} = await pSb();
    const {error} = await sb.rpc('start_match', {p_match:L.id});
    if(error) throw error;
    const id = L.id; L = null; pLobbyStop();
    await pOpen(id);
  }catch(e){ toast(errText(e, 'Start nicht möglich')); if(b) b.disabled = false }
  finally{ pBusy = false }
}

async function pCancelLobby(){
  if(!L) return;
  if(!await ask('Die Lobby wird geschlossen, der Code gilt nicht mehr. Beigetretene Mitspieler sind wieder raus.',
    {title:'Lobby abbrechen?', ok:'Abbrechen', danger:true})) return;
  try{ const {sb} = await pSb(); await sb.from('matches').update({state:'cancelled', join_code:null}).eq('id', L.id) }
  catch(e){ toast(errText(e, 'Nicht möglich')); return }
  L = null; pLobbyStop(); go('play');
}

async function pLeaveMatch(){
  if(!L) return;
  if(!await ask('Du bist dann nicht mehr Teil dieses Spiels.', {title:'Spiel verlassen?', ok:'Verlassen'})) return;
  try{ const {sb} = await pSb(); const {error} = await sb.rpc('leave_match', {p_match:L.id}); if(error) throw error }
  catch(e){ toast(errText(e, 'Nicht möglich')); return }
  L = null; pLobbyStop(); go('play');
}
