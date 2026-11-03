'use strict';
/* KickerTrainer · Reaktionsschießen (zwei Disziplinen, gemeinsame Konfiguration)
   • Lücken (r3): Immer nur EIN Segment ist grün. Die grüne Lücke wandert in „Rhythmen“: kurze Muster aus Segment + Dauer,
     die sich wiederholen, dazwischen CHAOS (zufällig). Mit Ansage: Ziel wird angesagt, geschossen wird, wenn das Ziel grün ist.
     Ohne Ansage: geschossen wird aufs Segment, das gerade grün ist. Ab Stufe 6 leuchten zusätzlich Ablenkfarben.
   • Signal (r3s): Ziel wird angesagt, nach zufälliger Wartezeit kommt ein Piep mit Aufleuchten, dann zählt das Reaktionsfenster.
   Schwierigkeit: Fest (Stufe 1–10), Dynamisch (Treffer schwerer, Daneben leichter), Individuell (aus deiner eigenen Reaktionszeit).
   Aufbau: Der obere Teil ist reine Rechenlogik ohne DOM und lässt sich im Terminal testen. Der untere verbindet sie mit training.js. */
const RX={
  INTRO:1200,     // ms zwischen Ansage und Beginn
  INTRO_Q:800,    // ohne Ansage: kurze Vorlaufzeit
  GRACE:150,      // ms Toleranz nach dem Schließen (Flugzeit des Balls, Erkennungsverzögerung)
  NEAR:700,       // ms: ein Schuss so kurz nach dem Schließen gilt als „zu spät“, sonst als „zu früh“
  LV_MIN:1,LV_MAX:10,
  UP:.5,DOWN:1,   // dynamisch: Treffer = +0,5 Stufen, Daneben = −1 Stufe
  SIG_WAIT:[1500,4000], // Signal: zufällige Wartezeit nach der Ansage
  SIG_OVER:1500,  // Signal: so lange nach dem Fenster wird noch auf einen (zu späten) Schuss gewartet
  W_MIN:250,W_MAX:1500, // Individuell: Grenzen des Reaktionsfensters
  IND_N:20,IND_MIN:5    // Individuell: die letzten 20 Reaktionszeiten, mindestens 5
};
const clampL=L=>Math.max(RX.LV_MIN,Math.min(RX.LV_MAX,L));
const rint=(rnd,a,b)=>a+Math.floor(rnd()*(b-a+1));
const rms=(rnd,a,b)=>Math.round((a+rnd()*(b-a))/10)*10;

/* ---------- Lücken ----------
   Stufe 1 (leicht) … 10 (schwer), linear:
   on/off   = so lange ist ein Segment grün / danach alles grau (ms)
   len      = Schritte pro Rhythmus, pool = verschiedene Rhythmen pro Versuch, reps = Wiederholungen am Stück
   chaos    = Anteil der zufälligen Blöcke, colors = Zahl der Ablenkfarben (ab Stufe 6) */
function gpParams(L){
  L=clampL(L);const f=(L-1)/9,r=(a,b)=>Math.round(a+(b-a)*f);
  return{on:[r(1600,400),r(2400,700)],off:[r(500,100),r(900,300)],len:[2+Math.round(f),3+Math.round(2*f)],pool:1+Math.round(3*f),
    reps:[Math.max(1,Math.round(4-3*f)),Math.max(1,Math.round(5-3*f))],chaos:Math.round((.1+.25*f)*100)/100,chaosLen:[2,3+Math.round(2*f)],
    colors:L>=6?1+Math.floor((L-6)/2):0,deco:[r(1400,500),r(2200,900)],decoGap:[r(900,250),r(1600,600)]};
}
/* Ein Rhythmus: Folge von Schritten {s,on,off}. Nie zweimal dasselbe Segment hintereinander.
   Mit Ansage enthält jeder Rhythmus das Ziel, sonst könnte man ewig warten. */
