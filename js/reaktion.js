'use strict';
/* KickerTrainer · Reaktionsschießen
   Das Ziel-Segment wird angesagt, dann leuchten Lücken (grün) auf und gehen wieder zu. Geschossen wird, wenn das Ziel grün ist.
   Aufbau: Der obere Teil (RX, rxParams, rxNew, rxStep, rxJudge) ist reine Rechenlogik ohne DOM und lässt sich im Terminal testen.
   Der untere Teil verbindet sie mit dem Training (training.js). */
const RX={
  INTRO:1200,     // ms zwischen Ansage und erster Lücke
  GRACE:150,      // ms Toleranz nach dem Schließen (Flugzeit des Balls, Erkennungsverzögerung)
  NEAR:700,       // ms: ein Schuss so kurz nach dem Schließen gilt als „zu spät“, sonst als „zu früh“
  REOPEN:300,     // ms: ein gerade geschlossenes Segment bleibt mindestens so lange zu (sonst sähe man kein Schließen)
  MIN_GREEN:600,  // kürzeste Lücke überhaupt, auch bei Stufe 10
  LV_MIN:1,LV_MAX:10,
  UP:.5,DOWN:1    // dynamisch: Treffer = +0,5 Stufen, Daneben = −1 Stufe
};
/* Stufe 1 (leicht, langsam) … 10 (schwer, schnell), linear.
   gmin/gmax = so lange bleibt eine Lücke offen, dmin/dmax = Abstand, bis die nächste aufgeht,
   pause = so lange bleibt das Ziel nach einer Lücke mindestens zu, guar = spätestens danach geht das Ziel wieder auf */
function rxParams(L){
  L=Math.max(RX.LV_MIN,Math.min(RX.LV_MAX,L));const f=(L-1)/9;
  return{gmin:Math.round(2400-1800*f),gmax:Math.round(3600-2600*f),dmin:Math.round(600-450*f),dmax:Math.round(1200-750*f),
    pause:Math.round(900-600*f),guar:Math.round(4500-2500*f)};
}
function rxNew(target,L,now){
  return{t0:now,L,target,p:rxParams(L),open:[0,0,0,0,0,0],until:[0,0,0,0,0,0],lastOpen:[0,0,0,0,0,0],closedAt:[-1e9,-1e9,-1e9,-1e9,-1e9,-1e9],
    k:1,next:now,lastTgtEnd:now};
}
const rxOpenCount=x=>{let n=0;for(let s=1;s<=5;s++)if(x.open[s]>0)n++;return n};
/* Ein Schritt der Lückenuhr. Gibt true zurück, wenn sich ein Segment geändert hat. rnd = Zufallsfunktion (für Tests ersetzbar). */
function rxStep(x,now,rnd){
  let ch=false;
  for(let s=1;s<=5;s++)if(x.open[s]>0&&now>=x.until[s]){x.open[s]=0;x.closedAt[s]=x.until[s];ch=true;if(s===x.target)x.lastTgtEnd=x.until[s]}
  const open=(s)=>{x.open[s]=now;x.lastOpen[s]=now;x.until[s]=now+x.p.gmin+rnd()*(x.p.gmax-x.p.gmin);ch=true};
  const n=rxOpenCount(x),tgtFree=x.open[x.target]===0&&now-x.closedAt[x.target]>=x.p.pause;
  // Das Ziel geht spätestens nach „guar“ wieder auf, sonst wartet man ewig
  if(x.open[x.target]===0&&tgtFree&&n<3&&now-x.lastTgtEnd>=x.p.guar){open(x.target);x.k=1+Math.floor(rnd()*3);x.next=now+x.p.dmin+rnd()*(x.p.dmax-x.p.dmin);return true}
  // Immer mindestens eine Lücke; sonst bis zur zufälligen Anzahl 1–3 auffüllen, wenn der nächste Zeitpunkt da ist
  if(n===0||(n<x.k&&now>=x.next)){
    const free=[];for(let s=1;s<=5;s++)if(x.open[s]===0&&now-x.closedAt[s]>=RX.REOPEN&&(s!==x.target||tgtFree))free.push(s);
    if(free.length){open(free[Math.floor(rnd()*free.length)]);x.k=1+Math.floor(rnd()*3);x.next=now+x.p.dmin+rnd()*(x.p.dmax-x.p.dmin)}
  }
  return ch;
}
/* War das Ziel im Moment des Schusses offen? {tm:'ok',rt} (rt = ms seit Aufgehen) | {tm:'early'} | {tm:'late'} */
function rxJudge(x,t){
  const s=x.target;
  if(x.open[s]>0&&t>=x.open[s])return{tm:'ok',rt:t-x.open[s]};
  if(x.closedAt[s]>x.t0&&t-x.closedAt[s]<=RX.GRACE)return{tm:'ok',rt:Math.max(0,t-x.lastOpen[s])};
  if(x.closedAt[s]>x.t0&&t-x.closedAt[s]<=RX.NEAR)return{tm:'late'};
  return{tm:'early'};
}
/* Dynamisch: nach jedem Versuch Stufe anpassen */
function rxNext(L,hit){return Math.max(RX.LV_MIN,Math.min(RX.LV_MAX,L+(hit?RX.UP:-RX.DOWN)))}
function rxLevelText(L){return'Stufe '+(Math.round(L*10)%10?(Math.round(L*10)/10).toString().replace('.',','):Math.round(L))}
function rxHint(c){
  const p=rxParams(c.lvl),sec=ms=>(Math.round(ms/100)/10).toString().replace('.',',');
  return'Lücken bleiben '+sec(p.gmin)+'–'+sec(p.gmax)+' s offen, das Ziel geht spätestens nach '+sec(p.guar)+' s auf.'
    +(c.dyn?' Dynamisch: Treffer +0,5 Stufen, Daneben −1 Stufe.':'');
}

