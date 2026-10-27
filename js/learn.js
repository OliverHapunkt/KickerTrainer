'use strict';
/* KickerTrainer · Trainingshilfen (v3.7): Lernpfad, Druckmodus, Standardtest, Ermüdungskurve
 *
 * Grundsatz: nichts davon wird extra gespeichert, was sich aus dem Verlauf berechnen lässt.
 * - Lernpfad: Stufe ergibt sich aus den Einträgen (wie XP).
 * - Standardtest: Sessions tragen cfg.std = Protokoll-Version; Ergebnis aus den Einträgen.
 * - Druckmodus: cfg.pr = Ziel-Serie; Stand wird aus den Einträgen der laufenden Session berechnet (Rückgängig/Korrektur sicher).
 */

/* ================= Druckmodus ================= */
const prOn=c=>(c.pr||0)>0&&DISC[c.d]&&DISC[c.d].kind!=='combo';
function prGoal(){return R&&prOn(R.cfg)?R.cfg.pr:0}
function prState(){
  const g=prGoal();let c=0,best=0;
  for(const e of R.entries){c=e.h?c+1:0;if(c>best)best=c}
  return{g,streak:c,best,ok:g>0&&best>=g,n:R.entries.length};
}
// „Matchball“: ein Treffer fehlt noch
function prMatch(){const g=prGoal();return g>1&&prState().streak===g-1}
// Erwartete Zahl von Versuchen, bis n Treffer in Folge gelingen (Trefferwahrscheinlichkeit p je Versuch)
function prExpect(p,n){return p>=1?n:(Math.pow(1/p,n)-1)/(1-p)}
function prRate(c){
  const ex=exSet(),a=D.shots.filter(z=>z.d===c.d&&z.k===c.tech&&!ex.has(z.s)).slice(-100);
  if(a.length<20)return null;
  return Math.max(.05,Math.min(.97,a.filter(z=>z.h).length/a.length));
}
function prHint(c){
  if(!c.pr)return'Aus. Mit Druck zählt jeder Fehlschuss: Die Serie fällt auf 0.';
  let t='Fehlschuss = Serie zurück auf 0. Ende, sobald '+c.pr+' Treffer in Folge gelungen sind oder der Umfang erreicht ist. Bei '+(c.pr-1)+' kommt die Ansage „Matchball“.';
  const p=prRate(c);
  if(p!=null){
    const e=prExpect(p,c.pr);
    t+='\nDeine Quote bei dieser Übung: '+pct(p)+' → im Schnitt rund '+(e>=1000?'über 1000':Math.round(e))+' Versuche bis zur Serie.';
    if(c.amt==='count'&&e>c.count*1.5)t+=' Das ist mehr als dein Umfang ('+c.count+'×): kürzere Serie oder mehr Versuche wählen.';
  }
  return t;
}
function prSummary(){
  const s=prState();if(!s.g)return'';
  return'<div class="prres '+(s.ok?'ok':'miss')+'"><b>'+(s.ok?s.g+' in Folge geschafft':'Serie von '+s.g+' nicht geschafft')+'</b><small>'
    +(s.ok?'nach '+s.n+' Versuchen':'beste Serie '+s.best+' · '+s.n+' Versuche')+'</small></div>';
}

/* ================= Lernpfad ================= */
// Stufen: Serie (Ziele blockweise) → Gemischt → Auf Signal. Eine Stufe gilt als geschafft,
// wenn die letzten 30 Aktionen auf dieser Stufe (gleiche Disziplin + Technik, in mind. 2 Sessions) über der Schwelle liegen.
// Die Schwellen sind erste Schätzwerte und werden mit echten Daten nachjustiert.
const LP={n:30,rates:[.75,.65,.55],names:['Serie','Gemischt','Signal'],
  desc:['Ziele blockweise nacheinander, freies Tempo','Ziele zufällig gemischt, freies Tempo','Ziele zufällig, Start auf Signal'],
  cfg:[{order:'series',timing:'free'},{order:'mix',timing:'free'},{order:'mix',timing:'signal'}]};
