'use strict';
/* KickerTrainer · Gamification: XP, Level, Challenges
 *
 * Grundsätze
 * - XP werden nie als Zähler gespeichert, sondern immer aus den Einträgen berechnet.
 *   Dadurch gibt es keine Sync-Konflikte, ausgeschlossene Sessions zählen automatisch nicht,
 *   und eine geänderte Formel gilt rückwirkend.
 * - Challenges zählen nur Einträge ab dem Start der Challenge (sonst wären manche sofort erfüllt).
 * - Alles ist abschaltbar (Einstellungen › Gamification), Standard: an.
 * - Der Stand der Challenges liegt in den Einstellungen (S.chal) und damit nur auf diesem Gerät.
 */

/* ---------- Einstellungen ---------- */
function gamDefaults(){
  if(!S.gam||typeof S.gam!=='object')S.gam={on:true,xp:true,ch:true};
  if(!S.chal||typeof S.chal!=='object')S.chal={act:{},done:{},base:{}};
  ['act','done','base'].forEach(k=>{if(!S.chal[k]||typeof S.chal[k]!=='object')S.chal[k]={}});
}
gamDefaults();
const gXP=()=>S.gam.on&&S.gam.xp;
const gCH=()=>S.gam.on&&S.gam.ch;

/* ---------- XP ---------- */
// Pro Aktion 1 XP. Treffer zusätzlich 2 XP × Schwierigkeit:
//   Schuss auf bestimmtes Segment ×2, Pass auf Wall/Lane ×1,5, „egal“ ×1, „auf Signal“ zusätzlich ×1,5.
// Ab der 301. Aktion eines Tages nur noch 25 % (Volumen ja, stumpfes Abarbeiten nein).
// Jede Session mit mindestens 20 Aktionen: +20 XP (bewusst nicht weniger, sonst lohnen sich viele Mini-Sessions).
const XP_DAY_CAP=300,XP_SESSION=20,XP_SESSION_MIN=20;
function xpEntry(z){
  let v=1;
  if(z.h){
    let m=1;
    if(z.st==='shot')m=(typeof z.g==='number'&&z.g>0)?2:1;
    else m=(z.g==='wall'||z.g==='lane')?1.5:1;
    if(z.sig)m*=1.5;
    v+=2*m;
  }
  return v;
}
function countedShots(){const ex=exSet();return D.shots.filter(z=>!ex.has(z.s)).sort((a,b)=>a.t-b.t)}
function xpOf(shots){
  const day=new Map(),per=new Map();let xp=0;
  for(const z of shots){
    const d=dayStart(z.t),c=(day.get(d)||0)+1;day.set(d,c);
    xp+=xpEntry(z)*(c>XP_DAY_CAP?.25:1);
    per.set(z.s,(per.get(z.s)||0)+1);
  }
  for(const n of per.values())if(n>=XP_SESSION_MIN)xp+=XP_SESSION;
  return Math.round(xp);
}
function xpChallenges(){return CHAL.reduce((x,c)=>x+(S.chal.done[c.id]?c.xp:0),0)}
function xpTotal(shots){return xpOf(shots||countedShots())+xpChallenges()}

/* ---------- Level ---------- */
// Benötigte Gesamt-XP für Level L: 100 · (L−1)^1,8  →  L2: 100, L3: 348, L5: 1.213, L10: 5.220, L20: 20.033
// Richtwert: 20 Schüsse mit 60 % auf ein bestimmtes Segment ≈ 90 XP. Level 10 ≈ 60 solcher Sessions.
const lvlNeed=L=>Math.round(100*Math.pow(L-1,1.8));
function levelOf(xp){let L=1;while(xp>=lvlNeed(L+1))L++;const a=lvlNeed(L),b=lvlNeed(L+1);return{L,xp,from:a,to:b,frac:(xp-a)/(b-a)}}
function lvlTitle(L){return L<5?'Einsteiger':L<10?'Vereinsspieler':L<15?'Ligaspieler':L<20?'Turnierspieler':'Profi'}

