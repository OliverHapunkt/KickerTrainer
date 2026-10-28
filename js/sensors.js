'use strict';
/* KickerTrainer · Ton, Schusserkennung, Spracheingabe, Wake Lock */
/* ---------- Audio ---------- */
let actx=null,ignoreUntil=0,quietUntil=0;
function ensureAudio(){if(!actx){const C=window.AudioContext||window.webkitAudioContext;if(C)actx=new C()}if(actx&&actx.state==='suspended')actx.resume()}
function beep(f=880,d=.12,v=.4){if(!actx)return;const o=actx.createOscillator(),g=actx.createGain(),t=actx.currentTime;o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(actx.destination);o.start(t);o.stop(t+d+.02);ignoreUntil=performance.now()+d*1000+150}
let voices=[],ttsBusy=false,ttsT=0;
function loadVoices(){voices=speechSynthesis.getVoices()}
if('speechSynthesis' in window){loadVoices();speechSynthesis.onvoiceschanged=loadVoices}
function speak(t,lang='de-DE',force){
  if((!S.voiceOut&&!force)||!('speechSynthesis' in window))return;
  speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang=lang;
  const v=voices.find(x=>x.lang&&x.lang.toLowerCase().startsWith(lang.slice(0,2).toLowerCase()));if(v)u.voice=v;
  u.rate=1.1;quietUntil=performance.now()+3000;ttsBusy=true;clearTimeout(ttsT);ttsT=setTimeout(()=>ttsBusy=false,2500);
  u.onend=u.onerror=()=>{quietUntil=performance.now()+1200;clearTimeout(ttsT);ttsT=setTimeout(()=>ttsBusy=false,150)};
  speechSynthesis.speak(u);
}

