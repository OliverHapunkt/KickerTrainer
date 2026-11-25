'use strict';
/* KickerTrainer · Spielen-Hälfte: Bilanz (Gegner-Statistik)
 *
 * Gegen wen habe ich gespielt, wie oft gewonnen, wie entwickelt es sich?
 * Grundlage ist my_match_history() – alle eigenen Spiele mit Ergebnis in einem
 * Aufruf. Gerechnet wird hier im Client, wie beim Training. Elo kommt später
 * und ist davon unabhängig.
 *
 * Welche Spiele zählen: bestätigte und beendete (noch unbestätigte werden
 * mitgezählt, aber ausgewiesen). Strittige zählen nicht – ihr Ergebnis steht
 * in Frage.
 *
 * Gegner = Spieler-ID, nicht Name. Zwei „Frank" bei verschiedenen Hosts sind
 * zwei Personen; bei mir gibt es pro Name ohnehin nur einen.
 */

/* ---------- Rechenlogik (ohne DOM, siehe local-tests/bilanz.test.js) ---------- */

const BZ_MIN_RATE = 5;   // Quote erst ab so vielen Spielen – darunter sagt sie nichts

/* Ein Spiel aus my_match_history() aus meiner Sicht aufbereiten. null = nicht wertbar. */
function bzNorm(m){
  if(!m || !m.team || !Array.isArray(m.sets) || !Array.isArray(m.players)) return null;
  const T = m.team, O = T === 1 ? 2 : 1;
  const sw = m.sets.filter(s=>s[2] === T).length, sl = m.sets.filter(s=>s[2] === O).length;
  if(sw === sl) return null;                                   // kein Sieger: nicht durchgespielt
  const gf = m.sets.reduce((a,s)=>a + (T === 1 ? s[0] : s[1]), 0);
  const ga = m.sets.reduce((a,s)=>a + (T === 1 ? s[1] : s[0]), 0);
  const mine = m.players.filter(p=>p.team === T);
  const opps = m.players.filter(p=>p.team === O);
  const meId = m.me || null;
  return {id:m.id, at:Date.parse(m.at), mode:m.mode, detail:m.detail, cat:m.category || 'ranked',
    state:m.state, host:!!m.host, win:sw > sl, sw, sl, gf, ga, sets:m.sets, team:T,
    me:meId, partner:mine.find(p=>p.id !== meId) || null, opps, goals:m.goals || []};
}

/* Rohliste → aufbereitete, gefilterte Liste. f = {range, mode, cat}, now = Zeitpunkt. */
function bzPrep(raw, f, now){
  const days = {'30':30, '90':90, '365':365}[f && f.range] || 0;
  const from = days ? now - days * 864e5 : -Infinity;
  return (raw || []).map(bzNorm)
    .filter(m=>m && m.state !== 'disputed' && m.at >= from
      && (!f || f.mode === 'all' || !f.mode || m.mode === f.mode)
      && (!f || f.cat === 'all' || !f.cat || m.cat === f.cat))
    .sort((a,b)=>a.at - b.at);                               // älteste zuerst, für Serien
}

/* Serien über eine zeitlich sortierte Liste: aktuelle (+n Siege / −n Niederlagen), beste Siegserie */
function bzStreaks(list){
  let best = 0, run = 0, cur = 0;
  for(const m of list){
    run = m.win ? run + 1 : 0; if(run > best) best = run;
    cur = m.win ? (cur > 0 ? cur + 1 : 1) : (cur < 0 ? cur - 1 : -1);
  }
  return {cur, best};
}

function bzSum(list){
  const n = list.length, w = list.filter(m=>m.win).length;
  return {n, w, l:n - w, rate:n ? w / n : 0,
    sw:list.reduce((a,m)=>a + m.sw, 0), sl:list.reduce((a,m)=>a + m.sl, 0),
    gf:list.reduce((a,m)=>a + m.gf, 0), ga:list.reduce((a,m)=>a + m.ga, 0),
    form:list.slice(-10).map(m=>m.win), open:list.filter(m=>m.state === 'finished').length,
    last:n ? list[n-1].at : null, ...bzStreaks(list)};
}

