'use strict';
/* KickerTrainer · Testseite, Export und Import */
/* ---------- Test ---------- */
const testSR={active:false,i:0,seq:[['Ja','ready'],['Drei',3],['Daneben',0],['Treffer','hit'],['Fünf',5]],
  heard(v,w){const exp=this.seq[this.i][1],ok=v===exp;
    $('#sVerdict').textContent=ok?'✓ erkannt':'✗ „'+w+'“';$('#sVerdict').style.color=ok?'var(--hit)':'var(--miss)';
    if(ok){beep(1200,.07,.2);setTimeout(()=>{this.i=(this.i+1)%this.seq.length;$('#sSay').textContent='Sag: „'+this.seq[this.i][0]+'“';$('#sVerdict').textContent=''},900)}}};
function renderTest(){
  $('#srSupport').textContent=SR?'Dieser Browser unterstützt Spracherkennung (bei Safari teils über Apple-Server, Internet nötig).':'Dieser Browser unterstützt keine Spracherkennung – Eingabe nur per Tippen.';
  $('#btnSR').disabled=!SR;$('#btnSR').textContent=testSR.active?'Test stoppen':'Test starten';
  $('#btnMicTest').textContent=(mic.on||mot.on)?'Sensoren aus':'Mikrofon + Erschütterung an';
  const b=micBlocker();if(b&&!mic.on){$('#micVerdict').textContent=b;$('#micVerdict').style.color='var(--miss)'}
}
$('#btnTestBack').onclick=()=>{testSR.active=false;rec.onText=null;recStop();show('settings')};
function renderDataHint(){$('#dataHint').textContent=(CL&&CL.user?'Deine Daten werden mit deinem Konto abgeglichen. Die Sicherung als Datei ist zusätzlich möglich.':'Daten liegen nur auf diesem Gerät. iPad ↔ iPhone: exportieren (z. B. AirDrop) und drüben importieren – Duplikate werden erkannt.')+' Tipp: App „Zum Home-Bildschirm“ hinzufügen, sonst kann Safari Daten nach 7 Tagen ohne Besuch löschen.'}
$('#tsNum').onclick=()=>{ensureAudio();speak('Drei','de-DE',true)};
$('#tsWall').onclick=()=>{ensureAudio();speak('wall','en-US',true)};
$('#btnSR').onclick=()=>{
  if(testSR.active){testSR.active=false;rec.onText=null;recStop();$('#sSay').textContent='–';$('#sHeard').textContent='';renderTest();return}
  testSR.active=true;testSR.i=0;$('#sSay').textContent='Sag: „Ja“';$('#sVerdict').textContent='';
  rec.onText=t=>{$('#sHeard').textContent='gehört: '+t};recStart();renderTest();
};
$('#btnMicTest').onclick=async()=>{if(mic.on||mot.on)detStop();else{const s=S.det;if(!S.mic)S.det='either';await Promise.all([micStart(),motStart()]);S.det=s}renderTest()};

/* ---------- Export / Import ---------- */
$('#btnExport').onclick=async()=>{
  const name='kickertrainer-'+new Date().toISOString().slice(0,10)+'.json',blob=new Blob([JSON.stringify(D)],{type:'application/json'});
  try{const f=new File([blob],name,{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:'KickerTrainer Daten'});return}}catch(e){if(e&&e.name==='AbortError')return}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),3000);
};
$('#btnCSV').onclick=async()=>{
  const ex=exSet(),q=v=>v==null?'':String(v).includes(';')?'"'+String(v).replace(/"/g,'""')+'"':String(v);
  const rows=[['Datum','Uhrzeit','Session','Disziplin','Phase','Technik','Ziel','Gelandet','Erfolg','Richtung','Reaktion_ms','Signal','Korrigiert','Auto','Ausgeschlossen','Notiz']];
  for(const z of D.shots){const d=new Date(z.t),m=sessMeta(z.s)||{};
    rows.push([d.toLocaleDateString('de-DE'),d.toLocaleTimeString('de-DE'),z.s,discName(z.d),z.st==='pass'?'Pass':'Schuss',z.k,tl(z.g,z.st),z.l==null?'':z.l===0?'daneben':z.l,z.h?1:0,{l:'links',r:'rechts'}[missSide(z)]||'',z.rt,z.sig?1:0,z.fix?1:0,z.auto?1:0,ex.has(z.s)?1:0,m.note||''])}
  const csv='\ufeff'+rows.map(r=>r.map(q).join(';')).join('\r\n'),name='kickertrainer-'+new Date().toISOString().slice(0,10)+'.csv',blob=new Blob([csv],{type:'text/csv'});
  try{const f=new File([blob],name,{type:'text/csv'});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:'KickerTrainer Tabelle'});return}}catch(e){if(e&&e.name==='AbortError')return}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),3000);
};
$('#btnImport').onclick=()=>$('#fileImport').click();
$('#fileImport').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const o=JSON.parse(await f.text());if(!o||!Array.isArray(o.shots))throw 0;
    o.shots.forEach(s=>{if(!s.d){s.d='s3';s.st='shot';s.sig=s.m==='late';s.end=true}});
    const key=s=>s.s+'|'+s.t+'|'+s.st,have=new Set(D.shots.map(key));let add=0;
    for(const s of o.shots)if(!have.has(key(s))){D.shots.push(s);add++}
    D.shots.sort((a,b)=>a.t-b.t);
    const hs=new Set(D.sessions.map(x=>x.id));for(const x of(o.sessions||[]))if(!hs.has(x.id))D.sessions.push(x);
    D.sessions.sort((a,b)=>a.start-b.start);
    save(LS_DATA,D);toast(add+' Einträge importiert');renderHome();
  }catch(err){toast('Datei ungültig')}
  e.target.value='';
};
$('#btnReset').onclick=async()=>{
  if(!await ask('Alle Sessions und Einträge auf diesem Gerät werden gelöscht.',{title:'Alle Trainingsdaten löschen?',ok:'Löschen',danger:true}))return;
  if(!await ask('Das kann nicht rückgängig gemacht werden. Tipp: vorher „Sichern (JSON)“.',{title:'Wirklich sicher?',ok:'Endgültig löschen',danger:true}))return;
  if(CL.user){
    if(!await ask('Du bist angemeldet: Die Daten werden auch aus deinem Konto gelöscht. Andere Geräte behalten ihre lokale Kopie.',{title:'Auch im Konto löschen',ok:'Fortfahren',danger:true}))return;
    try{await cloudWipe()}catch(e){toast(errText(e,'Löschen im Konto fehlgeschlagen, nichts gelöscht'));return}
  }else if(SY.uid){const u=SY.uid,m=SY.email;SY=SY0();SY.uid=u;SY.email=m;saveSY()}
  D={v:2,sessions:[],shots:[]};save(LS_DATA,D);renderHome();toast('Gelöscht');
};
