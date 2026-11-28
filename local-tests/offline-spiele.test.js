/* Offline-Spiele (v3.25): ohne Netz mehrere Spiele anlegen, zählen, später hochladen.
   Dazu der behobene Fehler: Tipps anderer Spiele gehen beim Öffnen nicht mehr verloren.
   „Kein Netz“ = navigator.onLine false UND der Ersatz-Client antwortet mit „Failed to fetch“. */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'), HERE=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  const base=p==='/fake-supabase.js'?HERE:ROOT;
  try{const b=fs.readFileSync(path.join(base,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});
let fails=0; const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m); if(!c)fails++};
(async()=>{
  await new Promise(r=>srv.listen(8131,'127.0.0.1',r));
  const br=await chromium.launch();
  const ctx=await br.newContext({viewport:{width:375,height:667}});
  await ctx.addInitScript({path:HERE+'/fake-supabase.js'});
  await ctx.addInitScript(()=>{
    // Netzzustand übersteht einen Neustart der Seite (wie bei einem echten Funkloch)
    window.__noNet = sessionStorage.getItem('__noNet') === '1';
    if(window.__noNet) setTimeout(()=>{ if(window.__fake) __fake.offline = true }, 0);
    Object.defineProperty(Navigator.prototype,'onLine',{configurable:true,get(){return !window.__noNet}});
    try{
      localStorage.setItem('sb-ihbyurdtfjwhpladpmwz-auth-token',
        JSON.stringify({user:{id:'11111111-0000-4000-8000-000000000001',email:'test@example.org'}}));
      localStorage.setItem('kt2_settings', JSON.stringify({onb:true, pwa:true, mode:'play'}));
    }catch(e){}});
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
  await pg.goto('http://127.0.0.1:8131/',{waitUntil:'networkidle'}); await pg.waitForTimeout(900);
  const vis=id=>pg.evaluate(i=>!document.querySelector('#'+i).classList.contains('hidden'),id);
  const txt=sel=>pg.textContent(sel);
  const score=async()=>(await txt('#mScore')).replace(/\s/g,'');
  const toasts=()=>pg.$$eval('.toast',t=>t.map(x=>x.textContent).join(' | '));
  const net=async on=>{ await pg.evaluate(o=>{ window.__noNet=!o; __fake.offline=!o; sessionStorage.setItem('__noNet', o?'0':'1');
    if(o) window.dispatchEvent(new Event('online')) }, on) };
  const tap=async i=>{ await pg.click('#mArea .ptile >> nth='+i); await pg.waitForTimeout(150) };
  const DB=f=>pg.evaluate(f);

  console.log('== Vorbereitung online: Nickname und ein Gast ==');
  await pg.click('#pNick'); await pg.waitForTimeout(200);
  await pg.fill('.dlg .dinput','Olli'); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(400);
  await pg.click('#pcMode button:has-text("Einzel")'); await pg.waitForTimeout(150);
  await pg.fill('#pcGps input','3'); await pg.waitForTimeout(150);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(200);
  await (await pg.$$('#pLineup .slot'))[1].click(); await pg.waitForTimeout(250);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput','Jan'); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(350);
  ok(!(await pg.isDisabled('#pStart')),'Aufstellung Olli gegen Jan steht');

  console.log('== Offline: erstes Spiel ==');
  await net(false);
  await pg.click('#pStart'); await pg.waitForTimeout(500);
  ok(await vis('match'),'Spiel startet ohne Netz');
  ok((await toasts()).includes('auf dem Gerät gezählt'),'Hinweis: wird auf dem Gerät gezählt');
  ok((await txt('#mSync')).includes('Offline-Spiel'),'Kopfzeile: Offline-Spiel');
  ok(await DB(()=>__fake.DB.matches.length===0),'Server hat (noch) nichts');
  await tap(0); await tap(1);
  ok((await score())==='1:1','Zählt lokal 1:1');
  await pg.click('#mUndo'); await pg.waitForTimeout(200);
  ok((await score())==='1:0','Rückgängig nimmt das letzte Tor (Jans) zurück');
  await tap(0);
  ok((await score())==='2:0','2:0');
  await pg.click('#mRules'); await pg.waitForTimeout(250);
  ok((await txt('.dlg')).includes('nicht ändern'),'Regeln im Offline-Spiel gesperrt, mit Begründung');
  await pg.click('.dlg .dbtns button >> nth=0'); await pg.waitForTimeout(200);
  await tap(0); await pg.waitForTimeout(300);
  ok(await vis('msummary'),'Satz bis 3: Auswertung erscheint');
  ok((await txt('#msumBody')).includes('noch auf diesem Gerät'),'Auswertung: liegt noch auf dem Gerät');
  ok((await txt('#msumBody')).includes('3 : 0')||(await txt('#msumBody')).includes('1 : 0'),'Ergebnis in der Auswertung');
  ok((await txt('#msumFix')).includes('Letztes Tor'),'Korrigieren heißt offline: letztes Tor zurücknehmen');
  await pg.click('#msumFix'); await pg.waitForTimeout(250);
  ok((await score())==='2:0' && await vis('match'),'Korrektur: wieder 2:0, Zählbildschirm offen');
  await tap(0); await pg.waitForTimeout(300);
  await pg.click('#msumDone'); await pg.waitForTimeout(500);
  ok(await vis('play'),'Zurück auf der Spielen-Seite');
  ok((await txt('#pOff')).includes('Ein Offline-Spiel wartet'),'Karte „Auf diesem Gerät“: 1 Spiel');
  ok(!(await pg.$('#pOffUp')),'Ohne Netz kein Knopf „Jetzt hochladen“');

  console.log('== Offline: zweites und drittes Spiel ==');
  await pg.click('#pStart'); await pg.waitForTimeout(500);
  await tap(1); await tap(1); await tap(1); await pg.waitForTimeout(300);
  ok(await vis('msummary'),'Zweites Spiel fertig (0:3)');
  await pg.click('#msumDone'); await pg.waitForTimeout(400);
  ok((await txt('#pOff')).includes('2 Offline-Spiele warten'),'Zwei Spiele warten');
  await pg.click('#pStart'); await pg.waitForTimeout(500);
  await tap(0);
  ok((await score())==='1:0','Drittes Spiel läuft offline, 1:0');
  await pg.reload({waitUntil:'networkidle'}); await pg.waitForTimeout(900);
  ok((await txt('#pOff')).includes('3 Offline-Spiele warten'),'Nach Neustart der App: alle drei noch da');
  await pg.click('#pOff [data-oid] >> nth=2'); await pg.waitForTimeout(400);
  ok(await vis('match') && (await score())==='1:0','Laufendes Offline-Spiel fortsetzen: 1:0');

  console.log('== Netz kommt zurück, Spiel ist offen ==');
  await net(true); await pg.waitForTimeout(900);
  ok(await DB(()=>__fake.DB.matches.length===3),'Alle drei Spiele auf dem Server');
  ok(await DB(()=>__fake.imports===3),'Genau drei Uploads');
  ok((await toasts()).includes('3 Offline-Spiele hochgeladen'),'Meldung: 3 hochgeladen');
  ok(await DB(()=>{const m=__fake.DB.matches;
    return m.filter(x=>x.state==='confirmed').length===2 && m.filter(x=>x.state==='running').length===1}),
    'Zwei fertige Spiele mit Gast sofort bestätigt, eins läuft');
  ok(await DB(()=>{const m=__fake.DB.matches[0];
    return __fake.DB.goals.filter(g=>g.match_id===m.id).length===3
      && __fake.DB.match_sets.some(s=>s.match_id===m.id&&s.score1===3&&s.score2===0)}),
    'Erstes Spiel 3:0 mit genau drei Toren (Rücknahmen nicht übertragen)');
  ok(!(await txt('#mSync')).includes('Offline'),'Offenes Spiel läuft jetzt über den Server');
  await tap(0); await pg.waitForTimeout(500);
  ok(await DB(()=>{const m=__fake.DB.matches[2];
    return __fake.DB.match_sets.some(s=>s.match_id===m.id&&s.score1===2)}),'Weiterzählen landet direkt auf dem Server (2:0)');
  ok(await pg.evaluate(()=>offMine().length===0),'Gerät hat keine Offline-Spiele mehr');
  await pg.evaluate(()=>offUpload()); await pg.waitForTimeout(300);
  ok(await DB(()=>__fake.imports===3),'Kein doppelter Upload');

  console.log('== Abgelehntes Spiel ==');
  await pg.evaluate(()=>{ const id=offNewId(); OFF.push({id, uid:offUid(), mode:'single', detail:'simple', gps:3, stw:1,
    cat:'ranked', rules:{win_by:1,scope:'decider',cap:null,draw_at:null}, started:Date.now(), err:'',
    players:P.players.map(p=>Object.assign({},p,{position:null})),
    goals:[1,1,1,2].map(t=>({team:t,scorer:null,position:null,own:false,t:Date.now()}))}); saveOFF(); });
  await pg.evaluate(()=>offUpload()); await pg.waitForTimeout(400);
  ok(await DB(()=>__fake.DB.matches.length===3),'Unstimmiges Spiel nicht übernommen, nichts Halbes auf dem Server');
  ok(await pg.evaluate(()=>offMine().length===1 && !!offMine()[0].err),'Bleibt mit Begründung auf dem Gerät');
  await pg.click('#mEnd'); await pg.waitForTimeout(250); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(500);
  ok((await txt('#pOff')).includes('Abgelehnt'),'Karte zeigt „Abgelehnt“');
  await pg.click('#pOff [data-odrop]'); await pg.waitForTimeout(250); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(300);
  ok((await txt('#pOff'))==='','Verworfen: Karte weg');

  console.log('== Fehler behoben: Tipps anderer Spiele bleiben ==');
  await pg.click('#pStart'); await pg.waitForTimeout(600);   // online: normales Spiel
  const ids=await DB(()=>__fake.DB.matches.map(m=>m.id));
  ok(await DB(()=>__fake.DB.matches[3].state==='running'),'Neues Online-Spiel läuft (Nr. 4)');
  ids[2]=ids[3];
  await pg.evaluate(()=>pClose()); await pg.waitForTimeout(300);
  await pg.evaluate(id=>{ PL.queue.push({match:id, kind:'goal', team:2, scorer:null, position:null, own:false, t:Date.now()}); savePL() }, ids[2]);
  await net(false);
  await pg.evaluate(id=>pOpen(id), ids[0]); await pg.waitForTimeout(300);
  await net(true);
  await pg.evaluate(id=>pOpen(id), ids[0]); await pg.waitForTimeout(700);
  ok(await DB(()=>{const m=__fake.DB.matches[3]; return __fake.DB.match_sets.some(s=>s.match_id===m.id&&s.score2===1)}),
     'Tipp für ein anderes Spiel wurde trotzdem gesendet');
  ok(await pg.evaluate(()=>PL.queue.length===0),'Warteschlange leer');

  console.log('== Online-Spiel, Netz weg: Rückgängig ohne Netz ==');
  await pg.evaluate(id=>pOpen(id), ids[2]); await pg.waitForTimeout(400);
  const before=await score();
  await net(false);
  await tap(0);
  ok((await score())!==before,'Tipp ohne Netz wirkt sofort');
  await pg.click('#mUndo'); await pg.waitForTimeout(300);
  ok((await score())===before,'Rückgängig ohne Netz stellt den alten Stand her ('+before+')');
  await net(true); await pg.waitForTimeout(500);

  console.log('== Netzfehler beim Anlegen trotz „online“ ==');
  await pg.evaluate(()=>pClose()); await pg.waitForTimeout(400);
  await pg.evaluate(()=>{__fake.offline=true});   // Gerät meint online, Server nicht erreichbar
  await pg.click('#pStart'); await pg.waitForTimeout(600);
  ok((await txt('#mSync')).includes('Offline-Spiel'),'Fällt auf ein Offline-Spiel zurück');
  await pg.evaluate(()=>{__fake.offline=false; window.dispatchEvent(new Event('online'))}); await pg.waitForTimeout(800);
  ok(await DB(()=>__fake.DB.matches.length===5),'Wird hochgeladen, sobald der Server antwortet');

  console.log('== Abmelden mit wartendem Spiel ==');
  await pg.evaluate(()=>pClose()); await pg.waitForTimeout(300);
  await net(false);
  await pg.click('#pStart'); await pg.waitForTimeout(400);
  await pg.evaluate(()=>{ pClose(); go('settings'); setView('profil') }); await pg.waitForTimeout(400);
  await pg.click('#acOutBtn'); await pg.waitForTimeout(300);
  ok((await txt('.dlg')).includes('Offline-Spiel wartet'),'Abmelden warnt vor dem wartenden Spiel');
  await pg.click('.dlg .dbtns [data-i="1"]'); await pg.waitForTimeout(200);

  ok(errs.length===0,'Keine Fehler in der Konsole'+(errs.length?': '+errs.join(' / '):''));
  await br.close(); srv.close();
  console.log(fails?('\n'+fails+' FEHLER'):'\nALLE GRÜN'); process.exit(fails?1:0);
})();
