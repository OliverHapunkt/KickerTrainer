'use strict';
/* KickerTrainer · Training und Auswertung nach der Session */
/* ---------- Training ---------- */
const segs=$('#segs');
for(let n=1;n<=5;n++){const b=document.createElement('button');b.className='seg';b.textContent=n;
  b.addEventListener('pointerdown',e=>{e.preventDefault();input(n)});segs.appendChild(b)}
function pd(el,fn){el.addEventListener('pointerdown',e=>{e.preventDefault();fn()})}
pd($('#btnMiss'),()=>input(0));pd($('#bYes'),()=>input('hit'));pd($('#bNo'),()=>input(0));
// Daneben mit Richtung (aus Sicht des Schützen): 'ml' = links, 'mr' = rechts
pd($('#bNoL'),()=>input('ml'));pd($('#bNoR'),()=>input('mr'));pd($('#btnMissL'),()=>input('ml'));pd($('#btnMissR'),()=>input('mr'));pd($('#readyBtn'),()=>input('ready'));
$('#btnUndo').onclick=()=>undo();
$('#mLive').onclick=()=>{if(micHealth())detRestart()};
$('#btnEnd').onclick=()=>finish();

let R=null;
function later(fn,ms){R.timers.push(setTimeout(fn,ms))}
function clearTimers(){if(R){R.timers.forEach(clearTimeout);R.timers=[]}}
function curKind(){return R.D.kind==='combo'?R.stage:R.D.kind}
function ruleMs(){return(R.D.kind==='combo'&&R.stage==='shot'?R.D.rule2:R.D.rule)*1000}
function curTech(){return R.techNow||(R.D.kind==='combo'&&R.stage==='shot'?R.cfg.tech2:R.cfg.tech)}
function dirOn(){return!!S.missDir&&curKind()==='shot'&&inputMode()==='simple'} // „Genau“ zeigt links/rechts/unklar immer
function missEl(m,md){return md?(m==='seg'?$(md==='l'?'#btnMissL':'#btnMissR'):$(md==='l'?'#bNoL':'#bNoR')):(m==='seg'?$('#btnMiss'):$('#bNo'))}
function inputMode(){return curKind()==='shot'&&R.cfg.scoring==='exact'?'seg':'simple'}
function deckKey(){return curKind()==='shot'?'deckS':'deckP'}
function makeDeck(t){
  const per=R.cfg.amt==='count'?Math.ceil(R.cfg.count/t.length):5,d=[];
  t.forEach(x=>{for(let i=0;i<per;i++)d.push(x)});
  return R.cfg.order==='mix'?shuffle(d):d;
}
function drawTarget(){
  if(R.cfg.order==='weak'){
    const c=pickW(weakPlan(R.cfg,curKind()).combos,R.lastPicks);
    R.lastPicks=((R.lastPicks||[]).concat(c)).slice(-2);R.techNow=c.k;R.pending=null;return c.g;
  }
  R.techNow=null;
  const k=deckKey();if(!R[k].length)R[k]=makeDeck(curKind()==='shot'?R.cfg.tS:R.cfg.tP);
  const t=R[k].shift();R.pending={k,t};return t;
}
function isDone(){return R.cfg.amt==='count'?R.reps>=R.cfg.count:Date.now()-R.t0>=R.cfg.minutes*60000}

