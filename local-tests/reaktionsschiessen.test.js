/* Browsertest: Reaktionsschießen (Lücken und Signal) über die ganze Kette (Fake-Mikrofon + künstliche Knalle, wie kalibrierung.test.js).
   Geprüft: Konfiguration, Hilfe-Dialog, Anzeige (ein Grün, Ziel-Rahmen, Ablenkfarben), Schuss bei grün / grau, mit und ohne Ansage,
   Signal mit Piep und Aufleuchten, zu früh / zu langsam / verpasst, Dynamisch, Individuell, ohne Schusserkennung, Auswertung.
   Misst NICHT, wie ein echter Tisch klingt. */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  try{const b=fs.readFileSync(path.join(ROOT,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};
const errs=[];
const CFG=o=>Object.assign({d:'r3',tech:'Frei',wt:['Frei'],tS:[2],order:'mix',timing:'free',ready:'off',scoring:'exact',amt:'count',count:8,lvl:5,dyn:false,rxd:'fix',rxa:true},o||{});
const base=(extra,cfg)=>JSON.stringify(Object.assign({onb:true,mode:'train',lvl:'pro',voiceOut:false,mic:true,det:'audio',rxHelp:{gap:true,sig:true},
  cal:{a:.05,m:null,at:Date.now(),qa:9,qm:0},cfg:CFG(cfg)},extra||{}));
async function open(br,settings,mic=true,data){
  const ctx=await br.newContext({viewport:{width:390,height:844},permissions:['microphone']});const pg=await ctx.newPage();
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message+' '+(e.stack||'').split('\n').slice(1,3).join('|')));
  pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
  await pg.addInitScript(([s,d])=>{if(!localStorage.getItem('kt2_settings')){localStorage.setItem('kt2_settings',s);if(d)localStorage.setItem('kt2_data',d)}},[settings,data||null]);
  await pg.goto('http://127.0.0.1:8128/',{waitUntil:'networkidle'});await pg.waitForTimeout(500);
  await pg.evaluate(()=>{DISC.r3.rule=12;DISC.r3s.rule=12});
  if(mic)await pg.evaluate(async()=>{
    await detStart();window.__sy={knocks:[]};const SR=48000;
    mic.an.getFloatTimeDomainData=function(buf){const now=performance.now(),n=buf.length,ks=__sy.knocks.filter(k=>now-k.t<400);__sy.knocks=ks;
      for(let i=0;i<n;i++){const t=now-(n-1-i)/SR*1000;let v=(Math.random()*2-1)*.0052;for(const k of ks)if(t>=k.t)v+=(Math.random()*2-1)*k.p*Math.exp(-(t-k.t)/12);buf[i]=v}};
    window.__knock=()=>__sy.knocks.push({t:performance.now(),p:.4});
  });
  return pg;
}
const waitRep=(pg,n)=>pg.waitForFunction(k=>R&&R.entries.length>=k,n,{timeout:25000});
const last=pg=>pg.evaluate(()=>{const e=R.entries[R.entries.length-1];return e?{tm:e.tm,h:e.h,rt:e.rt,l:e.l,lv:e.lv,w:e.w,na:e.na,auto:e.auto,g:e.g}:null});
const segState=pg=>pg.evaluate(()=>[...segs.children].map(b=>({rx:b.classList.contains('rx'),open:b.classList.contains('open'),tgt:b.classList.contains('tgt'),d:[1,2,3].find(k=>b.classList.contains('d'+k))||0})));
const nextAim=(pg,n)=>pg.waitForFunction(k=>R.phase==='aim'&&R.entries.length===k&&(R.rx||R.sg),n,{timeout:10000});

