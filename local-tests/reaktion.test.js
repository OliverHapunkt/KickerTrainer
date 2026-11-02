/* Test der Lückenlogik des Reaktionsschießens (js/reaktion.js), ohne Browser.
   Spielt die Lückenuhr mit 60 Bildern/s durch und prüft die Regeln aus dem Entwurf. */
const vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../js/reaktion.js'),'utf8')+';this.RX=RX;this.rxParams=rxParams;this.rxNew=rxNew;this.rxStep=rxStep;this.rxJudge=rxJudge;this.rxNext=rxNext;',ctx);
const {RX,rxParams,rxNew,rxStep,rxJudge,rxNext}=ctx;
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};
let seed=7;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};

/* Läuft eine Lückenuhr; sammelt Dauer der Lücken, Anzahl gleichzeitig offener, Wartezeit bis das Ziel aufgeht */
function sim(L,target,secs){
  const x=rxNew(target,L,0),out={durs:[],maxOpen:0,minOpen:9,tgtFirst:null,tgtWaits:[],tgtOpens:[],opens:0};
  const was=[0,0,0,0,0,0];let lastTgtClose=0,tgtOpen=false;
  for(let t=0;t<=secs*1000;t+=1000/60){
    rxStep(x,t,rnd);
    let n=0;for(let s=1;s<=5;s++){
      if(x.open[s]>0)n++;
      if(x.open[s]>0&&!was[s]){was[s]=x.open[s];out.opens++;if(s===x.target){if(out.tgtFirst==null)out.tgtFirst=t;out.tgtWaits.push(t-lastTgtClose);out.tgtOpens.push(t)}}
      if(!x.open[s]&&was[s]){out.durs.push(x.closedAt[s]-was[s]);if(s===x.target)lastTgtClose=x.closedAt[s];was[s]=0}
    }
    if(t>50){out.maxOpen=Math.max(out.maxOpen,n);out.minOpen=Math.min(out.minOpen,n)}
  }
  out.x=x;return out;
}
const avg=a=>a.reduce((p,c)=>p+c,0)/a.length;

console.log('== Parameter ==');
const p1=rxParams(1),p10=rxParams(10);
ok(p1.gmin>p10.gmin&&p1.gmax>p10.gmax&&p1.guar>p10.guar&&p1.dmax>p10.dmax,'Stufe 10 ist in allem schneller als Stufe 1');
ok(p10.gmin>=RX.MIN_GREEN,'Auch Stufe 10: Lücke mindestens '+RX.MIN_GREEN+' ms ('+p10.gmin+')');
ok(rxParams(0).gmin===p1.gmin&&rxParams(99).gmin===p10.gmin,'Stufen außerhalb 1–10 werden begrenzt');

console.log('== Lückenuhr über alle Stufen ==');
for(const L of [1,3,5,7,10]){
  const r=sim(L,[1,2,3,4,5][L%5],300),p=rxParams(L);
  ok(r.maxOpen<=3&&r.minOpen>=1,'Stufe '+L+': immer 1–3 Lücken offen (min '+r.minOpen+', max '+r.maxOpen+')');
  ok(Math.min.apply(null,r.durs)>=p.gmin-20&&Math.max.apply(null,r.durs)<=p.gmax+20,'Stufe '+L+': Dauer '+Math.round(Math.min.apply(null,r.durs))+'–'+Math.round(Math.max.apply(null,r.durs))+' ms liegt in '+p.gmin+'–'+p.gmax);
  ok(r.tgtOpens.length>=3,'Stufe '+L+': das Ziel geht regelmäßig auf ('+r.tgtOpens.length+'× in 300 s)');
  const maxWait=Math.max.apply(null,r.tgtWaits),lim=p.guar+p.gmax+120;
  ok(maxWait<=lim,'Stufe '+L+': längste Wartezeit aufs Ziel '+Math.round(maxWait)+' ms ≤ '+lim);
  ok(Math.min.apply(null,r.tgtWaits.slice(1))>=p.pause-20,'Stufe '+L+': Ziel bleibt nach dem Schließen mindestens '+p.pause+' ms zu');
}
const dens=L=>{const r=sim(L,3,300);return r.opens/300};
ok(dens(10)>dens(1)*1.8,'Schwer wechselt deutlich schneller als leicht ('+dens(1).toFixed(2)+' → '+dens(10).toFixed(2)+' Lücken/s)');
ok(avg(sim(1,3,300).durs)>avg(sim(10,3,300).durs)*2,'Lücken sind bei leicht mehr als doppelt so lang wie bei schwer');
// Das Ziel ist nicht dauerhaft offen und nicht dauerhaft zu
const r5=sim(5,2,300);const tOpenShare=r5.tgtOpens.length*avg(r5.durs)/300000;
ok(tOpenShare>.05&&tOpenShare<.6,'Ziel ist weder ständig offen noch ständig zu (Anteil ≈ '+Math.round(tOpenShare*100)+' %)');
// Jedes Segment kommt vor (auch die Nicht-Ziele als Ablenkung)
{const x=rxNew(3,5,0),seen=new Set();for(let t=0;t<120000;t+=16){rxStep(x,t,rnd);for(let s=1;s<=5;s++)if(x.open[s])seen.add(s)}ok(seen.size===5,'Alle fünf Segmente werden irgendwann grün')}

console.log('== Beurteilung des Schusses ==');
{
  const x=rxNew(2,5,0);x.open[2]=1000;x.lastOpen[2]=1000;x.until[2]=2000;
  let j=rxJudge(x,1400);ok(j.tm==='ok'&&Math.round(j.rt)===400,'Schuss bei offenem Ziel: ok, Reaktionszeit 400 ms');
  j=rxJudge(x,990);ok(j.tm==='early','Schuss kurz vor dem Aufgehen: zu früh');
  x.open[2]=0;x.closedAt[2]=2000;
  j=rxJudge(x,2100);ok(j.tm==='ok'&&Math.round(j.rt)===1100,'100 ms nach dem Schließen: noch ok (Flugzeit), Zeit ab Aufgehen');
  j=rxJudge(x,2150);ok(j.tm==='ok','Genau 150 ms nach dem Schließen: noch ok');
  j=rxJudge(x,2400);ok(j.tm==='late','400 ms nach dem Schließen: zu spät');
  j=rxJudge(x,3500);ok(j.tm==='early','1,5 s nach dem Schließen (Ziel wartet auf nächstes Grün): zu früh');
  const y=rxNew(4,5,0);ok(rxJudge(y,500).tm==='early','Ziel war noch nie offen: zu früh');
}

console.log('== Dynamisch ==');
ok(rxNext(5,true)===5.5&&rxNext(5,false)===4,'Treffer +0,5, Daneben −1');
ok(rxNext(10,true)===10&&rxNext(1,false)===1,'Begrenzt auf 1–10');
{let L=5;for(let i=0;i<8;i++)L=rxNext(L,true);ok(L===9,'Acht Treffer in Folge: Stufe 5 → 9');for(let i=0;i<3;i++)L=rxNext(L,false);ok(L===6,'Drei Fehlschüsse: wieder deutlich leichter (6)')}
console.log(fails?'\nFEHLGESCHLAGEN: '+fails:'\nALLE OK');process.exit(fails?1:0);
