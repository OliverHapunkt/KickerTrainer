/* Browsertest: Simple-/Profi-Modus der Übungskachel (v3.14).
   Geprüft: frische Installation = Simple mit schlichten Voreinstellungen; bestehende Nutzer bleiben bei Profi und
   ihren Hilfen; im Simple-Modus nur Schuss 3er / Pass 5er, Technik, 10/20/50; die fest eingestellte Übung stimmt;
   die Kachel lässt sich über die ganze Kopfzeile aufklappen. */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  try{const b=fs.readFileSync(path.join(ROOT,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};
const txt=(pg,sel)=>pg.$$eval(sel,els=>els.map(e=>e.textContent.trim()));
const vis=(pg,sel)=>pg.$eval(sel,e=>!e.classList.contains('hidden')&&e.offsetParent!==null);

(async()=>{
  await new Promise(r=>srv.listen(8127,'127.0.0.1',r));
  const br=await chromium.launch();
  const errs=[];
  const mk=async(init)=>{const ctx=await br.newContext({viewport:{width:390,height:844}});const pg=await ctx.newPage();
    pg.on('pageerror',e=>errs.push('pageerror: '+e.message+' '+(e.stack||'').split('\n').slice(1,3).join('|')));pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
    if(init)await pg.addInitScript(init);
    await pg.goto('http://127.0.0.1:8127/',{waitUntil:'networkidle'});await pg.waitForTimeout(600);return pg};

  console.log('== Frische Installation ==');
  let pg=await mk(null);
  await pg.evaluate(()=>{S.onb=true;saveS();document.querySelectorAll('.overlay:not(.hidden):not(#summary)').forEach(e=>e.remove())});
  let st=await pg.evaluate(()=>({lvl:S.lvl,lp:S.lp,std:S.stdOn,auto:S.autoCount,mic:S.mic,gam:S.gam,voice:S.voiceOut,tech:DEFCFG.tech}));
  ok(st.lvl==='simple','Startet im Simple-Modus');
  ok(st.lp===false&&st.std===false&&st.auto===false,'Trainings-Tipps, Standardtest, Auto-Treffer sind aus');
  ok(st.gam.on&&st.gam.xp&&st.gam.ch===false,'Gamification an, Challenges aus');
  ok(st.mic===false&&st.voice===true,'Schusserkennung aus, Ansage an');
  ok(st.tech==='Snake','Standardtechnik ist Snake');
  ok(await vis(pg,'#cLvl'),'Modus-Schalter sichtbar');
  ok(!(await vis(pg,'#simpleWrap')),'Auswahl ist zugeklappt');
  ok(!(await vis(pg,'#btnAddPlan')),'Kein „+ Station“ im Simple-Modus');
  ok(!(await vis(pg,'#presetCard'))&&!(await vis(pg,'#planCard')),'Keine „Meine Übungen“ / kein Ablauf im Simple-Modus');
  let sum=(await txt(pg,'#cfgSum'))[0];
  ok(/Schuss 3er · Snake/.test(sum)&&/20 Versuche/.test(sum),'Zusammenfassung: '+sum.replace(/\s+/g,' '));
  // Aufklappen über die ganze Kopfzeile
  await pg.click('.qhead h2');
  ok(await vis(pg,'#simpleWrap'),'Antippen der Überschrift klappt die Auswahl auf');
  ok(!(await vis(pg,'#cfgWrap')),'Die Profi-Auswahl bleibt zu');
  ok((await txt(pg,'#btnCfg'))[0].includes('Fertig'),'Knopf zeigt „Fertig“');
  ok(JSON.stringify(await txt(pg,'#sDisc .chip'))===JSON.stringify(['Schuss 3er','Pass 5er']),'Nur Schuss 3er und Pass 5er');
  ok(JSON.stringify(await txt(pg,'#sAmt .chip'))===JSON.stringify(['10×','20×','50×']),'Nur 10 / 20 / 50');
  ok((await txt(pg,'#sTech .chip')).join()==='Pull,Push,Snake,Tic-Tac,Frei','Alle Schuss-Techniken wählbar');
  await pg.click('#sTech .chip:has-text("Push")');await pg.click('#sAmt .chip:has-text("50")');
  let cfg=await pg.evaluate(()=>simpleCfg());
  ok(cfg.d==='s3'&&cfg.tech==='Push'&&cfg.count===50,'Wahl übernommen (Push, 50×)');
  ok(cfg.order==='mix'&&cfg.timing==='free'&&cfg.ready==='auto'&&cfg.auto===3&&cfg.scoring==='simple'&&!cfg.pr&&cfg.amt==='count',
    'Fest: gemischt, freies Tempo, Auto 3 s, Wertung einfach, kein Druckmodus');
  ok(cfg.tS.join()==='1,2,3,4,5'&&cfg.tP.join()==='wall,lane','Fest: alle Ziele');
  await pg.click('#sDisc .chip:has-text("Pass 5er")');
  cfg=await pg.evaluate(()=>simpleCfg());
  ok(cfg.d==='p53'&&['Brush','Stick','Kick','Bande','Frei'].includes(cfg.tech),'Pass 5er: gültige Pass-Technik ('+cfg.tech+')');
  ok((await txt(pg,'#sTech .chip')).join()==='Brush,Stick,Kick,Bande,Frei','Pass-Techniken wählbar');
  // Start im Simple-Modus nutzt die feste Übung
  await pg.click('#btnStart');await pg.waitForTimeout(400);
  const run=await pg.evaluate(()=>R&&R.cfg?{d:R.cfg.d,t:R.cfg.tech,n:R.cfg.count,sc:R.cfg.scoring,ready:R.cfg.ready,auto:R.cfg.auto}:null);
  ok(run&&run.d==='p53'&&run.n===50&&run.sc==='simple'&&run.ready==='auto'&&run.auto===3,'Training startet mit der Simple-Übung '+JSON.stringify(run));
  await pg.close();

  console.log('== Wechsel auf Profi ==');
  pg=await mk(()=>{if(!localStorage.getItem('kt2_settings'))localStorage.setItem('kt2_settings',JSON.stringify({onb:true,mode:'train',cfg:{d:'s2',tech:'Gerade'}}))});
  st=await pg.evaluate(()=>({lvl:S.lvl,lp:S.lp,std:S.stdOn,auto:S.autoCount,ch:S.gam.ch,d:S.cfg.d,t:S.cfg.tech}));
  ok(st.lvl==='pro','Bestehende Nutzer bleiben im Profi-Modus');
  ok(st.lp&&st.std&&st.auto&&st.ch,'… mit Tipps, Standardtest, Auto-Treffer und Challenges wie bisher');
  ok(st.d==='s2'&&st.t==='Gerade','… und ihrer gespeicherten Übung');
  ok(await vis(pg,'#btnAddPlan'),'Profi hat „+ Station“');
  await pg.click('.qhead h2');
  ok(await vis(pg,'#cfgWrap')&&!(await vis(pg,'#simpleWrap')),'Profi klappt die volle Auswahl auf');
  await pg.click('#cLvl .chip:has-text("Simple")');
  ok((await pg.evaluate(()=>S.lvl))==='simple','Umschalten auf Simple');
  await pg.click('#cLvl .chip:has-text("Profi")');
  ok((await pg.evaluate(()=>S.cfg.d+S.cfg.tech))==='s2Gerade','Zurück auf Profi: alte Konfiguration unverändert');
  await pg.close();

  ok(!errs.length,'Keine Browser-Fehler'+(errs.length?': '+errs.join(' | '):''));
  await br.close();srv.close();
  console.log(fails?'\nFEHLGESCHLAGEN: '+fails:'\nALLE OK');process.exit(fails?1:0);
})();
