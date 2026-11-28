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
const PL0 = () => ({uid:null, me:null, guests:[], cfg:{mode:'double',detail:'full',gps:5,stw:2,invite:false,cat:'ranked',winBy:1,scope:'decider',cap:null,draw:false},
                    presets:[],
                    lineup:[null,null,null,null], queue:[]});
let PL = Object.assign(PL0(), load(LS_PLAY, {}));
if(!Array.isArray(PL.lineup) || PL.lineup.length !== 4) PL.lineup=[null,null,null,null];
if(!Array.isArray(PL.queue)) PL.queue=[];
if(!Array.isArray(PL.guests)) PL.guests=[];
if(PL.cfg.cat !== 'casual') PL.cfg.cat = 'ranked';
PL.cfg = Object.assign({winBy:1, scope:'decider', cap:null, draw:false}, PL.cfg);
if(!Array.isArray(PL.presets)) PL.presets = [];
let pRulesOpen = false;   // Regel-Bereich beim Anlegen aufgeklappt?
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
  if(!PL.me) return PL.guests;
  const {sb} = await pSb();
  // Nur eigene Gäste: Sichtbar sind auch die Gäste anderer Hosts aus gemeinsamen
  // Spielen – die gehören nicht in meine Auswahl (und create_match würde sie ablehnen).
  const {data, error} = await sb.from('players').select('id,nickname')
    .eq('kind','guest').eq('owner_id', PL.me.id).is('deleted_at', null).order('nickname');
  if(error) throw error;
  PL.guests = data || []; savePL();
  return PL.guests;
}

const NICK_HINT = 'Dein Nickname ist für Mitspieler sichtbar – nimm nicht deinen vollen Namen. '
  + '3 bis 20 Zeichen, und er muss noch frei sein.';

/* Mehr › Profil: Nickname und Rangliste, wenn angemeldet */
var PROF = {busy:false, loaded:false, err:''};
function renderProf(){
  const el = $('#prof'); if(!el) return;
  if(!pLoggedIn()){ PROF.loaded = false; el.classList.add('hidden'); return }
  el.classList.remove('hidden');
  const me = PL.me;
  if(!me && !PROF.loaded){
    el.innerHTML = '<h2>Spieler-Profil</h2><p class="hint" style="margin:0">' + esc(PROF.err || 'Lade …') + '</p>';
    if(!PROF.busy){
      PROF.busy = true;
      pLoadMe().then(()=>{ PROF.err = '' }).catch(e=>{ PROF.err = errText(e) })
        .finally(()=>{ PROF.busy = false; PROF.loaded = true; renderProf(); applySetView() });
    }
    return;
  }
  el.innerHTML = '<h2>Spieler-Profil</h2>'
    + '<div class="kv"><span>Nickname</span><b>' + (me ? esc(me.nickname) : '–') + '</b></div>'
    + '<button class="big" id="profNick">' + (me ? 'Nickname ändern' : 'Nickname wählen') + '</button>'
    + (me ? '<div class="kv"><span>In der Rangliste</span><b>' + (me.ranking_opt_in ? 'ja' : 'nein') + '</b></div>'
      + '<button class="big" id="profRank">' + (me.ranking_opt_in ? 'Aus der Rangliste nehmen' : 'In der Rangliste erscheinen') + '</button>'
      + '<p class="hint">Mitspieler sehen deinen Nickname. In der Rangliste sieht jeder Nutzer Nickname, Wertung und Bilanz – nur mit deiner Zustimmung, jederzeit widerrufbar.</p>' : '');
  $('#profNick').onclick = async ()=>{ if(await pSetNickname()){ renderProf(); applySetView() } };
  if(me) $('#profRank').onclick = async ()=>{ await bzToggleOptIn(); renderProf() };
}

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
    hint:'Gäste spielen ohne eigenes Konto mit. Nimm Vorname oder Kürzel – der Name ist für deine Mitspieler sichtbar. '
      + 'Er muss nur unter deinen eigenen Gästen eindeutig sein.'});
  if(v === null) return null;
  const nick = v.trim();
  if(nick.length < 2){ toast('Mindestens 2 Zeichen'); return null }
  try{
    const {sb} = await pSb();
    const {data, error} = await sb.from('players')
      .insert({owner_id:PL.me.id, nickname:nick, kind:'guest'}).select('id,nickname').single();
    if(error) throw error;
    PL.guests.push(data); PL.guests.sort((a,b)=>a.nickname.localeCompare(b.nickname,'de')); savePL();
    return data;
  }catch(e){
    toast(/duplicate|unique/i.test(String(e.message||e))
      ? 'Du hast schon einen Gast „' + nick + '“ – unterscheide ihn, z. B. „' + nick + ' M.“' : errText(e,'Nicht angelegt'));
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
      'Gemeinsame Gästeliste, Stellvertreter, eigene Rangliste je Gruppe.']}}[id];
  $('#'+id+'Body').innerHTML = '<div class="card">' + x.p.map(t=>'<p class="lead">'+t+'</p>').join('')
    + '</div><p class="hint">Kommt in einem späteren Schritt. Zum Üben geht es über den Umschalter links unten.</p>';
}

