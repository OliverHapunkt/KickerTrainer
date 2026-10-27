const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'), HERE=__dirname;   // ROOT = Repo-Wurzel
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  const base=p==='/fake-supabase.js'?HERE:ROOT;
  try{const b=fs.readFileSync(path.join(base,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});
let fails=0; const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m); if(!c)fails++};
(async()=>{
  await new Promise(r=>srv.listen(8114,'127.0.0.1',r));
  const br=await chromium.launch();
  const ctx=await br.newContext({viewport:{width:375,height:667}});
  // Ersatz-Client und eine vorhandene Anmeldung einspielen, bevor die App startet
  await ctx.addInitScript({path:HERE+'/fake-supabase.js'});
  await ctx.addInitScript(()=>{try{
    localStorage.setItem('sb-ihbyurdtfjwhpladpmwz-auth-token',
      JSON.stringify({user:{id:'11111111-0000-4000-8000-000000000001',email:'test@example.org'}}));
    localStorage.setItem('kt2_settings', JSON.stringify({onb:true, mode:'play'}));
  }catch(e){}});
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
  await pg.goto('http://127.0.0.1:8114/',{waitUntil:'networkidle'}); await pg.waitForTimeout(900);
  const vis=id=>pg.evaluate(i=>!document.querySelector('#'+i).classList.contains('hidden'),id);
  const txt=sel=>pg.textContent(sel);

  console.log('== Start in der Spielen-Hälfte ==');
  ok(await vis('play'),'Spiel-Bildschirm offen');
  ok((await txt('#playBody')).includes('Nickname'),'Fragt nach dem Nickname');

  console.log('== Nickname ==');
  await pg.click('#pNick'); await pg.waitForTimeout(250);
  ok((await txt('.dlg')).includes('nicht deinen vollen Namen'),'Hinweis zur Sichtbarkeit im Dialog');
  await pg.fill('.dlg .dinput','Ol'); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(250);
  ok((await pg.$('#pNick'))!==null,'Zu kurzer Nickname wird abgelehnt');
  await pg.click('#pNick'); await pg.waitForTimeout(200);
  await pg.fill('.dlg .dinput','Olli'); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(400);
  ok((await txt('#playBody')).includes('Neues Spiel'),'Nach dem Nickname: Spiel anlegen');
  ok((await txt('#pNick2'))==='Olli','Nickname in der Kopfzeile');

  console.log('== Spiel einstellen ==');
  await pg.click('#pcMode button:has-text("Doppel")'); await pg.waitForTimeout(150);
  await pg.click('#pcDetail button:has-text("Erweitert")'); await pg.waitForTimeout(150);
  await pg.click('#pcGps button:has-text("3 Tore")'); await pg.waitForTimeout(150);
  await pg.click('#pcStw button:has-text("2 Gewinnsätze")'); await pg.waitForTimeout(200);
  ok((await pg.$$('#pLineup .slot')).length===4,'Vier Plätze im Doppel');
  ok((await txt('#pcStwHint')).includes('höchstens 3'),'Hinweis rechnet die Sätze aus');
  ok(await pg.isDisabled('#pStart'),'Start gesperrt, solange Plätze frei sind');

  console.log('== Gäste anlegen ==');
  const slots=await pg.$$('#pLineup .slot');
  ok((await slots[0].textContent()).includes('Olli'),'Platz 1 ist mit mir vorbelegt');
  for(const [i,name] of [[1,'Jan'],[2,'Tim'],[3,'Mara']]){
    await (await pg.$$('#pLineup .slot'))[i].click(); await pg.waitForTimeout(250);
    await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(250);   // Neuer Gast
    await pg.fill('.dlg .dinput',name); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(350);
  }
  const names=await pg.$$eval('#pLineup .slot b',b=>b.map(x=>x.textContent));
  console.log('     Aufstellung:',JSON.stringify(names));
  ok(names.join('|')==='Olli|Jan|Tim|Mara','Alle Plätze besetzt');
  ok(!(await pg.isDisabled('#pStart')),'Start jetzt möglich');

  console.log('== Gast wiederverwenden ==');
  await (await pg.$$('#pLineup .slot'))[1].click(); await pg.waitForTimeout(250);
  const pick=await pg.$$eval('.dlg .pickrow',b=>b.map(x=>x.textContent));
  console.log('     Auswahl:',JSON.stringify(pick));
  ok(pick.length===1 && pick[0].includes('Jan'),'Nur noch freie Spieler zur Auswahl (Jan selbst)');
  await pg.click('.dlg .dbtns [data-i="1"]'); await pg.waitForTimeout(200);

  console.log('== Zählen ==');
  await pg.click('#pStart'); await pg.waitForTimeout(600);
  ok(await vis('match'),'Zählbildschirm offen');
  ok(!(await vis('play')),'Spiel-Bildschirm zu');
  ok((await pg.$$('#mArea .ptile')).length===4,'Vier Kacheln');
  const tiles=await pg.$$eval('#mArea .ptile',t=>t.map(x=>x.textContent));
  console.log('     Kacheln:',JSON.stringify(tiles));
  ok(tiles[0].includes('Sturm')&&tiles[1].includes('Abwehr'),'Sturm oben, Abwehr darunter');
  ok((await txt('#mHead')).includes('Satz 1'),'Kopfzeile zeigt den Satz');

  const score=async()=>(await txt('#mScore')).replace(/\s/g,'');
  await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300);
  ok((await score())==='1:0','Tor für Team 1');
  await pg.click('#mArea .ptile >> nth=2'); await pg.waitForTimeout(300);
  ok((await score())==='1:1','Tor für Team 2');

  console.log('== Eigentor ==');
  await pg.click('#mOwn'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(()=>document.querySelector('#mOwn').classList.contains('on')),'Eigentor ist scharf');
  await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300);
  ok((await score())==='1:2','Eigentor zählt für das andere Team');
  ok(!(await pg.evaluate(()=>document.querySelector('#mOwn').classList.contains('on'))),'Eigentor danach wieder aus');
  ok(await pg.evaluate(()=>__fake.DB.goals.some(g=>g.own_goal)),'Als Eigentor gespeichert');

  console.log('== Rückgängig ==');
  await pg.click('#mUndo'); await pg.waitForTimeout(350);
  ok((await score())==='1:1','Rückgängig nimmt das Eigentor zurück');

  console.log('== Positionstausch ==');
  await pg.click('#mArea [data-swap="1"]'); await pg.waitForTimeout(300);
  const t2=await pg.$$eval('#mArea .tcol:first-child .ptile',t=>t.map(x=>x.textContent));
  ok(t2[0].includes('Jan')&&t2[0].includes('Sturm'),'Nach dem Tausch steht Jan im Sturm');
  await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(()=>__fake.DB.goals.slice(-1)[0].scorer_position==='off'),'Tor zählt auf die neue Position');

  console.log('== Satz- und Spielende ==');
  await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(350);   // 3:1 -> Satz 1 an Team 1
  ok((await txt('#mHead')).includes('Satz 2'),'Satz 2 beginnt');
  ok((await txt('#mHead')).includes('1:0'),'Satzstand 1:0');
  ok((await score())==='0:0','Neuer Satz beginnt bei 0');
  for(let i=0;i<3;i++){ await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300) }
  await pg.waitForTimeout(400);
  ok(await vis('msummary'),'Auswertung erscheint automatisch');
  const sum=await txt('#msumBody');
  console.log('     Auswertung enthält:', sum.replace(/\s+/g,' ').slice(0,160));
  ok(sum.includes('2 : 0'),'Satzergebnis 2:0');
  ok(sum.includes('Torschützen'),'Torschützen aufgeführt');
  ok(sum.includes('Tore je Position'),'Tore je Position aufgeführt');
  await pg.click('#msumDone'); await pg.waitForTimeout(500);
  ok(await vis('play'),'Zurück auf dem Spiel-Bildschirm');
  ok((await txt('#playBody')).includes('Letzte Spiele'),'Spiel steht in der Liste');

  console.log('== Ohne Netz weiterzählen ==');
  await pg.click('#pStart'); await pg.waitForTimeout(600);
  ok(await vis('match'),'Zweites Spiel gestartet');
  await pg.evaluate(()=>{__fake.offline=true});
  await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300);
  await pg.click('#mArea .ptile >> nth=2'); await pg.waitForTimeout(300);
  ok((await score())==='1:1','Zählt offline weiter');
  await pg.screenshot({path:path.join(require('os').tmpdir(),'zaehlen.png')});
  ok(await vis('mSync'),'Kopfzeile meldet Ausstehendes');
  ok((await txt('#mSync')).includes('2 Tipps noch nicht gespeichert – werden nachgeholt'),'Warteschlange richtig benannt: '+(await txt('#mSync')));
  // Schnelles Tippen: ältere Serverantwort darf den neueren Stand nicht überschreiben
  await pg.evaluate(()=>{__fake.offline=false});
  await pg.click('#mArea .ptile >> nth=0'); await pg.click('#mArea .ptile >> nth=0');
  await pg.waitForTimeout(900);
  // 1:1 + zwei Tore = 3:1, und bei "Satz bis 3" ist der Satz damit durch
  ok((await score())==='0:0','Nach dem Satzgewinn beginnt der neue Satz bei 0');
  ok((await txt('#mHead')).includes('1:0'),'Satzstand 1:0 nach dem Nachsenden');
  await pg.evaluate(()=>{__fake.offline=false});
  await pg.evaluate(()=>window.dispatchEvent(new Event('online'))); await pg.waitForTimeout(600);
  ok(!(await vis('mSync')),'Nach dem Netz ist nichts mehr offen');
  ok((await score())==='0:0','Stand stimmt nach dem Nachsenden');
  ok(await pg.evaluate(()=>__fake.DB.goals.filter(g=>g.match_id===__fake.DB.matches.slice(-1)[0].id).length===4),
     'Beide Tore sind auf dem Server angekommen');

  console.log('== Spiel abbrechen ==');
  await pg.click('#mEnd'); await pg.waitForTimeout(300);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(500);
  ok(await vis('play'),'Nach dem Abbruch zurück');
  ok(await pg.evaluate(()=>__fake.DB.matches.slice(-1)[0].state==='cancelled'),'Spiel ist abgebrochen, nicht gewertet');

  await pg.screenshot({path:path.join(require('os').tmpdir(),'spiel-anlegen.png')});
  console.log(errs.length?'\nFEHLER IM BROWSER:\n'+errs.join('\n'):'\nKeine Browser-Fehler');
  console.log(fails?'FEHLGESCHLAGEN: '+fails:'ALLE OK');
  await br.close(); srv.close(); process.exit(fails||errs.length?1:0);
})();
