'use strict';
/* KickerTrainer · Grundlagen: Konstanten, Speicher, Hilfsfunktionen */
const $=s=>document.querySelector(s);
const LS_DATA='kt2_data',LS_SET='kt2_settings';
const APP_VERSION=KT_VER.v,APP_DATE=KT_VER.d;
$('#appVer').textContent='v'+APP_VERSION+' · '+APP_DATE;
const SHOT_T=['Pull','Push','Snake','Tic-Tac','Frei'];
const PASS53_T=['Brush','Stick','Kick','Bande','Frei'];
const DISC={
  s3:{n:'Schuss 3er',kind:'shot',techs:SHOT_T,rule:15},
  s2:{n:'Schuss 2er',kind:'shot',techs:['Gerade','Bande','Lücke','Frei'],rule:15},
  p53:{n:'Pass 5er→3er',kind:'pass',techs:PASS53_T,rule:10},
  p25:{n:'Pass 2er→5er',kind:'pass',techs:['Gerade','Bande','Frei'],rule:15},
  p23:{n:'Pass 2er→3er',kind:'pass',techs:['Gerade','Bande','Frei'],rule:15},
  k53:{n:'Kombi Pass+Schuss',kind:'combo',techs:PASS53_T,techs2:SHOT_T,rule:10,rule2:15}
};
const NUM=['','Eins','Zwei','Drei','Vier','Fünf'];
const TORDER=[0,1,2,3,4,5,'wall','lane'];
// ready = Aufbauzeit nach jedem Versuch: 'auto' (Countdown, „Ja“/Tippen verkürzt), 'tap' (wartet auf „Ja“/Tippen), 'off' (nur bei freiem Tempo)
const DEFCFG={d:'s3',tech:'Pull',tech2:'Pull',tP:['wall','lane'],tS:[1,2,3,4,5],order:'mix',wt:['Pull'],wt2:['Pull'],weakN:10,timing:'free',window:2,ready:'auto',auto:5,scoring:'exact',amt:'count',count:20,minutes:10,pr:0};
const DEF={cfg:DEFCFG,plan:[],presets:[],cfgOpen:false,mode:'train',missDir:false,lp:true,stdOn:true,voiceOut:true,voiceIn:false,mic:false,sens:3,msens:4,det:'audio',autoCount:true,corrWin:3};

function clone(o){return JSON.parse(JSON.stringify(o))}
function load(k,d){try{const v=JSON.parse(localStorage.getItem(k));return v||clone(d)}catch(e){return clone(d)}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){toast('Speichern fehlgeschlagen!')}if(k===LS_DATA&&typeof cloudTouch==='function')cloudTouch()}
let S=Object.assign(clone(DEF),load(LS_SET,DEF));
S.cfg=Object.assign(clone(DEFCFG),S.cfg||{});if(!Array.isArray(S.plan))S.plan=[];if(!Array.isArray(S.presets))S.presets=[];
// Übungen haben Stationen (v3.6): {name,cfg} → {name,steps:[cfg]}
S.presets=S.presets.filter(p=>p&&(p.cfg||(Array.isArray(p.steps)&&p.steps.length))).map(p=>({name:p.name||'Übung',steps:(p.steps||[p.cfg]).map(c=>Object.assign(clone(DEFCFG),c))}));
// v3.8: Aufbauzeit gilt jetzt auch bei freiem Tempo. Dort war „Tippen“ nie eine bewusste Wahl (Auswahl war ausgeblendet) → auf Auto umstellen
if(!S.rdy38){
  const mig=c=>{if(c&&c.timing!=='signal'&&c.d!=='k53'&&c.ready==='tap'){c.ready='auto';if(!c.auto)c.auto=5}};
  mig(S.cfg);S.plan.forEach(mig);S.presets.forEach(p=>p.steps.forEach(mig));S.rdy38=1;saveS();
}
let D=load(LS_DATA,{v:2,sessions:[],shots:[]});
// Migration v1 → v2
D.shots.forEach(s=>{if(!s.d){s.d='s3';s.st='shot';s.sig=s.m==='late';s.end=true}});D.v=2;
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
function saveS(){save(LS_SET,S)}