/* ---------- Mikrofon: Schusserkennung ---------- */
let micErr='';
function micBlocker(){
  if(!window.isSecureContext)return'Seite nicht über HTTPS geöffnet ('+location.protocol+') – bitte die GitHub-Pages-Adresse in Safari öffnen';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return'Browser erlaubt hier keinen Mikrofonzugriff – direkt in Safari öffnen, nicht in einer Vorschau/App';
  try{if(window.top!==window.self)return'Seite läuft eingebettet (Vorschau) – direkt in Safari öffnen'}catch(e){return'Seite läuft eingebettet (Vorschau) – direkt in Safari öffnen'}
  return'';
}
const mic={on:false,stream:null,an:null,buf:null,amb:.01,last:0,raf:0,testHit:0,gap:DET.GAP,rms:0,thr:0,peak:0};
async function micStart(){
  if(mic.on)return true;
  try{
    const why=micBlocker();if(why)throw new Error(why);
    // getUserMedia zuerst und direkt im Tap aufrufen (iOS zeigt sonst evtl. keinen Dialog)
    const p=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    ensureAudio();
    mic.stream=await p;
    if(actx.state!=='running')await actx.resume();
    const src=actx.createMediaStreamSource(mic.stream);
    mic.an=actx.createAnalyser();mic.an.fftSize=2048;mic.buf=new Float32Array(mic.an.fftSize);
    src.connect(mic.an);mic.on=true;mic.amb=.01;micLoop();return true;
  }catch(e){
    const m=e.name==='NotAllowedError'?'Mikrofon blockiert – in Einstellungen › Safari › Mikrofon (bzw. „aA“ › Website-Einstellungen) erlauben'
      :e.name==='NotFoundError'?'Kein Mikrofon gefunden':(e.message||e.name||'unbekannter Fehler');
    micErr=m;toast('Mikrofon: '+m);const v=$('#micVerdict');if(v){v.textContent=m;v.style.color='var(--miss)'}
    return false}
}
function micStop(){if(mic.stream)mic.stream.getTracks().forEach(t=>t.stop());mic.on=false;cancelAnimationFrame(mic.raf)}
/* Schwelle Ton: kalibriert (feste Zahl) oder – ohne Kalibrierung – Umgebungspegel × Regler, wie bisher */
function thrA(){return S.cal&&S.cal.a?S.cal.a:Math.max(mic.amb*S.sens,DET.A_MIN)}
function thrM(){return S.cal&&S.cal.m?S.cal.m:Math.max(mot.amb*S.msens,DET.M_MIN)}
function micLoop(){
  if(!mic.on)return;
  mic.an.getFloatTimeDomainData(mic.buf);
  const bl=blockRms(mic.buf),thr=cal.on?cal.thrA():thrA(),now=performance.now(),o=findOnset(bl,thr);
  mic.rms=o.peak;mic.thr=thr;mic.peak=o.peak;
  if(cal.on)cal.frame('a',o.peak,now);
  if(o.ok){if(now-mic.last>mic.gap){mic.last=now;sensorHit('a',now,o.peak)}}
  else if(!S.cal||!S.cal.a){ // Umgebungspegel nur ohne Kalibrierung nachführen
    const mean=bl.reduce((a,b)=>a+b,0)/bl.length;if(mean<thr)mic.amb=mic.amb*.98+mean*.02}
  mic.raf=requestAnimationFrame(micLoop);
}
/* ---------- Erschütterung (Beschleunigungssensor) ---------- */
const mot={on:false,prev:null,amb:.05,lvl:0,thr:0,last:0,peak:0,n:0,hist:[],gap:DET.GAP};
async function motStart(){
  if(mot.on)return true;
  try{
    if(typeof DeviceMotionEvent==='undefined')throw new Error('Kein Bewegungssensor');
    if(typeof DeviceMotionEvent.requestPermission==='function'){
      const st=await DeviceMotionEvent.requestPermission();if(st!=='granted')throw new Error('Bewegungssensor nicht erlaubt');
    }
    window.addEventListener('devicemotion',onMotion);mot.on=true;mot.prev=null;mot.amb=.05;return true;
  }catch(e){toast('Erschütterung: '+(e.message||e.name));return false}
}
function motStop(){window.removeEventListener('devicemotion',onMotion);mot.on=false}
function onMotion(e){
  const a=e.accelerationIncludingGravity||e.acceleration;if(!a||a.x==null)return;
  mot.n++;
  if(mot.prev){
    const d=Math.hypot(a.x-mot.prev.x,a.y-mot.prev.y,a.z-mot.prev.z),now=performance.now(),thr=cal.on?cal.thrM():thrM();
    mot.lvl=d;mot.thr=thr;
    const o=motOnset(d,mot.hist,thr);
    if(cal.on)cal.frame('m',d,now);
    if(o.ok){if(now-mot.last>mot.gap){mot.last=now;sensorHit('m',now,d)}}
    else if(!S.cal||!S.cal.m){if(d<thr)mot.amb=mot.amb*.97+d*.03}
    mot.hist.push(d);if(mot.hist.length>8)mot.hist.shift();
  }
  mot.prev={x:a.x,y:a.y,z:a.z};
}
/* ---------- Fusion ---------- */
const fus={a:-1e9,m:-1e9,fired:-1e9,flash:{a:0,m:0}};
function sensorHit(src,now,amp){
  if(cal.on){fus.flash[src]=now;cal.event(src,now,amp);return} // Kalibrierung hört selbst zu, löst nichts aus
  fus[src]=now;fus.flash[src]=now;
  const det=S.det,need=det==='both'?(fus.a>now-250&&fus.m>now-250):det==='either'?true:det==='audio'?src==='a':src==='m';
  if(need&&now-fus.fired>400){fus.fired=now;onImpulse(now)}
}
function sensorsOn(){return(useAudio()?mic.on:true)&&(useMotion()?mot.on:true)}
function useAudio(){return S.det!=='motion'}
function useMotion(){return S.det!=='audio'}
async function detStart(){ // beide Anfragen parallel im selben Tap starten (iOS verlangt Nutzergeste)
  const pm=useMotion()?motStart():(motStop(),Promise.resolve(true));
  const pa=useAudio()?micStart():(micStop(),Promise.resolve(true));
  const [a,m]=await Promise.all([pa,pm]);return a&&m}