function gpRhythm(p,target,rnd,label){
  const n=rint(rnd,p.len[0],p.len[1]),st=[];
  for(let i=0;i<n;i++){let s;do s=rint(rnd,1,5);while(i&&s===st[i-1].s);st.push({s,on:rms(rnd,p.on[0],p.on[1]),off:rms(rnd,p.off[0],p.off[1]),b:label})}
  if(target&&!st.some(x=>x.s===target)){
    const ok=st.map((_,i)=>i).filter(i=>(!i||st[i-1].s!==target)&&(i===n-1||st[i+1].s!==target));
    st[ok.length?ok[rint(rnd,0,ok.length-1)]:0].s=target;
  }
  return st;
}
function gpRefill(x,rnd){
  const p=x.p;
  if(rnd()<p.chaos){const ch=gpRhythm({...p,len:p.chaosLen},x.target,rnd,'chaos'); // auch im Chaos kommt das Ziel vor, sonst wird die Wartezeit zu lang
   x.q.push(...ch);x.blocks.push('chaos');return}
  const i=rint(rnd,0,x.pool.length-1),reps=rint(rnd,p.reps[0],p.reps[1]);
  for(let k=0;k<reps;k++)x.q.push(...x.pool[i].map(s=>({...s})));
  x.blocks.push(String.fromCharCode(65+i)+'×'+reps);
}
function rxNew(target,L,now,rnd){
  rnd=rnd||Math.random;
  const p=gpParams(L),x={t0:now,L,target,p,pool:[],q:[],blocks:[],cur:null,nextAt:now,open:[0,0,0,0,0,0],lastOpen:[0,0,0,0,0,0],
    closedAt:[-1e9,-1e9,-1e9,-1e9,-1e9,-1e9],deco:[0,0,0,0,0,0],decoEnd:[0,0,0,0,0,0],nextDeco:now+rms(rnd,p.decoGap[0],p.decoGap[1]),log:[]};
  for(let i=0;i<p.pool;i++)x.pool.push(gpRhythm(p,target,rnd,String.fromCharCode(65+i)));
  return x;
}
/* Ein Schritt der Lückenuhr (pro Bild). Gibt true zurück, wenn sich etwas geändert hat. rnd ist für Tests ersetzbar. */
function rxStep(x,now,rnd){
  rnd=rnd||Math.random;let ch=false;
  for(let guard=0;guard<50;guard++){
    if(!x.cur){
      if(now<x.nextAt)break;
      if(!x.q.length)gpRefill(x,rnd);
      const st=x.q.shift(),t=x.nextAt;x.cur={...st,t0:t};
      x.open[st.s]=t;x.lastOpen[st.s]=t;x.deco[st.s]=0;x.log.push({s:st.s,t,on:st.on,off:st.off,b:st.b});ch=true;
    }
    const c=x.cur;
    if(x.open[c.s]>0&&now>=c.t0+c.on){x.open[c.s]=0;x.closedAt[c.s]=c.t0+c.on;ch=true}
    if(x.open[c.s]===0&&now>=c.t0+c.on+c.off){x.nextAt=c.t0+c.on+c.off;x.cur=null;continue}
    break;
  }
  // Ablenkfarben (ab Stufe 6): nie auf dem grünen Segment
  if(x.p.colors){
    for(let s=1;s<=5;s++)if(x.deco[s]&&now>=x.decoEnd[s]){x.deco[s]=0;ch=true}
    const n=x.deco.filter(Boolean).length,max=Math.min(2,x.p.colors);
    if(n<max&&now>=x.nextDeco){
      const g=x.cur&&x.open[x.cur.s]>0?x.cur.s:0,free=[1,2,3,4,5].filter(s=>s!==g&&!x.deco[s]);
      if(free.length){const s=free[rint(rnd,0,free.length-1)];x.deco[s]=rint(rnd,1,x.p.colors);x.decoEnd[s]=now+rms(rnd,x.p.deco[0],x.p.deco[1]);ch=true}
      x.nextDeco=now+rms(rnd,x.p.decoGap[0],x.p.decoGap[1]);
    }
  }
  return ch;
}
const rxGreen=x=>x&&x.cur&&x.open[x.cur.s]>0?x.cur.s:0;
/* Schuss beurteilen. Mit Ansage zählt nur das Ziel, ohne Ansage das Segment, das gerade grün war.
   {tm:'ok',rt,s} | {tm:'late',s} | {tm:'early',s} */