/* Je Person gruppieren. pick(m) liefert die Personen eines Spiels (Gegner oder Partner). */
function bzBy(list, pick){
  const g = new Map();
  for(const m of list) for(const p of pick(m)){
    if(!p) continue;
    if(!g.has(p.id)) g.set(p.id, {id:p.id, nick:p.nick, kind:p.kind, del:!!p.del, ms:[]});
    const e = g.get(p.id); e.nick = p.nick; e.ms.push(m);   // neuester Name gewinnt
  }
  return [...g.values()].map(e=>Object.assign(e, bzSum(e.ms)))
    .sort((a,b)=>b.n - a.n || b.last - a.last);
}
function bzOpponents(list){ return bzBy(list, m=>m.opps) }
function bzPartners(list){ return bzBy(list.filter(m=>m.mode === 'double'), m=>[m.partner]) }

/* Feste gegnerische Paarungen im Doppel */
function bzPairs(list){
  const g = new Map();
  for(const m of list.filter(x=>x.mode === 'double' && x.opps.length === 2)){
    const ps = m.opps.slice().sort((a,b)=>a.id < b.id ? -1 : 1), k = ps.map(p=>p.id).join('+');
    if(!g.has(k)) g.set(k, {id:k, nick:'', ms:[]});
    const e = g.get(k); e.nick = ps.map(p=>p.nick).join(' & '); e.ms.push(m);
  }
  return [...g.values()].map(e=>Object.assign(e, bzSum(e.ms))).sort((a,b)=>b.n - a.n || b.last - a.last);
}

/* Verlauf je Monat: [{key:'2026-11', n, w}] in zeitlicher Reihenfolge */
function bzMonths(list){
  const g = new Map();
  for(const m of list){
    const d = new Date(m.at), k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    if(!g.has(k)) g.set(k, {key:k, n:0, w:0});
    const e = g.get(k); e.n++; if(m.win) e.w++;
  }
  return [...g.values()].sort((a,b)=>a.key < b.key ? -1 : 1);
}

/* Eigene Tore (nur „Erweitert"): gesamt, Eigentore, je Position */
function bzGoals(list){
  const r = {matches:0, goals:0, own:0, off:0, def:0};
  for(const m of list.filter(x=>x.detail === 'full' && x.me)){
    r.matches++;
    for(const g of m.goals){
      if(g[2] !== m.me) continue;
      if(g[4]){ r.own++; continue }
      r.goals++; if(g[3] === 'off') r.off++; else if(g[3] === 'def') r.def++;
    }
  }
  return r;
}

/* ---------- Darstellung ---------- */
const LS_BZ = 'kt2_bilanz';
const BZ = {f:{range:'all', mode:'all', cat:'all'}, opp:null, raw:null, err:null, loading:false};
(function(){ const x = load(LS_BZ, null); if(x && x.f) BZ.f = Object.assign(BZ.f, x.f) })();
function bzSaveF(){ const x = load(LS_BZ, {}); x.f = BZ.f; save(LS_BZ, x) }

/* Verlauf holen. Zwischengespeichert je Konto, damit die Bilanz auch offline lesbar ist. */
async function bzLoad(){
  const x = load(LS_BZ, {});
  if(CL && CL.user && x.uid === CL.user.id && Array.isArray(x.raw) && !BZ.raw) BZ.raw = x.raw;
  if(BZ.loading) return;
  BZ.loading = true;
  try{
    const {sb, uid} = await pSb();
    const {data, error} = await sb.rpc('my_match_history');
    if(error) throw error;
    BZ.raw = data || []; BZ.err = null;
    const y = load(LS_BZ, {}); y.uid = uid; y.raw = BZ.raw; y.at = Date.now(); save(LS_BZ, y);
  }catch(e){ BZ.err = e }
  finally{ BZ.loading = false }
}