function pStepHint(){
  return '<p class="hint">Spiele mit Gästen erfassen, Mitspieler per Code einladen, Ergebnisse bestätigen lassen. '
    + 'Gruppen kommen in einem späteren Schritt.</p>';
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
    $('#pToAcct').onclick = ()=>{ go('settings'); setView('profil') };
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
  h += rlPresetBar();
  h += '<div class="sub"><label>Modus ' + tipBtn('pMode') + '</label><div class="chips sc" id="pcMode"></div></div>';
  h += '<div class="sub"><label>Erfassung ' + tipBtn('pDetail') + '</label><div class="chips sc" id="pcDetail"></div>'
     + '<p class="hint" id="pcDetailHint"></p></div>';
  h += '<div class="sub"><label>Satz bis … Tore</label><div id="pcGps"></div></div>';
  h += '<div class="sub"><label>Spiel bis … Gewinnsätze</label><div class="chips sc" id="pcStw"></div>'
     + '<p class="hint" id="pcStwHint"></p></div>';
  const rr = rlFromCfg(c);
  h += '<div class="sub"><label>Regeln ' + tipBtn('rlRules') + '</label>'
     + '<button class="rltog" id="pRulesTog"><span>' + esc(rlText(rr, c.gps, c.stw)) + '</span><i>' + (pRulesOpen ? '▴' : '▾') + '</i></button>'
     + (pRulesOpen ? '<div id="pRules" class="rlbox"></div>' : '') + '</div>';
  h += '<div class="sub"><label>Art ' + tipBtn('pCat') + '</label><div class="chips sc" id="pcCat"></div>'
     + '<p class="hint" id="pcCatHint"></p></div>';
  h += '<div class="sub"><label>Mitspieler ' + tipBtn('pJoin') + '</label><div class="chips sc" id="pcInvite"></div>'
     + '<p class="hint" id="pcInviteHint"></p></div>';
  if(!c.invite)
    h += '<div class="sub"><label>Aufstellung ' + tipBtn('pLineup') + '</label><div class="lineup" id="pLineup"></div></div>';
  if(c.invite) h += '<button class="big primary" id="pLobby">Lobby öffnen</button>';
  else {
    h += '<button class="big primary" id="pStart"' + (ready ? '' : ' disabled') + '>Spiel starten</button>';
    if(!ready) h += '<p class="hint" style="margin-bottom:0">Alle Plätze besetzen – du musst selbst dabei sein.</p>';
  }
  h += '</div><div id="pOff"></div><div id="pTodo"></div><div id="pRunning"></div>'
     + '<div class="card"><h2>Mitspielen</h2><p class="lead">Jemand anderes hostet? Dann brauchst du nur seinen sechsstelligen Code.</p>'
     + '<button class="big" id="pJoinBtn">Einem Spiel beitreten</button></div>'
     + '<div id="pRecent"></div>';
  el.innerHTML = h + pStepHint();

  $('#pNick2').onclick = async ()=>{ if(await pSetNickname()) renderPlayHome() };
  offRenderCard(); offUpload();
  rlWirePresets();
  $('#pRulesTog').onclick = ()=>{ pRulesOpen = !pRulesOpen; renderPlayHome() };
  if($('#pRules')) rlFields($('#pRules'), c, ()=>{ savePL(); renderPlayHome() });
  chips($('#pcMode'), [{v:'single',t:'Einzel 1:1'},{v:'double',t:'Doppel 2:2'}], v=>c.mode===v,
    v=>{ c.mode=v; if(v==='single'){PL.lineup[1]=null;PL.lineup[3]=null} savePL() }, renderPlayHome);
  chips($('#pcDetail'), [{v:'simple',t:'Einfach'},{v:'full',t:'Erweitert'}], v=>c.detail===v,
    v=>{ c.detail=v; savePL() }, renderPlayHome);
  slider($('#pcGps'), {min:3, max:15, step:1, value:c.gps, fmt:n=>n+' Tore',
    onInput:v=>{ c.gps=v; if(c.cap && c.cap <= v) c.cap = null; savePL() }, after:renderPlayHome});
  chips($('#pcStw'), [1,2,3].map(n=>({v:n,t:n===1?'Nur ein Satz':n+' Gewinnsätze'})), v=>c.stw===v,
    v=>{ c.stw=v; savePL() }, renderPlayHome);
  $('#pcDetailHint').textContent = c.detail === 'full'
    ? 'Jedes Tor einzeln mit Torschütze' + (c.mode==='double' ? ' und Position' : '') + '. Ein Tipp pro Tor.'
    : 'Nur der Spielstand. Weniger tippen, dafür keine Torschützen-Statistik.';
  $('#pcStwHint').textContent = c.stw === 1 ? 'Ein Satz bis ' + c.gps + ' Tore, dann ist Schluss.'
    : 'Wer zuerst ' + c.stw + ' Sätze hat, gewinnt – also höchstens ' + (c.stw*2-1) + ' Sätze.';

  chips($('#pcCat'), [{v:'ranked',t:'Wertung'},{v:'casual',t:'Locker'}], v=>c.cat===v,
    v=>{ c.cat=v; savePL() }, renderPlayHome);
  $('#pcCatHint').textContent = c.cat === 'casual'
    ? 'Zählt nur für deine Bilanz, nicht für Wertungen.' : 'Zählt für die Wertung und für deine Bilanz.';
  chips($('#pcInvite'), [{v:false,t:'Nur Gäste'},{v:true,t:'Per Code einladen'}], v=>!!c.invite===v,
    v=>{ c.invite=v; savePL() }, renderPlayHome);
  $('#pcInviteHint').textContent = c.invite
    ? 'Die App zeigt einen Code. Wer ihn eingibt, spielt mit eigenem Konto mit. Freie Plätze kannst du mit Gästen auffüllen.'
    : 'Du trägst alle Mitspieler selbst ein, das Spiel beginnt sofort.';
  $('#pJoinBtn').onclick = pJoin;
  if(c.invite){ $('#pLobby').onclick = pOpenLobbyNew; pLoadTodo(); pLoadRunning(); pLoadRecent();
    if(!pMeLoaded){ pMeLoaded = true; pLoadMe().then(()=>pLoadGuests()).then(()=>renderPlayHome()).catch(()=>{}) }
    return; }
  $('#pLineup').innerHTML = pSlots().map(i=>{
    const id = PL.lineup[i];
    return '<button class="slot' + (id?' set':'') + '" data-slot="' + i + '">'
      + '<small>' + pSlotLabel(i) + '</small><b>' + (id ? esc(pName(id)) : 'Wählen …') + '</b></button>';
  }).join('');
  $('#pLineup').onclick = e=>{ const b = e.target.closest('[data-slot]'); if(b) pPick(+b.dataset.slot) };
  $('#pStart').onclick = pStart;

  pLoadTodo();
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
      .select('id,host_id,mode,detail,state,category,finished_at,match_sets(set_no,score1,score2,winner_team)')
      .in('id', ids).in('state',['finished','confirmed','disputed'])
      .order('finished_at',{ascending:false}).limit(10);
    if(!data || !data.length){ el.innerHTML=''; return }
    el.innerHTML = '<div class="card"><h2>Letzte Spiele</h2>' + data.map(m=>{
      const s = (m.match_sets||[]).slice().sort((a,b)=>a.set_no-b.set_no);
      const w1 = s.filter(x=>x.winner_team===1).length, w2 = s.filter(x=>x.winner_team===2).length;
      return '<div class="mrow" data-mid="' + m.id + '"><div><b>' + w1 + ' : ' + w2 + '</b>'
        + '<small>' + (m.mode==='single'?'Einzel':'Doppel')
        + (m.host_id === PL.me.id ? '' : ' · als Mitspieler') + ' · '
        + s.map(x=>x.score1+':'+x.score2).join('  ') + (m.category === 'casual' ? ' · locker' : '')
        + '</small>' + pStateBadge(m.state) + '</div>'
        + '<span>' + (m.finished_at ? fmtDate(Date.parse(m.finished_at), true) : '') + '</span></div>';
    }).join('') + '</div>';
    el.querySelectorAll('[data-mid]').forEach(r=>r.onclick = ()=>pOpenLobby(r.dataset.mid));
  }catch(e){ /* offline */ }
}

async function pStart(){
  if(pBusy) return; pBusy = true;
  ensureAudio();   // im Tap: entsperrt den Ton auf iOS
  const b = $('#pStart'); if(b) b.disabled = true;
  // Die Nummer entsteht auf dem Gerät. So kann ein Spiel auch ohne Netz beginnen
  // und später unter derselben Nummer hochgeladen werden.
  const id = offNewId();
  const players = pSlots().map(i=>({player_id:PL.lineup[i], team:i<2?1:2,
    position:PL.cfg.mode==='double' ? (i%2===0?'off':'def') : null}));
  try{
    if(!navigator.onLine) throw new Error('offline');
    const {sb} = await pSb();
    const {data, error} = await offTimeout(sb.rpc('create_match', {
      p_mode:PL.cfg.mode, p_detail:PL.cfg.detail,
      p_goals_per_set:PL.cfg.gps, p_sets_to_win:PL.cfg.stw,
      p_group_id:null, p_players:players, p_category:PL.cfg.cat, p_rules:rlFromCfg(PL.cfg), p_id:id}), 8000);
    if(error) throw error;
    await pOpen(data.id);
  }catch(e){
    if(offIsNet(e)) offStart(id, players);
    else toast(errText(e, 'Spiel konnte nicht angelegt werden'));
  }finally{ pBusy = false; if(b) b.disabled = false }
}

/* ---------- Zählen ---------- */
async function pOpen(id){
  ensureAudio();
  try{
    const {sb} = await pSb();
    const [m, mp, st] = await Promise.all([
      sb.from('matches').select('*').eq('id', id).single(),
      sb.from('match_players').select('player_id,team,position,is_host,device').eq('match_id', id),
      sb.rpc('match_state', {p_match:id})]);
    if(m.error) throw m.error; if(mp.error) throw mp.error; if(st.error) throw st.error;
    // Namen der Mitspieler: Gäste stehen evtl. noch nicht im lokalen Puffer
    const ids = mp.data.map(x=>x.player_id);
    // kind wird gebraucht, um zu wissen, wer überhaupt bestätigen kann.
    // user_id wird bewusst NICHT geladen – die geht Mitspieler nichts an.
    const {data:names} = await sb.from('players').select('id,nickname,kind,deleted_at').in('id', ids);
    const nm = {}; (names||[]).forEach(p=>nm[p.id]=p);
    P = {id, mode:m.data.mode, detail:m.data.detail, gps:m.data.goals_per_set, stw:m.data.sets_to_win,
         host:m.data.host_id, rev:m.data.rev, finished_at:m.data.finished_at, cat:m.data.category || 'ranked',
         rules:rlFromMatch(m.data), flip:!!(P && P.id === id && P.flip),
         players:mp.data.map(x=>Object.assign({}, x, {
           nickname:(nm[x.player_id]||{}).nickname||'?',
           kind:(nm[x.player_id]||{}).kind, deleted_at:(nm[x.player_id]||{}).deleted_at})),
         st:st.data, own:false};
    // Tipps anderer Spiele bleiben stehen: pFlush schickt sie mit (früher gingen sie hier verloren)
    wake(true); renderMatch(); show('match');
    pFlush(); pHostPoll();
  }catch(e){ toast(errText(e, 'Spiel konnte nicht geöffnet werden')) }
}

// Sturm immer oben, damit die Kacheln nicht je nach Datenbank-Reihenfolge springen
function pTeam(t){ return P.players.filter(p=>p.team===t)
  .slice().sort((a,b)=>(a.position==='off'?0:1)-(b.position==='off'?0:1)) }
function pSlotOf(p){ return p.position === 'off' ? 'Sturm' : p.position === 'def' ? 'Abwehr' : '' }

