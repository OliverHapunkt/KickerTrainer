'use strict';
/* KickerTrainer · Startseite und Schwachstellen-Planung */
/* ---------- Startseite ---------- */
// after: was nach dem Tippen passieren soll. Ohne Angabe wie bisher: Einstellungen
// speichern und die Trainingsseite neu aufbauen. Die Spielen-Hälfte gibt ihr eigenes mit.
function chips(el,opts,isOn,onTap,after){
  el.innerHTML='';
  opts.forEach(o=>{const b=document.createElement('button');b.className='chip'+(isOn(o.v)?' on':'');b.textContent=o.t;
    b.onclick=()=>{onTap(o.v);if(after)after();else{saveS();renderHome()}};el.appendChild(b)});
}
/* Regler für Zahlenwerte (ab v3.15 Standard, wo ein Wert in einem größeren Bereich gewählt wird).
   o: {min,max,step} oder {stops:[…]} (nur diese Werte rasten ein), value, fmt(v)→Text, onInput(v) = Wert merken,
   after = was nach dem Loslassen passiert (Standard: speichern und Startseite neu zeichnen).
   Während des Ziehens wird nur der Wert daneben aktualisiert – ein Neuzeichnen würde den Regler unter dem Finger wegnehmen. */
function slider(el,o){
  const st=o.stops,f=o.fmt||String;
  el.innerHTML='';el.classList.add('sl');
  const inp=document.createElement('input');inp.type='range';
  if(st){inp.min=0;inp.max=st.length-1;inp.step=1;inp.value=Math.max(0,st.indexOf(o.value))}
  else{inp.min=o.min;inp.max=o.max;inp.step=o.step||1;inp.value=o.value}
  const val=()=>st?st[+inp.value]:+inp.value,out=document.createElement('output');
  const show=()=>{out.textContent=f(val());inp.setAttribute('aria-valuetext',f(val()))};show();
  inp.oninput=()=>{show();o.onInput&&o.onInput(val())};
  inp.onchange=()=>{o.onInput&&o.onInput(val());if(o.after)o.after();else{saveS();renderHome()}};
  const w=document.createElement('div');w.className='slw';w.appendChild(inp);
  if(st&&st.length<=6){const t=document.createElement('div');t.className='ticks';st.forEach(v=>{const s=document.createElement('span');s.textContent=f(v);t.appendChild(s)});w.appendChild(t)}
  el.append(w,out);
}
function toggleTarget(arr,v){
  if(v===0)return[0];
  arr=arr.filter(x=>x!==0);
  if(arr.includes(v)){arr=arr.filter(x=>x!==v);return arr.length?arr:[0]}
  arr.push(v);return arr.sort((a,b)=>TORDER.indexOf(a)-TORDER.indexOf(b));
}
function hasShot(c){return DISC[c.d].kind!=='pass'}
function hasPass(c){return DISC[c.d].kind!=='shot'}
function techList(c,n){const a=n===2?c.wt2:c.wt,f=n===2?c.tech2:c.tech;return a&&a.length?a:[f]}
function toggleTech(c,n,v){
  const key=n===2?'wt2':'wt',a=techList(c,n).slice(),i=a.indexOf(v);
  if(i>=0){if(a.length>1)a.splice(i,1)}else a.push(v);
  c[key]=a;if(n===1)c.tech=a[0];else c.tech2=a[0];
}
/* Schwachstellen: Gewicht je Kombination Technik × Ziel aus den letzten N Sessions */
function weakPlan(cfg,kind){
  const d=DISC[cfg.d],techs=(d.kind==='combo'&&kind==='shot')?techList(cfg,2):techList(cfg,1),
    targets=kind==='shot'?cfg.tS:cfg.tP;
  const ids=new Set(D.sessions.filter(x=>x.d===cfg.d&&!x.x).slice(-(cfg.weakN||10)).map(x=>x.id));
  const shots=D.shots.filter(s=>ids.has(s.s)&&s.st===kind);
  const combos=[];
  for(const k of techs)for(const g of targets){
    const a=shots.filter(s=>s.k===k&&s.g===g),n=a.length,h=a.filter(s=>s.h).length;
    // laufende Session zählt dreifach: die App reagiert spürbar auf das, was du gerade zeigst
    let nw=0,hw=0;for(const s of a){const f=(R&&R.active&&s.s===R.id)?3:1;nw+=f;if(s.h)hw+=f}
    const rate=(hw+1)/(nw+2);
    combos.push({k,g,n,h,rate,w:.15+(1-rate)});
  }
  return{combos,shots:shots.length};
}
function pickW(list,last){
  const tot=list.reduce((x,c)=>x+c.w,0);
  for(let t=0;t<6;t++){
    let r=Math.random()*tot,c=list[list.length-1];
    for(const x of list){r-=x.w;if(r<=0){c=x;break}}
    if(!(last&&last.length>=2&&list.length>1&&last.every(l=>l.k===c.k&&l.g===c.g)))return c;
  }
  return list[0];
}
function weakPreview(cfg){
  const kinds=DISC[cfg.d].kind==='combo'?['pass','shot']:[DISC[cfg.d].kind];let out=[];
  for(const kind of kinds){
    const pl=weakPlan(cfg,kind),seen=pl.combos.filter(c=>c.n>=3).sort((a,b)=>a.rate-b.rate).slice(0,3);
    const nm=c=>c.k+' → '+tl(c.g,kind)+' ('+Math.round(c.h/c.n*100)+' %, n='+c.n+')';
    out.push((kinds.length>1?(kind==='pass'?'Pass: ':'Schuss: '):'')+(pl.shots<10||!seen.length?'noch zu wenig Daten – bis dahin fast gleichmäßig verteilt':'häufiger geübt: '+seen.map(nm).join(' · ')));
  }
  return out.join('\n')+'\nDie Gewichtung passt sich während der Session laufend an.';
}
function weakShares(cfg,kind){
  const pl=weakPlan(cfg,kind),tot=pl.combos.reduce((x,c)=>x+c.w,0);
  return{shots:pl.shots,list:pl.combos.map(c=>Object.assign({},c,{share:c.w/tot*100}))};
}
function weakKinds(cfg){return DISC[cfg.d].kind==='combo'?['pass','shot']:[DISC[cfg.d].kind]}
function weakLabel(cfg,c,kind){
  const n=((DISC[cfg.d].kind==='combo'&&kind==='shot')?techList(cfg,2):techList(cfg,1)).length;
  return(n>1?c.k+' → ':'')+tl(c.g,kind);
}
function updateWeakLive(){
  const el=$('#wLive');
  if(!R||!R.active||R.cfg.order!=='weak'){el.classList.add('hidden');return}
  const kind=curKind(),ws=weakShares(R.cfg,kind),s0=(R.share0&&R.share0[kind])||{};
  const top=ws.list.slice().sort((a,b)=>b.share-a.share).slice(0,3);
  el.innerHTML='Fokus: '+top.map((c,i)=>{
    const d=c.share-(s0[c.k+'|'+c.g]!=null?s0[c.k+'|'+c.g]:c.share),ar=d>=2?' ▲':d<=-2?' ▼':'',t=weakLabel(R.cfg,c,kind)+' '+Math.round(c.share)+' %'+ar;
    return i===0?'<b>'+t+'</b>':t}).join(' · ')+(ws.shots<10?' · wenig Daten':'');
  el.classList.remove('hidden');
}
function showWeakIntro(){
  let html='<h2>Schwachstellen-Training</h2>';
  for(const kind of weakKinds(R.cfg)){
    const ws=weakShares(R.cfg,kind),eq=Math.round(100/ws.list.length);
    if(weakKinds(R.cfg).length>1)html+='<div class="blockh">'+(kind==='pass'?'Pass':'Schuss')+'</div>';
    html+=ws.shots<10
      ?'<p class="hint" style="margin-top:0">Noch wenig Daten ('+ws.shots+' Versuche) – die Verteilung ist fast gleichmäßig und passt sich während der Übung an.</p>'
      :'<p class="hint" style="margin-top:0">Anteil an dieser Übung (gleichmäßig wären je '+eq+' %). Basis: letzte '+R.cfg.weakN+' Sessions.</p>';
    ws.list.slice().sort((a,b)=>b.share-a.share).slice(0,8).forEach(c=>{
      html+='<div class="wrow"><div>'+weakLabel(R.cfg,c,kind)+'<small>'+(c.n?'Quote '+Math.round(c.h/c.n*100)+' % · n='+c.n:'noch keine Daten')+'</small></div>'
        +'<div class="wbar"><i style="width:'+Math.min(100,c.share*2.2)+'%"></i></div><b>'+Math.round(c.share)+' %</b></div>';
    });
  }
  $('#introBody').innerHTML=html;$('#intro').classList.remove('hidden');
  clearTimeout(R.introT);R.introT=setTimeout(closeIntro,9000);
}
function closeIntro(){
  if($('#intro').classList.contains('hidden'))return;
  $('#intro').classList.add('hidden');
  if(R){clearTimeout(R.introT);if(R.active&&!R.began){R.began=true;later(startRep,400)}}
}
$('#intro').addEventListener('pointerdown',e=>{e.preventDefault();closeIntro()});
function cfgLabel(c){
  const d=DISC[c.d],wk=c.order==='weak',p=[d.n,(wk?techList(c,1).join('/'):c.tech)+(d.kind==='combo'?' + '+(wk?techList(c,2).join('/'):c.tech2):'')];
  if(hasPass(c))p.push(c.tP.map(x=>tl(x,'pass')).join('/'));
  if(hasShot(c))p.push(c.tS.map(x=>tl(x,'shot')).join(''));
  p.push(c.order==='mix'?'gemischt':c.order==='weak'?'Schwachstellen':'Serie',c.timing==='signal'?'Signal':'frei');
  if(hasShot(c))p.push(c.scoring==='exact'?'genau':'einfach');
  if(prOn(c))p.push('Druck '+c.pr);
  p.push(c.amt==='count'?c.count+'×':c.minutes+' min');
  return(c.std?'Standardtest · ':'')+p.join(' · ');
}
/* Kurzbeschreibung der Übung für die Karte „Aktuelle Übung“ */
function cfgSummary(c){
  const d=DISC[c.d],wk=c.order==='weak',t1=wk?techList(c,1).join('/'):c.tech,t2=d.kind==='combo'?(wk?techList(c,2).join('/'):c.tech2):null;
  const head=d.n+' · '+t1+(t2?' + '+t2:'');
  const p=[];
  if(hasPass(c))p.push('Pass: '+c.tP.map(x=>tl(x,'pass')).join('/'));
  if(hasShot(c))p.push((c.tS.length===1&&c.tS[0]===0)?'Tor (egal)':'Ziele '+c.tS.join(' '));
  p.push(c.order==='mix'?'gemischt':c.order==='weak'?'Schwachstellen':'Serie',c.timing==='signal'?'auf Signal':'freies Tempo');
  if(hasShot(c))p.push(c.scoring==='exact'?'genau':'einfach');
  if(prOn(c))p.push('Druck '+c.pr+' in Folge');
  p.push(c.amt==='count'?c.count+'×':c.minutes+' min');
  return{head,sub:p.join(' · ')}}