/* ---------- Challenges ---------- */
const ALL5=c=>!!(c&&Array.isArray(c.tS)&&[1,2,3,4,5].every(n=>c.tS.includes(n)));
// Einträge seit Start der Challenge, gruppiert nach Session (mit Konfiguration)
function chSessions(a){
  const m=new Map();for(const z of a){if(!m.has(z.s))m.set(z.s,[]);m.get(z.s).push(z)}
  return[...m.entries()].map(([id,arr])=>({id,arr,cfg:(sessMeta(id)||{}).cfg||{}}));
}
function bestSessionRate(a,ok,minN,sessOk){
  let best=null;
  for(const x of chSessions(a)){if(sessOk&&!sessOk(x.cfg))continue;const e=x.arr.filter(ok);if(e.length<minN)continue;const r=e.filter(z=>z.h).length/e.length;if(best===null||r>best)best=r}
  return best;
}
function dayStreakSince(a,since){
  const days=new Set(a.map(z=>dayStart(z.t))),today=dayStart(Date.now()),first=dayStart(since);
  let d=days.has(today)?today:today-864e5,n=0;
  while(d>=first&&days.has(d)){n++;d-=864e5}
  return n;
}
const isS3=z=>z.d==='s3'&&z.st==='shot'&&z.end!==false;