function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function fmt(x,d=2){return x.toFixed(d).replace('.',',')}
function pct(r){return Math.round(r*100)+' %'}
function toast(t){const e=document.createElement('div');e.className='toast';e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),2400)}
/* ---------- Zwei Hälften: Üben und Spielen ----------
   Trainingsdaten gehören dir allein, Spieldaten mehreren Personen gemeinsam.
   Deshalb sind die Hälften auch in der Bedienung getrennt: Jede hat ihre eigene
   Tab-Leiste. Ganz links steht kein Ziel, sondern der Umschalter – er trägt den
   Namen der ANDEREN Hälfte und wechselt dorthin. */
const MODES={
  train:{n:'Üben',start:'home',tabs:[
    ['home','Training','tTrain'],['chal','Challenges','tChal'],
    ['stats','Statistik','tStats'],['settings','Mehr','tSettings']]},
  play:{n:'Spielen',start:'play',tabs:[
    ['play','Spiel','tPlay'],['groups','Gruppen','tGroups'],
    ['rank','Rangliste','tRank'],['settings','Mehr','tSettings']]}
};
const SCREENS=['home','train','chal','stats','settings','test','play','groups','rank','match'];
const TABS=[...new Set(Object.keys(MODES).flatMap(m=>MODES[m].tabs.map(t=>t[0])))];
function curMode(){return MODES[S.mode]?S.mode:'train'}
function curScreen(){return SCREENS.find(x=>!$('#'+x).classList.contains('hidden'))||''}
function markTab(id){
  document.querySelectorAll('#tabbar button[data-tab]').forEach(b=>b.classList.toggle('on',b.dataset.tab===id));
}
function show(id){
  SCREENS.forEach(x=>$('#'+x).classList.toggle('hidden',x!==id));
  $('#tabbar').classList.toggle('hidden',!TABS.includes(id));
  markTab(id);
  window.scrollTo(0,0)}
/* Tab-Leiste aus MODES aufbauen. Der Umschalter sieht bewusst anders aus als die
   Ziel-Tabs: Ein Tab, der die ganze Leiste austauscht, soll nicht wie ein Ziel wirken. */
function renderTabbar(){
  const m=curMode(),other=m==='train'?'play':'train';
  // Challenges nur, wenn sie eingeschaltet sind. Die Entscheidung gehört hierher:
  // Früher hat renderGam() den Knopf direkt versteckt – das ging schief, sobald die
  // Leiste neu gebaut wird oder in der anderen Hälfte gar nicht existiert.
  const tabs=MODES[m].tabs.filter(([id])=>id!=='chal'||typeof gCH!=='function'||gCH());
  $('#tabbar').innerHTML='<button class="modesw" data-mode="'+other+'" aria-label="Zu '+MODES[other].n+' wechseln">'
      +icon('swap')+'<span>'+MODES[other].n+'</span></button>'
    +tabs.map(([id,label,ic])=>'<button data-tab="'+id+'">'+icon(ic)+'<span>'+label+'</span></button>').join('');
  markTab(curScreen());
}
function setMode(m){
  if(!MODES[m])return;
  S.mode=m;saveS();
  document.body.classList.toggle('play',m==='play');
  renderTabbar();go(MODES[m].start);
}
/* Ein Ziel öffnen: erst aufbauen, dann zeigen. */
function go(id){
  if(id==='home'){renderHome();show('home')}
  else if(id==='chal'){renderChal();show('chal')}
  else if(id==='stats'){ST.session=null;ST.open=null;ST.edit=null;show('stats');renderStats()}
  else if(id==='settings'){renderSettings();show('settings')}
  else if(id==='play'||id==='groups'||id==='rank'){renderPlay(id);show(id)}
  else show(id);
}
document.addEventListener('click',e=>{
  const b=e.target.closest('#tabbar button');if(!b)return;
  if(b.dataset.mode)setMode(b.dataset.mode);else go(b.dataset.tab);
});
function tl(g,kind){return g===0?(kind==='pass'?'Pass':'Tor'):g==='wall'?'Wall':g==='lane'?'Lane':String(g)}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
