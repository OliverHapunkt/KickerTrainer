'use strict';
/* KickerTrainer · Spielen: Spielregeln und Vorlagen
 *
 * Jede Spielstätte zählt anders: mal reicht im Entscheidungssatz ein Tor, mal
 * braucht es zwei Tore Vorsprung (oft mit Obergrenze), mal endet der
 * Entscheidungssatz bei 4:4 unentschieden. Darum hat jedes Spiel eigene Regeln,
 * und häufig genutzte Einstellungen lassen sich als Vorlage speichern.
 *
 * Maßgeblich ist der Server (set_end in der Datenbank). Die Funktionen hier
 * rechnen dasselbe nur für die sofortige Anzeige beim Zählen nach.
 */

/* ---------- Rechenlogik (ohne DOM, siehe local-tests/regeln.test.js) ---------- */

/* Regeln aus den Einstellungen des Anlegen-Bildschirms (c = PL.cfg) */
function rlFromCfg(c){
  const two = c.winBy === 2;
  return {win_by:two ? 2 : 1, scope:c.scope === 'all' ? 'all' : 'decider',
    cap:two && c.cap ? c.cap : null, draw_at:c.draw ? c.gps - 1 : null};
}
/* Regeln aus einer Zeile der Tabelle matches */
function rlFromMatch(m){
  return {win_by:m.win_by || 1, scope:m.win_by_scope || 'decider', cap:m.goal_cap || null, draw_at:m.draw_at || null};
}

/* Satzende: 1/2 = Sieger, 0 = unentschieden, null = weiter. w1/w2 = schon gewonnene Sätze. */
function rlSetEnd(r, gps, stw, w1, w2, s1, s2){
  const decider = w1 === stw - 1 && w2 === stw - 1;
  if(r.draw_at != null && decider && s1 === r.draw_at && s2 === r.draw_at) return 0;
  if(r.cap != null && Math.max(s1, s2) >= r.cap && s1 !== s2) return s1 > s2 ? 1 : 2;
  const lead = r.win_by === 2 && (r.scope === 'all' || decider) ? 2 : 1;
  if(Math.max(s1, s2) >= gps && Math.abs(s1 - s2) >= lead) return s1 > s2 ? 1 : 2;
  return null;
}

/* Spielstand nach einem Tor für team – dieselbe Form wie match_state() */
function rlPredict(st, r, gps, stw, team){
  const n1 = st.score1 + (team === 1 ? 1 : 0), n2 = st.score2 + (team === 2 ? 1 : 0);
  const w = rlSetEnd(r, gps, stw, st.sets1, st.sets2, n1, n2);
  if(w === null) return Object.assign({}, st, {score1:n1, score2:n2});
  const sets1 = st.sets1 + (w === 1 ? 1 : 0), sets2 = st.sets2 + (w === 2 ? 1 : 0);
  const over = w === 0 || Math.max(sets1, sets2) >= stw;
  const sets = (st.sets || []).concat([{set_no:st.set_no, score1:n1, score2:n2, winner_team:w}]);
  return Object.assign({}, st, {sets1, sets2, sets, match_done:over, draw:w === 0,
    set_no:over ? st.set_no : st.set_no + 1, score1:over ? n1 : 0, score2:over ? n2 : 0});
}

/* Kurzbeschreibung für Zusammenfassungen */
function rlText(r, gps, stw){
  const p = [];
  if(r.win_by === 2) p.push('2 Tore Vorsprung ' + (r.scope === 'all' ? 'in jedem Satz' : 'im Entscheidungssatz')
    + (r.cap ? ', höchstens bis ' + r.cap : ''));
  if(r.draw_at != null) p.push('Remis bei ' + r.draw_at + ':' + r.draw_at + ' im Entscheidungssatz');
  return p.length ? p.join(' · ') : 'Ein Tor reicht, kein Remis';
}
function rlShort(gps, stw, r){
  return 'Bis ' + gps + ' · ' + (stw === 1 ? '1 Satz' : stw + ' Gewinnsätze')
    + (r.win_by === 2 ? ' · +2' + (r.scope === 'all' ? '' : ' im Entscheid') + (r.cap ? ' (max ' + r.cap + ')' : '') : '')
    + (r.draw_at != null ? ' · Remis ' + r.draw_at + ':' + r.draw_at : '');
}