/* ---------- Anbindung an das Training ---------- */
const SEGS_EL=()=>$('#segs');
function reactOn(){return!!(R&&R.D&&R.D.react)}
/* Nach der Ansage: Lücken starten nach der Einleitung */
function rxArm(){R.rx=null;R.rxStartAt=performance.now()+RX.INTRO;rxPaint()}
function rxPaint(){
  const el=SEGS_EL(),on=reactOn()&&(R.phase==='aim'||R.phase==='call')&&!R.undo;
  [...el.children].forEach((b,i)=>{
    b.classList.toggle('rx',on);
    b.classList.toggle('open',on&&!!R.rx&&R.rx.open[i+1]>0);
    b.classList.toggle('tgt',on&&R.target===i+1);
  });
  el.classList.toggle('rxon',on);
}
/* Pro Bild aufgerufen (tick) */
function rxTick(now){
  if(!reactOn())return;
  const live=(R.phase==='aim'||R.phase==='call')&&!R.undo;
  if(!live){if(SEGS_EL().classList.contains('rxon')){R.rx=null;rxPaint()}return}
  if(!R.rx&&R.rxStartAt&&now>=R.rxStartAt){R.rx=rxNew(R.target,R.lvl,now)}
  if(R.rx&&rxStep(R.rx,now,Math.random))rxPaint();
}
function rxTargetOpen(){return!!(R&&R.rx&&R.rx.open[R.target]>0)}
/* Erkannter Schuss im Reaktionsschießen: Timing sofort beurteilen */
function reactShot(now){
  const j=R.rx?rxJudge(R.rx,now):{tm:'early'};
  R.detectAt=now;
  if(j.tm==='ok'){R.rxRt=Math.round(j.rt);input(inputMode()==='seg'&&R.target>0?R.target:'hit',true,'ok')}
  else input(0,true,j.tm);
}
/* Nach einem Versuch: Stufe anpassen (nur dynamisch) */
function rxAdapt(){
  if(!reactOn())return;
  const n=R.entries.length;
  if(R.cfg.dyn&&n>R.rxAdj&&n>0)R.lvl=rxNext(R.lvl,!!R.entries[n-1].h);
  R.rxAdj=n;
}
const RX_TXT={early:'Zu früh · Ziel war zu',late:'Zu spät · Ziel war zu',none:'Verpasst · kein Schuss'};
