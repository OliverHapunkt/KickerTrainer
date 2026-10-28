/* Test der Erkennungslogik (js/detector.js) mit künstlichen Signalen, ohne Browser und ohne Mikrofon.
   Spielt nach, was sensors.js tut: Alle 1/60 s (oder 1/30 s) wird ein Puffer von 2048 Samples ausgewertet.
   Prüft NICHT, wie echte Tische klingen – dafür gibt es die Kalibrierung am Gerät. */
const vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../js/detector.js'),'utf8')+';this.DET=DET;this.blockRms=blockRms;this.findOnset=findOnset;this.motOnset=motOnset;this.calSummary=calSummary;',ctx);
const {DET,blockRms,findOnset,motOnset,calSummary}=ctx;
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};

const SR=48000,WIN=2048;
let seed=1;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296*2-1};

/* Signal = Summe aus Quellen. Jede Quelle liefert für Sample-Zeit t (Sekunden) einen Wert. */
const noise=rms=>t=>rnd()*rms*1.732;                                  // Rauschen mit gegebenem Effektivwert
const knock=(t0,peak,tau=.012)=>t=>t<t0?0:rnd()*peak*Math.exp(-(t-t0)/tau); // Knall: Rauschstoß, klingt ab
const speech=(rms,from,to,att=.06)=>t=>{if(t<from||t>to)return 0;        // Sprache: Rauschen, im Silbentakt moduliert, setzt über ~60 ms ein
  const env=(.35+.65*Math.abs(Math.sin(2*Math.PI*3.2*t)))*Math.min(1,(t-from)/att);return rnd()*rms*1.732*env*1.4};
const beep=(t0,amp,d=.12)=>t=>t<t0||t>t0+d?0:amp*Math.sin(2*Math.PI*880*t);
const sum=(...f)=>t=>f.reduce((a,g)=>a+g(t),0);

/* Läuft das Signal durch und liefert die Zeitpunkte der Erkennungen (wie micLoop + Pause GAP) */
function run(sig,thr,{fps=60,dur=4,gap=DET.GAP}={}){
  const hits=[];let last=-1e9;
  for(let ft=WIN/SR;ft<dur;ft+=1/fps){
    const buf=new Float32Array(WIN);for(let i=0;i<WIN;i++)buf[i]=sig(ft-(WIN-1-i)/SR);
    const o=findOnset(blockRms(buf),thr);
    if(o.ok&&(ft*1000-last)>gap){last=ft*1000;hits.push({t:ft,peak:o.peak,ratio:o.peak/Math.max(o.pre,1e-9)})}
  }
  return hits;
}
const near=(h,t,tol=.05)=>h.some(x=>x.t>=t&&x.t<=t+tol);
const THR=.04;

console.log('== Knall ==');
let h=run(sum(noise(.003),knock(1.0,.3)),THR);
ok(h.length===1,'Ein Knall nach Stille: genau 1 Erkennung ('+h.length+')');
ok(near(h,1.0,.04),'… und zwar ohne Verzögerung (< 40 ms): '+(h[0]?Math.round((h[0].t-1)*1000):'–')+' ms');
h=run(sum(noise(.003),knock(1.0,.3)),THR,{fps:30});
ok(h.length===1&&near(h,1.0,.07),'Auch bei nur 30 Bildern/s (Stromsparmodus): 1 Erkennung, < 70 ms Verzögerung');
h=run(sum(noise(.003),knock(1.0,.3),knock(1.04,.25)),THR);
ok(h.length===1,'Abschlag + Einschlag 40 ms später (harter Schuss): zählt als ein Schuss');
h=run(sum(noise(.003),knock(1.0,.3),knock(1.8,.25)),THR);
ok(h.length===2,'Zwei Schüsse 0,8 s auseinander: 2 Erkennungen');

console.log('== Leise Schüsse und lauter Raum ==');
h=run(sum(noise(.003),knock(1.0,.09)),THR);
ok(h.length===1,'Leiser Schuss (Spitze 0,09, Schwelle 0,04): erkannt');
h=run(sum(noise(.003),knock(1.0,.05)),THR);
ok(h.length===0,'Unter der Schwelle (Spitze 0,05 ≈ Block-RMS 0,02): nicht erkannt');
h=run(sum(noise(.04),knock(1.0,.5)),THR);
ok(h.length===1,'Knall in lautem Raum (Dauerrauschen 0,04): erkannt');