function detStop(){micStop();motStop()}
function micHealth(){
  if(useAudio()){
    if(!mic.on)return'Mikrofon aus';
    const t=mic.stream&&mic.stream.getAudioTracks()[0];
    if(!t||t.readyState==='ended')return'Mikrofon beendet (iOS) – tippen zum Neustart';
    if(t.muted)return'Mikrofon stumm geschaltet (iOS, evtl. durch Sprachansage/-eingabe) – tippen zum Neustart';
    if(actx&&actx.state!=='running')return'Audio pausiert – tippen zum Neustart';
  }
  if(useMotion()&&(!mot.on||mot.n===0))return'Keine Sensordaten (Erschütterung)';
  return'';
}
async function detRestart(){micStop();motStop();mot.n=0;ensureAudio();await detStart()}
function drawMeters(){
  const now=performance.now(),scA=x=>Math.min(100,Math.sqrt(x/.5)*100),scM=x=>Math.min(100,Math.sqrt(x/4)*100);
  document.querySelectorAll('.mA').forEach(m=>{m.querySelector('i').style.width=(mic.on?scA(mic.rms||0):0)+'%';m.querySelector('b').style.left=scA(mic.thr||0)+'%';m.classList.toggle('det',now-fus.flash.a<250)});
  document.querySelectorAll('.mM').forEach(m=>{m.querySelector('i').style.width=(mot.on?scM(mot.lvl):0)+'%';m.querySelector('b').style.left=scM(mot.thr)+'%';m.classList.toggle('det',now-fus.flash.m<250)});
  const hs=S.mic?micHealth():'';
  [$('#mState'),$('#mStateTest')].forEach(el=>{if(!el)return;const txt=hs||(now-fus.fired<700?'● Schuss erkannt':'● bereit');
    if(el.textContent!==txt){el.textContent=txt;el.style.color=hs?'var(--miss)':now-fus.fired<700?'var(--hit)':'var(--mute)'}});
  requestAnimationFrame(drawMeters);
}

function onImpulse(now){
  if(!$('#test').classList.contains('hidden')){$('#micVerdict').textContent='Schuss erkannt ✓';$('#micVerdict').style.color='var(--hit)';clearTimeout(mic.testHit);mic.testHit=setTimeout(()=>$('#micVerdict').textContent='',1200);return}
  if(!R||!R.active||R.undo)return;
  if(now<ignoreUntil||ttsBusy)return;
  if((R.phase==='call'||R.phase==='aim')&&R.detectAt==null){
    R.detectAt=now;
    // Auto-Treffer: erkannter Schuss zählt als Treffer auf das angesagte Ziel (bei „Genau“ auf dessen Segment), Korrekturfenster folgt
    if(S.mic&&S.autoCount&&curKind()==='shot')input(inputMode()==='seg'&&R.target>0?R.target:'hit',true);
  }
}

/* ---------- Spracheingabe ---------- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
/* Wörterbuch Spracheingabe: gesprochenes Wort → Bedeutung. Die Hilfe-Tabelle (ⓘ) wird aus dieser Liste erzeugt.
   'yes'   = „Ja“ – je nach Phase: Aufbau beendet / Treffer / gefangen / Korrektur bestätigt
   'ready' = „Bereit“, „Los“ – nur Aufbau beendet, nie ein Ergebnis
   1–5     = Segment, 'hit' = Treffer/gefangen, 0 = Miss (daneben, unklar wohin), 'ml'/'mr' = links/rechts neben dem Tor (Schützensicht) */
const WORDS={ja:'yes',jo:'yes',jep:'yes',bereit:'ready',los:'ready',
  eins:1,'1':1,zwei:2,zwo:2,'2':2,drei:3,'3':3,vier:4,'4':4,'fünf':5,'5':5,
  treffer:'hit',tor:'hit',gefangen:'hit',
  miss:0,mis:0,mist:0,mies:0,daneben:0,verloren:0,nein:0,vorbei:0,links:'ml',rechts:'mr'};