// Jede Challenge: id, name, icon, xp, desc (Text oder Funktion), cfg (vorkonfigurierte Übung, optional),
// eval(a, state) → {cur, goal, done, txt}. Grenzwerte vorläufig, kalibriert an den Daten vom Okt 2026.
const CHAL=[
  {id:'warm',name:'Warmlaufen',icon:'flame',xp:100,desc:'200 Schüsse mit der 3er-Reihe',
   cfg:{d:'s3',tS:[1,2,3,4,5],order:'mix',timing:'free',scoring:'simple',amt:'count',count:20},
   eval(a){const n=a.filter(isS3).length;return{cur:n,goal:200,done:n>=200,txt:Math.min(n,200)+' / 200 Schüsse'}}},
  {id:'left',name:'Linke Ecke',seg:1,xp:250,desc:'100 Treffer auf Segment 1 (3er-Reihe)',
   cfg:{d:'s3',tS:[1],order:'series',timing:'free',amt:'count',count:20},
   eval(a){const n=a.filter(z=>isS3(z)&&z.g===1&&z.h).length;return{cur:n,goal:100,done:n>=100,txt:Math.min(n,100)+' / 100 Treffer'}}},
  {id:'right',name:'Rechte Ecke',seg:5,xp:250,desc:'100 Treffer auf Segment 5 (3er-Reihe)',
   cfg:{d:'s3',tS:[5],order:'series',timing:'free',amt:'count',count:20},
   eval(a){const n=a.filter(z=>isS3(z)&&z.g===5&&z.h).length;return{cur:n,goal:100,done:n>=100,txt:Math.min(n,100)+' / 100 Treffer'}}},
  {id:'chain',name:'Achterkette',icon:'chain',xp:200,desc:'8 Treffer in Folge, Ziele 1–5 gemischt',
   cfg:{d:'s3',tS:[1,2,3,4,5],order:'mix',timing:'free',amt:'count',count:30},
   eval(a){let b=0;for(const x of chSessions(a))if(ALL5(x.cfg))b=Math.max(b,bestRun(x.arr.filter(isS3)));
     return{cur:b,goal:8,done:b>=8,txt:'Beste Serie: '+b+' / 8'}}},
  {id:'sniper',name:'Scharfschütze',icon:'target',xp:300,desc:'Eine Session: ≥ 20 Schüsse auf 1–5 gemischt, ≥ 60 % Treffer',
   cfg:{d:'s3',tS:[1,2,3,4,5],order:'mix',timing:'free',amt:'count',count:20},
   eval(a){const r=bestSessionRate(a,isS3,20,ALL5);
     return{cur:r||0,goal:.6,done:r!==null&&r>=.6,txt:r===null?'Noch keine passende Session':'Bestwert '+pct(r)+' von 60 %'}}},
  {id:'press',name:'Unter Druck',icon:'clock',xp:300,desc:'Eine Session auf Signal: ≥ 20 Schüsse auf 1 und 5, ≥ 70 % Treffer',
   cfg:{d:'s3',tS:[1,5],order:'mix',timing:'signal',window:2,ready:'auto',auto:5,amt:'count',count:20},
   eval(a){const r=bestSessionRate(a,z=>isS3(z)&&z.sig,20);
     return{cur:r||0,goal:.7,done:r!==null&&r>=.7,txt:r===null?'Noch keine passende Session':'Bestwert '+pct(r)+' von 70 %'}}},
  {id:'pass',name:'Passmaschine',icon:'repeat',xp:250,desc:'Eine Session Pass 5er→3er: ≥ 30 Pässe auf Wall/Lane, ≥ 80 % angekommen',
   cfg:{d:'p53',tP:['wall','lane'],order:'mix',timing:'free',amt:'count',count:30},
   eval(a){const r=bestSessionRate(a,z=>z.d==='p53'&&z.st==='pass'&&(z.g==='wall'||z.g==='lane'),30);
     return{cur:r||0,goal:.8,done:r!==null&&r>=.8,txt:r===null?'Noch keine passende Session':'Bestwert '+pct(r)+' von 80 %'}}},
  {id:'combo',name:'Durchmarsch',icon:'rocket',xp:300,desc:'Kombi Pass+Schuss: ≥ 8 komplette Tore in einer Session mit ≥ 20 Wiederholungen',
   cfg:{d:'k53',tP:['wall','lane'],order:'mix',timing:'free',amt:'count',count:20},
   eval(a){let b=0;for(const x of chSessions(a)){const ends=x.arr.filter(z=>z.d==='k53'&&z.end!==false);if(ends.length>=20)b=Math.max(b,ends.filter(z=>z.st==='shot'&&z.h).length)}
     return{cur:b,goal:8,done:b>=8,txt:'Bestwert: '+b+' / 8 Tore'}}},
  {id:'weak',name:'Schwachstelle knacken',icon:'wrench',xp:400,
   desc(){const b=S.chal.base.weak;if(!b)return'Dein schwächstes Segment um 10 Prozentpunkte verbessern (über 50 Versuche)';
     return'Segment '+b.seg+': '+(b.rate==null?'mindestens 60 %':'von '+pct(b.rate)+' auf '+pct(Math.min(1,b.rate+.1)))+' über 50 Versuche'},
   cfgFn(){const b=S.chal.base.weak||weakBase();return{d:'s3',tS:[b.seg],order:'series',timing:'free',amt:'count',count:25}},
   eval(a){const b=S.chal.base.weak;if(!b)return{cur:0,goal:50,done:false,txt:'Startet beim ersten Training'};
     const x=a.filter(z=>isS3(z)&&z.g===b.seg).slice(-50),n=x.length,r=n?x.filter(z=>z.h).length/n:0,need=b.rate==null?.6:Math.min(1,b.rate+.1);
     return{cur:n,goal:50,done:n>=50&&r>=need-1e-9,txt:n<50?n+' / 50 Versuche · aktuell '+pct(r):'Letzte 50: '+pct(r)+' (Ziel '+pct(need)+')'}}},
  {id:'days',name:'Eiserner Wille',icon:'calendar',xp:500,desc:'7 Trainingstage in Folge',
   eval(a,since){const n=dayStreakSince(a,since);return{cur:n,goal:7,done:n>=7,txt:n+' / 7 Tage in Folge'}}},
];
const chById=id=>CHAL.find(c=>c.id===id);
const chDesc=c=>typeof c.desc==='function'?c.desc():c.desc;
// Schwächstes Segment (3er-Reihe) aus allen bisherigen Daten: mindestens 20 Versuche, sonst 5 Versuche, sonst Segment 5
function weakBase(){
  const a=countedShots().filter(z=>isS3(z)&&typeof z.g==='number'&&z.g>0);
  for(const min of[20,5]){
    let best=null;
    for(let g=1;g<=5;g++){const x=a.filter(z=>z.g===g);if(x.length<min)continue;const r=x.filter(z=>z.h).length/x.length;if(!best||r<best.rate)best={seg:g,rate:r}}
    if(best)return best;
  }
  return{seg:5,rate:null};
}
function chState(c,shots){
  const since=S.chal.act[c.id],done=S.chal.done[c.id];
  if(!since)return{status:done?'done':'new',done:false};
  const a=(shots||countedShots()).filter(z=>z.t>=since);
  const e=c.eval(a,since); // e.done = Ziel jetzt erreicht; status = gespeicherter Stand
  return Object.assign(e,{status:done?'done':'active',frac:Math.max(0,Math.min(1,e.cur/e.goal))});
}
// Prüft aktive Challenges und vergibt neu erreichte. Liefert die neu geschafften.
function chCheck(){
  if(!gCH())return[];
  const shots=countedShots(),got=[];
  for(const c of CHAL){
    if(!S.chal.act[c.id]||S.chal.done[c.id])continue;
    if(chState(c,shots).done){S.chal.done[c.id]=Date.now();got.push(c)}
  }
  if(got.length)saveS();
  return got;
}
async function chStart(id){
  const c=chById(id);if(!c)return;
  if(S.chal.done[id]){if(!await ask('Du hast sie schon geschafft. Nochmal von vorne zählen? Die XP gibt es nur einmal.',{title:'„'+c.name+'“ wiederholen?',ok:'Nochmal'}))return;delete S.chal.done[id];delete S.chal.base[id];S.chal.act[id]=Date.now()}
  if(!S.chal.act[id]){S.chal.act[id]=Date.now();if(id==='weak')S.chal.base.weak=weakBase()}
  saveS();
  const ch=c.cfgFn?c.cfgFn():c.cfg;
  if(!ch){renderGam();toast('Challenge läuft – trainiere wie gewohnt');return}
  const base=Object.assign(clone(DEFCFG),clone(S.cfg));
  const cfg=Object.assign(base,clone(ch));
  const d=DISC[cfg.d];
  if(!d.techs.includes(cfg.tech))cfg.tech=d.techs[0];
  if(d.techs2&&!d.techs2.includes(cfg.tech2))cfg.tech2=d.techs2[0];
  cfg.wt=[cfg.tech];if(d.techs2)cfg.wt2=[cfg.tech2];
  startSession(cfg,null);
}
async function chStop(id){
  const c=chById(id);if(!c||!await ask('Der Fortschritt geht verloren.',{title:'„'+c.name+'“ abbrechen?',ok:'Abbrechen',cancel:'Weiter verfolgen',danger:true}))return;
  delete S.chal.act[id];delete S.chal.base[id];saveS();renderGam();
}

