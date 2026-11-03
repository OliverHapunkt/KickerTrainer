/* Test der Rechenlogik des Reaktionsschießens (js/reaktion.js), ohne Browser.
   Lücken: Rhythmen, immer nur ein Segment grün, Ablenkfarben, Beurteilung. Signal: Fenster, Beurteilung. Individuell. */
const vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={};vm.createContext(ctx);
const src=fs.readFileSync(path.resolve(__dirname,'../js/reaktion.js'),'utf8');
vm.runInContext(src.slice(0,src.indexOf('/* ---------- Anbindung'))+';Object.assign(this,{RX,gpParams,gpRhythm,rxNew,rxStep,rxJudge,rxGreen,sgWindow,sgNew,sgStep,sgJudge,sgOpen,sgOver,rxNext,rxMode,rxPersonal,median});',ctx);
const {RX,gpParams,gpRhythm,rxNew,rxStep,rxJudge,rxGreen,sgWindow,sgNew,sgStep,sgJudge,sgOpen,sgOver,rxNext,rxMode,rxPersonal}=ctx;
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};
let seed=7;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};

/* Lückenuhr mit 60 Bildern/s laufen lassen */
function sim(L,target,secs){
  const x=rxNew(target,L,0,rnd),o={maxGreen:0,decoOnGreen:0,decoMax:0,decoColors:new Set(),tgtWaits:[],greenSecs:0};
  let lastTgtEnd=0,wasTgt=false;
  for(let t=0;t<=secs*1000;t+=1000/60){
    rxStep(x,t,rnd);
    let g=0;for(let s=1;s<=5;s++){if(x.open[s]>0)g++;if(x.deco[s]){o.decoColors.add(x.deco[s]);if(x.open[s]>0)o.decoOnGreen++}}
    o.maxGreen=Math.max(o.maxGreen,g);o.decoMax=Math.max(o.decoMax,x.deco.filter(Boolean).length);if(g)o.greenSecs+=1/60;
    if(target){const isT=x.open[target]>0;if(isT&&!wasTgt)o.tgtWaits.push(t-lastTgtEnd);if(!isT&&wasTgt)lastTgtEnd=t;wasTgt=isT}
  }
  o.x=x;return o;
}

console.log('== Stufen ==');
const p1=gpParams(1),p10=gpParams(10);
ok(p10.on[0]===400&&p10.on[1]===700,'Stufe 10: grün nur noch 0,4–0,7 s (vorher 0,6–1,0)');
ok(p1.on[0]>=1500&&p1.off[0]>p10.off[0],'Stufe 1: lange Lücken (ab '+p1.on[0]+' ms) und längere Pausen');
ok(p1.pool===1&&p10.pool===4,'Leicht 1 Rhythmus, schwer 4 verschiedene');
ok(p1.reps[0]>=4&&p10.reps[1]<=2,'Leicht '+p1.reps.join('–')+' Wiederholungen, schwer '+p10.reps.join('–'));
ok(p10.chaos>p1.chaos,'Schwer mehr Chaos ('+p1.chaos+' → '+p10.chaos+')');
ok([1,5].every(L=>gpParams(L).colors===0)&&gpParams(6).colors===1&&gpParams(8).colors===2&&gpParams(10).colors===3,'Ablenkfarben: bis 5 keine, ab 6 eine, ab 8 zwei, bei 10 drei');