console.log('== Was NICHT auslösen darf ==');
h=run(sum(noise(.003),speech(.06,0.5,3.5)),THR);
ok(h.length===0,'Dauerhaftes Sprechen, deutlich über der Schwelle: keine Erkennung ('+h.length+')');
h=run(sum(noise(.03)),THR);
ok(h.length===0,'Gleichmäßiges Dauerrauschen (rollender Ball, Lüfter): keine Erkennung');
h=run(sum(noise(.003),speech(.03,0.5,3.5)),THR);
ok(h.length===0,'Normales Sprechen am Tisch (0,03): keine Erkennung ('+h.length+')');
h=run(sum(noise(.003),speech(.08,0.5,3.5)),THR);
console.log('      Grenze: Lautes Sprechen dicht am Gerät (0,08) löst im Ton-Kanal '+h.length+'× aus, und zwar beim Einsetzen aus der Stille (ein Anstieg über ~60 ms sieht für ein 43-ms-Fenster wie ein Knall aus)');
h=run(sum(noise(.003),speech(.14,0.5,3.5)),THR);
console.log('      Grenze: Schreien dicht am Mikrofon (0,14): '+h.length+'×. Dagegen hilft „Ton + Erschütterung“, denn Sprechen bewegt den Tisch nicht');
h=run(sum(noise(.01),speech(.05,0.5,3.5),knock(2.0,.6)),THR);
ok(near(h,2.0,.04)&&h.length===1,'Knall MITTEN im Sprechen wird erkannt, das Sprechen nicht');
h=run(sum(noise(.003),speech(.06,0.5,3.5,.002)),THR);
ok(h.length===1&&near(h,0.5,.05),'Grenze: Sprechen, das schlagartig (< 2 ms) einsetzt, z. B. ein hartes „P“ – löst EINMAL beim Einsetzen aus, danach nicht mehr');
h=run(sum(noise(.003),beep(1.0,.4)),THR);
ok(h.length===1,'Hinweis: ein plötzlicher Pfeifton ist für die Logik ein Knall – eigene Signaltöne müssen in sensors.js ausgeblendet werden (ignoreUntil)');

console.log('== Erschütterung ==');
const jerk=[.01,.012,.011,.013,.01,.012,.011,.01];
let m=motOnset(.6,jerk,.15);
ok(m.ok,'Plötzlicher Ruck nach ruhigem Tisch: erkannt');
m=motOnset(.6,[.5,.6,.55,.5,.6,.5,.55,.6],.15);
ok(!m.ok,'Dauerzittern (Tisch wackelt, jemand geht vorbei): nicht erkannt');
m=motOnset(.1,jerk,.15);
ok(!m.ok,'Zu schwach (unter Schwelle): nicht erkannt');

console.log('== Kalibrierung: Rechnung ==');
let c=calSummary({a:[.002,.004,.003],m:[.02,.03,.02]},[{a:.3,m:1.2},{a:.22,m:.9},{a:.35,m:1.4}]);
ok(Math.abs(c.a-.088)<.001,'Ton-Schwelle = 40 % des leisesten Schusses (0,22 → '+c.a.toFixed(3)+')');
ok(Math.abs(c.m-.36)<.001,'Erschütterungs-Schwelle = 40 % des leisesten Rucks (0,9 → '+c.m.toFixed(2)+')');
ok(c.okA&&c.okM&&c.det==='both','Beides deutlich über der Ruhe → Empfehlung „Ton + Erschütterung“');
c=calSummary({a:[.002],m:[.02]},[{a:.3,m:0},{a:.22,m:0},{a:.35,m:0}]);
ok(c.det==='audio'&&c.m===null,'Erschütterung nie erkannt → Empfehlung „Ton“, keine Erschütterungs-Schwelle');
c=calSummary({a:[.002],m:[.02]},[{a:0,m:1.2},{a:0,m:.9},{a:0,m:1.4}]);
ok(c.det==='motion'&&c.a===null,'Ton nie erkannt → Empfehlung „Erschütterung“');
c=calSummary({a:[.05],m:[.5]},[{a:.07,m:.6},{a:.06,m:.55},{a:.08,m:.7}]);
ok(c.det===null&&c.qa<DET.CAL_GOOD,'Schüsse kaum lauter als die Ruhe → keine sichere Erkennung, Warnung');
ok(c.a>=c.floorA*DET.CAL_FLOOR-1e-9,'Schwelle liegt trotzdem mindestens 3× über der lautesten Ruhe-Spitze');
c=calSummary({a:[0],m:[0]},[{a:.3,m:1},{a:.3,m:1},{a:.3,m:1}]);
ok(c.a>=DET.A_MIN&&c.m>=DET.M_MIN,'Absolute Untergrenzen gelten, auch wenn die Ruhe perfekt still war');

console.log(fails?'\nFEHLGESCHLAGEN: '+fails:'\nALLE OK');
process.exit(fails?1:0);
