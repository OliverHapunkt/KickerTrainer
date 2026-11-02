/* Browsertest: Reaktionsschießen über die ganze Kette (Fake-Mikrofon + künstliche Knalle, wie kalibrierung.test.js).
   Geprüft: Einstellungen, Lücken auf dem Bildschirm, Schuss bei grünem / grauem Ziel, Einleitung, Verpasst, Korrektur,
   dynamische Stufe, ohne Schusserkennung, Auswertung. Misst NICHT, wie ein echter Tisch klingt. */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  try{const b=fs.readFileSync(path.join(ROOT,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};
const errs=[];
const base=(extra)=>JSON.stringify(Object.assign({onb:true,mode:'train',lvl:'pro',voiceOut:false,mic:true,det:'audio',cal:{a:.05,m:null,at:Date.now(),qa:9,qm:0},
  cfg:{d:'r3',tech:'Frei',wt:['Frei'],tS:[2],order:'mix',timing:'free',ready:'off',scoring:'exact',amt:'count',count:6,lvl:5,dyn:false}},extra||{}));
async function open(br,settings,mic=true){
  const ctx=await br.newContext({viewport:{width:390,height:844},permissions:['microphone']});const pg=await ctx.newPage();
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message+' '+(e.stack||'').split('\n').slice(1,3).join('|')));
  pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
  await pg.addInitScript(s=>{if(!localStorage.getItem('kt2_settings'))localStorage.setItem('kt2_settings',s)},settings);
  await pg.goto('http://127.0.0.1:8128/',{waitUntil:'networkidle'});await pg.waitForTimeout(500);
  await pg.evaluate(()=>{DISC.r3.rule=4}); // kurze Versuchszeit, damit „Verpasst“ schnell kommt
  if(mic)await pg.evaluate(async()=>{
    await detStart();window.__sy={knocks:[]};const SR=48000;
    mic.an.getFloatTimeDomainData=function(buf){const now=performance.now(),n=buf.length,ks=__sy.knocks.filter(k=>now-k.t<400);__sy.knocks=ks;
      for(let i=0;i<n;i++){const t=now-(n-1-i)/SR*1000;let v=(Math.random()*2-1)*.0052;for(const k of ks)if(t>=k.t)v+=(Math.random()*2-1)*k.p*Math.exp(-(t-k.t)/12);buf[i]=v}};
    window.__knock=()=>__sy.knocks.push({t:performance.now(),p:.4});
  });
  return pg;
}
const waitRep=(pg,n)=>pg.waitForFunction(k=>R&&R.entries.length>=k,n,{timeout:20000});
const last=pg=>pg.evaluate(()=>{const e=R.entries[R.entries.length-1];return e?{tm:e.tm,h:e.h,rt:e.rt,l:e.l,lv:e.lv,auto:e.auto,g:e.g}:null});