function lpStageOf(c){return c.timing==='signal'?2:c.order==='series'?0:1}
function lpState(d,tech){
  // Standardtests und Druckserien zählen nicht (feste Bedingungen bzw. am Treffer abgebrochen)
  const sm=new Map();
  for(const x of D.sessions)if(!x.x&&x.d===d&&x.cfg&&!x.cfg.std&&!(x.cfg.pr>0))sm.set(x.id,lpStageOf(x.cfg));
  const by=[[],[],[]];
  for(const s of D.shots){const st=sm.get(s.s);if(st!==undefined&&s.d===d&&s.k===tech)by[st].push(s)}
  const stages=by.map((a,i)=>{
    const last=a.slice(-LP.n),h=last.filter(z=>z.h).length,rate=last.length?h/last.length:0;
    return{i,have:last.length,rate,goal:LP.rates[i],done:last.length>=LP.n&&rate>=LP.rates[i]&&new Set(last.map(z=>z.s)).size>=2};
  });
  for(let i=stages.length-2;i>=0;i--)if(stages[i+1].done)stages[i].done=true; // wer „Auf Signal“ kann, hat die Vorstufen
  let cur=stages.findIndex(x=>!x.done);if(cur<0)cur=3;
  return{d,tech,stages,cur};
}
function lpCard(){
  const c=S.cfg,d=DISC[c.d];if(d.kind==='combo')return'';
  const st=lpState(c.d,c.tech),all=st.cur>2,s=st.stages[Math.min(st.cur,2)];
  let h='<div class="card lpcard"><div class="qhead"><h2>Lernpfad</h2><small class="lpsub">'+esc(d.n+' · '+c.tech)+'</small></div>'
    +'<div class="lpsteps">'+st.stages.map((x,i)=>'<div class="lps'+(x.done?' done':i===st.cur?' cur':'')+'"><i>'+(x.done?icon('check'):i+1)+'</i><span>'+LP.names[i]+'</span></div>').join('')+'</div>';
  if(all){
    h+='<p class="lpnow"><b>Alle drei Stufen geschafft.</b> Nächster Schritt: Druck. Fünf Treffer in Folge, jeder Fehlschuss setzt zurück.</p>'
      +'<button class="big primary" data-lp="pr">Druckmodus starten</button>';
  }else{
    h+='<p class="lpnow"><b>Stufe '+(st.cur+1)+': '+LP.names[st.cur]+'</b> · '+LP.desc[st.cur]+'</p>'
      +'<div class="chbar"><i style="width:'+Math.round(Math.min(1,s.rate/s.goal)*100)+'%"></i></div>'
      +'<small class="lpprog">'+(s.have?'Letzte '+s.have+' von '+LP.n+' Aktionen · Quote '+pct(s.rate)+' · Ziel '+pct(s.goal):'Noch keine Aktionen auf dieser Stufe · Ziel: '+pct(s.goal)+' über '+LP.n+' Aktionen')+'</small>'
      +'<button class="big primary" data-lp="go">Stufe '+(st.cur+1)+' starten</button>';
  }
  return h+'</div>';
}
function lpGo(pressure){
  const c=S.cfg;
  if(pressure){c.pr=5}
  else{const st=lpState(c.d,c.tech);Object.assign(c,LP.cfg[Math.min(st.cur,2)]);c.pr=0}
  if(c.amt!=='count'||c.count<LP.n){c.amt='count';c.count=LP.n}
  saveS();renderHome();startSession(c,null);
}
// Auswertung: Stufe in dieser Session geschafft?
function lpSummary(){
  if(!R||R.lp0==null||DISC[R.cfg.d].kind==='combo')return'';
  const now=lpState(R.cfg.d,R.cfg.tech).cur;if(now<=R.lp0)return'';
  return'<div class="gwin">'+icon('trophy')+'<b>Lernpfad: Stufe „'+LP.names[R.lp0]+'“ geschafft</b><span>'+(now>2?'alle Stufen':'weiter: '+LP.names[now])+'</span></div>';
}

/* ================= Standardtest ================= */
// Immer gleiche Bedingungen, damit Monat für Monat und später Spieler untereinander vergleichbar sind.
// Änderungen am Protokoll nur mit neuer Versionsnummer (std), alte Ergebnisse bleiben dann getrennt.
// ready:'off' = wie bisher keine Aufbauzeit, damit das Protokoll v1 unverändert bleibt (v3.8 führt die Aufbauzeit auch bei freiem Tempo ein).
const STD={v:1,steps:[
  {d:'s3',tech:'Frei',wt:['Frei'],tS:[1,2,3,4,5],order:'mix',timing:'free',ready:'off',scoring:'simple',amt:'count',count:25,pr:0,std:1},
  {d:'p53',tech:'Frei',wt:['Frei'],tP:['wall','lane'],order:'mix',timing:'free',ready:'off',amt:'count',count:20,pr:0,std:1}]};
