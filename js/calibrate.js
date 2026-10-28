'use strict';
/* KickerTrainer · Kalibrierung der Schusserkennung (Seite „Mikrofon & Sprache testen“)
   Ablauf, bewusst kurz: 1) 3 s Ruhe messen  2) dreimal aufs Tor schießen  3) Schwellen übernehmen.
   Die Rechnung steht in detector.js (calSummary), hier nur Ablauf und Anzeige.

   Warum so: Jeder Tisch klingt anders und jedes Gerät steht anders. Statt am Regler zu raten, hört die App
   den eigenen Tisch einmal an und setzt die Schwelle auf 40 % des leisesten Schusses – laut genug, dass
   jeder Schuss sicher darüber liegt, und weit weg vom Umgebungslärm. */
const cal={on:false,phase:'idle',rest:{a:[],m:[]},shots:[],g:null,t0:0,tShoot:0,timer:0,tmpA:1e9,tmpM:1e9,msg:'',
  REST_MS:3000,GROUP_MS:1500,AMP_MS:45,TIMEOUT_MS:60000,NEED:3};
/* Schwellen während der Messung: in der Ruhe unendlich (nichts löst aus), beim Schießen knapp über der lautesten Ruhe-Spitze */
cal.thrA=()=>cal.phase==='shoot'?cal.tmpA:1e9;
cal.thrM=()=>cal.phase==='shoot'?cal.tmpM:1e9;
/* Jeder Messwert (Ton: Spitze je Durchlauf, Erschütterung: Sprung je Sensorwert) */
cal.frame=(src,val,t)=>{
  if(cal.phase==='rest'){cal.rest[src].push(val);return}
  const g=cal.g&&cal.g[src];if(g&&t-g.t0<=cal.AMP_MS)g.max=Math.max(g.max,val);
};
/* Ein Knall wurde erkannt: erster Knall einer Gruppe öffnet sie; was in den nächsten 1,5 s folgt (Einschlag, Nachprellen), gehört zum selben Schuss */
cal.event=(src,t,amp)=>{
  if(cal.phase!=='shoot')return;
  if(!cal.g){cal.g={t0:t};cal.timer2=setTimeout(cal.closeGroup,cal.GROUP_MS)}
  if(!cal.g[src])cal.g[src]={t0:t,max:amp||0};
  calRender();
};
cal.closeGroup=()=>{
  const g=cal.g;cal.g=null;if(!g||cal.phase!=='shoot')return;
  cal.shots.push({a:g.a?g.a.max:0,m:g.m?g.m.max:0});beep(1200,.07,.2);
  if(cal.shots.length>=cal.NEED)cal.finish();else calRender();
};
cal.cancel=()=>{
  clearTimeout(cal.timer);clearTimeout(cal.timer2);
  if(cal.on){mic.gap=DET.GAP;mot.gap=DET.GAP}
  cal.on=false;cal.phase='idle';cal.g=null;calRender();
};
cal.start=async()=>{
  if(cal.on){cal.cancel();return}
  ensureAudio();
  const [a,m]=await Promise.all([mic.on?true:micStart(),mot.on?true:motStart()]);
  if(!a){cal.msg='Ohne Mikrofon geht die Kalibrierung nicht – siehe Meldung oben.';calRender();return}
  cal.on=true;cal.phase='rest';cal.rest={a:[],m:[]};cal.shots=[];cal.g=null;cal.t0=performance.now();cal.noMotion=!m;cal.msg='';
  mic.gap=mot.gap=100;calRender();
  cal.timer=setTimeout(cal.endRest,cal.REST_MS);
};
cal.endRest=()=>{
  if(cal.phase!=='rest')return;
  const mx=a=>a.length?Math.max.apply(null,a):0;
  cal.tmpA=Math.max(DET.A_MIN,mx(cal.rest.a)*2.5);cal.tmpM=Math.max(DET.M_MIN,mx(cal.rest.m)*2.5);
  cal.phase='shoot';cal.tShoot=performance.now();beep(880,.1,.25);calRender();
  cal.timer=setTimeout(()=>{ // Zeit abgelaufen
    if(cal.phase!=='shoot')return;
    cal.msg=cal.shots.length?'Nur '+cal.shots.length+' von '+cal.NEED+' Schüssen gehört. Gerät näher ans Tor legen und nochmal versuchen.'
      :'Nichts gehört. Gerät näher ans Tor legen, Lautstärke des Raums prüfen, dann nochmal.';
    cal.cancel();
  },cal.TIMEOUT_MS);
};
cal.finish=()=>{
  clearTimeout(cal.timer);clearTimeout(cal.timer2);
  const sum=calSummary(cal.rest,cal.shots);
  mic.gap=DET.GAP;mot.gap=DET.GAP;cal.on=false;cal.phase='done';cal.sum=sum;
  if(!sum.a&&!sum.m){cal.msg='Kein Schuss deutlich erkannt. Gerät näher ans Tor legen und nochmal versuchen.';cal.phase='idle';calRender();return}
  S.cal={a:sum.a,m:sum.m,at:Date.now(),qa:sum.qa,qm:sum.qm};
  if(sum.det)S.det=sum.det;
  const was=S.mic;S.mic=true;saveS();
  const w=[];
  if(!sum.okA&&sum.gotA)w.push('Ton: Schüsse nur '+fmt(sum.qa,1)+'× lauter als die Ruhe – eher unsicher. Ruhigere Umgebung oder Gerät näher ans Tor.');
  if(!sum.gotA)w.push('Ton: kein Schuss gehört.');
  if(!sum.okM&&sum.gotM)w.push('Erschütterung: Schüsse nur '+fmt(sum.qm,1)+'× stärker als die Ruhe – eher unsicher.');
  if(!sum.gotM)w.push(cal.noMotion?'Erschütterung: Bewegungssensor nicht erlaubt oder nicht vorhanden.':'Erschütterung: bei keinem Schuss gespürt. Das Gerät muss direkt auf dem Tisch liegen.');
  cal.warn=w;cal.msg='';
  cal.det=sum.det;cal.enabled=!was;
  calRender();
  if(typeof renderHome==='function')renderHome();
};
cal.reset=()=>{S.cal=null;saveS();cal.phase='idle';cal.msg='Kalibrierung verworfen – die Schwelle folgt wieder dem Umgebungspegel (Regler).';calRender();if(typeof renderHome==='function')renderHome()};