function renderMatch(){
  if(!P) return;
  const s = P.st, done = s.match_done;
  const L1 = P.flip ? 2 : 1, R1 = P.flip ? 1 : 2;       // welches Team links/rechts steht
  const sc = t => t === 1 ? s.score1 : s.score2, st = t => t === 1 ? s.sets1 : s.sets2;
  const decider = s.sets1 === P.stw - 1 && s.sets2 === P.stw - 1;
  $('#mHead').innerHTML = '<button class="mhbtn" id="mFlip" aria-label="Seiten tauschen">⇆ <small>Seiten</small></button>'
    + '<div class="msets">' + (done ? (s.draw || (s.sets||[]).some(x=>x.winner_team===0) ? 'Unentschieden' : 'Spiel beendet')
        : (P.stw > 1 ? '<span>Sätze</span><b>' + st(L1) + ' : ' + st(R1) + '</b><span>Satz ' + s.set_no + (decider ? ' · Entscheidung' : '') + '</span>'
                     : '<span>Satz bis ' + P.gps + '</span>'))
    + '</div><button class="mhbtn" id="mRules" aria-label="Regeln">⚙ <small>' + esc('bis ' + P.gps) + '</small></button>';
  $('#mScore').innerHTML = '<b>' + sc(L1) + '</b><i>:</i><b>' + sc(R1) + '</b>';
  $('#mFlip').onclick = ()=>{ P.flip = !P.flip; renderMatch() };
  $('#mRules').onclick = pEditRulesMatch;
  const q = pQueued();
  $('#mSync').textContent = P.off ? 'Offline-Spiel · wird hochgeladen, sobald Netz da ist'
    : q === 0 ? ''
    : q === 1 ? '1 Tipp noch nicht gespeichert – wird nachgeholt'
    : q + ' Tipps noch nicht gespeichert – werden nachgeholt';
  $('#mSync').classList.toggle('hidden', !q && !P.off);

  const tile = p => '<button class="ptile" data-pid="' + p.player_id + '" data-team="' + p.team + '">'
    + '<b>' + esc(p.nickname) + '</b>' + (pSlotOf(p) ? '<small>' + pSlotOf(p) + '</small>' : '')
    + (p.device && p.player_id !== P.host ? '<small class="pdev">📱 ' + pDevText(p.device) + '</small>' : '') + '</button>';
  const teamCol = t => {
    if(P.detail === 'simple')
      return '<div class="tcol"><button class="ptile big2" data-team="' + t + '"><b>Team ' + t + '</b>'
        + '<small>' + pTeam(t).map(p=>esc(p.nickname)).join(' · ') + '</small>'
        + (pTeam(t).some(p=>p.device && p.player_id !== P.host) ? '<small class="pdev">📱 zählt selbst</small>' : '')
        + '</button></div>';
    return '<div class="tcol">' + pTeam(t).map(tile).join('')
      + (P.mode==='double' ? '<button class="swapbtn" data-swap="' + t + '">' + icon('swap') + ' tauschen</button>' : '')
      + '</div>';
  };
  $('#mArea').innerHTML = teamCol(L1) + '<div class="tsep"></div>' + teamCol(R1);
  $('#mArea').classList.toggle('off', done);
  $('#mOwn').classList.toggle('on', !!P.own);
  $('#mOwn').classList.toggle('hidden', P.detail !== 'full' || done);
  $('#mEnd').textContent = done ? 'Auswertung' : 'Ende';
}

/* Lokale Vorhersage – dieselben Regeln wie record_goal auf dem Server.
   Sobald der Server antwortet, gilt seine Antwort. */
function pPredict(team){ P.st = rlPredict(P.st, P.rules, P.gps, P.stw, team) }

function pGoal(team, scorer, position){
  if(!P || P.st.match_done) return;
  const own = !!P.own; P.own = false;
  const credit = own ? (team===1?2:1) : team;
  beep(own?520:880, .07, .25);
  if(P.off) return offGoal({team:credit, scorer:scorer||null, position:position||null, own, t:Date.now()});
  const prev = P.st;   // für „Rückgängig“ ohne Netz: Stand vor diesem Tipp
  pPredict(credit);
  PL.queue.push({match:P.id, kind:'goal', team:credit, scorer:scorer||null,
                 position:position||null, own, t:Date.now(), prev});
  savePL(); renderMatch(); pFlush();
}
function pUndo(){
  if(!P) return;
  if(P.off) return offUndo();
  // Noch nicht gesendet: einfach wegnehmen – aber nur einen Tipp DIESES Spiels
  const qi = PL.queue.map(q=>q.match).lastIndexOf(P.id);
  if(qi >= 0){
    const q = PL.queue.splice(qi, 1)[0]; savePL();
    if(q.kind === 'goal' && q.prev) P.st = q.prev;   // sofort richtig, auch ohne Netz
    pRefresh(); return }
  PL.queue.push({match:P.id, kind:'undo', t:Date.now()}); savePL(); renderMatch(); pFlush();
}

/* Wie viele Tipps des offenen Spiels warten noch? */
function pQueued(){ return P ? PL.queue.filter(q=>q.match === P.id).length : 0 }
/* Warteschlange abarbeiten. Streng der Reihe nach, damit die Reihenfolge stimmt. */
let pFlushing = false;
async function pFlush(){
  if(pFlushing) return;
  if(!PL.queue.length) return;
  pFlushing = true;
  let last = null;
  try{
    const {sb} = await pSb();
    // Alle Spiele der Reihe nach, auch ältere. Den Stand übernimmt nur das offene.
    while(PL.queue.length){
      const a = PL.queue[0];
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
      if(P && a.match === P.id) last = r.data;
    }
    // Erst ganz am Ende übernehmen, und nur wenn nichts mehr aussteht. Sonst würde
    // eine ältere Serverantwort einen neueren lokalen Stand überschreiben.
    if(P && last && !pQueued()) P.st = last;
    renderMatch();
    if(P && last && P.st.match_done) pSummary();
  }catch(e){
    renderMatch();            // Warteschlange bleibt, Kopfzeile zeigt sie an
  }finally{ pFlushing = false }
}
async function pRefresh(){
  try{ const {sb} = await pSb();
    const {data, error} = await sb.rpc('match_state', {p_match:P.id});
    if(!error && P && !pQueued()) P.st = data;   // ausstehende Tipps nicht überschreiben
  }catch(e){}
  renderMatch();
}