const rec={r:null,want:false,seen:{},gen:0,onText:null,netT:0};
let voiceLast=0; // Zeitpunkt des letzten angenommenen Befehls (Wortgruppen wie „links daneben“ zählen nur einmal)
function recStart(){
  if(!SR)return false;
  rec.want=true;
  if(!rec.r){
    const r=new SR();r.lang='de-DE';r.continuous=true;r.interimResults=true;
    r.onresult=e=>{
      for(let i=e.resultIndex;i<e.results.length;i++){
        const res=e.results[i],txt=res[0].transcript.toLowerCase().replace(/[.,!?]/g,'').trim();
        if(rec.onText)rec.onText(txt);
        const words=txt.split(/\s+/).filter(Boolean),key=rec.gen+'_'+i;
        let seen=rec.seen[key]||0;
        for(let j=seen;j<words.length;j++){
          if(Object.prototype.hasOwnProperty.call(WORDS,words[j])){rec.seen[key]=j+1;onVoice(WORDS[words[j]],words[j])}
        }
        if(res.isFinal)rec.seen[key]=words.length;
      }
    };
    r.onend=()=>{if(rec.want)setTimeout(()=>{try{rec.gen++;rec.seen={};r.start()}catch(e){}},200)};
    r.onerror=e=>{
      if(e.error==='not-allowed'||e.error==='service-not-allowed'){rec.want=false;toast('Spracherkennung nicht erlaubt – evtl. iOS-Diktierfunktion prüfen (Einstellungen › Allgemein › Tastatur). Tippen geht weiter')}
      else if(e.error==='network'){const n=Date.now();if(n-rec.netT>15000){rec.netT=n;toast('Spracherkennung braucht Internet – bitte tippen')}}
    };
    rec.r=r;
  }
  try{rec.r.start()}catch(e){}
  return true;
}
function recStop(){rec.want=false;if(rec.r)try{rec.r.stop()}catch(e){}}
function onVoice(v,word){
  const now=performance.now();
  if(now<quietUntil||(window.speechSynthesis&&speechSynthesis.speaking))return; // eigene Ansage ignorieren
  if(testSR.active)return testSR.heard(v,word);
  if(now-voiceLast<700)return; // „links daneben“ & Co.: nur das erste Wort zählt
  const go=v==='yes'||v==='ready';
  if(!$('#intro').classList.contains('hidden')){if(go){voiceLast=now;closeIntro()}return}
  if(!$('#summary').classList.contains('hidden')){if(go&&nextPlanBtn()){voiceLast=now;nextPlanBtn().click()}return}
  if(!R||!R.active)return;
  // Aufbauzeit: nur „Ja“/„Bereit“. Die ersten 0,7 s zählen nicht, damit ein spät erkanntes Ergebnis-Wort die Aufbauzeit nicht verkürzt
  if(R.phase==='ready'){if(go&&now-R.phaseStart>700){voiceLast=now;input('ready')}return}
  // Korrekturfenster nach erkanntem Schuss: „Ja“ = stimmt so, weiter
  if(R.phase==='result'&&R.corr&&go){voiceLast=now;confirmCorr();return}
  if(v==='ready')return; // „Bereit“/„Los“ ist nie ein Ergebnis
  if(v==='yes')v='hit';   // „Ja“ = Treffer bzw. gefangen
  const seg=inputMode()==='seg';
  voiceLast=now;
  if(typeof v==='number'&&v>0){if(seg)input(v);return}
  if(v==='hit'){input(seg?(R.target||0)===0?null:R.target:'hit');return}
  if(v==='ml'||v==='mr'){input(v);return}
  if(v===0)input(0);
}

/* ---------- Wake Lock ---------- */
let wl=null;
async function wake(on){try{if(on&&'wakeLock' in navigator)wl=await navigator.wakeLock.request('screen');else if(!on&&wl){await wl.release();wl=null}}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&R&&R.active)wake(true)});