(async()=>{
  await new Promise(r=>srv.listen(8128,'127.0.0.1',r));
  const br=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});

  console.log('== Einstellungen ==');
  let pg=await open(br,base({cfgOpen:true}));
  ok((await pg.$$eval('#cDisc .chip',e=>e.map(x=>x.textContent))).includes('Reaktionsschießen'),'„Reaktionsschießen“ steht in der Disziplin-Auswahl');
  ok(await pg.isVisible('#wReact'),'Block „Stufe“ ist sichtbar');
  ok(await pg.isHidden('#wTiming')&&await pg.isHidden('#wPr')&&await pg.isHidden('#wWindow'),'Timing, Reaktionsfenster und Druckmodus sind ausgeblendet');
  ok(JSON.stringify(await pg.$$eval('#cDyn .chip',e=>e.map(x=>x.textContent)))===JSON.stringify(['Fest','Dynamisch']),'Chips Fest | Dynamisch');
  ok(JSON.stringify(await pg.$eval('#sLvl input',e=>[e.min,e.max,e.step,e.value]))===JSON.stringify(['1','10','1','5']),'Regler Stufe 1–10, Start 5');
  ok(!(await pg.$$eval('#cTS .chip',e=>e.map(x=>x.textContent))).some(t=>/egal/.test(t)),'Keine Zielwahl „Tor (egal)“');
  ok(await pg.isHidden('#hRx'),'Hinweis zur Schusserkennung ist weg, wenn sie an ist');
  await pg.fill('#sLvl input','8');await pg.waitForTimeout(150);
  ok((await pg.evaluate(()=>S.cfg.lvl))===8&&/schwer/.test(await pg.textContent('#sLvl output')),'Stufe 8 per Regler („schwer“)');
  await pg.click('#cDyn .chip:has-text("Dynamisch")');
  ok(/Startstufe/.test(await pg.textContent('#lLvl'))&&/dynamisch ab Stufe 8/.test(await pg.textContent('#cfgSum')),'Dynamisch: „Startstufe“, Zusammenfassung „dynamisch ab Stufe 8“');
  await pg.close();

  console.log('== Hinweis ohne Schusserkennung ==');
  pg=await open(br,base({cfgOpen:true,mic:false}),false);
  ok(await pg.isVisible('#hRx')&&/Empfohlen: mit Schusserkennung/.test(await pg.textContent('#hRx')),'Hinweis „Empfohlen: mit Schusserkennung spielen“ steht da');
  await pg.close();

  console.log('== Mit Schusserkennung ==');
  pg=await open(br,base());
  await pg.evaluate(()=>startSession(S.cfg,null));
  // Einleitung: noch keine Lücke, das Ziel ist markiert
  await pg.waitForFunction(()=>R.phase==='aim',null,{timeout:4000});
  let st=await pg.evaluate(()=>({rx:[...segs.children].map(b=>b.classList.contains('rx')),tgt:[...segs.children].map(b=>b.classList.contains('tgt')),open:[...segs.children].filter(b=>b.classList.contains('open')).length,txt:document.querySelector('#tStatus').textContent}));
  ok(st.rx.every(Boolean)&&st.tgt.join()==='false,true,false,false,false','Ansage: alle Segmente grau, Ziel 2 hat den weißen Rand');
  ok(st.open===0&&/2 · warten/.test(st.txt),'Einleitung: noch keine Lücke, Status „… warten“ ('+st.txt+')');
  // Schuss in der Einleitung = zu früh
  await pg.waitForTimeout(300);await pg.evaluate(()=>__knock());
  await waitRep(pg,1);let e=await last(pg);
  ok(e.tm==='early'&&e.h===false&&e.rt===null&&e.l===null,'Schuss in der Einleitung: zu früh, kein Treffer, keine Zeit ('+JSON.stringify(e)+')');
  ok(/Zu früh/.test(await pg.textContent('#tStatus')),'Status zeigt „Zu früh“');
  ok(await pg.evaluate(()=>R.corr===null),'… ohne Korrekturfenster');
  // nächster Versuch: Lücken laufen
  await pg.waitForFunction(()=>R.phase==='aim'&&R.rx&&R.entries.length===1,null,{timeout:6000});
  const cnt=await pg.evaluate(()=>{const n=[...segs.children].filter(b=>b.classList.contains('open')).length;return n});
  ok(cnt>=1&&cnt<=3,'Auf dem Bildschirm sind '+cnt+' Lücken grün (1–3)');
  // Schuss bei grünem Ziel
  await pg.waitForFunction(()=>rxTargetOpen()&&performance.now()-R.rx.open[R.target]>150,null,{timeout:10000,polling:'raf'});
  const green=await pg.evaluate(()=>segs.children[R.target-1].classList.contains('open')&&/JETZT/.test(document.querySelector('#tStatus').textContent));
  ok(green,'Ziel grün: Segment leuchtet, Status „JETZT“');
  await pg.evaluate(()=>__knock());await waitRep(pg,2);e=await last(pg);
  ok(e.tm==='ok'&&e.auto===true&&e.h===true&&e.l===2,'Schuss bei grünem Ziel: ok, Treffer-Kandidat auf Segment 2 ('+JSON.stringify(e)+')');
  ok(e.rt>=150&&e.rt<4000,'Reaktionszeit ab Grünwerden gemessen ('+e.rt+' ms)');
  ok(/Im Fenster/.test(await pg.textContent('#tStatus'))&&await pg.evaluate(()=>!!R.corr),'Status „Im Fenster“, Korrekturfenster läuft');
  ok(await pg.evaluate(()=>[...segs.children].every(b=>!b.classList.contains('rx'))),'Nach dem Schuss: Lücken-Anzeige aus');
  // Korrektur: Ball ging ins Segment 3
  await pg.evaluate(()=>input(3));await pg.waitForTimeout(100);
  e=await last(pg);ok(e.h===false&&e.l===3&&e.tm==='ok','Korrektur auf Segment 3: kein Treffer, Zeitfenster bleibt ok');
  // Schuss bei grauem Ziel, das noch nie aufging = zu früh (Lücken laufen schon)
  await pg.waitForFunction(()=>R.phase==='aim'&&R.rx&&R.entries.length===2,null,{timeout:6000});
  await pg.waitForFunction(()=>R.rx&&performance.now()-R.rx.t0>300&&!rxTargetOpen()&&R.rx.lastOpen[R.target]===0,null,{timeout:6000,polling:'raf'});
  ok(await pg.evaluate(()=>[...segs.children].some(b=>b.classList.contains('open'))),'… andere Lücken sind gerade grün (Ablenkung)');
  await pg.evaluate(()=>__knock());await waitRep(pg,3);e=await last(pg);
  ok(e.tm==='early'&&e.h===false&&e.rt===null,'Schuss bei grauem Ziel: zu früh, kein Treffer ('+e.tm+')');
  // Verpasst: nichts schießen
  await pg.waitForFunction(()=>R.entries.length>=3&&R.phase==='aim'&&R.rx,null,{timeout:8000});
  const n0=await pg.evaluate(()=>R.entries.length);
  await waitRep(pg,n0+1);e=await last(pg);
  ok(e.tm==='none'&&e.h===false&&e.rt===null,'Kein Schuss bis zum Ende der Versuchszeit: verpasst ('+JSON.stringify(e)+')');
  ok(/Verpasst/.test(await pg.textContent('#tStatus')),'Status zeigt „Verpasst“');
  await pg.close();

  console.log('== Zu spät ==');
  pg=await open(br,base());
  await pg.evaluate(()=>{DISC.r3.rule=12;startSession(S.cfg,null)});
  await pg.waitForFunction(()=>R.rx&&R.rx.closedAt[R.target]>R.rx.t0&&!rxTargetOpen()&&performance.now()-R.rx.closedAt[R.target]>330&&performance.now()-R.rx.closedAt[R.target]<420,null,{timeout:20000,polling:'raf'});
  await pg.evaluate(()=>__knock());await waitRep(pg,1);e=await last(pg);
  ok(e.tm==='late'&&e.h===false,'Schuss kurz nach dem Schließen (> 150 ms): zu spät ('+e.tm+')');
  ok(/Zu spät/.test(await pg.textContent('#tStatus')),'Status zeigt „Zu spät“');
  await pg.close();

  console.log('== Dynamisch ==');
  pg=await open(br,base({cfg:{d:'r3',tech:'Frei',wt:['Frei'],tS:[2],order:'mix',timing:'free',ready:'off',scoring:'exact',amt:'count',count:6,lvl:5,dyn:true}}));
  await pg.evaluate(()=>startSession(S.cfg,null));
  ok((await pg.evaluate(()=>R.lvl))===5,'Start bei Stufe 5');
  await pg.waitForTimeout(500);await pg.evaluate(()=>__knock());                       // zu früh = Daneben
  await pg.waitForFunction(()=>R.entries.length>=1&&R.phase==='aim'&&R.entries.length===1&&R.rx,null,{timeout:8000});
  ok((await pg.evaluate(()=>R.lvl))===4,'Nach einem Fehlschuss: Stufe 4');
  ok((await last(pg)).lv===5,'Der Eintrag merkt sich die Stufe, mit der geschossen wurde (5)');
  await pg.waitForFunction(()=>rxTargetOpen()&&performance.now()-R.rx.open[R.target]>150,null,{timeout:10000,polling:'raf'});
  await pg.evaluate(()=>__knock());await waitRep(pg,2);
  await pg.evaluate(()=>input('hit'));                                                // Treffer bestätigen
  await pg.waitForFunction(()=>R.phase==='aim'&&R.entries.length===2,null,{timeout:8000});
  ok((await pg.evaluate(()=>R.lvl))===4.5,'Nach einem Treffer: Stufe 4,5');
  // Rückgängig stellt die Stufe wieder her
  await pg.evaluate(()=>undo());await pg.waitForTimeout(100);
  ok((await pg.evaluate(()=>R.lvl))===4&&(await pg.evaluate(()=>R.entries.length))===1,'Rückgängig: letzter Eintrag weg, Stufe wieder 4');
  await pg.close();

  console.log('== Ohne Schusserkennung ==');
  pg=await open(br,base({mic:false,cfg:{d:'r3',tech:'Frei',wt:['Frei'],tS:[2],order:'mix',timing:'free',ready:'off',scoring:'simple',amt:'count',count:3,lvl:5,dyn:false}}),false);
  await pg.evaluate(()=>startSession(S.cfg,null));
  await pg.waitForFunction(()=>R.phase==='aim'&&R.rx,null,{timeout:6000});
  ok(await pg.evaluate(()=>[...segs.children].some(b=>b.classList.contains('open'))),'Lücken laufen auch ohne Erkennung');
  await pg.waitForTimeout(4600); // Versuchszeit (4 s) abgelaufen: ohne Erkennung kein automatisches „Verpasst“
  ok(await pg.evaluate(()=>R.entries.length===0&&R.phase==='aim'),'Ohne Erkennung wartet die App auf deine Eingabe, kein Automatik-Ergebnis');
  await pg.click('#bYes');await waitRep(pg,1);e=await last(pg);
  ok(e.h===true&&e.tm===undefined&&e.rt===null,'Treffer von Hand: ohne Timing, ohne Reaktionszeit ('+JSON.stringify(e)+')');
  await pg.close();

  console.log('== Auswertung ==');
  pg=await open(br,base({cfg:{d:'r3',tech:'Frei',wt:['Frei'],tS:[2],order:'mix',timing:'free',ready:'off',scoring:'exact',amt:'count',count:6,lvl:5,dyn:false}}));
  await pg.evaluate(()=>startSession(S.cfg,null));
  await pg.waitForTimeout(500);await pg.evaluate(()=>__knock());await waitRep(pg,1);
  await pg.evaluate(()=>finish());await pg.waitForTimeout(300);
  const sum=await pg.textContent('#summaryBody');
  ok(/Reaktionsschießen/.test(sum)&&/Zeitfenster getroffen/.test(sum)&&/Zu früh \/ zu spät \/ verpasst/.test(sum),'Auswertung zeigt Zeitfenster und früh/spät/verpasst');
  ok(/Schwierigkeit/.test(sum),'… und die Schwierigkeit');
  ok(!/Lernpfad/.test(sum),'Kein Lernpfad bei Reaktionsschießen');
  await pg.close();

  ok(!errs.length,'Keine Browser-Fehler'+(errs.length?': '+errs.join(' | '):''));
  await br.close();srv.close();
  console.log(fails?'\nFEHLGESCHLAGEN: '+fails:'\nALLE OK');process.exit(fails?1:0);
})();