/* ---------- Auswertung ---------- */
async function pSummary(){
  if(!P) return;
  // Zustand und Spielende frisch holen: Beides entsteht erst mit dem letzten Tor,
  // und davon hängt ab, ob noch korrigiert werden darf.
  if(P.off) P.state = 'offline';
  else try{ const {sb} = await pSb();
    const {data} = await sb.from('matches').select('state,finished_at,rev').eq('id', P.id).single();
    if(data){ P.state = data.state; P.finished_at = data.finished_at; P.rev = data.rev }
  }catch(e){}
  let goals = [];
  if(P.detail === 'full' && P.off){
    const om = offGet(P.id);
    goals = (om ? om.goals : []).map(g=>({scorer_id:g.scorer, scorer_position:g.position, own_goal:!!g.own}));
  } else if(P.detail === 'full'){
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
    + (sets.some(x=>x.winner_team===0) ? '<p class="center"><b>Unentschieden</b></p>' : '')
    + '<p class="center">' + sets.map(x=>x.score1+':'+x.score2).join(' · ') + '</p></div></div>';
  h += kv('Teams', pTeam(1).map(p=>esc(p.nickname)).join(' & ') + '  gegen  ' + pTeam(2).map(p=>esc(p.nickname)).join(' & '));
  h += kv('Art', P.cat === 'casual' ? 'locker' : 'Wertung');
  h += kv('Regeln', esc(rlText(P.rules, P.gps, P.stw)));
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
  // Bestätigungslage: Ein Spiel aus Host und Gästen steht sofort auf 'confirmed'.
  // Sonst fehlt noch das Wort der Gegenseite.
  if(P.state === 'confirmed'){
    h += '<div class="blockh">Wertung</div>' + kv('Stand', 'bestätigt und wertbar');
    // Elo entsteht auf dem Server in derselben Bewegung wie die Bestätigung
    if(P.cat !== 'casual' && PL.me){
      try{ const {sb} = await pSb();
        const {data} = await sb.from('rating_history').select('before,after')
          .eq('match_id', P.id).eq('player_id', PL.me.id).maybeSingle();
        if(data){ const d = Math.round(data.after - data.before);
          h += kv('Deine Wertung', (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d) + ' → ' + Math.round(data.after)) }
        else if([1,2].some(t=>!P.players.some(p=>p.team===t && p.kind==='account')))
          h += '<p class="hint">Zählt nicht für die Wertung: Auf einer Seite spielen nur Gäste, niemand hat gegengeprüft. In deiner Bilanz steht das Spiel trotzdem.</p>';
      }catch(e){}
    }
  } else if(P.state === 'finished'){
    const warte = P.players.filter(p=>p.kind === 'account' && !p.deleted_at
      && p.player_id !== P.host && p.team !== (P.players.find(x=>x.player_id===P.host)||{}).team);
    h += '<div class="blockh">Wertung</div>'
      + kv('Stand', 'wartet auf Bestätigung')
      + '<p class="hint">' + (warte.length
        ? esc(warte.map(p=>p.nickname).join(' oder ')) + ' muss das Ergebnis noch bestätigen, damit es zählt.'
        : 'Die Gegenseite muss das Ergebnis noch bestätigen.') + '</p>';
  } else if(P.state === 'offline'){
    h += '<div class="blockh">Wertung</div>' + kv('Stand', 'noch auf diesem Gerät')
      + '<p class="hint">Wird hochgeladen, sobald Netz da ist. Ein Spiel mit Gästen gilt dann sofort als bestätigt.</p>';
  } else if(P.state === 'disputed'){
    h += '<div class="blockh">Wertung</div>' + kv('Stand', 'strittig')
      + '<p class="hint">Jemand hat widersprochen. Korrigiere das Ergebnis, damit es gewertet werden kann.</p>';
  }

  const left = pFixLeft();
  let foot = '<button class="big primary" id="msumDone">Fertig</button>';
  if(P.off) foot = '<button class="big" id="msumFix">Letztes Tor zurücknehmen</button>' + foot;
  else if(left > 0) foot = '<button class="big" id="msumFix">Ergebnis korrigieren</button>' + foot;
  $('#msumBody').innerHTML = '<div class="sumscroll">' + h + '</div>'
    + '<div class="sumfoot">' + foot + '</div>';
  $('#msummary').classList.remove('hidden');
  $('#msumDone').onclick = ()=>{ $('#msummary').classList.add('hidden'); pClose() };
  const fx = $('#msumFix');
  if(fx) fx.onclick = P.off ? ()=>{ $('#msummary').classList.add('hidden'); offUndo() } : pReopen;
}

function pClose(){
  wake(false); P = null; clearTimeout(hostTimer);
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
  if(P.off){ saveOFF(); return }   // P.players ist die Aufstellung des Offline-Spiels
  pSb().then(({sb})=>sb.rpc('swap_positions', {p_match:P.id, p_team:team}))
    .then(r=>{ if(r.error) throw r.error }).catch(()=>toast('Tausch noch nicht gespeichert'));
}
$('#mUndo').onclick = ()=>pUndo();
async function pEditRulesMatch(){
  if(!P || P.st.match_done) return;
  if(P.off){ info('Offline-Spiel', '<p class="dmsg">Die Regeln eines Offline-Spiels lassen sich nicht ändern. '
    + 'Beim Hochladen rechnet der Server jedes Tor mit genau diesen Regeln nach.</p>'); return }
  if(pQueued()){ toast('Erst müssen alle Tipps gespeichert sein'); return }
  const ch = await rlEditDialog({mode:P.mode, detail:P.detail, gps:P.gps, stw:P.stw, cat:P.cat, rules:P.rules, state:'running'});
  if(!ch) return;
  try{
    const {sb} = await pSb();
    const {data, error} = await sb.rpc('update_match_rules', Object.assign({p_match:P.id}, ch));
    if(error) throw error;
    P.detail = data.detail; P.gps = data.goals_per_set; P.stw = data.sets_to_win; P.rules = rlFromMatch(data);
    const mp = await sb.from('match_players').select('player_id,position').eq('match_id', P.id);
    (mp.data||[]).forEach(x=>{ const p = P.players.find(y=>y.player_id===x.player_id); if(p) p.position = x.position });
    toast('Regeln geändert'); renderMatch();
  }catch(e){ toast(errText(e, 'Nicht geändert')) }
}
$('#mOwn').onclick = ()=>{ if(!P) return; P.own = !P.own; renderMatch();
  if(P.own) toast('Nächster Tipp zählt als Eigentor') };
$('#mEnd').onclick = async ()=>{
  if(!P) return;
  if(P.st.match_done) return pSummary();
  if(!await ask('Das Spiel wird vorzeitig beendet und nicht gewertet.',
    {title:'Spiel beenden?', ok:'Beenden', danger:true})) return;
  if(P.off){ offDrop(P.id); pClose(); return }
  try{ const {sb} = await pSb(); await sb.from('matches').update({state:'cancelled'}).eq('id', P.id) }catch(e){}
  pClose();
};
$('#mInfo').onclick = ()=>info('Zählen',
  '<p class="dmsg">Jeder Tipp auf eine Kachel zählt ein Tor für dieses Team. Bei <b>Erweitert</b> ist die angetippte Person der Torschütze.</p>'
  + '<p class="dmsg"><b>Eigentor</b>: erst antippen, dann die Person, der es passiert ist. Der Punkt geht ans andere Team.</p>'
  + '<p class="dmsg"><b>Tauschen</b> dreht Sturm und Abwehr eines Teams. Ab dann zählen Tore auf die neue Position.</p>'
  + '<p class="dmsg">Satz- und Spielende erkennt die App selbst. <b>Rückgängig</b> nimmt auch über ein Satzende hinweg zurück.</p>'
  + '<p class="dmsg">Ohne Netz zählt die App weiter und holt das Speichern später nach. Die Kopfzeile sagt, wenn etwas aussteht.</p>'
  + '<p class="dmsg"><b>Offline-Spiel</b>: Ohne Netz kannst du auch neue Spiele mit Gästen anlegen, beliebig viele. Sie liegen auf dem Gerät und werden hochgeladen, sobald wieder Netz da ist. Regeln ändern und Mitspieler per Code einladen gehen erst online.</p>');

window.addEventListener('online', ()=>{ pFlush(); offUpload() });

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
      p_goals_per_set:PL.cfg.gps, p_sets_to_win:PL.cfg.stw, p_group_id:null, p_category:PL.cfg.cat,
      p_rules:rlFromCfg(PL.cfg)});
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
  }catch(e){
    if(e && e.code === 'P0001' && /Kein offenes Spiel/i.test(e.message||''))
      info('Keine Lobby gefunden', '<p class="dmsg">Zum Code <b>' + esc(code) + '</b> gibt es keine offene Lobby.</p>'
        + '<p class="dmsg">Prüfe die Ziffern. Der Code gilt nur, solange die Lobby offen ist – sobald der Host startet, ist er ungültig.</p>');
    else toast(errText(e, 'Beitritt nicht möglich'));
  }
}

async function pLobbyLoad(id){
  const {sb} = await pSb();
  const [m, mp] = await Promise.all([
    sb.from('matches').select('id,host_id,mode,detail,goals_per_set,sets_to_win,state,join_code,rev,finished_at,category,win_by,win_by_scope,goal_cap,draw_at').eq('id', id).single(),
    sb.from('match_players').select('player_id,team,position,is_host,device').eq('match_id', id)]);
  if(m.error) throw m.error; if(mp.error) throw mp.error;
  const ids = mp.data.map(x=>x.player_id);
  const nm = {};
  if(ids.length){
    const {data:names} = await sb.from('players').select('id,nickname,kind,deleted_at').in('id', ids);
    (names||[]).forEach(p=>nm[p.id]=p);
  }
  L = {id, host:m.data.host_id, mode:m.data.mode, detail:m.data.detail,
       gps:m.data.goals_per_set, stw:m.data.sets_to_win, state:m.data.state,
       code:m.data.join_code, rev:m.data.rev, finished_at:m.data.finished_at, cat:m.data.category || 'ranked',
       rules:rlFromMatch(m.data),
       players:mp.data.map(x=>Object.assign({}, x, {
         nickname:(nm[x.player_id]||{}).nickname||'?',
         kind:(nm[x.player_id]||{}).kind, deleted_at:(nm[x.player_id]||{}).deleted_at}))};
  // Läuft das Spiel und ich zähle nicht: Spielstand live mitlesen
  if(L.state === 'running'){
    const st = await sb.rpc('match_state', {p_match:id});
    L.live = st.error ? null : st.data;
  }
  // Für ein durchgespieltes Spiel zusätzlich Ergebnis und Bestätigungen
  if(['finished','confirmed','disputed'].includes(L.state)){
    const [ss, cc] = await Promise.all([
      sb.from('match_sets').select('set_no,score1,score2,winner_team').eq('match_id', id).order('set_no'),
      sb.from('match_confirmations').select('player_id,rev,decision,comment,at').eq('match_id', id)]);
    L.sets = ss.data || [];
    L.confs = (cc.data || []).filter(c=>c.rev === L.rev);
  }
  return L;
}
function pIsHost(){ return !!(L && PL.me && L.host === PL.me.id) }