/* ---------- Bedienung ---------- */

/* Regel-Felder in einen Container zeichnen. c hat winBy, scope, cap, draw, gps. after() nach jeder Änderung. */
function rlFields(el, c, after){
  el.innerHTML = '<div class="sub"><label>Zwei Tore Vorsprung ' + tipBtn('rlLead') + '</label><div class="chips sc" data-k="lead"></div></div>'
    + (c.winBy === 2 ? '<div class="sub"><label>Obergrenze (Satz endet spätestens bei)</label><div data-k="cap"></div></div>' : '')
    + '<div class="sub"><label>Unentschieden ' + tipBtn('rlDraw') + '</label><div class="chips sc" data-k="draw"></div></div>';
  const q = k => el.querySelector('[data-k="' + k + '"]');
  const lead = c.winBy !== 2 ? 'off' : c.scope === 'all' ? 'all' : 'decider';
  chips(q('lead'), [{v:'off',t:'Nein'},{v:'decider',t:'Entscheid'},{v:'all',t:'Jeder Satz'}], v=>lead===v,
    v=>{ if(v === 'off'){ c.winBy = 1 } else { c.winBy = 2; c.scope = v } }, after);
  if(q('cap')){
    const stops = [0].concat([1,2,3,4,5].map(i=>c.gps + i));
    if(c.cap && !stops.includes(c.cap)) c.cap = 0;
    slider(q('cap'), {stops, value:c.cap || 0, fmt:v=>v ? String(v) : 'ohne', onInput:v=>{ c.cap = v || null }, after});
  }
  chips(q('draw'), [{v:false,t:'Nein'},{v:true,t:'Bei ' + (c.gps - 1) + ':' + (c.gps - 1)}], v=>!!c.draw===v,
    v=>{ c.draw = v }, after);
}

/* ---------- Vorlagen ----------
   Lokal gespeichert (PL.presets), je Gerät. Eine Vorlage hält Einzel/Doppel,
   Erfassung, Tore, Sätze, Art und Regeln – nicht die Aufstellung. */
const RL_KEYS = ['mode','detail','gps','stw','cat','winBy','scope','cap','draw'];
function rlPick(c){ const o = {}; RL_KEYS.forEach(k=>{ o[k] = c[k] }); return o }
function rlSame(a, b){ return RL_KEYS.every(k=>(a[k] ?? null) === (b[k] ?? null)) }

async function rlSavePreset(){
  const v = await askText('Als Vorlage speichern', {placeholder:'z. B. Vereinsabend', max:24, ok:'Speichern',
    hint:'Speichert Einzel/Doppel, Erfassung, Tore, Sätze, Art und Regeln. Die Aufstellung nicht.'});
  if(v === null) return;
  const n = v.trim(); if(!n){ toast('Bitte einen Namen'); return }
  PL.presets = (PL.presets || []).filter(p=>p.n !== n);
  PL.presets.push({n, c:rlPick(PL.cfg)}); savePL();
  toast('Vorlage „' + n + '“ gespeichert'); renderPlayHome();
}
async function rlManagePresets(){
  const list = PL.presets || [];
  const rows = list.map((p,i)=>'<div class="lrow"><b>' + esc(p.n) + '</b><button class="lbtn del" data-del="' + i + '" aria-label="Löschen">✕</button></div>').join('');
  await dlg('<h3 class="dtitle">Vorlagen</h3>' + (rows || '<p class="dmsg">Keine gespeichert.</p>'),
    [{t:'Fertig', v:true, cls:'primary', primary:true}],
    o=>o.addEventListener('click', e=>{ const b = e.target.closest('[data-del]'); if(!b) return;
      PL.presets.splice(+b.dataset.del, 1); savePL(); b.closest('.lrow').remove() }));
  renderPlayHome();
}
function rlPresetBar(){
  const list = PL.presets || [];
  return '<div class="sub"><label>Vorlage</label><div class="chips scroll" id="pcPreset">'
    + list.map((p,i)=>'<button class="chip' + (rlSame(p.c, PL.cfg) ? ' on' : '') + '" data-pre="' + i + '">' + esc(p.n) + '</button>').join('')
    + '<button class="chip" id="pcPreSave">+ Speichern</button>'
    + (list.length ? '<button class="chip" id="pcPreEdit">Bearbeiten</button>' : '') + '</div></div>';
}
function rlWirePresets(){
  const bar = $('#pcPreset'); if(!bar) return;
  bar.querySelectorAll('[data-pre]').forEach(b=>b.onclick = ()=>{
    const p = PL.presets[+b.dataset.pre]; if(!p) return;
    const wasSingle = PL.cfg.mode === 'single';
    Object.assign(PL.cfg, p.c);
    if(PL.cfg.mode === 'single' && !wasSingle){ PL.lineup[1] = null; PL.lineup[3] = null }
    savePL(); renderPlayHome();
  });
  $('#pcPreSave').onclick = rlSavePreset;
  const ed = $('#pcPreEdit'); if(ed) ed.onclick = rlManagePresets;
}