function rxJudge(x,t){
  const tg=x.target;
  const os=tg?(x.open[tg]>0?tg:0):rxGreen(x);
  if(os&&t>=x.open[os])return{tm:'ok',rt:t-x.open[os],s:os};
  let ls=tg,lc=tg?x.closedAt[tg]:-1e9;
  if(!tg)for(let k=1;k<=5;k++)if(x.closedAt[k]>lc){lc=x.closedAt[k];ls=k}
  if(lc>x.t0&&t-lc<=RX.GRACE)return{tm:'ok',rt:Math.max(0,t-x.lastOpen[ls]),s:ls};
  if(lc>x.t0&&t-lc<=RX.NEAR)return{tm:'late',s:ls};
  return{tm:'early',s:tg||0};
}

/* ---------- Signal ----------
   Reaktionsfenster: Stufe 1 = 1,5 s, Stufe 10 = 0,4 s */
const sgWindow=L=>Math.round(1500-1100*(clampL(L)-1)/9);
function sgNew(W,now,rnd){rnd=rnd||Math.random;return{t0:now,W,beepAt:now+RX.INTRO+rms(rnd,RX.SIG_WAIT[0],RX.SIG_WAIT[1]),fired:false,tb:0}}
function sgStep(x,now){if(!x.fired&&now>=x.beepAt){x.fired=true;x.tb=x.beepAt;return'beep'}return null}
function sgJudge(x,t){
  if(!x.fired||t<x.tb)return{tm:'early'};
  const rt=t-x.tb;return{tm:rt<=x.W?'ok':'late',rt};
}
const sgOpen=(x,now)=>!!x&&x.fired&&now<=x.tb+x.W;
const sgOver=(x,now)=>!!x&&x.fired&&now>x.tb+x.W+RX.SIG_OVER;

/* ---------- Schwierigkeit ---------- */
function rxNext(L,hit){return clampL(L+(hit?RX.UP:-RX.DOWN))}
function rxMode(c){return c.rxd||(c.dyn?'dyn':'fix')}
const median=a=>{const s=a.slice().sort((p,q)=>p-q),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null};
/* Individuell: Stufe aus deinen letzten Reaktionszeiten (Median), sodass du ungefähr jeden zweiten schaffst.
   shots = alle Einträge, kind = 'gap' | 'sig'. Gibt null zurück, solange es zu wenig Daten gibt. */
function rxPersonal(shots,kind){
  const d=kind==='sig'?'r3s':'r3';
  const rts=shots.filter(z=>z.d===d&&z.rt!=null&&(z.tm==='ok'||(kind==='sig'&&z.tm==='late'))).slice(-RX.IND_N).map(z=>z.rt);
  if(rts.length<RX.IND_MIN)return null;
  const m=median(rts);
  if(kind==='sig'){const W=Math.max(RX.W_MIN,Math.min(RX.W_MAX,Math.round(m)));return{L:clampL(1+9*(1500-W)/1100),W,m,n:rts.length}}
  // Lücken: grün etwa 1,3× so lange wie du brauchst; Mitte der Grün-Dauer je Stufe = 2000 − 1450·f
  const c=Math.max(350,Math.min(2400,m*1.3));return{L:clampL(1+9*(2000-c)/1450),m,n:rts.length};
}
function rxLevelText(L){return'Stufe '+(Math.round(L*10)%10?(Math.round(L*10)/10).toString().replace('.',','):Math.round(L))}
const sec=ms=>(Math.round(ms/100)/10).toString().replace('.',',');
function rxHint(c,shots){
  const sig=DISC[c.d]&&DISC[c.d].react==='sig',m=rxMode(c);
  if(m==='ind'){
    const p=rxPersonal(shots||[],sig?'sig':'gap');
    return p?'Aus deinen letzten '+p.n+' Reaktionszeiten (Mitte '+sec(p.m)+' s): '+rxLevelText(p.L)+(sig?', Fenster '+sec(p.W)+' s':'')+'. Passt sich nach jedem Schuss an.'
      :'Noch zu wenig eigene Reaktionszeiten (mindestens '+RX.IND_MIN+'). Start bei Stufe 5, danach passt es sich an.';
  }
  let t;
  if(sig)t='Reaktionsfenster '+sec(sgWindow(c.lvl))+' s nach dem Piep.';
  else{const p=gpParams(c.lvl);t='Grün '+sec(p.on[0])+'–'+sec(p.on[1])+' s, '+p.pool+(p.pool>1?' Rhythmen':' Rhythmus')+', je '+p.reps[0]+(p.reps[1]>p.reps[0]?'–'+p.reps[1]:'')+'× wiederholt'+(p.colors?', '+p.colors+(p.colors>1?' Ablenkfarben':' Ablenkfarbe'):'')+'.'}
  return t+(m==='dyn'?' Dynamisch: Treffer +0,5 Stufen, Daneben −1 Stufe.':'');
}

