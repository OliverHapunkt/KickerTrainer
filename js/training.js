'use strict';
/* KickerTrainer · Training und Auswertung nach der Session */
/* ---------- Training ---------- */
const segs=$('#segs');
for(let n=1;n<=5;n++){const b=document.createElement('button');b.className='seg';b.textContent=n;
  b.addEventListener('pointerdown',e=>{e.preventDefault();input(n)});segs.appendChild(b)}
function pd(el,fn){el.addEventListener('pointerdown',e=>{e.preventDefault();fn()})}
pd($('#btnMiss'),()=>input(0));pd($('#bYes'),()=>input('hit'));pd($('#bNo'),()=>input(0));pd($('#readyBtn'),()=>input('ready'));
$('#btnUndo').onclick=()=>undo();
$('#mLive').onclick=()=>{if(micHealth())detRestart()};
$('#btnEnd').onclick=()=>finish();

let R=null;
function later(fn,ms){R.timers.push(setTimeout(fn,ms))}
function clearTimers(){if(R){R.timers.forEach(clearTimeout);R.timers=[]}}
function curKind(){return R.D.kind==='combo'?R.stage:R.D.kind}
function ruleMs(){return(R.D.kind==='combo'&&R.stage==='shot'?R.D.rule2:R.D.rule)*1000}
function curTech(){return R.techNow||(R.D.kind==='combo'&&R.stage==='shot'?R.cfg.tech2:R.cfg.tech)}
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
  const micP=S.mic?detStart():null; // im Tap anfragen
  ensureAudio();speak(' ');beep(660,.08,.2); // im Tap → entsperrt Audio auf iOS
  $('#summary').classList.add('hidden');
  const d=DISC[cfg.d];
  R={id:Date.now().toString(36),cfg:clone(cfg),D:d,plan,entries:[],reps:0,stage:d.kind==='shot'?'shot':'pass',
     deckP:[],deckS:[],pending:null,phase:'idle',target:null,callAt:0,detectAt:null,phaseStart:performance.now(),phaseDur:0,
     timers:[],active:true,undo:null,lastHit:null,t0:Date.now()};
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
  if(R.stage===first&&isDone())return finish();
  R.target=drawTarget();
  const needReady=R.cfg.timing==='signal'||(R.D.kind==='combo'&&R.stage==='shot');
  if(!needReady){call();return}
  setPhase('ready');
  if(R.cfg.ready==='auto')later(goReady,R.cfg.auto*1000);
}
function goReady(){
  if(R.phase!=='ready')return;
  clearTimers();beep(520,.05,.15);
  if(R.cfg.timing==='free'){call();return}
  const max=Math.max(1.5,ruleMs()/1000-R.cfg.window-2),w=(1+Math.random()*(max-1))*1000;
  setPhase('wait',w);later(call,w);
}
function call(){
  const sig=R.cfg.timing==='signal';
  R.callAt=performance.now();R.detectAt=null;
  setPhase(sig?'call':'aim',sig?R.cfg.window*1000:ruleMs());
  if(sig)beep();
  const k=curKind(),t=R.target;
  if(k==='shot'&&t>0)speak(NUM[t]);
  else if(k==='pass'&&t)speak(t,'en-US');
  else if(!sig)beep();
  pulse();
  later(timeUp,sig?R.cfg.window*1000:ruleMs());
}
function timeUp(){ // zwei tiefe Töne = Zeit abgelaufen
  if(!R||!R.active||R.detectAt!=null)return;
  beep(330,.22,.5);setTimeout(()=>beep(247,.35,.5),280);
}
const SEGC=[null,'#4a96ee','#f0743a','#22b98a','#ffb020','#e0609a'],PASSC={wall:'#4a96ee',lane:'#f0743a'};
function targetColor(){const k=curKind();return k==='shot'?(R.target>0?SEGC[R.target]:null):(PASSC[R.target]||null)}
function updateBeam(live){
  const b=$('#beam'),c=live&&!R.undo?targetColor():null;
  if(!c){b.className='beam';b.dataset.t='';return}
  const key=R.callAt+'|'+R.target;if(b.dataset.t===key)return;b.dataset.t=key;
  if(curKind()==='shot'&&!segs.classList.contains('hidden')){
    const sr=segs.children[R.target-1].getBoundingClientRect(),tr=$('#train').getBoundingClientRect();
    b.style.left=(sr.left-tr.left)+'px';b.style.width=sr.width+'px';
  }else{b.style.left='0';b.style.width='100%'}
  b.style.setProperty('--bc',c);b.className='beam';void b.offsetWidth;b.className='beam on';
}
function pulse(){if(curKind()!=='shot'||!(R.target>0))return;const s=segs.children[R.target-1];s.classList.remove('pulse');void s.offsetWidth;s.classList.add('pulse')}
function renderTrain(){
  const live=R.phase==='aim'||R.phase==='call',m=inputMode(),k=curKind();
  $('#readyBtn').classList.toggle('hidden',R.phase!=='ready');
  const showSeg=R.phase!=='ready'&&(m==='seg'||(k==='shot'&&(R.target>0||R.cfg.tS.some(x=>x>0))));
  segs.classList.toggle('hidden',!showSeg);segs.classList.toggle('ro',m!=='seg');
  $('#area').classList.toggle('split',showSeg&&m==='simple');
  $('#simple').classList.toggle('hidden',R.phase==='ready'||m!=='simple');
  $('#btnMiss').classList.toggle('hidden',m!=='seg');
  $('#area').classList.toggle('off',!live&&R.phase!=='ready'&&!R.corr);
  [...segs.children].forEach((s,i)=>s.classList.toggle('target',live&&R.target===i+1));
  updateBeam(live);
  $('#bYes').textContent=k==='pass'?'Gefangen':'Treffer';$('#bNo').textContent=k==='pass'?'Verloren':'Daneben';
  $('#tMode').textContent=R.D.n+' · '+curTech()+(R.D.kind==='combo'?' ('+(k==='pass'?'Pass':'Schuss')+')':'')+(R.plan?' · Plan '+(R.plan.i+1)+'/'+S.plan.length:'');
  const n=R.entries.length,h=R.entries.filter(s=>s.h).length;
  $('#tRate').textContent=n?h+'/'+n+' · '+pct(h/n):'';
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
    case 'ready':txt=R.cfg.ready==='auto'?'Aufbauen · '+Math.max(1,Math.ceil((R.cfg.auto*1000-el)/1000)):(S.voiceIn?'Bereit? „Ja“ / Tippen':'Bereit? Tippen');
      if(R.cfg.ready==='auto')frac=Math.min(1,el/(R.cfg.auto*1000));break;
    case 'wait':txt='Achtung …';cls='alert';break;
    case 'call':txt=rem>0?tgt+' – JETZT':tgt+' · Zeit um';cls=rem>0?'alert':'late';frac=Math.max(0,rem/R.phaseDur);break;
    case 'aim':txt=tgt+' · '+(rem>0?Math.ceil(rem/1000)+' s':'Zeit um');frac=Math.max(0,rem/R.phaseDur);if(rem<=0)cls='late';break;
    case 'result':txt=R.lastHit?(k==='pass'?'Gefangen':'Treffer'):(k==='pass'?'Verloren':'Daneben');cls=R.lastHit?'ok':'late';
      if(R.corr){txt+=' · falsch? tippen';frac=Math.max(0,rem/R.phaseDur)}break;
  }
  if(S.mic&&R.detectAt!=null&&!R.undo&&(R.phase==='call'||R.phase==='aim'))txt+=' · ⚡ '+fmt((R.detectAt-R.callAt)/1000)+' s';
  const key=txt+cls;
  const sc=(R.phase==='aim'||R.phase==='call')&&!R.undo&&!cls.includes('late')&&curKind()==='shot'?targetColor():null;
  if(key+sc!==lastTxt){const st=$('#tStatus');st.textContent=txt;st.className='status '+cls;st.style.color=sc||'';lastTxt=key+sc}
  $('#tBar').style.width=(frac*100)+'%';
  // Zähler
  if(R.cfg.amt==='count')$('#tCount').textContent=Math.min(R.reps+1,R.cfg.count)+' / '+R.cfg.count;
  else{const r=Math.max(0,R.cfg.minutes*60000-(Date.now()-R.t0)),s=Math.ceil(r/1000);$('#tCount').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
  requestAnimationFrame(tick);
}
function correct(v){
  const e=R.corr.e,m=inputMode();let l=null,h;
  if(v==='hit')h=true;else if(v===0){h=false;if(m==='seg')l=0}else{l=v;h=e.g===0?true:v===e.g}
  e.l=l;e.h=h;e.fix=true;save(LS_DATA,D);
  clearTimers();R.corr=null;R.lastHit=h;beep(h?1200:400,.07,.2);
  const el=m==='seg'?(l>0?segs.children[l-1]:$('#btnMiss')):(h?$('#bYes'):$('#bNo'));
  el.classList.add(h?'fhit':'fmiss');setTimeout(()=>el.classList.remove('fhit','fmiss'),450);
  setPhase('result');later(startRep,800);
}
function input(v,auto){
  if(!R||!R.active||v===null)return;
  if(v==='ready'){if(R.phase==='ready')goReady();return}
  if(R.phase==='result'&&R.corr){correct(v);return}
  if(!(R.phase==='aim'||R.phase==='call'))return;
  const k=curKind(),m=inputMode();
  let l=null,h;
  if(v==='hit')h=true;
  else if(v===0){h=false;if(m==='seg')l=0}
  else{l=v;h=R.target===0?true:v===R.target}
  let rt=null,late=null;
  if(R.undo){rt=R.undo.rt;late=R.undo.late;R.undo=null}
  else if(S.mic&&R.detectAt!=null){rt=Math.round(R.detectAt-R.callAt);if(R.cfg.timing==='signal')late=rt>R.cfg.window*1000}
  const passOk=R.D.kind==='combo'&&R.stage==='pass'&&h,end=!passOk;
  const e={s:R.id,t:Date.now(),d:R.cfg.d,st:k,k:curTech(),g:R.target,l,h,rt,late,sig:R.cfg.timing==='signal',end};
  if(auto)e.auto=true;
  R.entries.push(e);D.shots.push(e);save(LS_DATA,D);
  R.pending=null;clearTimers();R.lastHit=h;
  if(end){R.reps++;R.nextStage=R.D.kind==='combo'?'pass':R.stage}else R.nextStage='shot'; // Phasenwechsel erst beim nächsten Ziel, sonst stimmt die Anzeige im Korrekturfenster nicht
  beep(h?1200:400,.07,.2);
  const el=m==='seg'?(l>0?segs.children[l-1]:$('#btnMiss')):(h?$('#bYes'):$('#bNo'));
  el.classList.add(h?'fhit':'fmiss');setTimeout(()=>el.classList.remove('fhit','fmiss'),450);
  if(auto){const w=S.corrWin*1000;R.corr={e};setPhase('result',w);later(startRep,w)}
  else{setPhase('result');later(startRep,550)}
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
  const sess=D.sessions.find(x=>x.id===R.id);if(sess){sess.end=Date.now();sess.reps=R.reps}
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
  const a=R.entries;let html='';
  for(const g of groups(a)){
    const b=agg(g.arr);
    html+='<div class="blockh">'+g.title+'</div><div class="bigpct">'+pct(b.rate)+'</div><p class="center">'+b.h+' von '+b.n+'</p>'+targetRow(g.arr,g.st)+detailKV(g.arr,b);
  }
  const ch=chainRate(a);if(ch)html+=kv('Kette Pass → Tor',ch.h+' / '+ch.n+' ('+pct(ch.h/ch.n)+')');
  if(R.cfg.order==='weak'&&R.share0){
    for(const kind of weakKinds(R.cfg)){
      const ws=weakShares(R.cfg,kind),s0=R.share0[kind]||{};
      html+='<div class="blockh">Fokus-Verschiebung'+(weakKinds(R.cfg).length>1?' ('+(kind==='pass'?'Pass':'Schuss')+')':'')+'</div>'
        +ws.list.slice().sort((a,b)=>(s0[b.k+'|'+b.g]||0)-(s0[a.k+'|'+a.g]||0)).slice(0,3)
          .map(c=>kv(weakLabel(R.cfg,c,kind),Math.round(s0[c.k+'|'+c.g]||0)+' % → '+Math.round(c.share)+' %')).join('');
    }
  }
  html+='<p class="center" style="margin-top:12px">'+cfgLabel(R.cfg)+'</p>';
  const hasNext=R.plan&&R.plan.i+1<S.plan.length;
  if(hasNext)html+='<button class="big primary" id="sumNext">Weiter: Übung '+(R.plan.i+2)+'</button><p class="center">'+cfgLabel(S.plan[R.plan.i+1])+(S.voiceIn?' · oder „Ja“':'')+'</p>';
  html+='<button class="big'+(hasNext?'':' primary')+'" id="sumAgain">Nochmal</button><div class="two" style="grid-template-columns:1fr 1fr"><button class="big" id="sumStats">Details / korrigieren</button><button class="big" id="sumHome">Menü</button></div>';
  $('#summaryBody').innerHTML=html;$('#summary').classList.remove('hidden');
  const cfg=R.cfg,plan=R.plan;
  if(hasNext){$('#sumNext').onclick=()=>startSession(S.plan[plan.i+1],{i:plan.i+1});if(S.voiceIn)recStart()}
  $('#sumAgain').onclick=()=>startSession(cfg,plan);
  $('#sumHome').onclick=()=>{recStop();$('#summary').classList.add('hidden');R=null;show('home')};
  $('#sumStats').onclick=()=>{const id=R.id;recStop();$('#summary').classList.add('hidden');R=null;ST.session=id;ST.open=id;ST.edit=null;ST.disc='all';ST.tech='all';ST.timing='all';show('stats');renderStats()};
  if(S.voiceOut){const all=agg(a);speak((hasNext?'Übung fertig. ':'Fertig. ')+all.h+' von '+all.n)}
}