/* Wann gilt ein Team als bestätigt – dieselbe Regel wie team_confirmed() auf dem
   Server. Hier nur zur Anzeige; maßgeblich bleibt der Server. */
function pTeamDone(t){
  if(!L) return false;
  const ps = L.players.filter(p=>p.team===t);
  if(ps.some(p=>p.player_id === L.host)) return true;           // Team des Hosts
  const able = ps.filter(p=>p.kind === 'account' && !p.deleted_at);
  if(!able.length) return true;                                  // nur Gäste
  return (L.confs||[]).some(c=>c.decision==='ok' && able.some(a=>a.player_id===c.player_id));
}
function pMyConf(){ return (L.confs||[]).find(c=>PL.me && c.player_id === PL.me.id) }
function pMyTeam(){ const p = L.players.find(x=>PL.me && x.player_id === PL.me.id); return p ? p.team : null }
function pCanConfirm(){
  if(!L || !PL.me) return false;
  if(!['finished','disputed'].includes(L.state)) return false;
  if(pMyConf()) return false;
  const t = pMyTeam();
  return !!t && !pTeamDone(t);
}
/* Noch wie lange darf der Host korrigieren? Minuten, oder 0. */
function pFixLeft(){
  const src = (L && L.finished_at) || (P && P.finished_at);
  if(!src) return 0;
  return Math.max(0, Math.ceil((Date.parse(src) + 7200000 - Date.now()) / 60000));
}
function pStateBadge(st){
  const t = st === 'confirmed' ? ['ok','✓ bestätigt'] : st === 'disputed' ? ['bad','⚠ strittig']
    : st === 'finished' ? ['wait','⏳ wartet auf Bestätigung'] : ['', pStateText(st)];
  return '<span class="stbadge ' + t[0] + '">' + t[1] + '</span>';
}
function pStateText(st){
  return st === 'confirmed' ? 'bestätigt'
    : st === 'disputed' ? 'strittig'
    : st === 'finished' ? 'wartet auf Bestätigung'
    : st === 'cancelled' ? 'abgebrochen' : st;
}