const DETNAME={audio:'Ton',motion:'Erschütterung',both:'Ton + Erschütterung',either:'Ton oder Erschütterung'};
function x1(v){return v>=10?Math.round(v)+'×':fmt(v,1)+'×'}
function calRender(){
  const msg=$('#calMsg');if(!msg)return;
  const dots=$('#calDots'),btn=$('#btnCal'),info=$('#calInfo'),rs=$('#btnCalReset');
  let m='',inf='',cls='';
  if(cal.phase==='rest'){
    const left=Math.max(1,Math.ceil((cal.REST_MS-(performance.now()-cal.t0))/1000));
    m='Ruhe messen … '+left;inf='Nicht sprechen, nichts anfassen. Das Gerät liegt so, wie es beim Training liegt.';cls='alert';
    setTimeout(()=>{if(cal.phase==='rest')calRender()},250);
  }else if(cal.phase==='shoot'){
    m='Schieß jetzt aufs Tor – Schuss '+Math.min(cal.NEED,cal.shots.length+1)+' von '+cal.NEED;cls='alert';
    inf='Nach jedem Schuss kurz warten, bis das Häkchen kommt. Schieß so, wie du im Training schießt – auch ruhig mal einen schwächeren.';
  }else if(cal.phase==='done'&&cal.sum){
    const s=cal.sum,ok=!cal.warn.length;
    m=ok?'Fertig ✓':'Fertig, mit Einschränkung';cls=ok?'ok':'late';
    inf='Erkennung: '+(DETNAME[S.det]||S.det)+(cal.det?' (von der App gewählt)':' (unverändert)')+'.'
      +(cal.enabled?' Schusserkennung ist jetzt eingeschaltet.':'')
      +(cal.warn.length?' '+cal.warn.join(' '):'')+' Probier es jetzt aus: Schuss aufs Tor → „Schuss erkannt“ erscheint unten.';
  }else{
    m=cal.msg||(S.cal?'Kalibriert':'Nicht kalibriert');cls=cal.msg?'late':S.cal?'ok':'';
    inf=S.cal?'Stand '+new Date(S.cal.at).toLocaleDateString('de-DE')+(S.cal.a?' · Ton '+x1(S.cal.qa):'')+(S.cal.m?' · Erschütterung '+x1(S.cal.qm):'')+' (so viel lauter bzw. stärker als die Ruhe war). Bei einem anderen Tisch, Ort oder Gerät neu kalibrieren.'
      :'Ohne Kalibrierung folgt die Schwelle dem Umgebungspegel, einstellbar mit den Reglern unten. Kalibrieren ist genauer und dauert eine Minute.';
  }
  msg.textContent=m;msg.className='calmsg '+cls;info.textContent=inf;
  dots.innerHTML=cal.on||cal.phase==='done'?Array.from({length:cal.NEED},(_,i)=>{
    const s=cal.shots[i];
    return'<div class="'+(s?'on':'')+'"><b>'+(s?'✓':i+1)+'</b><small>'+(s?(s.a?'Ton '+fmt(s.a,2):'kein Ton')+' · '+(s.m?'Ruck '+fmt(s.m,1):'kein Ruck'):'')+'</small></div>'}).join(''):'';
  dots.classList.toggle('hidden',!dots.innerHTML);
  btn.textContent=cal.on?'Abbrechen':S.cal?'Neu kalibrieren':'Kalibrieren';
  btn.classList.toggle('primary',!cal.on);
  rs.classList.toggle('hidden',!S.cal||cal.on);
  // Regler nur für das, was nicht kalibriert ist
  const ca=!!(S.cal&&S.cal.a),cm=!!(S.cal&&S.cal.m);
  $('#rowSens').classList.toggle('hidden',ca);$('#rowMSens').classList.toggle('hidden',cm);$('#manSens').classList.toggle('hidden',ca&&cm);
}
$('#btnCal').onclick=()=>cal.start();
$('#btnCalReset').onclick=()=>cal.reset();