/* ---------- Anzeige ---------- */
function chIcon(c){return c.seg?'<span class="chico seg" style="--sc:var(--s'+c.seg+')">'+c.seg+'</span>':'<span class="chico">'+icon(c.icon)+'</span>'}
function chCard(c,st,compact){
  const done=st.status==='done',act=st.status==='active';
  let h='<div class="chcard'+(done?' done':'')+(act?' act':'')+'">'+chIcon(c)+'<div class="chbody"><div class="chtop"><b>'+esc(c.name)+'</b><span class="chxp">'+(done?'✓ ':'+')+c.xp+' XP</span></div>';
  if(!compact||!act)h+='<p>'+esc(chDesc(c))+'</p>';
  if(act&&!done)h+='<div class="chbar"><i style="width:'+Math.round(st.frac*100)+'%"></i></div><small>'+esc(st.txt)+'</small>';
  if(done)h+='<small class="okc">Geschafft am '+new Date(S.chal.done[c.id]).toLocaleDateString('de-DE')+'</small>';
  h+='</div><div class="chact">';
  const hasCfg=!!(c.cfg||c.cfgFn);
  if(act&&!done)h+='<button class="pgo" data-ch="go" data-id="'+c.id+'" aria-label="Trainieren">'+icon('play')+'</button>';
  else if(!done)h+='<button class="chstart" data-ch="go" data-id="'+c.id+'">'+(hasCfg?'Starten':'Annehmen')+'</button>';
  if(!compact&&act&&!done)h+='<button class="pdel" data-ch="stop" data-id="'+c.id+'" aria-label="Abbrechen">'+icon('x')+'</button>';
  if(!compact&&done)h+='<button class="chstart ghost" data-ch="go" data-id="'+c.id+'">Nochmal</button>';
  return h+'</div></div>';
}
function lvlCard(){
  const shots=countedShots(),xp=xpTotal(shots),lv=levelOf(xp),today=dayStart(Date.now());
  const xpToday=xpOf(shots)-xpOf(shots.filter(z=>z.t<today));
  return'<div class="card lvl"><div class="lvltop"><div class="lvlnum">'+lv.L+'</div><div class="lvlinfo"><b>Level '+lv.L+' · '+lvlTitle(lv.L)+'</b><small>'+xp.toLocaleString('de-DE')+' XP · noch '+(lv.to-xp).toLocaleString('de-DE')+' bis Level '+(lv.L+1)+'</small></div>'
    +(xpToday>0?'<div class="lvltoday">+'+xpToday+'<small>heute</small></div>':'')+'</div><div class="chbar lvlbar"><i style="width:'+Math.round(lv.frac*100)+'%"></i></div></div>';
}
function renderLvlChip(){
  const b=$('#lvlChip');b.classList.toggle('hidden',!gXP());if(!gXP())return;
  const lv=levelOf(xpTotal());
  b.innerHTML='<span class="lvlc">'+lv.L+'</span><span class="lvlt">Level<i><b style="width:'+Math.round(lv.frac*100)+'%"></b></i></span>';
}
$('#lvlChip').onclick=()=>info('Dein Level',lvlCard()
  +'<p class="dmsg">XP gibt es für jede Aktion, Treffer zählen mehr – schwierige Ziele (bestimmtes Segment, auf Signal) am meisten. Dazu Bonus für Sessions ab 20 Aktionen und für geschaffte Challenges.</p>');