/* Bilanz plus Quote – die Quote nur, wenn sie etwas aussagt */
function bzSLR(s){ return bzSL(s) + (s.n >= BZ_MIN_RATE ? ' · ' + pct(s.rate) : '') }
function bzRateLine(s){ return s.n >= BZ_MIN_RATE ? 'Quote ' + pct(s.rate) : 'Quote ab ' + BZ_MIN_RATE + ' Spielen' }
function bzSL(s){ return s.w + ' – ' + s.l }
function bzForm(form){
  return '<span class="bzform">' + form.map(w=>'<i class="' + (w ? 'w' : 'l') + '">' + (w ? 'S' : 'N') + '</i>').join('') + '</span>';
}
function bzStreakText(c){
  return c > 0 ? c + (c === 1 ? ' Sieg' : ' Siege') : c < 0 ? -c + (c === -1 ? ' Niederlage' : ' Niederlagen') : '–';
}
function bzDiff(a, b){ const d = a - b; return a + ':' + b + ' <small>(' + (d > 0 ? '+' : '') + d + ')</small>' }

function bzRows(items, kind){
  return items.map(e=>'<div class="mrow bzrow"' + (kind === 'opp' ? ' data-opp="' + e.id + '"' : '') + '><div>'
    + '<b class="bznick">' + esc(e.nick || '?') + (e.kind === 'guest' ? ' <small class="tag">Gast</small>' : '') + '</b>'
    + '<small>' + e.n + (e.n === 1 ? ' Spiel' : ' Spiele') + ' · zuletzt ' + fmtDate(e.last) + '</small></div>'
    + '<span class="bzsl"><b>' + bzSL(e) + '</b>' + (e.n >= BZ_MIN_RATE ? '<small>' + pct(e.rate) + '</small>' : '') + '</span></div>').join('');
}

function bzFilters(){
  return '<div class="filters">'
    + '<div class="chips sc" id="bzRange"></div>'
    + '<div class="chips sc" id="bzMode"></div>'
    + '<div class="chips sc" id="bzCat"></div></div>';
}
function bzWireFilters(){
  const re = ()=>{ bzSaveF(); renderBilanz() };
  chips($('#bzRange'), [{v:'all',t:'Alle'},{v:'365',t:'12 M'},{v:'90',t:'3 M'},{v:'30',t:'30 T'}],
    v=>BZ.f.range===v, v=>{ BZ.f.range=v }, re);
  chips($('#bzMode'), [{v:'all',t:'Alle'},{v:'single',t:'Einzel'},{v:'double',t:'Doppel'}],
    v=>BZ.f.mode===v, v=>{ BZ.f.mode=v }, re);
  chips($('#bzCat'), [{v:'all',t:'Alle'},{v:'ranked',t:'Wertung'},{v:'casual',t:'Locker'}],
    v=>BZ.f.cat===v, v=>{ BZ.f.cat=v }, re);
}

/* Einstieg aus dem Tab. Zeigt sofort den Zwischenstand, holt dann frisch. */
function renderBilanzTab(){
  BZ.opp = null;
  renderBilanz();
  bzLoad().then(()=>{ if(curScreen() === 'rank') renderBilanz() });
}