console.log('== Rhythmen ==');
{const r=gpRhythm(gpParams(10),3,rnd,'A');ok(r.some(s=>s.s===3),'Mit Ansage enthält jeder Rhythmus das Ziel');
 let same=0;for(let i=0;i<300;i++){const q=gpRhythm(gpParams(10),i%5+1,rnd,'A');for(let k=1;k<q.length;k++)if(q[k].s===q[k-1].s)same++}
 ok(same===0,'Nie zweimal dasselbe Segment direkt hintereinander (300 Rhythmen)')}
{const o=sim(1,2,600),x=o.x;
 // Wiederholung prüfen: Blöcke „A×n“ müssen n identische Folgen ergeben
 const steps=x.log.filter(s=>s.b==='A'),pat=x.pool[0].map(s=>s.s+'/'+s.on).join(' ');
 let rep=0;for(let i=0;i+x.pool[0].length<=steps.length;i+=x.pool[0].length){if(steps.slice(i,i+x.pool[0].length).map(s=>s.s+'/'+s.on).join(' ')===pat)rep++}
 ok(rep>=4&&rep===Math.floor(steps.length/x.pool[0].length),'Stufe 1: Rhythmus A ('+pat+') läuft immer gleich ab, '+rep+'× in 10 min');
 ok(x.blocks.some(b=>b==='chaos'),'Dazwischen Chaos-Blöcke ('+x.blocks.slice(0,8).join(', ')+' …)')}
{const x=sim(10,0,120).x,kinds=new Set(x.blocks.map(b=>b[0]));ok(kinds.size>=3,'Stufe 10: mehrere Rhythmen im Wechsel ('+x.blocks.slice(0,10).join(', ')+' …)')}

console.log('== Immer nur ein Grün, Ablenkung ==');
for(const L of [1,5,6,8,10]){
  const o=sim(L,[0,3][L%2],180),p=gpParams(L);
  ok(o.maxGreen===1,'Stufe '+L+': nie mehr als ein Segment grün');
  ok(o.decoOnGreen===0,'Stufe '+L+': Ablenkfarbe nie auf dem grünen Segment');
  ok(p.colors?o.decoColors.size>=1&&Math.max(...o.decoColors)<=p.colors&&o.decoMax<=2:o.decoMax===0,'Stufe '+L+': '+(p.colors?o.decoColors.size+' Ablenkfarben benutzt (max '+p.colors+'), höchstens '+o.decoMax+' gleichzeitig':'keine Ablenkfarben'));
}
for(const L of [1,10]){const o=sim(L,4,300),mx=Math.max(...o.tgtWaits);ok(o.tgtWaits.length>=8&&mx<(L===1?16000:6000),'Stufe '+L+': Ziel kommt regelmäßig, längste Wartezeit '+(mx/1000).toFixed(1)+' s')}
{const a=sim(1,0,180).x.log.length/180,b=sim(10,0,180).x.log.length/180;ok(b>a*3,'Schwer wechselt viel schneller ('+a.toFixed(2)+' → '+b.toFixed(2)+' Lücken/s)')}

console.log('== Beurteilung Lücken ==');
{
  const x=rxNew(2,5,0,rnd);x.cur={s:2,on:1000,off:300,t0:1000};x.open[2]=1000;x.lastOpen[2]=1000;
  let j=rxJudge(x,1400);ok(j.tm==='ok'&&Math.round(j.rt)===400&&j.s===2,'Mit Ansage, Ziel grün: ok, 400 ms');
  j=rxJudge(x,990);ok(j.tm==='early','Kurz vor dem Grünwerden: zu früh');
  x.open[2]=0;x.closedAt[2]=2000;
  ok(rxJudge(x,2120).tm==='ok','120 ms nach dem Schließen: noch ok (Flugzeit)');
  ok(rxJudge(x,2400).tm==='late','400 ms danach: zu spät');
  ok(rxJudge(x,3500).tm==='early','1,5 s danach: zu früh (wartet aufs nächste Grün)');
  x.cur={s:4,on:800,off:200,t0:2300};x.open[4]=2300;x.lastOpen[4]=2300;
  ok(rxJudge(x,3000).tm==='early','Mit Ansage: anderes Segment grün zählt nicht (zu früh)');
  const y=rxNew(0,5,0,rnd);y.cur={s:4,on:800,off:200,t0:2300};y.open[4]=2300;y.lastOpen[4]=2300;
  j=rxJudge(y,2500);ok(j.tm==='ok'&&j.s===4&&Math.round(j.rt)===200,'Ohne Ansage: Schuss aufs Grüne (Segment 4) zählt, 200 ms');
  y.open[4]=0;y.closedAt[4]=3100;j=rxJudge(y,3200);ok(j.tm==='ok'&&j.s===4,'Ohne Ansage: 100 ms nach dem Schließen noch ok, Segment 4');
  j=rxJudge(y,3500);ok(j.tm==='late'&&j.s===4,'Ohne Ansage: 400 ms danach zu spät');
  ok(rxJudge(rxNew(0,5,0,rnd),100).tm==='early','Ohne Ansage, noch nie etwas grün: zu früh');
}