function renderGamHome(){
  const el=$('#gamHome');if(!el)return;let h='';
  chCheck().forEach(c=>toast('Challenge geschafft: '+c.name+' (+'+c.xp+' XP)')); // z. B. nach Abgleich oder Korrektur
  renderLvlChip();
  if(gCH()){
    const shots=countedShots(),act=CHAL.filter(c=>S.chal.act[c.id]&&!S.chal.done[c.id]).map(c=>[c,chState(c,shots)]).sort((p,q)=>q[1].frac-p[1].frac);
    if(act.length)h+='<div class="card"><div class="qhead"><h2>Aktive Challenges</h2><button class="link" data-ch="tab">Alle</button></div>'+act.slice(0,2).map(([c,st])=>chCard(c,st,true)).join('')+(act.length>2?'<p class="hint" style="margin:6px 0 0">+'+(act.length-2)+' weitere</p>':'')+'</div>';
    else{const n=CHAL.filter(c=>!S.chal.done[c.id]).length;
      if(n)h+='<button class="card chpromo" data-ch="tab"><span class="chico">'+icon('trophy')+'</span><span><b>Challenges</b><small>'+n+' warten auf dich · Übung starten und Fortschritt sammeln</small></span>'+icon('chevron','chev')+'</button>'}
  }
  el.innerHTML=h;
}
function renderChal(){
  const el=$('#chalBody');if(!el)return;
  const shots=countedShots(),rows=CHAL.map(c=>[c,chState(c,shots)]);
  const order={active:0,new:1,done:2};rows.sort((p,q)=>order[p[1].status]-order[q[1].status]);
  const nDone=rows.filter(r=>r[1].status==='done').length;
  let h='<div class="card chsum"><div><b>'+nDone+' / '+CHAL.length+'</b><small>geschafft</small></div><div><b>'+xpChallenges().toLocaleString('de-DE')+'</b><small>XP aus Challenges</small></div></div>';
  const grp=(t,list)=>list.length?'<h2 class="chh">'+t+'</h2><div class="card chlist">'+list.map(([c,st])=>chCard(c,st,false)).join('')+'</div>':'';
  h+=grp('Aktiv',rows.filter(r=>r[1].status==='active'));
  h+=grp('Verfügbar',rows.filter(r=>r[1].status==='new'));
  h+=grp('Geschafft',rows.filter(r=>r[1].status==='done'));
  h+='<p class="hint">Fortschritt zählt ab dem Start einer Challenge, auch aus normalen Trainings mit passender Übung. Der Stand liegt nur auf diesem Gerät.</p>';
  el.innerHTML=h;
}
function renderGam(){
  $('#tabbar [data-tab=chal]').classList.toggle('hidden',!gCH());
  renderGamHome();
  if(!$('#chal').classList.contains('hidden'))renderChal();
  ['gXp','gCh'].forEach(id=>{const r=$('#'+id).closest('.row');$('#'+id).disabled=!S.gam.on;r.style.opacity=S.gam.on?'':'.5'});
  $('#gOn').checked=S.gam.on;$('#gXp').checked=S.gam.xp;$('#gCh').checked=S.gam.ch;
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-ch]');if(!b)return;
  const a=b.dataset.ch,id=b.dataset.id;
  if(a==='go')chStart(id);
  else if(a==='stop')chStop(id);
  else if(a==='tab'){renderChal();show('chal')}
});
$('#gOn').onchange=e=>{S.gam.on=e.target.checked;saveS();renderGam()};
$('#gXp').onchange=e=>{S.gam.xp=e.target.checked;saveS();renderGam()};
$('#gCh').onchange=e=>{S.gam.ch=e.target.checked;saveS();renderGam()};

