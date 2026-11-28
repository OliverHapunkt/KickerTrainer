/* Browsertest: Jeder zählt am eigenen Handy (v3.26).
   Vier Konten nacheinander in derselben Umgebung (wie lobby-beitritt.test.js).
   Was ein anderes Handy gleichzeitig tut, wird im selben Tab als dessen Konto
   über den Ersatz-Client aufgerufen (asOther). */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'), HERE=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  const base=p==='/fake-supabase.js'?HERE:ROOT;
  try{const b=fs.readFileSync(path.join(base,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});

const H='11111111-0000-4000-8000-000000000001', B='22222222-0000-4000-8000-000000000002',
      C='33333333-0000-4000-8000-000000000003', D='44444444-0000-4000-8000-000000000004';
let fails=0; const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m); if(!c)fails++};

(async()=>{
  await new Promise(r=>srv.listen(8132,'127.0.0.1',r));
  const br=await chromium.launch();
  const ctx=await br.newContext({viewport:{width:375,height:667}});
  await ctx.addInitScript({path:HERE+'/fake-supabase.js'});
  await ctx.addInitScript(()=>{ window.__noNet=false;
    Object.defineProperty(Navigator.prototype,'onLine',{configurable:true,get(){return !window.__noNet}}) });
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
  let cur=null;
  const asUser=async(uid)=>{
    cur=uid;
    await pg.addInitScript(([u])=>{try{
      localStorage.setItem('sb-ihbyurdtfjwhpladpmwz-auth-token', JSON.stringify({user:{id:u}}));
      localStorage.setItem('__fakeuid', u);
      localStorage.setItem('kt2_settings', JSON.stringify({onb:true, pwa:true, mode:'play'}));
    }catch(e){}}, [uid]);
    await pg.goto('http://127.0.0.1:8132/',{waitUntil:'networkidle'});
    await pg.waitForTimeout(800);
    await pg.evaluate(()=>{document.querySelectorAll('.overlay.dlg').forEach(e=>e.remove())});
    await pg.waitForTimeout(400);
  };
  const vis=id=>pg.evaluate(i=>!document.querySelector('#'+i).classList.contains('hidden'),id);
  const txt=sel=>pg.textContent(sel);
  const toasts=()=>pg.$$eval('.toast',t=>t.map(x=>x.textContent).join(' | '));
  const setNick=async(name)=>{
    await pg.waitForSelector('#pNick',{timeout:8000});
    await pg.click('#pNick'); await pg.waitForTimeout(250);
    await pg.fill('.dlg .dinput',name); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(500);
  };
  const join=async(code)=>{
    await pg.click('#pJoinBtn'); await pg.waitForTimeout(250);
    await pg.fill('.dlg .dinput',code); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(800);
  };
  // Aufruf als anderes Handy (anderes Konto), danach wieder als ich
  const asOther=(uid,fn,args)=>pg.evaluate(async([u,me,fn,args])=>{
    __fake.setUid(u); try{ const sb=await sbInit(); const r=await sb.rpc(fn,args); return r.error?r.error.message:'ok' }
    finally{ __fake.setUid(me) } },[uid,cur,fn,args]);
  const DB=f=>pg.evaluate(f);
  const pid=n=>pg.evaluate(n=>__fake.DB.players.find(p=>p.nickname===n).id, n);
  const mid=()=>DB(()=>__fake.DB.matches.slice(-1)[0].id);
  const miScore=()=>pg.$$eval('#miScore .miteam b',b=>b.map(x=>x.textContent).join(':'));
  const goals=()=>DB(()=>{const m=__fake.DB.matches.slice(-1)[0];return __fake.DB.goals.filter(g=>g.match_id===m.id)});

  console.log('== Host öffnet eine Doppel-Lobby (Erweitert, ein Satz bis 5) ==');
  await asUser(H); await setNick('Olli');
  await pg.click('#pcMode button:has-text("Doppel")'); await pg.waitForTimeout(150);
  await pg.click('#pcDetail button:has-text("Erweitert")'); await pg.waitForTimeout(150);
  await pg.fill('#pcGps input','5'); await pg.waitForTimeout(150);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  await pg.click('#pcInvite button:has-text("Per Code")'); await pg.waitForTimeout(250);
  await pg.click('#pLobby'); await pg.waitForTimeout(800);
  const code=(await txt('.codecard .code')).trim();
  ok(/^\d{6}$/.test(code),'Code '+code);
  ok(!(await pg.$('#lobDev')),'Host bekommt keine Zählweise-Auswahl (er zählt immer)');

  console.log('== Basti: eigenes Handy ==');
  await asUser(B); await setNick('Basti'); await join(code);
  ok(await vis('lobby'),'Basti in der Lobby');
  ok((await txt('#lobBody')).includes('Wie zählst du?'),'Karte „Wie zählst du?“');
  const chipsB=await pg.$$eval('#lobDev .chip',b=>b.map(x=>x.textContent));
  ok(chipsB.join('|')==='Host zählt|Eigenes Handy|Team-Handy','Drei Möglichkeiten im Doppel: '+chipsB.join(', '));
  ok((await pg.$eval('#lobDev .chip.on',b=>b.textContent))==='Host zählt','Vorgabe: Host zählt');
  await pg.click('#lobDev [data-dev="own"]'); await pg.waitForTimeout(500);
  ok((await pg.$eval('#lobDev .chip.on',b=>b.textContent))==='Eigenes Handy','Eigenes Handy gewählt');
  ok((await txt('#lobBody')).includes('nur deine eigenen Tore'),'Hinweis erklärt „nur eigene Tore“');
  ok((await txt('#lobBody')).includes('📱 zählt selbst'),'Aufstellung zeigt „zählt selbst“');

  console.log('== Chris: Team-Handy für Team 1 ==');
  await asUser(C); await setNick('Chris'); await join(code);
  await pg.click('#lobDev [data-dev="team"]'); await pg.waitForTimeout(500);
  ok((await pg.$eval('#lobDev .chip.on',b=>b.textContent))==='Team-Handy','Chris: Team-Handy');

  console.log('== Dani: Team-Handy geht nicht, eigenes Handy schon ==');
  await asUser(D); await setNick('Dani'); await join(code);
  ok(await DB(()=>{const mp=__fake.DB.match_players;const t=n=>mp.find(x=>x.player_id===__fake.DB.players.find(p=>p.nickname===n).id).team;
    return t('Olli')===1&&t('Chris')===1&&t('Basti')===2&&t('Dani')===2}),'Teams: Olli+Chris gegen Basti+Dani');
  await pg.click('#lobDev [data-dev="team"]'); await pg.waitForTimeout(500);
  ok((await toasts()).includes('Basti zählt schon selbst'),'Team-Handy abgewiesen: Basti zählt schon selbst');
  ok((await pg.$eval('#lobDev .chip.on',b=>b.textContent))==='Host zählt','Dani bleibt bei „Host zählt“');
  await pg.click('#lobDev [data-dev="own"]'); await pg.waitForTimeout(500);
  ok((await pg.$eval('#lobDev .chip.on',b=>b.textContent))==='Eigenes Handy','Dani: eigenes Handy');

  console.log('== Host startet ==');
  await asUser(H); await pg.click('#pResume'); await pg.waitForTimeout(800);
  ok((await txt('#lobBody')).includes('📱 Team-Handy'),'Host sieht, wer wie zählt');
  await pg.click('#lobStart'); await pg.waitForTimeout(900);
  ok(await vis('match'),'Host im Zählbildschirm');
  const tiles=await pg.$$eval('#mArea .ptile',t=>t.map(x=>x.textContent));
  ok(tiles.some(t=>t.includes('Basti')&&t.includes('zählt selbst'))&&tiles.some(t=>t.includes('Chris')&&t.includes('Team-Handy')),
     'Kacheln markieren Selbstzähler: '+JSON.stringify(tiles));

  console.log('== Basti am eigenen Handy ==');
  await asUser(B);
  await pg.click('#pResume'); await pg.waitForTimeout(1000);
  ok(await vis('mine'),'Basti landet direkt in der Zählansicht');
  ok((await miScore())==='0:0','Stand 0:0');
  ok((await pg.$eval('#miScore .miteam.me span',e=>e.textContent))==='Ihr','Eigenes Team links, beschriftet „Ihr“');
  ok((await pg.$eval('#miScore .miteam.me small',e=>e.textContent)).includes('Basti'),'… mit den eigenen Namen');
  const fs=await pg.$eval('#miScore .miteam b',e=>parseFloat(getComputedStyle(e).fontSize));
  ok(fs>=96,'Ziffern groß (≥ 96 px): '+fs);
  const gb=await pg.$$eval('.migoal',b=>b.map(x=>x.textContent));
  ok(gb.length===1&&gb[0].includes('TOR')&&gb[0].includes('von mir')&&gb[0].includes('Sturm'),'Ein Knopf „TOR von mir · Sturm“');
  const sb1=await pg.$eval('#miScore',e=>e.getBoundingClientRect().bottom), bb1=await pg.$eval('.migoal',e=>e.getBoundingClientRect().top);
  ok(sb1<=bb1,'Hochformat: Stand oben, Knopf darunter');
  await pg.click('.migoal'); await pg.click('.migoal',{force:true}); await pg.waitForTimeout(1300);
  ok((await goals()).length===1,'Doppeltipp zählt nur einmal');
  const g1=(await goals())[0];
  ok(g1.team===2&&g1.scorer_id===await pid('Basti')&&g1.scorer_position==='off'&&g1.by_player===await pid('Basti'),'Tor: Team 2, Schütze Basti, Sturm, eingetragen von Basti');
  ok((await miScore())==='1:0','Anzeige 1:0 (eigenes Team zuerst)');
  await pg.click('.migoal'); await pg.waitForTimeout(1200);
  ok((await miScore())==='2:0','Zweites Tor: 2:0');
  await pg.screenshot({path:path.join(require('os').tmpdir(),'eigenes-handy-hoch.png')});
  await pg.click('#miUndo'); await pg.waitForTimeout(1200);
  ok((await miScore())==='1:0','Rückgängig: 1:0');

  console.log('== Querformat ==');
  await pg.setViewportSize({width:667,height:375}); await pg.waitForTimeout(300);
  const sL=await pg.$eval('#miScore',e=>e.getBoundingClientRect()), bL=await pg.$eval('.migoal',e=>e.getBoundingClientRect());
  ok(sL.right<=bL.left+1,'Querformat: Stand links, Knopf rechts');
  ok(bL.height>=120,'Knopf im Querformat groß genug: '+Math.round(bL.height)+' px');
  const fsL=await pg.$eval('#miScore .miteam b',e=>parseFloat(getComputedStyle(e).fontSize));
  ok(fsL>=80,'Ziffern auch quer groß: '+fsL);
  await pg.screenshot({path:path.join(require('os').tmpdir(),'eigenes-handy-quer.png')});
  const over=await pg.evaluate(()=>[...document.querySelectorAll('#mine > *')].some(e=>e.getBoundingClientRect().bottom>innerHeight+1));
  ok(!over,'Nichts ragt unten heraus');
  await pg.setViewportSize({width:375,height:667}); await pg.waitForTimeout(300);

  console.log('== Position: „Ich gehe hinten“ ==');
  ok((await txt('#miSwap')).includes('Ich gehe hinten'),'Knopf „Ich gehe hinten“');
  await pg.click('#miSwap'); await pg.waitForTimeout(1200);
  ok(await DB(()=>{const mp=__fake.DB.match_players;const p=n=>mp.find(x=>x.player_id===__fake.DB.players.find(y=>y.nickname===n).id).position;
    return p('Basti')==='def'&&p('Dani')==='off'}),'Basti jetzt Abwehr, Dani Sturm');
  ok((await txt('#miSwap')).includes('Ich gehe vorne'),'Knopf heißt jetzt „Ich gehe vorne“');
  ok((await txt('.migoal')).includes('Abwehr'),'Tor-Knopf zeigt „Abwehr“');

  console.log('== Eigentor des Gegners ==');
  await pg.click('#miOwn'); await pg.waitForTimeout(300);
  const opp=await pg.$$eval('.dlg .pickrow',b=>b.map(x=>x.textContent));
  ok(opp.join('|')==='Olli|Chris','Auswahl nur Gegner: '+opp.join(', '));
  await pg.click('.dlg .pickrow:has-text("Olli")'); await pg.waitForTimeout(1200);
  ok((await miScore())==='2:0','Eigentor zählt für uns: 2:0');
  ok((await goals()).slice(-1)[0].own_goal===true&&(await goals()).slice(-1)[0].scorer_id===await pid('Olli'),'Gespeichert als Eigentor von Olli');

  console.log('== Andere Handys zählen mit ==');
  const m=await mid();
  ok((await asOther(C,'record_goal',{p_match:m,p_team:1,p_scorer:await pid('Olli'),p_position:null,p_own:false}))==='ok','Chris (Team-Handy) trägt Tor von Olli ein');
  ok((await asOther(C,'record_goal',{p_match:m,p_team:2,p_scorer:null,p_position:null,p_own:false})).includes('nur Tore für dein Team'),'Chris kann kein Tor für den Gegner eintragen');
  ok((await asOther(D,'record_goal',{p_match:m,p_team:2,p_scorer:await pid('Basti'),p_position:null,p_own:false})).includes('nur deine eigenen'),'Dani kann kein Tor für Basti eintragen');
  await pg.waitForTimeout(3000);
  ok((await miScore())==='2:1','Bastis Anzeige holt das Tor von selbst: 2:1');
  await pg.click('#miUndo'); await pg.waitForTimeout(1300);
  ok((await toasts()).includes('jemand anderes eingetragen'),'Fremdes Tor zurücknehmen abgewiesen, mit Begründung');
  ok((await miScore())==='2:1','Stand bleibt 2:1');

  console.log('== Ohne Netz ==');
  await pg.evaluate(()=>{window.__noNet=true; __fake.offline=true; window.dispatchEvent(new Event('offline'))}); await pg.waitForTimeout(300);
  ok(await pg.$eval('.migoal',b=>b.disabled),'Tor-Knopf gesperrt');
  ok((await txt('#miSync')).includes('Verbindung weg'),'Hinweis „Verbindung weg“');
  await pg.screenshot({path:path.join(require('os').tmpdir(),'eigenes-handy-offline.png')});
  ok((await miScore())==='2:1','Stand bleibt sichtbar');
  await pg.evaluate(()=>{window.__noNet=false; __fake.offline=false; window.dispatchEvent(new Event('online'))}); await pg.waitForTimeout(300);
  ok(!(await pg.$eval('.migoal',b=>b.disabled)),'Mit Netz wieder frei');

  console.log('== Host sieht die Tore der anderen ==');
  await asUser(H); await pg.click('#pResume'); await pg.waitForTimeout(900);
  ok(await vis('match'),'Host zurück im Zählen');
  const hs=async()=>(await txt('#mScore')).replace(/\s/g,'');
  ok((await hs())==='1:2','Host-Stand 1:2 (Team 1 links)');
  ok((await asOther(B,'record_goal',{p_match:m,p_team:2,p_scorer:null,p_position:null,p_own:false}))==='ok','Basti zählt währenddessen');
  await pg.waitForTimeout(3600);
  ok((await hs())==='1:3','Host-Anzeige aktualisiert sich von selbst: 1:3');
  const tl=await pg.$$eval('#mArea .ptile',t=>t.map(x=>x.textContent));
  ok(tl.findIndex(t=>t.includes('Dani'))<tl.findIndex(t=>t.includes('Basti')),'Bastis Positionstausch beim Host angekommen (Dani jetzt oben im Sturm)');

  console.log('== Spielende: Basti kommt zur Bestätigung ==');
  await asOther(B,'record_goal',{p_match:m,p_team:2,p_scorer:null,p_position:null,p_own:false});
  await asOther(D,'record_goal',{p_match:m,p_team:2,p_scorer:null,p_position:null,p_own:false});
  await pg.waitForTimeout(3600);
  ok(await vis('msummary'),'Host bekommt die Auswertung, als die anderen das letzte Tor zählen');
  ok(await DB(()=>__fake.DB.matches.slice(-1)[0].state==='finished'),'Spiel wartet auf Bestätigung (Gegenseite hat Konten)');
  ok((await asOther(B,'undo_goal',{p_match:m})).includes('nur der Host'),'Nach Spielende korrigiert nur der Host');
  await asUser(B); await pg.waitForTimeout(300);
  await pg.evaluate(id=>pOpenLobby(id), m); await pg.waitForTimeout(900);
  ok(await vis('lobby')&&(await txt('#lobBody')).includes('Stimmt das Ergebnis?'),'Basti sieht die Bestätigung, keine Zählansicht mehr');

  ok(errs.length===0,'Keine Fehler in der Konsole'+(errs.length?': '+errs.join(' / '):''));
  await br.close(); srv.close();
  console.log(fails?('\n'+fails+' FEHLER'):'\nALLE GRÜN'); process.exit(fails?1:0);
})();
