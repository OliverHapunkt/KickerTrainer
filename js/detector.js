'use strict';
/* KickerTrainer · Schusserkennung: reine Rechenlogik (kein DOM, kein Mikrofon)
   Getrennt von sensors.js, damit sie mit künstlichen Signalen im Terminal getestet werden kann.

   Grundidee, bewusst einfach: Ein Schuss ist ein PLÖTZLICHER und LAUTER Knall.
   • laut genug  = Spitze über einer festen Schwelle (aus der Kalibrierung, sonst Umgebungspegel × Regler)
   • plötzlich   = Spitze mindestens RATIO-mal so laut wie das, was kurz davor zu hören war
   Stimmen, Musik, rollender Ball und Nachbartische sind laut, aber nicht plötzlich – sie fallen durch die zweite
   Bedingung, ohne dass die Schwelle dafür hochgedreht werden muss. */
const DET={
  BLOCK:64,      // Samples je Messblock (≈1,3 ms bei 48 kHz): fein genug, um einen Knall von seinem Nachhall zu trennen
  PRE_MIN:6,     // so viele Blöcke (≈8 ms) Vorgeschichte braucht eine Spitze, sonst wartet man auf den nächsten Durchlauf
  RATIO:3,       // Spitze muss mindestens so viel mal lauter sein wie der Schnitt davor (≈ +9,5 dB)
  A_MIN:.012,    // absolute Untergrenze Ton (Block-RMS, 1 = Vollaussteuerung)
  M_MIN:.08,     // absolute Untergrenze Erschütterung (Sprung der Beschleunigung in m/s²)
  GAP:400,       // ms Pause nach einer Erkennung im Training
  CAL_FRAC:.4,   // Schwelle = so viel Anteil des leisesten kalibrierten Schusses …
  CAL_FLOOR:3,   // … mindestens aber so viel mal die lauteste Ruhe-Spitze
  CAL_GOOD:4     // Abstand Schuss ÷ Ruhe, ab dem die Erkennung als sicher gilt
};

/* Lautstärke je Block (Effektivwert) über einen Zeitpuffer */
function blockRms(buf,n){
  n=n||DET.BLOCK;const out=[];
  for(let i=0;i+n<=buf.length;i+=n){let s=0;for(let j=i;j<i+n;j++)s+=buf[j]*buf[j];out.push(Math.sqrt(s/n))}
  return out;
}
/* Sucht im Puffer einen Knall. Gibt {peak,idx,pre,ok} zurück; ok = laut genug UND plötzlich. */
function findOnset(blocks,thr,ratio){
  ratio=ratio||DET.RATIO;
  let pk=0,idx=-1;
  for(let i=0;i<blocks.length;i++)if(blocks[i]>pk){pk=blocks[i];idx=i}
  if(idx<DET.PRE_MIN)return{peak:pk,idx,pre:0,ok:false,wait:pk>=thr}; // zu wenig Vorgeschichte: nächster Durchlauf sieht sie
  let s=0;for(let i=0;i<idx-2;i++)s+=blocks[i];            // die 2 Blöcke direkt vor der Spitze (Anstieg) zählen nicht mit
  const pre=s/Math.max(1,idx-2);
  return{peak:pk,idx,pre,ok:pk>=thr&&pk>=pre*ratio,wait:false};
}
/* Dasselbe für Werte im Takt des Bewegungssensors (≈60 Hz): level = aktueller Sprung, hist = die letzten Werte davor */
function motOnset(level,hist,thr,ratio){
  ratio=ratio||DET.RATIO;
  const pre=hist.length?hist.reduce((a,b)=>a+b,0)/hist.length:0;
  return{peak:level,pre,ok:level>=thr&&level>=pre*ratio};
}

/* ---------- Kalibrierung ----------
   rest  = {a:[…],m:[…]}  Spitzen je Durchlauf während der Ruhe-Messung
   shots = [{a,m}, …]     je Schuss die lauteste Spitze (Ton / Erschütterung); 0 = nichts erkannt
   Ergebnis: Schwellen, Abstand Schuss ÷ Ruhe und eine Empfehlung, worüber erkannt werden soll. */
function calSummary(rest,shots){
  const mx=a=>a.length?Math.max.apply(null,a):0,mn=a=>a.length?Math.min.apply(null,a):0;
  const floorA=mx(rest.a),floorM=mx(rest.m);
  const sa=shots.map(s=>s.a).filter(v=>v>0),sm=shots.map(s=>s.m).filter(v=>v>0);
  const out={floorA,floorM,nShots:shots.length,gotA:sa.length,gotM:sm.length};
  out.a=sa.length?Math.max(DET.A_MIN,mn(sa)*DET.CAL_FRAC,floorA*DET.CAL_FLOOR):null;
  out.m=sm.length?Math.max(DET.M_MIN,mn(sm)*DET.CAL_FRAC,floorM*DET.CAL_FLOOR):null;
  out.qa=sa.length&&floorA>0?mn(sa)/floorA:sa.length?99:0;   // wie viel lauter der leiseste Schuss als die lauteste Ruhe war
  out.qm=sm.length&&floorM>0?mn(sm)/floorM:sm.length?99:0;
  const okA=sa.length===shots.length&&out.qa>=DET.CAL_GOOD,okM=sm.length===shots.length&&out.qm>=DET.CAL_GOOD;
  out.okA=okA;out.okM=okM;
  out.det=okA&&okM?'both':okA?'audio':okM?'motion':null;
  return out;
}