function renderBilanz(){
  const el = $('#rankBody'); if(!el) return;
  if(!pLoggedIn()){
    el.innerHTML = '<div class="card"><h2>Konto nötig</h2><p class="lead">Die Bilanz rechnet aus deinen gespielten Spielen. '
      + 'Die liegen auf dem Server, dafür brauchst du ein Konto.</p></div>';
    return;
  }
  if(!BZ.raw){
    el.innerHTML = '<div class="card"><p class="hint" style="margin:0">'
      + (BZ.err ? 'Konnte nicht geladen werden. Ohne Netz geht es erst, wenn die Bilanz einmal geladen war.' : 'Wird geladen …')
      + '</p></div>';
    return;
  }
  const list = bzPrep(BZ.raw, BZ.f, Date.now());
  const disputed = BZ.raw.filter(m=>m.state === 'disputed').length;
  if(BZ.opp) return renderBilanzOpp(el, list);

  let h = bzFilters();
  if(!list.length){
    h += '<div class="card"><h2>Noch nichts</h2><p class="lead">' + (BZ.raw.length
      ? 'Für diese Auswahl gibt es keine Spiele.'
      : 'Sobald du ein Spiel zu Ende gespielt hast, steht hier, gegen wen du wie oft gewonnen hast.') + '</p></div>';
    el.innerHTML = h; bzWireFilters(); return;
  }
  const s = bzSum(list);
  h += '<div class="card"><h2>Übersicht ' + tipBtn('bzSum') + '</h2>'
    + '<div class="bigpct">' + bzSL(s) + '</div>'
    + '<p class="center hint" style="margin-top:4px">Siege – Niederlagen · ' + bzRateLine(s) + '</p>'
    + kv('Form (letzte ' + s.form.length + ')', bzForm(s.form))
    + kv('Aktuelle Serie', bzStreakText(s.cur))
    + kv('Längste Siegserie', s.best)
    + kv('Sätze', bzDiff(s.sw, s.sl))
    + kv('Tore', bzDiff(s.gf, s.ga));
  if(BZ.f.mode === 'all'){
    const e = bzSum(list.filter(m=>m.mode === 'single')), d = bzSum(list.filter(m=>m.mode === 'double'));
    if(e.n && d.n) h += kv('Einzel', bzSLR(e)) + kv('Doppel', bzSLR(d));
  }
  if(BZ.f.cat === 'all'){
    const r = bzSum(list.filter(m=>m.cat === 'ranked')), c = bzSum(list.filter(m=>m.cat === 'casual'));
    if(r.n && c.n) h += kv('Wertung', bzSLR(r)) + kv('Locker', bzSLR(c));
  }
  const notes = [];
  if(s.open) notes.push(s.open + (s.open === 1 ? ' Spiel wartet' : ' Spiele warten') + ' noch auf Bestätigung und ' + (s.open === 1 ? 'ist' : 'sind') + ' enthalten.');
  if(disputed) notes.push(disputed + (disputed === 1 ? ' strittiges Spiel zählt' : ' strittige Spiele zählen') + ' nicht.');
  if(notes.length) h += '<p class="hint">' + notes.join(' ') + '</p>';
  h += '</div>';

  const opps = bzOpponents(list);
  h += '<div class="card"><h2>Gegner</h2>' + bzRows(opps, 'opp')
    + '<p class="hint">Quote ab ' + BZ_MIN_RATE + ' Spielen. Antippen für den direkten Vergleich.</p></div>';

  const parts = bzPartners(list);
  if(parts.length) h += '<div class="card"><h2>Partner im Doppel</h2>' + bzRows(parts, 'part') + '</div>';
  const pairs = bzPairs(list).filter(p=>p.n >= 2);
  if(pairs.length) h += '<div class="card"><h2>Gegner-Paare</h2>' + bzRows(pairs, 'pair')
    + '<p class="hint">Feste Paarungen ab 2 Spielen.</p></div>';

  const g = bzGoals(list);
  if(g.matches){
    h += '<div class="card"><h2>Deine Tore ' + tipBtn('bzGoals') + '</h2>'
      + kv('Tore', g.goals + ' in ' + g.matches + (g.matches === 1 ? ' Spiel' : ' Spielen')
           + ' · Ø ' + (g.goals / g.matches).toFixed(1).replace('.', ','));
    if(g.off || g.def) h += kv('Sturm / Abwehr', g.off + ' / ' + g.def);
    if(g.own) h += kv('Eigentore', g.own);
    h += '</div>';
  }
  el.innerHTML = h;
  bzWireFilters();
  el.querySelectorAll('[data-opp]').forEach(r=>r.onclick = ()=>{ BZ.opp = r.dataset.opp; renderBilanz(); window.scrollTo(0,0) });
}