(async()=>{
  await new Promise(r=>srv.listen(8128,'127.0.0.1',r));
  const br=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});

  console.log('== Konfiguration ==');
  let pg=await open(br,base({cfgOpen:true}));
  const discs=await pg.$$eval('#cDisc .chip',e=>e.map(x=>x.textContent));
  ok(discs.filter(t=>t==='Reaktionsschießen').length===1&&!discs.some(t=>/Signal|Lücken/.test(t)),'Ein Chip „Reaktionsschießen“ in der Disziplin-Auswahl');
  ok(JSON.stringify(await pg.$$eval('#cRxm .chip',e=>e.map(x=>x.textContent)))===JSON.stringify(['Lücken','Signal']),'Darunter: Lücken | Signal');
  ok(JSON.stringify(await pg.$$eval('#cRxa .chip',e=>e.map(x=>x.textContent)))===JSON.stringify(['Mit Ansage','Ohne Ansage'])&&/Mit Ansage/.test(await pg.textContent('#cRxa .chip.on')),'Mit Ansage | Ohne Ansage, Standard: mit Ansage');
  ok(JSON.stringify(await pg.$$eval('#cDyn .chip',e=>e.map(x=>x.textContent)))===JSON.stringify(['Fest','Dynamisch','Individuell']),'Fest | Dynamisch | Individuell');
  ok(await pg.isHidden('#wTiming')&&await pg.isHidden('#wPr')&&await pg.isHidden('#wWindow'),'Timing, Reaktionsfenster, Druckmodus ausgeblendet');
  await pg.fill('#sLvl input','8');await pg.waitForTimeout(150);
  ok(/Ablenkfarben/.test(await pg.textContent('#hLvl')),'Stufe 8: Hinweis nennt Ablenkfarben');
  await pg.click('#cRxa .chip:has-text("Ohne Ansage")');
  ok(await pg.isHidden('#wTS')&&/ohne Ansage/.test(await pg.textContent('#cfgSum')),'Ohne Ansage: keine Zielwahl, Zusammenfassung „ohne Ansage“');
  await pg.click('#cRxm .chip:has-text("Signal")');
  ok((await pg.evaluate(()=>S.cfg.d))==='r3s'&&await pg.isHidden('#cRxa')&&await pg.isVisible('#wTS'),'Signal: Disziplin r3s, keine Ansage-Wahl, Zielwahl wieder da');
  ok(/Reaktionsfenster 0,6 s/.test(await pg.textContent('#hLvl')),'Signal Stufe 8: Fenster 0,6 s');
  ok(/Reaktionsschießen/.test(await pg.textContent('#cDisc .chip.on')),'Der Disziplin-Chip bleibt markiert');
  await pg.click('#cDyn .chip:has-text("Individuell")');
  ok(await pg.isHidden('#sLvl')&&/zu wenig eigene Reaktionszeiten/.test(await pg.textContent('#hLvl')),'Individuell: kein Regler, Hinweis „noch zu wenig Daten“');
  await pg.click('#cDyn .chip:has-text("Dynamisch")');
  ok(/Startstufe/.test(await pg.textContent('#lLvl'))&&/dynamisch ab Stufe 8/.test(await pg.textContent('#cfgSum')),'Dynamisch: „Startstufe“');
  await pg.close();

  console.log('== Hilfe beim Start ==');
  pg=await open(br,base({rxHelp:{}}));
  await pg.evaluate(()=>{startSession(S.cfg,null)});await pg.waitForTimeout(300);
  ok(await pg.isVisible('.dlg')&&/eine grüne Lücke/i.test(await pg.textContent('.dlg'))&&/Rhythmen/.test(await pg.textContent('.dlg')),'Dialog erklärt das Spiel vor dem Start');
  ok(await pg.evaluate(()=>!R),'Training startet erst nach „Los“');
  await pg.check('#rxHelpOff');await pg.click('.dlg button:has-text("Los")');await pg.waitForTimeout(300);
  ok(await pg.evaluate(()=>R&&R.active&&S.rxHelp&&S.rxHelp.gap===true),'„Nicht mehr anzeigen“ + Los: Training läuft, Hilfe abgeschaltet');
  await pg.evaluate(()=>{finish()});await pg.evaluate(()=>{$('#summary').classList.add('hidden');R=null;startSession(S.cfg,null)});await pg.waitForTimeout(300);
  ok(await pg.evaluate(()=>!document.querySelector('.dlg')&&R&&R.active),'Beim nächsten Start kein Dialog mehr');
  await pg.evaluate(()=>{finish();$('#summary').classList.add('hidden');R=null;show('home')});
  await pg.click('[data-tip-k="react"]').catch(()=>{});
  await pg.evaluate(()=>{S.cfgOpen=true;renderHome()});await pg.click('#wReact [data-tip-k="react"]');await pg.waitForTimeout(200);
  ok(/eine grüne Lücke/i.test(await pg.textContent('.dlg')),'Hilfe bleibt über das ⓘ in der Konfiguration erreichbar');
  await pg.close();

  console.log('== Lücken mit Ansage ==');
  pg=await open(br,base());
  await pg.evaluate(()=>startSession(S.cfg,null));
  await pg.waitForFunction(()=>R&&R.phase==='aim',null,{timeout:4000});
  let st=await segState(pg);
  ok(st.every(s=>s.rx)&&st.map(s=>s.tgt).join()==='false,true,false,false,false'&&st.every(s=>!s.open),'Ansage: alles grau, Ziel 2 mit Rahmen');
  ok(await pg.evaluate(()=>getComputedStyle(segs.children[1]).outlineColor.replace(/\s/g,'')==='rgb(255,176,32)'),'Ziel-Rahmen in Bernstein (nicht grün)');
  await pg.waitForTimeout(300);await pg.evaluate(()=>__knock());await waitRep(pg,1);let e=await last(pg);
  ok(e.tm==='early'&&e.h===false&&e.rt===null,'Schuss in der Einleitung: zu früh');
  await nextAim(pg,1);
  // ein Grün zur Zeit, über ~3 s beobachtet
  let maxG=0;for(let i=0;i<30;i++){st=await segState(pg);maxG=Math.max(maxG,st.filter(s=>s.open).length);await pg.waitForTimeout(100)}
  ok(maxG===1,'Nie mehr als ein Segment grün (3 s beobachtet)');
  ok(st.every(s=>!s.d),'Stufe 5: keine Ablenkfarben');
  await pg.waitForFunction(()=>rxTargetOpen()&&performance.now()-R.rx.open[R.target]>150,null,{timeout:15000,polling:'raf'});
  ok(/JETZT/.test(await pg.textContent('#tStatus'))&&await pg.evaluate(()=>getComputedStyle(segs.children[R.target-1]).animationName==='rxPulse'),'Ziel grün: „JETZT“, Segment pulsiert');
  await pg.evaluate(()=>__knock());await waitRep(pg,2);e=await last(pg);
  ok(e.tm==='ok'&&e.h===true&&e.l===2&&e.rt>=150,'Schuss bei grünem Ziel: ok, Segment 2, '+e.rt+' ms');
  ok(/Im Fenster/.test(await pg.textContent('#tStatus')),'Korrekturfenster „Im Fenster“');
  await pg.evaluate(()=>input('hit'));
  await nextAim(pg,2);
  await pg.waitForFunction(()=>R.rx&&R.rx.closedAt[R.target]>R.rx.t0&&!rxTargetOpen()&&performance.now()-R.rx.closedAt[R.target]>330&&performance.now()-R.rx.closedAt[R.target]<420,null,{timeout:20000,polling:'raf'});
  await pg.evaluate(()=>__knock());await waitRep(pg,3);e=await last(pg);
  ok(e.tm==='late'&&e.h===false,'Kurz nach dem Schließen: zu spät');
  ok(/Zu spät/.test(await pg.textContent('#tStatus')),'Status „Zu spät“');
  await nextAim(pg,3);
  await waitRep(pg,4);e=await last(pg);
  ok(e.tm==='none','Kein Schuss: verpasst');
  await pg.close();

  console.log('== Lücken ohne Ansage, Ablenkfarben ==');
  pg=await open(br,base({},{rxa:false,lvl:8,tS:[1,2,3,4,5]}));
  await pg.evaluate(()=>startSession(S.cfg,null));
  await nextAim(pg,0).catch(()=>{});
  await pg.waitForFunction(()=>R.phase==='aim'&&R.rx,null,{timeout:6000});
  ok(await pg.evaluate(()=>R.target===0),'Ohne Ansage: kein Ziel');
  let sawDeco=0,decoOnGreen=0,maxG2=0;
  for(let i=0;i<40;i++){const s=await segState(pg);if(s.some(x=>x.d))sawDeco++;if(s.some(x=>x.d&&x.open))decoOnGreen++;maxG2=Math.max(maxG2,s.filter(x=>x.open).length);if(s.some(x=>x.tgt))decoOnGreen+=100;await pg.waitForTimeout(80)}
  ok(sawDeco>3&&decoOnGreen===0&&maxG2===1,'Stufe 8: Ablenkfarben sichtbar, nie auf dem Grünen, nie Zielrahmen, ein Grün');
  await pg.waitForFunction(()=>rxTargetOpen()&&performance.now()-R.rx.open[rxGreen(R.rx)]>120,null,{timeout:8000,polling:'raf'});
  const gs=await pg.evaluate(()=>rxGreen(R.rx));
  await pg.evaluate(()=>__knock());await waitRep(pg,1);e=await last(pg);
  ok(e.tm==='ok'&&e.g===gs&&e.l===gs&&e.na===true,'Schuss aufs Grüne (Segment '+gs+'): ok, Ziel = dieses Segment');
  await pg.close();

  console.log('== Signal ==');
  pg=await open(br,base({},{d:'r3s',lvl:5}));
  await pg.evaluate(()=>startSession(S.cfg,null));
  await pg.waitForFunction(()=>R.phase==='aim'&&R.sg,null,{timeout:4000});
  ok(/auf Piep warten/.test(await pg.textContent('#tStatus'))&&(await segState(pg)).filter(s=>s.open).length===0,'Vor dem Piep: Ziel markiert, nichts grün, „auf Piep warten“');
  await pg.waitForTimeout(300);await pg.evaluate(()=>__knock());await waitRep(pg,1);e=await last(pg);
  ok(e.tm==='early'&&e.h===false,'Schuss vor dem Piep: zu früh');
  ok(/vor dem Piep/.test(await pg.textContent('#tStatus')),'Status „Zu früh · vor dem Piep“');
  await nextAim(pg,1);
  await pg.waitForFunction(()=>R.sg&&R.sg.fired,null,{timeout:8000,polling:'raf'});
  const fl=await pg.evaluate(()=>({flash:document.querySelector('#flash').classList.contains('on'),open:segs.children[R.target-1].classList.contains('open'),W:R.sg.W}));
  ok(fl.flash&&fl.open,'Piep: Bildschirm blitzt auf, Ziel wird grün');
  ok(fl.W===1011,'Stufe 5: Fenster '+fl.W+' ms');
  await pg.waitForTimeout(250);await pg.evaluate(()=>__knock());await waitRep(pg,2);e=await last(pg);
  ok(e.tm==='ok'&&e.rt>=200&&e.rt<500&&e.w===1011,'Schuss 0,25 s nach dem Piep: ok, Reaktionszeit '+e.rt+' ms (nicht vom eigenen Piep verschluckt)');
  await pg.evaluate(()=>input('hit'));
  await nextAim(pg,2);
  await pg.waitForFunction(()=>R.sg&&R.sg.fired&&performance.now()-R.sg.tb>R.sg.W+100,null,{timeout:10000,polling:'raf'});
  await pg.evaluate(()=>__knock());await waitRep(pg,3);e=await last(pg);
  ok(e.tm==='late'&&e.h===false&&e.rt>1011,'Nach dem Fenster: zu langsam, Zeit '+e.rt+' ms wird gemerkt');
  ok(/Zu langsam/.test(await pg.textContent('#tStatus')),'Status „Zu langsam“');
  await nextAim(pg,3);await waitRep(pg,4);e=await last(pg);
  ok(e.tm==='none','Kein Schuss: verpasst');
  await pg.evaluate(()=>finish());await pg.waitForTimeout(300);
  ok(/Reaktion · Signal/.test(await pg.textContent('#summaryBody'))&&/Reaktionsfenster Ø/.test(await pg.textContent('#summaryBody')),'Auswertung: „Reaktion · Signal“, Reaktionsfenster');
  await pg.close();

  console.log('== Signal ohne Schusserkennung ==');
  pg=await open(br,base({mic:false},{d:'r3s'}),false);
  await pg.evaluate(()=>{startSession(S.cfg,null)});await pg.waitForTimeout(300);
  ok(/Schusserkennung nötig/.test(await pg.textContent('.dlg'))&&await pg.evaluate(()=>!R),'Startet nicht, Dialog „Schusserkennung nötig“');
  await pg.click('.dlg button:has-text("Einrichten")');await pg.waitForTimeout(200);
  ok(await pg.isVisible('#test'),'„Einrichten“ führt zur Kalibrierung');
  await pg.close();

  console.log('== Individuell ==');
  const now=Date.now(),hist={v:2,sessions:[{id:'h1',start:now-9e5,d:'r3s',cfg:{},end:now-8e5}],shots:[480,500,520,510,490,505].map((rt,i)=>({s:'h1',t:now-9e5+i*1000,d:'r3s',st:'shot',k:'Frei',g:2,l:2,h:true,rt,tm:'ok',end:true}))};
  pg=await open(br,base({cfgOpen:true},{d:'r3s',rxd:'ind'}),true,JSON.stringify(hist));
  ok(/letzten 6 Reaktionszeiten/.test(await pg.textContent('#hLvl'))&&/Fenster 0,5 s/.test(await pg.textContent('#hLvl')),'Hinweis: aus deinen letzten 6 Zeiten, Fenster 0,5 s');
  await pg.evaluate(()=>startSession(S.cfg,null));
  await pg.waitForFunction(()=>R.phase==='aim'&&R.sg,null,{timeout:4000});
  ok((await pg.evaluate(()=>R.sg.W))===503,'Fenster folgt deiner Reaktionszeit (Mitte 503 ms)');
  await pg.waitForFunction(()=>R.sg&&R.sg.fired,null,{timeout:8000,polling:'raf'});
  await pg.waitForTimeout(150);await pg.evaluate(()=>__knock());await waitRep(pg,1);
  await pg.evaluate(()=>input('hit'));await nextAim(pg,1);
  const W2=await pg.evaluate(()=>R.sg.W);ok(W2<503,'Schneller Schuss → Fenster wird enger ('+W2+' ms)');
  await pg.close();

  console.log('== Dynamisch ==');
  pg=await open(br,base({},{rxd:'dyn',lvl:5}));
  await pg.evaluate(()=>startSession(S.cfg,null));
  await pg.waitForFunction(()=>R.phase==='aim',null,{timeout:4000});await pg.waitForTimeout(300);await pg.evaluate(()=>__knock());
  await nextAim(pg,1);
  ok((await pg.evaluate(()=>R.lvl))===4&&(await last(pg)).lv===5,'Fehlschuss: Stufe 5 → 4, Eintrag merkt sich 5');
  await pg.evaluate(()=>undo());await pg.waitForTimeout(100);
  ok((await pg.evaluate(()=>R.lvl))===5,'Rückgängig stellt Stufe 5 wieder her');
  await pg.close();

  console.log('== Lücken ohne Schusserkennung ==');
  pg=await open(br,base({mic:false},{scoring:'simple',count:3}),false);
  await pg.evaluate(()=>startSession(S.cfg,null));
  await pg.waitForFunction(()=>R.phase==='aim'&&R.rx,null,{timeout:6000});
  ok(await pg.evaluate(()=>[...segs.children].some(b=>b.classList.contains('open'))),'Lücken laufen auch ohne Erkennung');
  await pg.click('#bYes');await waitRep(pg,1);e=await last(pg);
  ok(e.h===true&&e.tm===undefined&&e.rt===null,'Treffer von Hand, ohne Timing');
  await pg.close();

  ok(!errs.length,'Keine Browser-Fehler'+(errs.length?': '+errs.join(' | '):''));
  await br.close();srv.close();
  console.log(fails?'\nFEHLGESCHLAGEN: '+fails:'\nALLE OK');process.exit(fails?1:0);
})();