function renderHome(){
  const c=S.cfg,d=DISC[c.d];
  const simple=S.lvl==='simple',sc=curCfg();
  chips($('#cLvl'),[{v:'simple',t:'Simple'},{v:'pro',t:'Profi'}],v=>S.lvl===v,v=>S.lvl=v);
  const sm=simple?{head:DISC[sc.d].n,sub:sc.count+' Versuche · alle Ziele'}:cfgSummary(sc);$('#cfgSum').innerHTML=esc(sm.head)+'<small>'+esc(sm.sub)+'</small>';
  $('#cfgWrap').classList.toggle('hidden',simple||!S.cfgOpen);
  $('#simpleWrap').classList.toggle('hidden',!simple||!S.cfgOpen);
  $('#btnAddPlan').classList.toggle('hidden',simple);$('.qbtns').classList.toggle('two',!simple);
  const sm2=S.simple;
  chips($('#sDisc'),[{v:'s3',t:'Schuss 3er'},{v:'p53',t:'Pass 5er'}],v=>sm2.d===v,v=>sm2.d=v);
  slider($('#sAmt'),{stops:[10,20,50],value:sm2.count,fmt:n=>n+'×',onInput:v=>sm2.count=v});
  $('#btnCfg').innerHTML=(S.cfgOpen?'Fertig':'Anpassen')+' <span class="chev" aria-hidden="true">'+(S.cfgOpen?'▴':'▾')+'</span>';$('#btnCfg').setAttribute('aria-expanded',String(!!S.cfgOpen));
  renderPresets();
  if(typeof renderGam==='function')renderGam();
  if(typeof renderLp==='function')renderLp();
  chips($('#cDisc'),Object.entries(DISC).map(([v,x])=>({v,t:x.n})),v=>c.d===v,v=>{
    c.d=v;const n=DISC[v];if(!n.techs.includes(c.tech))c.tech=n.techs[0];if(n.techs2&&!n.techs2.includes(c.tech2))c.tech2=n.techs2[0];c.wt=(c.wt||[]).filter(x=>n.techs.includes(x));if(!c.wt.length)c.wt=[c.tech];if(n.techs2){c.wt2=(c.wt2||[]).filter(x=>n.techs2.includes(x));if(!c.wt2.length)c.wt2=[c.tech2]}});
  const wk=c.order==='weak';
  $('#lTech').innerHTML=(d.kind==='combo'?'Pass-Technik':'Technik')+(wk?' <span class="lmulti">mehrere möglich</span>':'');$('#cTech').classList.toggle('multi',wk);$('#cTech2').classList.toggle('multi',wk);
  if(wk)chips($('#cTech'),d.techs.map(t=>({v:t,t})),v=>techList(c,1).includes(v),v=>toggleTech(c,1,v));
  else chips($('#cTech'),d.techs.map(t=>({v:t,t})),v=>c.tech===v,v=>c.tech=v);
  $('#wTech2').classList.toggle('hidden',d.kind!=='combo');
  if(d.techs2){
    $('#wTech2').querySelector('label').innerHTML='Schuss-Technik'+(wk?' <span class="lmulti">mehrere möglich</span>':'');
    if(wk)chips($('#cTech2'),d.techs2.map(t=>({v:t,t})),v=>techList(c,2).includes(v),v=>toggleTech(c,2,v));
    else chips($('#cTech2'),d.techs2.map(t=>({v:t,t})),v=>c.tech2===v,v=>c.tech2=v);
  }
  $('#wTP').classList.toggle('hidden',!hasPass(c));$('#wTS').classList.toggle('hidden',!hasShot(c));
  chips($('#cTP'),[{v:0,t:'Egal'},{v:'wall',t:'Wall'},{v:'lane',t:'Lane'}],v=>c.tP.includes(v),v=>c.tP=toggleTarget(c.tP,v));
  chips($('#cTS'),[{v:0,t:'Tor (egal)'},1,2,3,4,5].map(x=>typeof x==='number'?{v:x,t:String(x)}:x),v=>c.tS.includes(v),v=>c.tS=toggleTarget(c.tS,v));
  chips($('#cOrder'),[{v:'mix',t:'Gemischt'},{v:'series',t:'Serie'},{v:'weak',t:'Schwachstellen'}],v=>c.order===v,v=>c.order=v);
  $('#wWeak').classList.toggle('hidden',c.order!=='weak');
  if(c.order==='weak'){
    chips($('#cWeakN'),[5,10,20].map(n=>({v:n,t:n+' Sessions'})),v=>c.weakN===v,v=>c.weakN=v);
    $('#hWeak').textContent=weakPreview(c);
  }
  chips($('#cTiming'),[{v:'free',t:'Freies Tempo'},{v:'signal',t:'Auf Signal'}],v=>c.timing===v,v=>c.timing=v);
  $('#hTiming').textContent=c.timing==='free'
    ?'Nach der Aufbauzeit wird das Ziel angesagt, du spielst in deinem Rhythmus.'
    :'Nach „Bereit“ kommt das Ziel zufällig innerhalb der Regelzeit ('+d.rule+' s) – dann bleibt nur das Reaktionsfenster.';
  $('#wWindow').classList.toggle('hidden',c.timing!=='signal');
  slider($('#cWindow'),{min:1,max:4,step:.5,value:c.window,fmt:n=>fmt(n,n%1?1:0)+' s',onInput:v=>c.window=v});
  // Aufbauzeit gilt für alle Modi. „Aus“ gibt es nur bei freiem Tempo (bei Signal und beim Schuss der Kombi ist „Bereit“ Pflicht)
  const needSetup=c.timing==='signal'||d.kind==='combo';
  if(needSetup&&c.ready==='off')c.ready='tap';
  chips($('#cReady'),(needSetup?[]:[{v:'off',t:'Aus'}]).concat([{v:'tap',t:'Tippen'},{v:'auto',t:'Auto'}]),
    v=>c.ready===v,v=>{c.ready=v;if(v==='auto'&&!c.auto)c.auto=5});
  $('#sReady').classList.toggle('hidden',c.ready!=='auto');
  if(c.ready==='auto')slider($('#sReady'),{min:1,max:15,step:1,value:c.auto||5,fmt:n=>n+' s',onInput:v=>c.auto=v});
  $('#hReady').textContent=c.ready==='off'?'Ziel kommt sofort nach dem Ergebnis.'
    :c.ready==='tap'?'Nach jedem Versuch wartet die App auf „Ja“ oder Tippen auf BEREIT, dann 0,5 s Griffzeit.'
    :'Nach jedem Versuch läuft ein Countdown zum Aufbauen. „Ja“ oder Tippen beendet ihn früher, dann 0,5 s Griffzeit.';
  $('#wScore').classList.toggle('hidden',!hasShot(c));
  chips($('#cScore'),[{v:'simple',t:'Einfach'},{v:'exact',t:'Genau'}],v=>c.scoring===v,v=>c.scoring=v);
  $('#hScore').textContent=c.scoring==='exact'?'Du meldest, wohin der Ball ging: Segment 1–5, links oder rechts neben dem Tor, oder „Miss“ (daneben, unklar wohin).':'Du meldest nur Treffer oder Daneben („Ja“ / „Miss“).';
  $('#wPr').classList.toggle('hidden',d.kind==='combo');
  slider($('#cPr'),{stops:[0,3,4,5,6,7,8,9,10],value:c.pr||0,fmt:n=>n?n+' in Folge':'Aus',onInput:v=>c.pr=v,after:()=>{saveS();$('#hPr').textContent=prHint(c);renderHome()}});
  $('#hPr').textContent=prHint(c);
  chips($('#cAmtC'),[{v:'count',t:'Anzahl'},{v:'time',t:'Zeit'}],v=>c.amt===v,v=>c.amt=v);
  if(c.amt==='time')slider($('#cAmt'),{min:1,max:30,step:1,value:c.minutes,fmt:n=>n+' min',onInput:v=>c.minutes=v});
  else slider($('#cAmt'),{min:5,max:100,step:5,value:c.count,fmt:n=>n+'×',onInput:v=>c.count=v});
  // Plan
  $('#planCard').classList.toggle('hidden',simple||!S.plan.length);
  $('#planTitle').textContent='Ablauf · '+S.plan.length+(S.plan.length===1?' Station':' Stationen');
  $('#planList').innerHTML='';
  S.plan.forEach((p,i)=>{const r=document.createElement('div');r.className='planitem';
    r.innerHTML='<b>'+(i+1)+'</b><span></span><button aria-label="Station entfernen">'+icon('x')+'</button>';r.querySelector('span').textContent=cfgLabel(p);
    r.querySelector('button').onclick=()=>{S.plan.splice(i,1);saveS();renderHome()};$('#planList').appendChild(r)});
  $('#oVoiceOut').checked=S.voiceOut;$('#oMissDir').checked=!!S.missDir;$('#oVoiceIn').checked=S.voiceIn;$('#oMic').checked=S.mic;$('#oSens').value=S.sens;
  $('#oVoiceIn').disabled=!SR;$('#oMSens').value=S.msens;
  $('#srNote').textContent=SR?'Spracheingabe braucht Internet (bei Safari teils über Apple-Server) und kann das Mikrofon der Schusserkennung stören. Tippen geht immer.':'Dieser Browser unterstützt keine Spracherkennung – Eingabe nur per Tippen.';
  $('#wDet').classList.toggle('hidden',!S.mic);
  $('#calState').textContent=S.cal?'Kalibriert am '+new Date(S.cal.at).toLocaleDateString('de-DE')+'. Bei anderem Tisch oder Ort neu kalibrieren.':'Nicht kalibriert – die Schwelle folgt dem Umgebungspegel. Kalibrieren ist genauer (Knopf unten).';
  $('#oAuto').checked=S.autoCount;$('#wCorr').classList.toggle('hidden',!S.autoCount);$('#oAuto').disabled=!S.mic;$('#oAuto').closest('.row').style.opacity=S.mic?'':'.5';
  chips($('#cCorr'),[2,3,5].map(n=>({v:n,t:n+' s'})),v=>S.corrWin===v,v=>S.corrWin=v);
  chips($('#cDet'),[{v:'audio',t:'Ton'},{v:'motion',t:'Erschütterung'},{v:'both',t:'Ton + Erschütterung'},{v:'either',t:'Ton oder Erschütterung'}],v=>S.det===v,v=>{S.det=v;if(S.mic)detStart()});
}
$('#oVoiceOut').onchange=e=>{S.voiceOut=e.target.checked;saveS()};
$('#oMissDir').onchange=e=>{S.missDir=e.target.checked;saveS()};
$('#oVoiceIn').onchange=e=>{S.voiceIn=e.target.checked;saveS()};
$('#oMic').onchange=async e=>{S.mic=e.target.checked;saveS();if(!S.mic){detStop();$('#wDet').classList.add('hidden');return}
  if(!await detStart()){S.mic=false;saveS();e.target.checked=false}else toast('Schusserkennung aktiv ✓');renderHome()};