/* ---------- Anbindung an das Training ---------- */
const SEGS_EL=()=>$('#segs');
function reactOn(){return!!(R&&R.D&&R.D.react)}
const rxKind=()=>R&&R.D?R.D.react:null; // 'gap' | 'sig'
/* Nach der Ansage (call): Lücken bzw. Signal vorbereiten */
function rxArm(){
  R.rx=null;R.sg=null;R.sgShown=false;
  const now=performance.now();
  if(rxKind()==='sig')R.sg=sgNew(R.cfg.rxd==='ind'&&R.indW?R.indW:sgWindow(R.lvl),now);
  else R.rxStartAt=now+(R.target>0?RX.INTRO:RX.INTRO_Q);
  rxPaint();
}
function rxPaint(){
  const el=SEGS_EL(),on=reactOn()&&(R.phase==='aim'||R.phase==='call')&&!R.undo,now=performance.now(),sig=rxKind()==='sig';
  const green=s=>sig?(sgOpen(R.sg,now)&&s===R.target):(!!R.rx&&R.rx.open[s]>0);
  [...el.children].forEach((b,i)=>{
    const s=i+1,d=on&&!sig&&R.rx?R.rx.deco[s]:0;
    b.classList.toggle('rx',on);
    b.classList.toggle('open',on&&green(s));
    b.classList.toggle('tgt',on&&R.target===s);
    for(let k=1;k<=3;k++)b.classList.toggle('d'+k,d===k);
  });
  el.classList.toggle('rxon',on);
}
function rxFlash(){const f=$('#flash');if(!f)return;f.classList.remove('on');void f.offsetWidth;f.classList.add('on')}
/* Pro Bild aufgerufen (tick) */
function rxTick(now){
  if(!reactOn())return;
  const live=(R.phase==='aim'||R.phase==='call')&&!R.undo;
  if(!live){if(SEGS_EL().classList.contains('rxon')){R.rx=null;R.sg=null;rxPaint()}return}
  if(rxKind()==='sig'){
    if(!R.sg)return;
    if(sgStep(R.sg,now)==='beep'){
      beep(1400,.06,.5);ignoreUntil=performance.now()+120; // kurzer Piep, nur kurz ausblenden – sonst würde ein schneller Schuss verschluckt
      rxFlash();R.sgShown=true;rxPaint();
    }
    if(R.sgShown&&!sgOpen(R.sg,now)){R.sgShown=false;rxPaint()}
    if(S.mic&&R.detectAt==null&&sgOver(R.sg,now))input(0,true,'none');
    return;
  }
  if(!R.rx&&R.rxStartAt&&now>=R.rxStartAt)R.rx=rxNew(R.target,R.lvl,now);
  if(R.rx&&rxStep(R.rx,now))rxPaint();
}
function rxTargetOpen(){
  if(!R)return false;const now=performance.now();
  if(rxKind()==='sig')return sgOpen(R.sg,now);
  return!!R.rx&&(R.target>0?R.rx.open[R.target]>0:rxGreen(R.rx)>0);
}
function rxStatus(tgt){
  const o=rxTargetOpen();
  if(rxKind()==='sig')return{txt:tgt+(o?' · JETZT':R.sg&&R.sg.fired?' · zu spät':' · auf Piep warten'),cls:o?'alert':''};
  if(!(R.target>0))return{txt:o?'GRÜN · JETZT':'Grün abwarten',cls:o?'alert':''};
  return{txt:tgt+(o?' · JETZT':' · warten'),cls:o?'alert':''};
}
/* Erkannter Schuss: Timing sofort beurteilen */
function reactShot(now){
  R.detectAt=now;let j;
  if(rxKind()==='sig')j=R.sg?sgJudge(R.sg,now):{tm:'early'};
  else{j=R.rx?rxJudge(R.rx,now):{tm:'early',s:R.target};if(!(R.target>0))R.target=j.s||0}
  R.rxRt=j.rt!=null?Math.round(j.rt):null;
  if(j.tm==='ok')input(inputMode()==='seg'&&R.target>0?R.target:'hit',true,'ok');
  else input(0,true,j.tm);
}
/* Vor jedem Versuch: Stufe anpassen */
function rxAdapt(){
  if(!reactOn())return;
  const n=R.entries.length,m=rxMode(R.cfg);
  if(m==='dyn'&&n>R.rxAdj&&n>0)R.lvl=rxNext(R.lvl,!!R.entries[n-1].h);
  if(m==='ind'){const p=rxPersonal(D.shots,rxKind());R.lvl=p?p.L:5;R.indW=p&&p.W?p.W:null}
  R.rxAdj=n;
}
/* Zusatzfelder für den Eintrag */
function rxEntry(e){
  e.lv=Math.round(R.lvl*10)/10;
  if(rxKind()==='sig'&&R.sg)e.w=R.sg.W;
  if(rxKind()==='gap'&&R.cfg.rxa===false)e.na=true; // ohne Ansage
}
function rxTxt(tm){
  if(tm==='none')return'Verpasst · kein Schuss';
  if(rxKind()==='sig')return tm==='early'?'Zu früh · vor dem Piep':'Zu langsam · '+(R.rxRt!=null?sec(R.rxRt)+' s':'');
  if(!(R.target>0)||(R.cfg.rxa===false))return tm==='early'?'Zu früh · nichts grün':'Zu spät · Lücke war zu';
  return tm==='early'?'Zu früh · Ziel war zu':'Zu spät · Ziel war zu';
}
/* Hilfe vor dem Start (abschaltbar), dieselben Texte wie das ⓘ in der Konfiguration */
function rxHelpHtml(kind,ansage){
  if(kind==='sig')return'<p class="dmsg">Die App sagt ein Ziel an und markiert es mit <b>gelbem Rahmen</b>. Nach einer zufälligen Wartezeit kommt ein <b>Piep</b>, der Bildschirm blitzt auf und das Ziel wird grün.</p><p class="dmsg">Erst <b>dann</b> schießen. Zählt nur, wenn du im <b>Reaktionsfenster</b> schießt. Vor dem Piep ist „zu früh“.</p><p class="dmsg"><b>Leicht</b>: langes Fenster (1,5 s). <b>Schwer</b>: kurzes (0,4 s). <b>Dynamisch</b>: Treffer macht es schwerer, Daneben leichter. <b>Individuell</b>: Das Fenster folgt deiner eigenen Reaktionszeit, du spielst gegen dich selbst.</p><p class="dmsg">Braucht die Schusserkennung.</p>';
  return(ansage?'<p class="dmsg">Die App sagt ein Ziel an und markiert es mit <b>gelbem Rahmen</b>. Dann wandert <b>eine grüne Lücke</b> über das Tor. Schieß, wenn <b>dein Ziel grün</b> ist.</p>'
      :'<p class="dmsg"><b>Eine grüne Lücke</b> wandert über das Tor. Schieß auf das Segment, das <b>gerade grün</b> ist.</p>')
    +'<p class="dmsg">Die Lücke läuft in <b>Rhythmen</b>: kurze Muster, die sich wiederholen, dazwischen Chaos. Wer den Rhythmus erkennt, kann vorausahnen.</p>'
    +'<p class="dmsg">Ab Stufe 6 leuchten auch <b>andere Farben</b> (blau, violett, weiß). Nur auf <b>Grün</b> schießen, grün pulsiert zusätzlich.</p>'
    +'<p class="dmsg">Mit Schusserkennung prüft die App das Timing selbst. Ohne sie meldest du nur Treffer oder Daneben.</p>';
}
function rxHelpFor(c){const k=DISC[c.d]&&DISC[c.d].react;return rxHelpHtml(k,c.rxa!==false)}