async function startSession(cfg,plan){
  if(!prOn(cfg)&&cfg.pr)cfg=Object.assign({},cfg,{pr:0}); // Druckmodus gibt es nicht bei Kombi
  const micP=S.mic?detStart():null; // im Tap anfragen
  ensureAudio();speak(' ');beep(660,.08,.2); // im Tap → entsperrt Audio auf iOS
  $('#summary').classList.add('hidden');
  const d=DISC[cfg.d];
  R={id:Date.now().toString(36),cfg:clone(cfg),D:d,plan,entries:[],reps:0,stage:d.kind==='shot'?'shot':'pass',
     deckP:[],deckS:[],pending:null,phase:'idle',target:null,callAt:0,detectAt:null,phaseStart:performance.now(),phaseDur:0,
     timers:[],active:true,undo:null,lastHit:null,t0:Date.now()};
  R.lp0=DISC[cfg.d].kind==='combo'?null:lpState(cfg.d,cfg.tech).cur; // Lernpfad-Stufe vor der Session
  R.gam0=gamSnapshot(); // Stand vor der Session (XP, Challenges) für die Auswertung
  D.sessions.push({id:R.id,start:Date.now(),d:cfg.d,cfg:clone(cfg)});save(LS_DATA,D);
  show('train');renderTrain();wake(true);
  $('#mLive').classList.toggle('hidden',!S.mic);
  if(micP&&!await micP)toast('Schusserkennung unvollständig – siehe Anzeige');
  if(S.mic&&S.voiceIn)toast('Hinweis: iOS kann Mikrofon und Spracheingabe nicht immer gleichzeitig');
  if(S.voiceIn)recStart();
  if(R.cfg.order==='weak'){R.share0={};weakKinds(R.cfg).forEach(k=>{const m={};weakShares(R.cfg,k).list.forEach(c=>m[c.k+'|'+c.g]=c.share);R.share0[k]=m});showWeakIntro()}
  else later(startRep,1000);
  requestAnimationFrame(tick);
}
function setPhase(p,dur){R.phase=p;R.phaseStart=performance.now();R.phaseDur=dur||0;renderTrain()}
function startRep(){
  clearTimers();R.corr=null;R.detectAt=null;R.undo=null;
  if(R.nextStage){R.stage=R.nextStage;R.nextStage=null}
  const first=R.D.kind==='shot'?'shot':'pass';
  if(prGoal()&&prState().ok)return finish(); // Druckmodus: Serie geschafft
  if(R.stage===first&&isDone())return finish();
  R.target=drawTarget();
  const rm=readyMode();
  if(rm==='off'){call();return}
  setPhase('ready');
  if(rm==='auto')later(goReady,autoMs());
}
/* Aufbauzeit nach jedem Versuch (Ball holen, hinlegen, Hände an die Griffe): 'auto' = Countdown, „Ja“/Tippen beendet ihn früher,
   'tap' = wartet auf „Ja“/Tippen, 'off' = Ziel kommt sofort. Bei Signal und beim Schuss der Kombi ist sie Pflicht (dort nie 'off'). */
function readyMode(){
  const forced=R.cfg.timing==='signal'||(R.D.kind==='combo'&&R.stage==='shot');
  const m=R.cfg.ready==='tap'||R.cfg.ready==='off'?R.cfg.ready:'auto';
  return m==='off'&&forced?'tap':m;
}
function autoMs(){return(R.cfg.auto||5)*1000}
const GRIP_MS=500; // nach „Bereit“: Zeit, um die Griffe anzufassen
function goReady(){
  if(R.phase!=='ready')return;
  clearTimers();beep(520,.05,.15);
  if(R.cfg.timing==='free'){setPhase('grip',GRIP_MS);later(call,GRIP_MS);return} // bei Signal deckt die Zufallszeit (mind. 1 s) die Griffzeit ab
  const max=Math.max(1.5,ruleMs()/1000-R.cfg.window-2),w=(1+Math.random()*(max-1))*1000;
  setPhase('wait',w);later(call,w);
}
function call(){
  const sig=R.cfg.timing==='signal';
  R.callAt=performance.now();R.detectAt=null;
  setPhase(sig?'call':'aim',sig?R.cfg.window*1000:ruleMs());
  if(sig)beep();
  const k=curKind(),t=R.target,mb=prMatch()?'Matchball. ':'';
  if(k==='shot'&&t>0)speak(mb+NUM[t]);
  else if(k==='pass'&&t)speak(mb+t,'en-US');
  else if(mb)speak('Matchball');
  else if(!sig)beep();
  pulse();
  later(timeUp,sig?R.cfg.window*1000:ruleMs());
}
function timeUp(){ // zwei tiefe Töne = Zeit abgelaufen
  if(!R||!R.active||R.detectAt!=null)return;
  beep(330,.22,.5);setTimeout(()=>beep(247,.35,.5),280);
}
const SEGC=[null,'#4a96ee','#f0743a','#22b98a','#a07cf0','#e0609a'],PASSC={wall:'#4a96ee',lane:'#f0743a'}; // wie --s1…--s5 in app.css
function targetColor(){const k=curKind();return k==='shot'?(R.target>0?SEGC[R.target]:null):(PASSC[R.target]||null)}
function updateBeam(live){
  const b=$('#beam'),c=live&&!R.undo?targetColor():null;
  // Nur bei Schüssen auf ein bestimmtes Segment, und nur hinter genau diesem Segment (nie über den Buttons)
  if(!c||curKind()!=='shot'||!(R.target>0)||segs.classList.contains('hidden')){b.className='beam';b.dataset.t='';return}
  const key=R.callAt+'|'+R.target;if(b.dataset.t===key)return;b.dataset.t=key;
  const sr=segs.children[R.target-1].getBoundingClientRect(),tr=$('#train').getBoundingClientRect();
  b.style.left=(sr.left-tr.left)+'px';b.style.width=sr.width+'px';b.style.top=(sr.top-tr.top)+'px';b.style.height=sr.height+'px';b.style.bottom='auto';
  b.style.setProperty('--bc',c);b.className='beam';void b.offsetWidth;b.className='beam on';
}
/* Pass-Skizze: Draufsicht aus Sicht des Spielers. Unten eigene 5er, Mitte gegnerische 5er, oben eigene 3er.
   Wall = entlang der Bande, Lane = durch die Lücke zwischen den gegnerischen Figuren. */