async function pOpenLobby(id){
  try{
    await pLobbyLoad(id);
    if(L.state === 'running' && !pIsHost() && pMyDevice()) return pMineOpen(id);
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
      // Mitspieler, der selbst zählt: beim Start direkt in die eigene Zählansicht
      if(L.state === 'running' && before === 'lobby' && pMyDevice()){ pLobbyStop(); return pMineOpen(L.id) }
      if(L.state !== before || true) renderLobby();
    }catch(e){ /* offline: beim nächsten Durchgang erneut */ }
    pLobbyPoll();
  }, L.state === 'lobby' ? 3000 : L.state === 'running' && !pIsHost() ? 4000 : 15000);
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
      h += '<div class="card"><h2>Du bist dabei</h2><p class="lead">Der Host stellt die Teams zusammen und startet.</p></div>';
  } else if(L.state === 'running'){
    const lv = L.live, mt = pMyTeam() || 1, ot = mt === 1 ? 2 : 1;
    const sc = t => t === 1 ? lv.score1 : lv.score2, se = t => t === 1 ? lv.sets1 : lv.sets2;
    h += '<div class="card"><h2>Das Spiel läuft · live</h2>'
      + (lv ? '<div class="miscore">' + miTeamHtml(mt, sc(mt), pMyTeam() ? 'Ihr' : 'Team 1', true)
              + '<i>:</i>' + miTeamHtml(ot, sc(ot), pMyTeam() ? 'Gegner' : 'Team 2', false) + '</div>'
            + '<p class="center hint">' + (L.stw > 1 ? 'Sätze ' + se(mt) + ' : ' + se(ot) + ' · ' : '') + 'Satz ' + (lv.set_no || '') + '</p>'
            + (lv.sets||[]).filter(x=>x.winner_team!=null).map(x=>'<p class="center hint" style="margin:2px 0">Satz ' + x.set_no + ': ' + x.score1 + ':' + x.score2 + '</p>').join('')
          : '<p class="lead">Der Host zählt die Tore.</p>')
      + '<p class="hint">Aktualisiert sich alle paar Sekunden.' + (pMyTeam() ? ' Dein Team links.' : '') + '</p></div>';
  } else if(L.state === 'cancelled'){
    h += '<div class="card"><h2>Abgebrochen</h2>'
      + '<p class="lead">Der Host hat das Spiel abgebrochen, es wird nicht gewertet.</p></div>';
  } else {
    // Ergebnis und Bestätigungslage
    const ss = L.sets || [];
    const w1 = ss.filter(x=>x.winner_team===1).length, w2 = ss.filter(x=>x.winner_team===2).length;
    h += '<div class="card"><h2>Ergebnis</h2>'
      + '<div class="bigpct">' + w1 + ' : ' + w2 + '</div>'
      + '<p class="center">' + (ss.length ? ss.map(x=>x.score1+':'+x.score2).join(' · ') : '') + '</p>'
      + '<div class="blockh">Stand</div>'
      + kv('Team 1', pTeamDone(1) ? 'bestätigt' : 'offen')
      + kv('Team 2', pTeamDone(2) ? 'bestätigt' : 'offen');
    const rej = (L.confs||[]).filter(c=>c.decision==='reject');
    if(rej.length){
      const who = rej.map(c=>{const p=L.players.find(x=>x.player_id===c.player_id);return p?p.nickname:'Jemand'});
      h += '<p class="hint">Widerspruch von ' + esc(who.join(', ')) + '. Das Spiel wird nicht gewertet, '
        + 'bis der Host das Ergebnis korrigiert.</p>';
      const cm = rej.find(c=>c.comment);
      if(cm) h += '<p class="hint">„' + esc(cm.comment) + '“</p>';
    }
    h += '</div>';

    if(pCanConfirm()){
      h += '<div class="card"><h2>Stimmt das Ergebnis?</h2>'
        + '<p class="lead">Bestätige es, damit das Spiel gewertet werden kann. Stimmt etwas nicht, '
        + 'widersprich – dann kann der Host es korrigieren.</p>'
        + '<button class="big primary" id="lobOk">Ergebnis bestätigen</button>'
        + '<button class="big danger" id="lobNo">Stimmt nicht</button></div>';
    } else if(pMyConf()){
      h += '<p class="hint">Du hast ' + (pMyConf().decision === 'ok' ? 'bestätigt' : 'widersprochen') + '.</p>';
    }
  }

  // Mitspieler mit Konto: Wie zähle ich mit? (Host zählt immer)
  if(!host && ['lobby','running'].includes(L.state) && pMyTeam()) h += pDevCard();

  // Aufstellung, je Team. Die Art steht dabei, damit jeder vor dem Start weiß, ob es zählt.
  h += '<div class="card"><h2>Aufstellung</h2>'
    + kv('Art', L.cat === 'casual' ? 'locker – zählt nicht für Wertungen' : 'Wertung – zählt')
    + kv(L.mode === 'single' ? 'Einzel' : 'Doppel', esc(rlShort(L.gps, L.stw, L.rules)))
    + (host && L.state === 'lobby' ? '<button class="big" id="lobRules">Einstellungen ändern</button>' : '');
  for(const t of [1,2]){
    const ps = L.players.filter(p=>p.team===t);
    h += '<div class="blockh">Team ' + t + '</div>';
    for(const p of ps){
      h += '<div class="lrow"><b>' + esc(p.nickname) + (p.is_host ? ' <small>Host</small>' : '')
        + (p.device && !p.is_host ? '<span class="ldev">📱 ' + pDevText(p.device) + '</span>' : '') + '</b>';
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
    if(pIsHost() && ['finished','confirmed','disputed'].includes(L.state)){
      const left = pFixLeft();
      if(left > 0){
        h += '<button class="big" id="lobFix">Ergebnis korrigieren</button>'
          + '<p class="hint">Noch ' + left + ' Minute' + (left===1?'':'n') + ' lang möglich. '
          + 'Danach ist das Ergebnis endgültig.</p>';
      } else {
        h += '<p class="hint">Die Korrekturzeit von 2 Stunden ist abgelaufen – das Ergebnis ist endgültig.</p>';
      }
    }
    h += '<button class="big" id="lobBack">Zurück</button>';
  }
  $('#lobBody').innerHTML = h;

  const on = (id, fn)=>{ const e = $('#'+id); if(e) e.onclick = fn };
  on('lobStart', pStartMatch);
  on('lobCancel', pCancelLobby);
  on('lobLeave', pLeaveMatch);
  on('lobBack', ()=>{ L = null; pLobbyStop(); go('play') });
  on('lobOk', ()=>pConfirm('ok'));
  on('lobNo', ()=>pConfirm('reject'));
  on('lobFix', pReopen);
  on('lobRules', pEditRulesLobby);
  on('lobCount', ()=>pMineOpen(L.id));
  document.querySelectorAll('#lobDev [data-dev]').forEach(b=>b.onclick = ()=>pSetDevice(b.dataset.dev || null));
}
async function pEditRulesLobby(){
  if(!L) return;
  const ch = await rlEditDialog({mode:L.mode, detail:L.detail, gps:L.gps, stw:L.stw, cat:L.cat, rules:L.rules, state:'lobby'});
  if(!ch) return;
  try{
    const {sb} = await pSb();
    const {error} = await sb.rpc('update_match_rules', Object.assign({p_match:L.id}, ch));
    if(error) throw error;
    await pLobbyLoad(L.id); renderLobby(); toast('Geändert');
  }catch(e){ toast(errText(e, 'Nicht geändert')) }
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

/* ---------- Bestätigen und korrigieren ---------- */

async function pConfirm(decision){
  if(!L || pBusy) return;
  let comment = null;
  if(decision === 'reject'){
    const v = await askText('Was stimmt nicht?',
      {placeholder:'z. B. „war 5:4“', max:200, ok:'Widersprechen',
       hint:'Der Host sieht deinen Hinweis und kann das Ergebnis innerhalb von 2 Stunden nach Spielende korrigieren. Das Feld darf leer bleiben.'});
    if(v === null) return;
    comment = v.trim() || null;
  } else {
    if(!await ask('Damit zählt das Ergebnis für die Wertung. Ändern kannst du es danach nicht mehr.',
      {title:'Ergebnis bestätigen?', ok:'Bestätigen'})) return;
  }
  pBusy = true;
  try{
    const {sb} = await pSb();
    const {error} = await sb.rpc('confirm_match',
      {p_match:L.id, p_decision:decision, p_comment:comment});
    if(error) throw error;
    await pLobbyLoad(L.id); renderLobby();
    toast(decision === 'ok' ? 'Bestätigt' : 'Widerspruch vermerkt');
  }catch(e){ toast(errText(e, 'Nicht übernommen')) }
  finally{ pBusy = false }
}

/* Korrigieren heißt: Spiel wieder aufnehmen und mit den normalen Mitteln ändern.
   rev zählt dabei hoch, alle Bestätigungen der alten Fassung verfallen. */
async function pReopen(){
  const id = L ? L.id : (P ? P.id : null);
  if(!id || pBusy) return;
  if(!await ask('Das Spiel läuft dann wieder und du kannst Tore zählen oder zurücknehmen. '
    + 'Alle bereits abgegebenen Bestätigungen verfallen und müssen neu eingeholt werden.',
    {title:'Ergebnis korrigieren?', ok:'Korrigieren'})) return;
  pBusy = true;
  try{
    const {sb} = await pSb();
    const {error} = await sb.rpc('reopen_match', {p_match:id});
    if(error) throw error;
    L = null; pLobbyStop();
    $('#msummary').classList.add('hidden');
    await pOpen(id);
  }catch(e){ toast(errText(e, 'Korrektur nicht möglich')) }
  finally{ pBusy = false }
}

/* Karte auf dem Spiel-Bildschirm: Spiele, die auf mein Wort warten.
   Bedingung bewusst einfach gehalten: beendet oder strittig, ich bin nicht der
   Host, und ich habe mich zu dieser Fassung noch nicht geäußert. Ob es meine
   Bestätigung wirklich noch braucht, entscheidet der Server. */
async function pLoadTodo(){
  const el = $('#pTodo'); if(!el) return;
  try{
    const {sb} = await pSb();
    const ids = await pMyMatchIds(sb);
    if(!ids.length){ el.innerHTML=''; return }
    const {data} = await sb.from('matches')
      .select('id,host_id,mode,state,rev,finished_at,match_confirmations(player_id,rev,decision)')
      .in('id', ids).in('state',['finished','disputed'])
      .order('finished_at',{ascending:false}).limit(10);
    const offen = (data||[]).filter(m=>m.host_id !== PL.me.id
      && !(m.match_confirmations||[]).some(c=>c.rev===m.rev && c.player_id===PL.me.id));
    if(!offen.length){ el.innerHTML=''; return }
    el.innerHTML = '<div class="card todo"><h2>Warten auf dich</h2>'
      + '<p class="lead">Diese Spiele zählen erst, wenn du das Ergebnis bestätigst.</p>'
      + offen.map(m=>'<div class="mrow" data-conf="' + m.id + '"><div><b>'
          + (m.mode==='single'?'Einzel':'Doppel') + '</b><small>' + pStateText(m.state) + '</small></div>'
          + '<span>' + (m.finished_at ? fmtDate(Date.parse(m.finished_at), true) : '') + '</span></div>').join('')
      + '</div>';
    el.querySelectorAll('[data-conf]').forEach(r=>r.onclick = ()=>pOpenLobby(r.dataset.conf));
  }catch(e){ /* offline */ }
}

/* ---------- Offline-Spiele ----------
   Ohne Netz entsteht das Spiel auf dem Gerät: Nummer, Aufstellung, Tore. Der
   Stand wird aus den Toren mit denselben Regeln berechnet wie auf dem Server
   (rlPredict). Sobald Netz da ist, lädt import_match das ganze Spiel in einem
   Stück hoch und rechnet jedes Tor nach. Erst danach ist es aus dem Gerät weg.
   Eigener Speicher je Konto, damit ein Kontowechsel nichts verliert. */
const LS_OFF = 'kt2_offm';
var OFF = load(LS_OFF, []); if(!Array.isArray(OFF)) OFF = [];
function saveOFF(){ save(LS_OFF, OFF) }
function offUid(){ return CL && CL.user ? CL.user.id : null }
function offMine(){ const u = offUid(); return u ? OFF.filter(m=>m.uid === u) : [] }
function offGet(id){ return OFF.find(m=>m.id === id) || null }
function offNewId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
// Kein Netz oder keine Antwort: dann lohnt das Offline-Spiel
function offIsNet(e){ return errText(e) === 'Offline – keine Verbindung' }
function offTimeout(pr, ms){
  return Promise.race([pr, new Promise((_, no)=>setTimeout(()=>no(new Error('offline: keine Antwort')), ms))]);
}
function offState(m){
  let st = {state:'running', set_no:1, score1:0, score2:0, sets1:0, sets2:0, match_done:false, sets:[]};
  for(const g of m.goals) if(!st.match_done) st = rlPredict(st, m.rules, m.gps, m.stw, g.team);
  return st;
}

function offStart(id, players){
  if(!PL.me || !offUid()){ toast('Offline geht erst, wenn dein Profil einmal online geladen wurde'); return }
  const c = PL.cfg, two = c.detail === 'full' && c.mode === 'double';
  const m = {id, uid:offUid(), mode:c.mode, detail:c.detail, gps:c.gps, stw:c.stw, cat:c.cat,
    rules:rlFromCfg(c), started:Date.now(), goals:[], err:'',
    players:players.map(p=>({player_id:p.player_id, team:p.team, position:two ? p.position : null,
      is_host:p.player_id === PL.me.id, nickname:pName(p.player_id),
      kind:p.player_id === PL.me.id ? 'account' : 'guest'}))};
  OFF.push(m); saveOFF();
  offOpen(m);
  toast('Kein Netz: Das Spiel wird auf dem Gerät gezählt und später hochgeladen');
}
function offOpen(m){
  ensureAudio();
  P = {id:m.id, off:true, mode:m.mode, detail:m.detail, gps:m.gps, stw:m.stw, host:PL.me ? PL.me.id : null,
       cat:m.cat, rules:m.rules, flip:false, players:m.players, st:offState(m), own:false};
  wake(true); renderMatch(); show('match');
  if(P.st.match_done) pSummary();
}
function offGoal(g){
  const m = offGet(P.id); if(!m) return;
  m.goals.push(g); P.st = offState(m); saveOFF(); renderMatch();
  if(P.st.match_done){ pSummary(); offUpload() }
}
function offUndo(){
  const m = offGet(P.id); if(!m) return;
  if(!m.goals.length){ toast('Es gibt kein Tor zum Zurücknehmen'); return }
  m.goals.pop(); P.st = offState(m); saveOFF(); renderMatch();
}
function offDrop(id){ OFF = OFF.filter(m=>m.id !== id); saveOFF() }

/* Hochladen: der Reihe nach, jedes Spiel für sich. Ein abgelehntes Spiel bleibt
   mit Begründung auf dem Gerät und hält die anderen nicht auf. */
let offBusy = false;
async function offUpload(){
  if(offBusy || !navigator.onLine || !offMine().length) return;
  offBusy = true; let n = 0;
  try{
    const {sb} = await pSb();
    for(const m of offMine()){
      const snap = m.goals.slice();
      const {data, error} = await sb.rpc('import_match', {p_id:m.id, p_mode:m.mode, p_detail:m.detail,
        p_goals_per_set:m.gps, p_sets_to_win:m.stw, p_category:m.cat, p_rules:m.rules,
        p_players:m.players.map(p=>({player_id:p.player_id, team:p.team, position:p.position})),
        p_goals:snap.map(g=>({team:g.team, scorer:g.scorer, position:g.position, own:!!g.own, t:g.t})),
        p_started_at:new Date(m.started).toISOString()});
      if(error){
        if(error.code === 'P0001' || error.code === '42501'){ m.err = errText(error); saveOFF(); continue }
        throw error;   // Netz: später erneut
      }
      // Was während des Hochladens getippt wurde, geht als normaler Tipp hinterher
      let k = 0;
      while(k < snap.length && k < m.goals.length && snap[k] === m.goals[k]) k++;
      for(let i = k; i < snap.length; i++) PL.queue.push({match:m.id, kind:'undo', t:Date.now()});
      m.goals.slice(k).forEach(g=>PL.queue.push({match:m.id, kind:'goal', team:g.team, scorer:g.scorer,
        position:g.position, own:!!g.own, t:g.t}));
      savePL(); offDrop(m.id); n++;
      if(P && P.id === m.id){
        P.off = false;
        if(data.match_done && k === snap.length && k === m.goals.length){
          P.st = data;
          if(!$('#msummary').classList.contains('hidden')) pSummary();
        } else await pOpen(m.id);
      }
    }
  }catch(e){ /* kein Netz oder abgemeldet: beim nächsten Mal */ }
  finally{ offBusy = false }
  if(n){
    toast(n === 1 ? 'Offline-Spiel hochgeladen' : n + ' Offline-Spiele hochgeladen');
    if(!P) renderPlayHome();
  } else offRenderCard();
}

function offRenderCard(){
  const el = $('#pOff'); if(!el) return;
  const list = offMine();
  if(!list.length){ el.innerHTML = ''; return }
  el.innerHTML = '<div class="card"><h2>Auf diesem Gerät</h2><p class="lead">'
    + (list.length === 1 ? 'Ein Offline-Spiel wartet' : list.length + ' Offline-Spiele warten')
    + ' aufs Hochladen. Das passiert von selbst, sobald Netz da ist.</p>'
    + list.map(m=>{
      const st = offState(m), name = t => m.players.filter(p=>p.team===t).map(p=>esc(p.nickname)).join(' & ');
      return '<div class="mrow" data-oid="' + m.id + '"><div><b>' + (m.stw > 1 ? st.sets1 + ' : ' + st.sets2 : (st.sets[0] || st).score1 + ' : ' + (st.sets[0] || st).score2) + '</b>'
        + '<small>' + name(1) + ' gegen ' + name(2) + ' · ' + (st.match_done ? 'fertig' : 'läuft') + '</small>'
        + (m.err ? '<small class="bad">Abgelehnt: ' + esc(m.err) + '</small>' : '') + '</div>'
        + '<span>' + fmtDate(m.started, true) + '</span></div>'
        + (m.err ? '<button class="big" data-odrop="' + m.id + '">Verwerfen</button>' : '');
    }).join('')
    + (navigator.onLine ? '<button class="big" id="pOffUp">Jetzt hochladen</button>' : '') + '</div>';
  el.querySelectorAll('[data-oid]').forEach(r=>r.onclick = ()=>{ const m = offGet(r.dataset.oid); if(m) offOpen(m) });
  el.querySelectorAll('[data-odrop]').forEach(b=>b.onclick = async ()=>{
    if(!await ask('Das Spiel wird vom Gerät gelöscht und nicht gewertet.', {title:'Offline-Spiel verwerfen?', ok:'Verwerfen', danger:true})) return;
    offDrop(b.dataset.odrop); offRenderCard() });
  const up = $('#pOffUp'); if(up) up.onclick = ()=>{ OFF.forEach(m=>{ m.err = '' }); offUpload() };
}
setTimeout(()=>{ if(offMine().length) offUpload() }, 4000);

/* ---------- Jeder zählt am eigenen Handy (v3.26) ----------
   Regeln (Oliver, 28.11.2026), durchgesetzt auf dem Server:
   - „Eigenes Handy“: nur eigene Tore. „Team-Handy“: Tore des eigenen Teams, Schütze wählbar.
     Je Team entweder ein Team-Handy oder eigene Handys.
   - Nie Tore für den Gegner; ein Eigentor des Gegners trägt das begünstigte Team ein.
   - Zurücknehmen: nur das letzte Tor, nur wer es eingetragen hat, der Schütze, das Team-Handy, der Host.
   - Ohne Netz ist der Tor-Knopf gesperrt. Der Host zählt immer und ist damit der Rückfall.
   - Die Bestätigung am Ende bleibt; gegen schnelles Mehrfachtippen sperrt der Knopf kurz. */
function pDevText(d){ return d === 'team' ? 'Team-Handy' : d === 'own' ? 'zählt selbst' : '' }
function pMyDevice(){ const p = L && PL.me && L.players.find(x=>x.player_id === PL.me.id); return p ? p.device || null : null }
function pDevCard(){
  const d = pMyDevice(), dbl = L.mode === 'double';
  const opts = [[null,'Host zählt'],['own','Eigenes Handy']].concat(dbl ? [['team','Team-Handy']] : []);
  const hint = d === 'own' ? (dbl ? 'Du tippst nur deine eigenen Tore. Dein Partner zählt seine selbst, sonst trägt sie der Host ein.' : 'Du tippst deine Tore selbst.')
    : d === 'team' ? 'Du zählst alle Tore deines Teams und tippst jeweils den Schützen an. Dein Partner zählt dann nicht selbst.'
    : 'Der Host zählt. Du siehst den Stand live.';
  return '<div class="card"><h2>Wie zählst du?</h2><div class="chips sc" id="lobDev">'
    + opts.map(([v,t])=>'<button class="chip' + (d === v ? ' on' : '') + '" data-dev="' + (v || '') + '">' + t + '</button>').join('')
    + '</div><p class="hint">' + hint + ' Bestätigt wird am Ende trotzdem.</p>'
    + (d && L.state === 'running' ? '<button class="big primary" id="lobCount">Zum Zählen</button>' : '') + '</div>';
}
async function pSetDevice(d){
  if(!L) return;
  try{
    const {sb} = await pSb();
    const {error} = await sb.rpc('set_device', {p_match:L.id, p_device:d});
    if(error) throw error;
    await pLobbyLoad(L.id);
    if(L.state === 'running' && d) return pMineOpen(L.id);
    renderLobby();
  }catch(e){ toast(errText(e, 'Nicht geändert')) }
}
function miTeamHtml(t, n, label, me){
  const names = L ? L.players.filter(p=>p.team === t).map(p=>esc(p.nickname)).join(' · ') : '';
  return '<div class="miteam' + (me ? ' me' : '') + '"><span>' + label + '</span><b>' + n + '</b><small>' + names + '</small></div>';
}

/* Host: Andere zählen mit → regelmäßig den Stand vom Server holen. Nur wenn nichts
   aussteht, sonst überschriebe die Antwort die eigene Vorhersage. */
let hostTimer = 0;
function pHostPoll(){
  clearTimeout(hostTimer);
  if(!P || P.off || !P.players.some(p=>p.kind === 'account' && p.player_id !== P.host)) return;
  hostTimer = setTimeout(async ()=>{
    if(!P || $('#match').classList.contains('hidden')) return;
    if(!pFlushing && !pQueued()) try{
      const {sb} = await pSb(); const id = P.id;
      const [st, mp] = await Promise.all([sb.rpc('match_state', {p_match:id}),
        sb.from('match_players').select('player_id,position,device').eq('match_id', id)]);
      if(P && P.id === id && !pFlushing && !pQueued() && !st.error){
        const was = P.st.match_done;
        P.st = st.data;
        (mp.data||[]).forEach(x=>{ const p = P.players.find(y=>y.player_id === x.player_id); if(p){ p.position = x.position; p.device = x.device } });
        renderMatch();
        if(!was && P.st.match_done) pSummary();
      }
    }catch(e){ /* kein Netz: nächster Versuch */ }
    pHostPoll();
  }, 3000);
}

/* ---------- Zählansicht „eigenes Handy“ ---------- */
let miTimer = 0, miBusy = false, miNet = true, miLast = '';
async function pMineOpen(id){
  try{
    pLobbyStop();
    await pLobbyLoad(id);
    if(L.state !== 'running' || !pMyDevice()){ renderLobby(); show('lobby'); pLobbyPoll(); return }
    ensureAudio(); miNet = true; miLast = '';
    wake(true); renderMine(); show('mine'); miPoll();
  }catch(e){ toast(errText(e, 'Spiel konnte nicht geöffnet werden')) }
}
function miStop(){ clearTimeout(miTimer); miTimer = 0 }
function miPoll(){
  miStop();
  miTimer = setTimeout(async ()=>{
    if(!L || $('#mine').classList.contains('hidden')) return;
    try{
      await pLobbyLoad(L.id); miNet = true;
      if(L.state !== 'running' || !pMyDevice()){ wake(false); miStop(); return pOpenLobby(L.id) }
    }catch(e){ miNet = false }
    renderMine(); miPoll();
  }, 2500);
}
function miOnline(){ return miNet && navigator.onLine }
function renderMine(){
  if(!L || !PL.me) return;
  const me = L.players.find(p=>p.player_id === PL.me.id); if(!me) return;
  const t = me.team, o = t === 1 ? 2 : 1, dev = me.device;
  const s = L.live || {score1:0, score2:0, sets1:0, sets2:0, set_no:1};
  const sc = x => x === 1 ? s.score1 : s.score2, se = x => x === 1 ? s.sets1 : s.sets2;
  const full = L.detail === 'full', dbl = L.mode === 'double', pos = full && dbl;
  const decider = s.sets1 === L.stw - 1 && s.sets2 === L.stw - 1;
  $('#miSets').innerHTML = L.stw > 1
    ? '<span>Sätze</span><b>' + se(t) + ' : ' + se(o) + '</b><span>Satz ' + s.set_no + (decider ? ' · Entscheidung' : '') + '</span>'
    : '<span>Satz bis ' + L.gps + '</span>';
  const key = sc(t) + ':' + sc(o) + ':' + s.set_no;
  $('#miScore').innerHTML = miTeamHtml(t, sc(t), dbl ? 'Ihr' : 'Du', true) + '<i>:</i>' + miTeamHtml(o, sc(o), 'Gegner', false);
  if(miLast && miLast !== key){ const e = $('#miScore'); e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump') }
  miLast = key;
  const on = miOnline();
  $('#miSync').textContent = !on ? 'Verbindung weg – Tippen gesperrt, der Host zählt weiter'
    : miBusy ? 'Wird gezählt …' : 'Live · ' + (dev === 'team' ? 'Team-Handy' : 'eigenes Handy');
  $('#miSync').classList.toggle('bad', !on);
  const dis = !on || miBusy ? ' disabled' : '';
  const sub = p => esc(p.nickname) + (pos && p.position ? ' · ' + pSlotOf(p) : '');
  let b;
  if(!full) b = '<button class="migoal" data-sc=""' + dis + '><b>TOR</b><small>für ' + (dbl ? 'uns' : 'mich') + '</small></button>';
  else if(dev === 'team' && dbl)
    b = L.players.filter(p=>p.team === t).sort((x,y)=>(x.position==='off'?0:1)-(y.position==='off'?0:1))
      .map(p=>'<button class="migoal" data-sc="' + p.player_id + '"' + dis + '><b>TOR</b><small>' + sub(p) + '</small></button>').join('');
  else b = '<button class="migoal" data-sc="' + me.player_id + '"' + dis + '><b>TOR</b><small>von mir' + (pos && me.position ? ' · ' + pSlotOf(me) : '') + '</small></button>';
  $('#miBtns').innerHTML = b;
  const swapT = dev === 'team' ? 'Sturm ⇆ Abwehr' : me.position === 'off' ? 'Ich gehe hinten' : 'Ich gehe vorne';
  $('#miFoot').innerHTML = '<button id="miUndo"' + dis + '>' + icon('undo') + '<small>Rückgängig</small></button>'
    + (pos ? '<button id="miSwap"' + dis + '>' + icon('swap') + '<small>' + swapT + '</small></button>' : '')
    + (full ? '<button id="miOwn"' + dis + '>Eigentor<small>vom Gegner</small></button>' : '');
}
async function miSend(fn, okBeep){
  if(miBusy || !miOnline()) return;
  miBusy = true; renderMine();
  const t0 = Date.now();
  try{
    const {sb} = await pSb();
    const r = await offTimeout(fn(sb), 8000);
    if(r.error) throw r.error;
    if(okBeep) beep(880, .07, .25);
    if(r.data && typeof r.data === 'object' && 'score1' in r.data) L.live = r.data;
    await pLobbyLoad(L.id).catch(()=>{});
  }catch(e){
    if(offIsNet(e)) miNet = false;
    beep(220, .15, .3);
    // Fachliche Ablehnung (Rechte, Regeln) im Wortlaut des Servers, ohne Vorsatz
    toast(offIsNet(e) ? 'Nicht gezählt – keine Verbindung' : (e && /^(P0001|42501)$/.test(e.code) ? errText(e) : errText(e, 'Nicht möglich')));
  }
  // Kurze Sperre: ein versehentlicher Doppeltipp zählt nicht doppelt
  setTimeout(()=>{ miBusy = false;
    if(L && L.state !== 'running'){ miStop(); wake(false); return pOpenLobby(L.id) }
    renderMine() }, Math.max(0, 900 - (Date.now() - t0)));
}
function miTeam(){ const me = L.players.find(p=>p.player_id === PL.me.id); return me ? me.team : null }
$('#miBtns').addEventListener('pointerdown', e=>{
  const b = e.target.closest('.migoal'); if(!b || b.disabled || !L) return;
  e.preventDefault();
  const sc = b.dataset.sc || null;
  miSend(sb=>sb.rpc('record_goal', {p_match:L.id, p_team:miTeam(), p_scorer:sc, p_position:null, p_own:false}), true);
});
$('#miFoot').addEventListener('click', async e=>{
  const b = e.target.closest('button'); if(!b || b.disabled || !L) return;
  if(b.id === 'miUndo') miSend(sb=>sb.rpc('undo_goal', {p_match:L.id}));
  else if(b.id === 'miSwap') miSend(sb=>sb.rpc('swap_positions', {p_match:L.id, p_team:miTeam()}));
  else if(b.id === 'miOwn'){
    const opp = L.players.filter(p=>p.team !== miTeam());
    let chosen = null;
    await dlg('<h3 class="dtitle">Eigentor – wem ist es passiert?</h3><p class="dmsg">Der Punkt geht an euch.</p><div class="picklist">'
      + opp.map(p=>'<button class="pickrow" data-pid="' + p.player_id + '">' + esc(p.nickname) + '</button>').join('') + '</div>',
      [{t:'Abbrechen', v:null, cancel:true}],
      o => o.addEventListener('click', ev=>{ const x = ev.target.closest('[data-pid]'); if(!x) return;
        chosen = x.dataset.pid; o.querySelector('.dbtns [data-i="0"]').click() }));
    if(chosen) miSend(sb=>sb.rpc('record_goal', {p_match:L.id, p_team:miTeam(), p_scorer:chosen, p_position:null, p_own:true}), true);
  }
});
$('#miBack').onclick = ()=>{ miStop(); wake(false); L = null; go('play') };
$('#miInfo').onclick = ()=>info('Selbst zählen',
  '<p class="dmsg">Oben steht der Stand, <b>dein Team links</b>. Tippe <b>TOR</b>, wenn ' + (pMyDevice() === 'team' ? 'jemand aus deinem Team' : 'du') + ' getroffen hast.</p>'
  + '<p class="dmsg">Du trägst nur Tore für dein Team ein, nie für den Gegner. Ein <b>Eigentor</b> des Gegners trägst du ein, weil der Punkt an euch geht.</p>'
  + '<p class="dmsg"><b>Rückgängig</b> nimmt das letzte Tor des Spiels zurück, wenn du es eingetragen hast oder Schütze warst. Sonst kann es der Host.</p>'
  + '<p class="dmsg">Ohne Netz ist der Knopf gesperrt, damit nichts doppelt zählt. Der Host kann immer für alle zählen.</p>'
  + '<p class="dmsg">Am Ende bestätigt die Gegenseite das Ergebnis wie gewohnt.</p>');
window.addEventListener('online', ()=>{ if(L && !$('#mine').classList.contains('hidden')){ miNet = true; renderMine() } });
window.addEventListener('offline', ()=>{ if(L && !$('#mine').classList.contains('hidden')) renderMine() });
