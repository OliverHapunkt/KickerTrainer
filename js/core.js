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
const DEFCFG={d:'s3',tech:'Pull',tech2:'Pull',tP:['wall','lane'],tS:[1,2,3,4,5],order:'mix',wt:['Pull'],wt2:['Pull'],weakN:10,timing:'free',window:2,ready:'tap',auto:5,scoring:'exact',amt:'count',count:20,minutes:10};
const DEF={cfg:DEFCFG,plan:[],presets:[],cfgOpen:false,voiceOut:true,voiceIn:false,mic:false,sens:3,msens:4,det:'audio',autoCount:true,corrWin:3};

function clone(o){return JSON.parse(JSON.stringify(o))}
function load(k,d){try{const v=JSON.parse(localStorage.getItem(k));return v||clone(d)}catch(e){return clone(d)}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){toast('Speichern fehlgeschlagen!')}if(k===LS_DATA&&typeof cloudTouch==='function')cloudTouch()}
let S=Object.assign(clone(DEF),load(LS_SET,DEF));
S.cfg=Object.assign(clone(DEFCFG),S.cfg||{});if(!Array.isArray(S.plan))S.plan=[];if(!Array.isArray(S.presets))S.presets=[];
let D=load(LS_DATA,{v:2,sessions:[],shots:[]});
// Migration v1 → v2
D.shots.forEach(s=>{if(!s.d){s.d='s3';s.st='shot';s.sig=s.m==='late';s.end=true}});D.v=2;
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
function saveS(){save(LS_SET,S)}

function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function fmt(x,d=2){return x.toFixed(d).replace('.',',')}
function pct(r){return Math.round(r*100)+' %'}
function toast(t){const e=document.createElement('div');e.className='toast';e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),2400)}
const TABS=['home','stats','settings'];
function show(id){
  ['home','train','stats','settings','test'].forEach(x=>$('#'+x).classList.toggle('hidden',x!==id));
  $('#tabbar').classList.toggle('hidden',!TABS.includes(id));
  document.querySelectorAll('#tabbar button').forEach(b=>b.classList.toggle('on',b.dataset.tab===id));
  window.scrollTo(0,0)}
function tl(g,kind){return g===0?(kind==='pass'?'Pass':'Tor'):g==='wall'?'Wall':g==='lane'?'Lane':String(g)}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