/* ---------- Training: Schnappschuss vorher, Auswertung nachher ---------- */
function gamSnapshot(){
  if(!S.gam.on)return null;
  const shots=countedShots(),prog={};
  for(const c of CHAL)if(S.chal.act[c.id]&&!S.chal.done[c.id])prog[c.id]=chState(c,shots);
  return{xp:xpTotal(shots),prog};
}
function gamSummary(snap){
  if(!snap||!S.gam.on)return'';
  const got=chCheck(),shots=countedShots();let h='';
  if(gCH())for(const c of got)h+='<div class="gwin">'+icon('trophy')+'<b>Challenge geschafft: '+esc(c.name)+'</b><span>+'+c.xp+' XP</span></div>';
  if(gXP()){
    const xp=xpTotal(shots),d=xp-snap.xp,l0=levelOf(snap.xp),l1=levelOf(xp);
    if(l1.L>l0.L)h+='<div class="gwin lvlup">'+icon('up')+'<b>Level '+l1.L+' erreicht</b><span>'+lvlTitle(l1.L)+'</span></div>';
    h+='<div class="gxp"><span>+'+d+' XP</span><div class="chbar lvlbar"><i style="width:'+Math.round(l1.frac*100)+'%"></i></div><small>Level '+l1.L+' · noch '+(l1.to-xp)+' XP bis Level '+(l1.L+1)+'</small></div>';
  }
  if(gCH()){
    const rows=[];
    for(const id in snap.prog){
      const c=chById(id);if(!c||got.includes(c))continue;
      const before=snap.prog[id],now=chState(c,shots);
      if(now.cur!==before.cur||now.txt!==before.txt)rows.push(kv(esc(c.name),esc(now.txt)));
    }
    if(rows.length)h+='<div class="blockh">Challenges</div>'+rows.join('');
  }
  return h;
}
// Serie während des Trainings (Treffer in Folge, nur abgeschlossene Wiederholungen)
function gamStreak(entries){
  if(!S.gam.on)return'';
  let n=0;for(let i=entries.length-1;i>=0;i--){if(entries[i].h)n++;else break}
  return n>=3?' <span class="streak">'+icon('flame')+n+'</span>':'';
}