$('#oAuto').onchange=e=>{S.autoCount=e.target.checked;saveS();renderHome()};
$('#oMSens').oninput=e=>{S.msens=+e.target.value;saveS()};
$('#oSens').oninput=e=>{S.sens=+e.target.value;saveS()};
$('#btnStart').onclick=()=>startSession(curCfg(),null);
/* Ablauf = mehrere Stationen hintereinander; als Übung speicherbar */
function startSteps(steps,name){
  steps=steps.map(c=>Object.assign(clone(DEFCFG),clone(c)));
  if(steps.length===1)startSession(steps[0],null);else startSession(steps[0],{i:0,steps,name:name||null});
}
$('#btnAddPlan').onclick=()=>{S.plan.push(clone(S.cfg));saveS();renderHome();toast('Station '+S.plan.length+' hinzugefügt')};
$('#btnPlanStart').onclick=()=>{if(S.plan.length)startSteps(S.plan)};
$('#btnPlanClear').onclick=async()=>{if(await ask('Alle Stationen werden aus dem Ablauf entfernt.',{title:'Ablauf leeren?',ok:'Leeren'})){S.plan=[];saveS();renderHome()}};
$('#btnPlanSave').onclick=async()=>{
  const n=await askText('Name des Ablaufs',{value:'Ablauf '+(S.presets.length+1),max:40});if(n===null)return;
  S.presets.push({name:n.trim().slice(0,40)||'Ablauf',steps:clone(S.plan)});saveS();renderHome();toast('Als Übung gespeichert')};