console.log('== Signal ==');
ok(sgWindow(1)===1500&&sgWindow(10)===400&&sgWindow(5)>sgWindow(6),'Fenster: Stufe 1 = 1,5 s, Stufe 10 = 0,4 s');
{
  const s=sgNew(600,0,rnd);ok(s.beepAt>=RX.INTRO+RX.SIG_WAIT[0]&&s.beepAt<=RX.INTRO+RX.SIG_WAIT[1]+10,'Piep zufällig '+(s.beepAt/1000).toFixed(1)+' s nach der Ansage');
  ok(sgJudge(s,1000).tm==='early','Schuss vor dem Piep: zu früh');
  ok(sgStep(s,s.beepAt-1)===null&&sgStep(s,s.beepAt+5)==='beep'&&sgStep(s,s.beepAt+20)===null,'Piep kommt genau einmal');
  let j=sgJudge(s,s.tb+420);ok(j.tm==='ok'&&j.rt===420,'420 ms nach dem Piep, Fenster 600: ok');
  j=sgJudge(s,s.tb+750);ok(j.tm==='late'&&j.rt===750,'750 ms: zu langsam, Zeit wird trotzdem gemessen');
  ok(sgOpen(s,s.tb+500)&&!sgOpen(s,s.tb+700),'Fenster offen bis 600 ms');
  ok(!sgOver(s,s.tb+2000)&&sgOver(s,s.tb+2200),'Verpasst erst 1,5 s nach dem Fenster');
}

console.log('== Dynamisch / Individuell ==');
ok(rxNext(5,true)===5.5&&rxNext(5,false)===4&&rxNext(10,true)===10&&rxNext(1,false)===1,'Dynamisch: +0,5 / −1, begrenzt auf 1–10');
ok(rxMode({dyn:true})==='dyn'&&rxMode({rxd:'ind'})==='ind'&&rxMode({})==='fix','Ältere Einstellung „dynamisch“ wird übernommen');
{
  const mk=(d,rts,tm='ok')=>rts.map(rt=>({d,rt,tm}));
  ok(rxPersonal(mk('r3s',[400,420,380,410]),'sig')===null,'Individuell: unter 5 Reaktionszeiten noch keine Stufe');
  let p=rxPersonal(mk('r3s',[400,420,380,410,500]),'sig');ok(p&&p.W===410,'Signal: Fenster = Mitte deiner Zeiten (410 ms)');
  p=rxPersonal(mk('r3s',[200,180,190,210,205]),'sig');ok(p.W===RX.W_MIN,'Sehr schnell: Fenster nicht unter '+RX.W_MIN+' ms');
  p=rxPersonal(mk('r3s',[700,720,690,710,705],'late'),'sig');ok(p&&p.W===705,'Auch zu langsame Schüsse zählen (echte Reaktionszeit)');
  const fast=rxPersonal(mk('r3',[300,320,310,290,305]),'gap'),slow=rxPersonal(mk('r3',[900,950,880,910,920]),'gap');
  ok(fast.L>slow.L,'Lücken: wer schneller reagiert, bekommt eine höhere Stufe ('+fast.L.toFixed(1)+' vs. '+slow.L.toFixed(1)+')');
  ok(rxPersonal(mk('r3',[300,320,310,290,305]),'sig')===null,'Lücken- und Signal-Zeiten werden getrennt');
  const many=mk('r3s',Array(30).fill(1000).concat([400,400,400,400,400,400,400,400,400,400,400,400,400,400,400,400,400,400,400,400]));
  ok(rxPersonal(many,'sig').W===400,'Nur die letzten 20 zählen');
}
console.log(fails?'\nFEHLGESCHLAGEN: '+fails:'\nALLE OK');process.exit(fails?1:0);