function renderPassViz(live){
  const el=$('#pviz'),t=R.target,key=t+'|'+live;if(el.dataset.k===key)return;el.dataset.k=key;
  const W=PASSC.wall,L=PASSC.lane,on=g=>live&&(t===g||t===0),op=g=>on(g)?1:.22;
  // Ausschnitt: linke Tischhälfte (Ball an der Bande), Spielfeld läuft rechts aus dem Bild
  const men=(y,xs,c)=>'<line x1="6" x2="170" y1="'+y+'" y2="'+y+'" class="rod"/>'+xs.map(x=>'<rect x="'+(x-8)+'" y="'+(y-10)+'" width="16" height="20" rx="4" fill="'+c+'"/>').join('');
  el.innerHTML='<svg viewBox="0 0 150 232" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'
    +'<rect x="6" y="4" width="170" height="224" rx="10" class="field"/>'
    +men(56,[50,110],'#e8eaed')+men(132,[30,70,110,150],'#5b6270')+men(206,[30,70,110,150],'#e8eaed')
    +'<circle cx="30" cy="188" r="7" fill="#ffb020"/>'
    +'<g opacity="'+op('wall')+'"><path d="M17 180 V64" stroke="'+W+'" class="arr"/><path d="M9 74 L17 60 L25 74" stroke="'+W+'" class="arr"/>'
    +'<text x="10" y="30" fill="'+W+'" class="plbl">WALL</text></g>'
    +'<g opacity="'+op('lane')+'"><path d="M38 180 C48 150 50 110 54 70" stroke="'+L+'" class="arr"/><path d="M46 78 L55 64 L62 79" stroke="'+L+'" class="arr"/>'
    +'<text x="76" y="30" fill="'+L+'" class="plbl">LANE</text></g>'
    +'</svg>';
}
function pulse(){if(curKind()!=='shot'||!(R.target>0))return;const s=segs.children[R.target-1];s.classList.remove('pulse');void s.offsetWidth;s.classList.add('pulse')}
function renderTrain(){
  const live=R.phase==='aim'||R.phase==='call',m=inputMode(),k=curKind();
  $('#readyBtn').classList.toggle('hidden',R.phase!=='ready');
  const showSeg=R.phase!=='ready'&&(m==='seg'||(k==='shot'&&(R.target>0||R.cfg.tS.some(x=>x>0))));
  segs.classList.toggle('hidden',!showSeg);segs.classList.toggle('ro',m!=='seg');
  const showP=k==='pass'&&R.phase!=='ready';
  $('#pviz').classList.toggle('hidden',!showP);if(showP)renderPassViz(live);
  $('#area').classList.toggle('split',(showSeg&&m==='simple')||showP);
  $('#simple').classList.toggle('hidden',R.phase==='ready'||m!=='simple');
  const dir=dirOn(); // nur Wertung „Einfach“ + Einstellung „Daneben mit Richtung“
  $('#btnMiss').classList.toggle('hidden',m!=='seg');$('#btnMissL').classList.toggle('hidden',m!=='seg');$('#btnMissR').classList.toggle('hidden',m!=='seg'); // „Genau“: links / unklar / rechts immer
  $('#bNo').classList.toggle('hidden',dir);$('#bNoL').classList.toggle('hidden',!dir);$('#bNoR').classList.toggle('hidden',!dir);$('#simple').classList.toggle('dir',dir);
  $('#area').classList.toggle('off',!live&&R.phase!=='ready'&&!R.corr);
  [...segs.children].forEach((s,i)=>s.classList.toggle('target',live&&R.target===i+1));
  updateBeam(live);
  $('#bYes').textContent=k==='pass'?'Gefangen':'Treffer';$('#bNo').textContent=k==='pass'?'Verloren':'Daneben';
  $('#tMode').textContent=R.D.n+' · '+curTech()+(R.D.kind==='combo'?' ('+(k==='pass'?'Pass':'Schuss')+')':'')+(R.plan?' · Station '+(R.plan.i+1)+'/'+R.plan.steps.length:'');
  const n=R.entries.length,h=R.entries.filter(s=>s.h).length;
  const pg=prGoal();
  $('#tRate').innerHTML=pg?'Serie '+prState().streak+' / '+pg+(n?' · '+h+'/'+n:''):n?h+'/'+n+' · '+pct(h/n)+gamStreak(R.entries):'';
  updateWeakLive();
}
let lastTxt='';
function tick(){
  if(!R||!R.active)return;
  const el=performance.now()-R.phaseStart,rem=R.phaseDur-el,k=curKind(),tgt=tl(R.target,k).toUpperCase();
  let txt='',frac=0,cls='';
  if(R.undo){txt='Korrektur · '+tgt}
  else switch(R.phase){
    case 'idle':txt='Bereit machen …';break;
    case 'ready':if(readyMode()==='auto'){txt='Aufbauen · '+Math.max(1,Math.ceil((autoMs()-el)/1000))+(S.voiceIn?' · „Ja“ = bereit':' · tippen = bereit');frac=Math.min(1,el/autoMs())}
      else txt=S.voiceIn?'Bereit? „Ja“ / Tippen':'Bereit? Tippen';break;
    case 'grip':txt='Griffe …';break;
    case 'wait':txt='Achtung …';cls='alert';break;
    case 'call':txt=rem>0?tgt+' – JETZT':tgt+' · Zeit um';cls=rem>0?'alert':'late';frac=Math.max(0,rem/R.phaseDur);break;
    case 'aim':txt=tgt+' · '+(rem>0?Math.ceil(rem/1000)+' s':'Zeit um');frac=Math.max(0,rem/R.phaseDur);if(rem<=0)cls='late';break;
    case 'result':txt=R.lastHit?(k==='pass'?'Gefangen':'Treffer'):(k==='pass'?'Verloren':'Daneben');cls=R.lastHit?'ok':'late';
      if(R.corr){txt+=' · falsch? tippen';frac=Math.max(0,rem/R.phaseDur)}break;
  }
  const mb=prMatch()&&!R.undo&&(R.phase==='call'||R.phase==='aim');
  if(mb){txt='MATCHBALL · '+txt;if(!cls.includes('late'))cls='alert'}
  if(S.mic&&R.detectAt!=null&&!R.undo&&(R.phase==='call'||R.phase==='aim'))txt+=' · ⚡ '+fmt((R.detectAt-R.callAt)/1000)+' s'+(inputMode()==='seg'?' · wohin?':'');
  const key=txt+cls;
  const sc=(R.phase==='aim'||R.phase==='call')&&!R.undo&&!cls.includes('late')&&!mb&&curKind()==='shot'?targetColor():null;
  if(key+sc!==lastTxt){const st=$('#tStatus');st.textContent=txt;st.className='status '+cls;st.style.color=sc||'';lastTxt=key+sc}
  $('#tBar').style.width=(frac*100)+'%';
  // Zähler
  if(R.cfg.amt==='count')$('#tCount').textContent=Math.min(R.reps+1,R.cfg.count)+' / '+R.cfg.count;
  else{const r=Math.max(0,R.cfg.minutes*60000-(Date.now()-R.t0)),s=Math.ceil(r/1000);$('#tCount').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
  requestAnimationFrame(tick);
}
function correct(v){
  const e=R.corr.e,m=inputMode();let l=null,h,md=null;
  if(v==='ml'||v==='mr'){md=v[1];v=0}
  if(v==='hit')h=true;else if(v===0){h=false;if(m==='seg')l=0}else{l=v;h=e.g===0?true:v===e.g}
  e.l=l;e.h=h;e.fix=true;if(md)e.md=md;else delete e.md;save(LS_DATA,D);
  clearTimers();R.corr=null;R.lastHit=h;beep(h?1200:400,.07,.2);
  const el=m==='seg'?(l>0?segs.children[l-1]:missEl(m,md)):(h?$('#bYes'):missEl(m,md));
  el.classList.add(h?'fhit':'fmiss');setTimeout(()=>el.classList.remove('fhit','fmiss'),450);
  setPhase('result');later(startRep,800);
}
function input(v,auto){
  if(!R||!R.active||v===null)return;
  if(v==='ready'){if(R.phase==='ready')goReady();return}
  if(R.phase==='result'&&R.corr){correct(v);return}
  if(!(R.phase==='aim'||R.phase==='call'))return;
  const k=curKind(),m=inputMode();
  let l=null,h,md=null;
  if(v==='ml'||v==='mr'){if(k!=='shot')return;md=v[1];v=0}
  if(v==='hit')h=true;
  else if(v===0){h=false;if(m==='seg')l=0}
  else{l=v;h=R.target===0?true:v===R.target}
  let rt=null,late=null;
  if(R.undo){rt=R.undo.rt;late=R.undo.late;R.undo=null}
  else if(S.mic&&R.detectAt!=null){rt=Math.round(R.detectAt-R.callAt);if(R.cfg.timing==='signal')late=rt>R.cfg.window*1000}
  const passOk=R.D.kind==='combo'&&R.stage==='pass'&&h,end=!passOk;
  const e={s:R.id,t:Date.now(),d:R.cfg.d,st:k,k:curTech(),g:R.target,l,h,rt,late,sig:R.cfg.timing==='signal',end};
  if(auto)e.auto=true;
  if(md)e.md=md;
  R.entries.push(e);D.shots.push(e);save(LS_DATA,D);
  R.pending=null;clearTimers();R.lastHit=h;
  if(end){R.reps++;R.nextStage=R.D.kind==='combo'?'pass':R.stage}else R.nextStage='shot'; // Phasenwechsel erst beim nächsten Ziel, sonst stimmt die Anzeige im Korrekturfenster nicht
  beep(h?1200:400,.07,.2);
  const el=m==='seg'?(l>0?segs.children[l-1]:missEl(m,md)):(h?$('#bYes'):missEl(m,md));
  el.classList.add(h?'fhit':'fmiss');setTimeout(()=>el.classList.remove('fhit','fmiss'),450);
  if(auto){const w=S.corrWin*1000;R.corr={e};setPhase('result',w);later(startRep,w)}
  else{setPhase('result');later(startRep,550)}
}
function confirmCorr(){ // „Ja“ im Korrekturfenster: Eintrag stimmt, nächster Versuch ohne Restzeit
  if(!R||!R.active||!R.corr)return;
  clearTimers();R.corr=null;startRep();
}
function undo(){
  if(!R||!R.active||!R.entries.length)return;R.corr=null;
  const e=R.entries.pop(),i=D.shots.lastIndexOf(e);if(i>=0)D.shots.splice(i,1);save(LS_DATA,D);
  clearTimers();
  if(R.pending){R[R.pending.k].unshift(R.pending.t);R.pending=null}
  if(e.end)R.reps--;
  R.nextStage=null;if(R.D.kind==='combo')R.stage=e.st;
  R.target=e.g;if(R.cfg.order==='weak')R.techNow=e.k;R.undo={rt:e.rt,late:e.late};R.detectAt=null;
  setPhase(R.cfg.timing==='signal'?'call':'aim',0);
}
function finish(){
  if(!R)return;
  clearTimers();R.active=false;wake(false);recStop();
  if(!R.entries.length){D.sessions=D.sessions.filter(x=>x.id!==R.id);cloudDelS(R.id);save(LS_DATA,D);const p=R.plan;R=null;show('home');return}
  const sess=D.sessions.find(x=>x.id===R.id);if(sess){sess.end=Date.now();sess.reps=R.reps;if(prGoal()){const p=prState();sess.pr={g:p.g,ok:p.ok,best:p.best,n:p.n}}}
  save(LS_DATA,D);
  beep(880,.15,.3);
  showSummary();
}

/* ---------- Auswertung ---------- */
function agg(a){
  const n=a.length,h=a.filter(s=>s.h).length,rts=a.filter(s=>s.rt!=null).map(s=>s.rt),lk=a.filter(s=>s.late!=null);
  const wrong=a.filter(s=>typeof s.l==='number'&&s.l>0&&typeof s.g==='number'&&s.g>0&&!s.h);
  return{n,h,rate:n?h/n:0,rtAvg:rts.length?rts.reduce((x,y)=>x+y,0)/rts.length:null,rtN:rts.length,
    inWin:lk.length?lk.filter(s=>!s.late).length/lk.length:null,
    dev:wrong.length?wrong.reduce((x,s)=>x+(s.l-s.g),0)/wrong.length:null,wrongN:wrong.length,
    outN:a.filter(s=>s.l===0).length};
}
/* Richtung eines Fehlschusses aus Sicht des Schützen: 'l', 'r' oder null.
   Quelle 1: ausdrücklich erfasst (md, Einstellung „Daneben mit Richtung“).
   Quelle 2: Wertung „Genau“ – getroffenes Segment links/rechts vom Ziel.
   Grundlage für spätere Schwachstellenanalyse, Technik-Tipps und Trainer-Auswertung. */
function missSide(z){
  if(z.h||z.st!=='shot')return null;
  if(z.md==='l'||z.md==='r')return z.md;
  if(typeof z.l==='number'&&z.l>0&&typeof z.g==='number'&&z.g>0&&z.l!==z.g)return z.l<z.g?'l':'r';
  return null;
}
function sideCount(a){let l=0,r=0;for(const z of a){const s=missSide(z);if(s==='l')l++;else if(s==='r')r++}return{l,r,n:l+r}}
function tend(a){if(a.dev==null)return'–';if(a.dev<-.25)return'← eher links ('+fmt(a.dev,1)+')';if(a.dev>.25)return'eher rechts → (+'+fmt(a.dev,1)+')';return'ausgeglichen'}
function kv(k,v){return'<div class="kv"><span>'+k+'</span><b>'+v+'</b></div>'}
function targetRow(a,kind){
  const ts=TORDER.filter(t=>a.some(s=>s.g===t));if(ts.length<2&&!(ts[0]>0))return'';
  return'<div class="segrow" style="--c:'+ts.length+'">'+ts.map(t=>{const x=a.filter(s=>s.g===t),h=x.filter(s=>s.h).length;
    return'<div>'+tl(t,kind)+'<b>'+Math.round(h/x.length*100)+'%</b>'+h+'/'+x.length+'</div>'}).join('')+'</div>';
}
function detailKV(a,b){
  let x='';
  if(b.rtAvg!=null)x+=kv('Ø Reaktionszeit (Mikro)',fmt(b.rtAvg/1000)+' s ('+b.rtN+')');
  if(b.inWin!=null)x+=kv('Im Reaktionsfenster',pct(b.inWin));
  if(b.wrongN)x+=kv('Falsches Segment / daneben',b.wrongN+' / '+b.outN),x+=kv('Tendenz',tend(b));
  const sc=sideCount(a.filter(z=>z.md));if(sc.n)x+=kv('Daneben links / rechts',sc.l+' / '+sc.r);
  const unk=a.filter(z=>z.st==='shot'&&z.l===0&&!z.md).length;if(unk)x+=kv('Daneben ohne Angabe wohin',unk+' (nicht in „Wohin geht der Ball?“)');
  return x;
}
function groups(a){
  const m=new Map();
  for(const s of a){const key=s.d+'|'+s.st;if(!m.has(key))m.set(key,[]);m.get(key).push(s)}
  return[...m.entries()].map(([key,arr])=>{const[d,st]=key.split('|');
    return{d,st,arr,title:(DISC[d]?DISC[d].n:d)+(DISC[d]&&DISC[d].kind==='combo'?' – '+(st==='pass'?'Pass':'Schuss'):'')}});
}
function chainRate(a){const ends=a.filter(s=>s.d==='k53'&&s.end);return ends.length?{n:ends.length,h:ends.filter(s=>s.st==='shot'&&s.h).length}:null}
function nextPlanBtn(){return $('#sumNext')}
function showSummary(){
  // Reihenfolge: Ergebnis → Belohnung (XP, Challenges) → Details. Buttons fest am unteren Rand.
  const a=R.entries,gs=groups(a);let html='',det='';
  html+='<div class="sumhead">'+gs.map(g=>{const b=agg(g.arr);return'<div><div class="blockh">'+g.title+'</div><div class="bigpct">'+pct(b.rate)+'</div><p class="center">'+b.h+' von '+b.n+'</p></div>'}).join('')+'</div>';
  html+=prSummary();
  const ch=chainRate(a);if(ch)html+=kv('Kette Pass → Tor',ch.h+' / '+ch.n+' ('+pct(ch.h/ch.n)+')');
  html+=stdSummary();
  html+=lpSummary();
  html+=gamSummary(R.gam0);
  for(const g of gs){const b=agg(g.arr),x=targetRow(g.arr,g.st)+detailKV(g.arr,b);if(x)det+=(gs.length>1?'<div class="blockh">'+g.title+'</div>':'')+x}
  if(R.cfg.order==='weak'&&R.share0){
    for(const kind of weakKinds(R.cfg)){
      const ws=weakShares(R.cfg,kind),s0=R.share0[kind]||{};
      det+='<div class="blockh">Fokus-Verschiebung'+(weakKinds(R.cfg).length>1?' ('+(kind==='pass'?'Pass':'Schuss')+')':'')+'</div>'
        +ws.list.slice().sort((a,b)=>(s0[b.k+'|'+b.g]||0)-(s0[a.k+'|'+a.g]||0)).slice(0,3)
          .map(c=>kv(weakLabel(R.cfg,c,kind),Math.round(s0[c.k+'|'+c.g]||0)+' % → '+Math.round(c.share)+' %')).join('');
    }
  }
  if(det)html+='<div class="sumdet"><h2>Details</h2>'+det+'</div>';
  html+='<p class="center" style="margin-top:12px">'+cfgLabel(R.cfg)+'</p>';
  const hasNext=R.plan&&R.plan.i+1<R.plan.steps.length,nextCfg=hasNext?R.plan.steps[R.plan.i+1]:null;
  let foot='';
  if(hasNext)foot+='<p class="center" style="margin:0 0 2px">Nächste: '+cfgLabel(nextCfg)+(S.voiceIn?' · oder „Ja“':'')+'</p><button class="big primary" id="sumNext">Weiter: Station '+(R.plan.i+2)+' von '+R.plan.steps.length+'</button>';
  foot+='<button class="big'+(hasNext?'':' primary')+'" id="sumAgain">Nochmal</button><div class="two eq"><button class="big" id="sumStats">Details / korrigieren</button><button class="big" id="sumHome">Menü</button></div>';
  $('#summaryBody').innerHTML='<div class="sumscroll">'+html+'</div><div class="sumfoot">'+foot+'</div>';$('#summary').classList.remove('hidden');
  const cfg=R.cfg,plan=R.plan;
  if(hasNext){$('#sumNext').onclick=()=>startSession(nextCfg,{i:plan.i+1,steps:plan.steps,name:plan.name});if(S.voiceIn)recStart()}
  $('#sumAgain').onclick=()=>startSession(cfg,plan);
  $('#sumHome').onclick=()=>{recStop();$('#summary').classList.add('hidden');R=null;renderHome();show('home')};
  $('#sumStats').onclick=()=>{const id=R.id;recStop();$('#summary').classList.add('hidden');R=null;ST.session=id;ST.open=id;ST.edit=null;ST.disc='all';ST.tech='all';ST.timing='all';show('stats');renderStats()};
  if(S.voiceOut){const all=agg(a),ps=prState();speak((ps.g?(ps.ok?'Geschafft. ':'Nicht geschafft. '):hasNext?'Übung fertig. ':'Fertig. ')+all.h+' von '+all.n)}
}