/* Direkter Vergleich mit einem Gegner */
function renderBilanzOpp(el, list){
  const ms = list.filter(m=>m.opps.some(p=>p.id === BZ.opp));
  const who = (ms.length ? ms[ms.length-1].opps.find(p=>p.id === BZ.opp) : null)
    || (BZ.raw.flatMap(m=>m.players).find(p=>p.id === BZ.opp)) || {nick:'?'};
  let h = '<button class="link" id="bzBack" style="padding-left:0">‹ Alle Gegner</button>' + bzFilters()
    + '<div class="card"><h2>Du gegen ' + esc(who.nick) + '</h2>';
  if(!ms.length){
    h += '<p class="lead">Für diese Auswahl keine Spiele.</p></div>';
    el.innerHTML = h; bzWireFilters(); $('#bzBack').onclick = ()=>{ BZ.opp = null; renderBilanz() }; return;
  }
  const s = bzSum(ms);
  h += '<div class="bigpct">' + bzSL(s) + '</div>'
    + '<p class="center hint" style="margin-top:4px">' + bzRateLine(s) + '</p>'
    + kv('Form', bzForm(s.form)) + kv('Aktuelle Serie', bzStreakText(s.cur)) + kv('Längste Siegserie', s.best)
    + kv('Sätze', bzDiff(s.sw, s.sl)) + kv('Tore', bzDiff(s.gf, s.ga));
  const e = bzSum(ms.filter(m=>m.mode === 'single')), d = bzSum(ms.filter(m=>m.mode === 'double'));
  if(e.n && d.n) h += kv('Einzel', bzSL(e)) + kv('Doppel', bzSL(d));
  h += '</div>';

  const mon = bzMonths(ms);
  if(mon.length >= 2){
    h += '<div class="card"><h2>Verlauf</h2>' + mon.slice(-12).map(x=>{
      const r = x.w / x.n, faint = x.n < 3;
      const [y, mo] = x.key.split('-');
      return '<div class="wrow' + (faint ? ' faint' : '') + '"><div><b>' + mo + '/' + y.slice(2) + '</b><small>'
        + x.w + ' – ' + (x.n - x.w) + '</small></div><div class="wbar"><i style="width:' + Math.round(r*100) + '%"></i></div>'
        + '<b>' + (faint ? '' : pct(r)) + '</b></div>';
    }).join('') + '<p class="hint">Balken = Siegquote im Monat. Blass = weniger als 3 Spiele.</p></div>';
  }

  h += '<div class="card"><h2>Begegnungen</h2>' + ms.slice().reverse().slice(0, 20).map(m=>{
    const sets = m.sets.map(x=>m.team === 1 ? x[0] + ':' + x[1] : x[1] + ':' + x[0]).join('  ');
    const mit = m.partner ? ' · mit ' + esc(m.partner.nick) : '';
    return '<div class="mrow" data-mid="' + m.id + '"><div><b class="' + (m.win ? 'up' : 'down') + '">'
      + (m.win ? 'S' : 'N') + ' ' + m.sw + ':' + m.sl + '</b><small>'
      + (m.mode === 'single' ? 'Einzel' : 'Doppel') + mit + ' · ' + sets
      + (m.cat === 'casual' ? ' · locker' : '') + (m.state === 'finished' ? ' · unbestätigt' : '') + '</small></div>'
      + '<span>' + fmtDate(m.at) + '</span></div>';
  }).join('') + '</div>';
  el.innerHTML = h;
  bzWireFilters();
  $('#bzBack').onclick = ()=>{ BZ.opp = null; renderBilanz(); window.scrollTo(0,0) };
  el.querySelectorAll('[data-mid]').forEach(r=>r.onclick = ()=>pOpenLobby(r.dataset.mid));
}