const monthKey=t=>{const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')};
const monthName=(k,long)=>new Date(+k.slice(0,4),+k.slice(5)-1,1).toLocaleDateString('de-DE',{month:long?'long':'short',year:'numeric'});
// Je Monat der jeweils letzte vollständige Durchlauf von Schuss- und Pass-Teil
function stdResults(){
  const cnt=new Map();for(const z of D.shots){const o=cnt.get(z.s)||{n:0,h:0};o.n++;if(z.h)o.h++;cnt.set(z.s,o)}
  const m=new Map();
  for(const x of D.sessions){
    if(x.x||!x.cfg||!x.cfg.std||!(x.reps>=x.cfg.count))continue;
    const o=cnt.get(x.id);if(!o)continue;
    const k=monthKey(x.start),r=m.get(k)||{m:k},kind=x.d==='s3'?'shot':x.d==='p53'?'pass':null;if(!kind)continue;
    if(!r[kind]||r[kind].t<x.start)r[kind]={h:o.h,n:o.n,t:x.start};
    m.set(k,r);
  }
  return[...m.values()].sort((a,b)=>a.m<b.m?-1:1);
}
function stdState(){
  const rs=stdResults(),nowK=monthKey(Date.now()),cur=rs.find(r=>r.m===nowK),last=rs.filter(r=>r.m<nowK).pop();
  return{rs,cur,last,done:!!(cur&&cur.shot&&cur.pass)};
}
const qs=o=>o?pct(o.h/o.n):'–';
function stdCard(){
  if(D.shots.length<30)return''; // Neulinge erst mal trainieren lassen
  const st=stdState();let h;
  if(st.done){
    h='<div class="card stdcard"><div class="qhead"><h2>Standardtest</h2><small class="lpsub">'+esc(monthName(st.cur.m,true))+' ✓</small></div>'
      +'<div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile"><b>'+qs(st.cur.shot)+'</b><span>Schuss 3er</span></div><div class="tile"><b>'+qs(st.cur.pass)+'</b><span>Pass 5er→3er</span></div></div>'
      +'<p class="hint">Nächster Test ab dem 1. '+new Date(new Date().getFullYear(),new Date().getMonth()+1,1).toLocaleDateString('de-DE',{month:'long'})+'. Verlauf in der Statistik.</p>'
      +'<button class="link" data-lp="std">Trotzdem nochmal</button></div>';
  }else{
    const part=st.cur&&(st.cur.shot||st.cur.pass);
    h='<div class="card stdcard due"><div class="qhead"><h2>Standardtest</h2><small class="lpsub">'+(part?'angefangen':st.last?'fällig':'noch nie gemacht')+'</small></div>'
      +'<p class="lpnow">'+(st.last?'Letzter Test: '+esc(monthName(st.last.m,true))+' · Schuss '+qs(st.last.shot)+' · Pass '+qs(st.last.pass)+'. ':'')
      +'Zwei Stationen mit festen Bedingungen: Schuss 3er (25×) und Pass 5er→3er (20×), etwa 6 Minuten. Nur so ist dein Fortschritt über Monate vergleichbar.</p>'
      +'<button class="big primary" data-lp="std">Test starten</button></div>';
  }
  return h;
}
// Auswertung: Ergebnis des gerade gespielten Test-Teils im Vergleich zum Vormonat
function stdSummary(){
  if(!R||!R.cfg.std)return'';
  if(R.reps<R.cfg.count)return'<p class="hint">Test nicht vollständig gespielt – zählt nicht als Standardtest.</p>';
  const kind=R.cfg.d==='s3'?'shot':'pass',rs=stdResults(),cur=rs.find(r=>r.m===monthKey(Date.now())),prev=rs.filter(r=>r.m<monthKey(Date.now())&&r[kind]).pop();
  if(!cur||!cur[kind])return'';
  const p=cur[kind].h/cur[kind].n;let d='';
  if(prev){const q=prev[kind].h/prev[kind].n,x=Math.round((p-q)*100);d=' <span class="'+(x>0?'up':x<0?'down':'')+'">'+(x>0?'▲ +'+x:x<0?'▼ −'+(-x):'± 0')+' Pkt ggü. '+esc(monthName(prev.m))+'</span>'}
  return kv('Standardtest '+(kind==='shot'?'Schuss':'Pass'),pct(p)+d);
}
function chartStd(W){
  const rs=stdResults().slice(-6);if(!rs.length)return'';
  const L=70,Rr=44,bh=13,gap=3,rowH=2*bh+gap+12,H=rs.length*rowH,iw=W-L-Rr;let s='';
  rs.forEach((r,i)=>{
    const Y=i*rowH;s+='<text x="'+(L-10)+'" y="'+(Y+bh+2)+'" text-anchor="end">'+esc(monthName(r.m))+'</text>';
    [['shot','Schuss',C_S1],['pass','Pass',C_S2]].forEach(([k,nm,col],j)=>{
      const y0=Y+j*(bh+gap),o=r[k],v=o?o.h/o.n:0;
      s+='<rect x="'+L+'" y="'+y0+'" width="'+iw+'" height="'+bh+'" rx="4" fill="#1e2229"/>';
      if(o)s+='<rect x="'+L+'" y="'+y0+'" width="'+Math.max(4,iw*v).toFixed(1)+'" height="'+bh+'" rx="4" fill="'+col+'"/>';
      s+='<text class="val" x="'+(L+iw+8)+'" y="'+(y0+bh-2)+'">'+(o?pct(v):'–')+'</text>';
      s+='<rect class="hit" x="'+L+'" y="'+(y0-1)+'" width="'+(iw+Rr)+'" height="'+(bh+2)+'" data-tip="'+esc(monthName(r.m,true)+' · '+nm+'\n'+(o?o.h+' von '+o.n+' ('+pct(v)+')':'nicht gespielt'))+'"/>';
    });
  });
  const f=rs.filter(r=>r.shot),l=rs.filter(r=>r.pass);
  let note='';
  if(f.length>1){const a=f[f.length-2].shot,b=f[f.length-1].shot,x=Math.round((b.h/b.n-a.h/a.n)*100);note+='Schuss '+(x>0?'+':x<0?'−':'±')+Math.abs(x)+' Pkt ggü. Vormonat. '}
  if(l.length>1){const a=l[l.length-2].pass,b=l[l.length-1].pass,x=Math.round((b.h/b.n-a.h/a.n)*100);note+='Pass '+(x>0?'+':x<0?'−':'±')+Math.abs(x)+' Pkt.'}
  return card('Standardtest-Verlauf',svg(W,H,s)+legend([[C_S1,'Schuss 3er (25×)'],[C_S2,'Pass 5er→3er (20×)']])+(note?'<p class="hint">'+note+' Bei 20–25 Versuchen schwankt die Quote zufällig um bis zu ±10 Punkte.</p>':''),
    'Immer gleiche Bedingungen · Technik „Frei“ · freies Tempo · Wertung einfach');
}

/* ================= Ermüdungskurve ================= */
// Trainingsblock = Sessions mit weniger als 20 Minuten Pause. Aktion Nr. im Block gegen Quote.
const FT={gap:20*60000,size:20,min:20};
function blockPos(){
  const ex=exSet(),by=new Map();
  for(const s of D.shots){if(ex.has(s.s))continue;if(!by.has(s.s))by.set(s.s,[]);by.get(s.s).push(s)}
  const ses=[...by.values()].map(a=>{a.sort((p,q)=>p.t-q.t);return{a,t0:a[0].t,t1:a[a.length-1].t}}).sort((p,q)=>p.t0-q.t0);
  const pos=new Map();let n=0,prev=-Infinity;
  for(const x of ses){if(x.t0-prev>FT.gap)n=0;for(const e of x.a){n++;pos.set(e,n)}prev=x.t1}
  return pos;
}
function chartFatigue(W,a){
  const pos=blockPos(),prs=new Set(D.sessions.filter(x=>x.cfg&&x.cfg.pr>0).map(x=>x.id)); // Druckserien enden am Treffer → verfälschen
  const bk=[];
  for(const z of a){const p=pos.get(z);if(!p||prs.has(z.s))continue;const i=Math.min(3,Math.floor((p-1)/FT.size));(bk[i]||(bk[i]={i,n:0,h:0})).n++;if(z.h)bk[i].h++}
  const rows=bk.filter(b=>b&&b.n>=FT.min);if(rows.length<2)return'';
  const lab=b=>b.i===3?'ab '+(3*FT.size+1):(b.i*FT.size+1)+'–'+(b.i+1)*FT.size;
  const L=62,Rr=84,bh=18,gap=10,iw=W-L-Rr,H=rows.length*(bh+gap);let s='';
  rows.forEach((b,k)=>{
    const Y=k*(bh+gap),r=b.h/b.n;
    s+='<text x="'+(L-10)+'" y="'+(Y+bh-4)+'" text-anchor="end">'+lab(b)+'</text><rect x="'+L+'" y="'+Y+'" width="'+iw+'" height="'+bh+'" rx="5" fill="#1e2229"/>'
      +'<rect x="'+L+'" y="'+Y+'" width="'+Math.max(4,iw*r).toFixed(1)+'" height="'+bh+'" rx="5" fill="'+C_ACC+'"/>'
      +'<text class="val" x="'+(L+iw+8)+'" y="'+(Y+bh-4)+'">'+pct(r)+'</text><text x="'+(L+iw+50)+'" y="'+(Y+bh-4)+'" style="fill:'+C_MUTE+'">n='+b.n+'</text>'
      +'<rect class="hit" x="'+L+'" y="'+Y+'" width="'+(iw+Rr)+'" height="'+bh+'" data-tip="Aktion '+lab(b)+' im Block\n'+b.h+' von '+b.n+' ('+pct(r)+')"/>';
  });
  // Unterschied erste ↔ letzte Gruppe: nur als „echt“ melden, wenn er über der Streuung liegt (Zwei-Stichproben-z-Test)
  const f=rows[0],l=rows[rows.length-1],p1=f.h/f.n,p2=l.h/l.n,pp=(f.h+l.h)/(f.n+l.n),se=Math.sqrt(pp*(1-pp)*(1/f.n+1/l.n)),z=se?(p2-p1)/se:0,d=Math.round((p2-p1)*100);
  let note;
  if(z<=-1.64)note='Ab Aktion <b style="color:var(--text)">'+(l.i*FT.size+1)+'</b> fällt deine Quote von '+pct(p1)+' auf '+pct(p2)+' (−'+Math.abs(d)+' Pkt). Das ist mehr als Zufall erklärt: kürzere Blöcke oder eine Pause testen.';
  else if(z>=1.64)note='Du wirst im Block besser: '+pct(p1)+' → '+pct(p2)+' (+'+d+' Pkt). Plane Einspielzeit ein, bevor es zählt.';
  else note='Kein klarer Verlauf: '+(d?(d>0?'+':'−')+Math.abs(d)+' Pkt':'gleich')+' zwischen erster und letzter Gruppe liegt im Bereich normaler Streuung. Mit mehr Daten wird die Aussage verlässlicher.';
  return card('Ermüdungskurve',svg(W,H,s)+'<p class="hint">'+note+'</p>','Quote nach Aktionsnummer im Trainingsblock (Pause über 20 Min = neuer Block) · nur Gruppen ab '+FT.min+' Aktionen');
}

/* ================= Anzeige ================= */
function renderLp(){
  const o=$('#oLp');if(o)o.checked=!!S.lp;const s=$('#oStd');if(s)s.checked=!!S.stdOn;
  const el=$('#lpHome');if(!el)return;
  el.innerHTML=(S.lp?lpCard():'')+(S.stdOn?stdCard():'');
}
$('#lpHome').addEventListener('click',e=>{
  const b=e.target.closest('[data-lp]');if(!b)return;
  const a=b.dataset.lp;
  if(a==='go')lpGo(false);
  else if(a==='pr')lpGo(true);
  else if(a==='std')startSteps(STD.steps,'Standardtest');
});
$('#oLp').onchange=e=>{S.lp=e.target.checked;saveS();renderLp()};
$('#oStd').onchange=e=>{S.stdOn=e.target.checked;saveS();renderLp()};