/* Meine Übungen (gespeicherte Konfigurationen) */
function renderPresets(){
  const el=$('#presetList');el.innerHTML='';
  $('#presetCard').classList.toggle('hidden',S.lvl==='simple'||!S.presets.length);
  S.presets.forEach((p,i)=>{
    const r=document.createElement('div');r.className='prow';const multi=p.steps.length>1,sm=cfgSummary(p.steps[0]);
    r.innerHTML='<button class="pmain"><b></b><small></small></button><button class="pgo" aria-label="Starten">'+icon('play')+'</button><button class="pdel" aria-label="Löschen">'+icon('x')+'</button>';
    r.querySelector('b').textContent=p.name;
    r.querySelector('small').textContent=multi?p.steps.length+' Stationen · '+p.steps.map(c=>DISC[c.d]?DISC[c.d].n:c.d).join(' → '):sm.head+' · '+sm.sub;
    // Antippen lädt: einzelne Übung in „Aktuelle Übung“, Ablauf zusätzlich in den Ablauf
    r.querySelector('.pmain').onclick=()=>{S.cfg=Object.assign(clone(DEFCFG),clone(p.steps[0]));if(multi)S.plan=clone(p.steps);saveS();renderHome();toast('„'+p.name+'“ geladen')};
    r.querySelector('.pgo').onclick=()=>startSteps(p.steps,p.name);
    r.querySelector('.pdel').onclick=async()=>{if(!await ask('Die gespeicherte Übung wird entfernt.',{title:'„'+p.name+'“ löschen?',ok:'Löschen',danger:true}))return;S.presets.splice(i,1);saveS();renderHome()};
    el.appendChild(r)});
}
$('#btnPreset').onclick=async()=>{
  const n=await askText('Name der Übung',{value:cfgSummary(S.cfg).head,max:40});if(n===null)return;const name=n.trim().slice(0,40)||cfgSummary(S.cfg).head;
  S.presets.push({name,steps:[clone(S.cfg)]});saveS();renderHome();toast('Gespeichert')};
$('.qhead').onclick=()=>{S.cfgOpen=!S.cfgOpen;saveS();renderHome()};
/* Einstellungen: Karten, die nur fürs Üben gelten, in der Spielen-Hälfte ausblenden.
   Konto, Daten und Gamification gelten für beide Hälften. */
function renderSettings(){
  const play=curMode()==='play';
  document.querySelectorAll('#settings [data-only]').forEach(el=>
    el.classList.toggle('hidden',el.dataset.only!==(play?'play':'train')));
  renderDataHint();
}
$('#btnTest').onclick=()=>{ensureAudio();renderTest();show('test')};