/* ---------- Regeln eines laufenden Spiels / einer Lobby ändern ----------
   m: {mode, detail, gps, stw, cat, rules, state}. Liefert die Änderung für
   update_match_rules oder null bei Abbruch. */
async function rlEditDialog(m){
  const lobby = m.state === 'lobby';
  const c = {mode:m.mode, detail:m.detail, gps:m.gps, stw:m.stw, cat:m.cat,
    winBy:m.rules.win_by, scope:m.rules.scope, cap:m.rules.cap, draw:m.rules.draw_at != null};
  const html = '<h3 class="dtitle">Regeln ändern</h3><div id="rlDlg"></div>'
    + '<p class="dmsg">' + (lobby ? 'Gilt für dieses Spiel.' : 'Gilt ab sofort. Was schon entschieden ist, bleibt entschieden.') + '</p>';
  const draw = el=>{
    let h = '';
    if(lobby) h += '<div class="sub"><label>Modus</label><div class="chips sc" data-f="mode"></div></div>'
      + '<div class="sub"><label>Art</label><div class="chips sc" data-f="cat"></div></div>';
    h += '<div class="sub"><label>Erfassung</label><div class="chips sc" data-f="detail"></div></div>'
      + '<div class="sub"><label>Satz bis … Tore</label><div data-f="gps"></div></div>'
      + '<div class="sub"><label>Spiel bis … Gewinnsätze</label><div class="chips sc" data-f="stw"></div></div>'
      + '<div data-f="rules"></div>';
    el.innerHTML = h;
    const f = k=>el.querySelector('[data-f="' + k + '"]'), re = ()=>draw(el);
    if(lobby){
      chips(f('mode'), [{v:'single',t:'Einzel'},{v:'double',t:'Doppel'}], v=>c.mode===v, v=>{ c.mode = v }, re);
      chips(f('cat'), [{v:'ranked',t:'Wertung'},{v:'casual',t:'Locker'}], v=>c.cat===v, v=>{ c.cat = v }, re);
    }
    chips(f('detail'), [{v:'simple',t:'Einfach'},{v:'full',t:'Erweitert'}], v=>c.detail===v, v=>{ c.detail = v }, re);
    slider(f('gps'), {min:3, max:15, step:1, value:c.gps, fmt:n=>n + ' Tore', onInput:v=>{ c.gps = v }, after:re});
    chips(f('stw'), [1,2,3].map(n=>({v:n, t:n === 1 ? 'Nur ein Satz' : n + ' Sätze'})), v=>c.stw===v, v=>{ c.stw = v }, re);
    rlFields(f('rules'), c, re);
  };
  const v = await dlg(html, [{t:'Übernehmen', v:true, cls:'primary', primary:true}, {t:'Abbrechen', v:false, cancel:true}],
    o=>draw(o.querySelector('#rlDlg')));
  if(v !== true) return null;
  const r = rlFromCfg(c);
  return {p_mode:lobby ? c.mode : null, p_category:lobby ? c.cat : null, p_detail:c.detail,
    p_gps:c.gps, p_stw:c.stw, p_win_by:r.win_by, p_scope:r.scope,
    p_cap:r.cap, p_draw_at:r.draw_at, p_clear_cap:r.cap == null, p_clear_draw:r.draw_at == null};
}
