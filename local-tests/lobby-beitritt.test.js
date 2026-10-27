/* Browsertest: Lobby und Beitritt per Code (Schritt 3b).
   Zwei Personen nacheinander in derselben Umgebung: Der Ersatz-Client behält
   Datenbank und angemeldetes Konto über einen Neustart hinweg, dadurch lässt
   sich zwischen Host und Mitspieler hin- und herwechseln. */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'), HERE=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  const base=p==='/fake-supabase.js'?HERE:ROOT;
  try{const b=fs.readFileSync(path.join(base,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});

const HOST='11111111-0000-4000-8000-000000000001';
const GUEST2='22222222-0000-4000-8000-000000000002';
let fails=0; const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m); if(!c)fails++};

(async()=>{
  await new Promise(r=>srv.listen(8117,'127.0.0.1',r));
  const br=await chromium.launch();
  const ctx=await br.newContext({viewport:{width:375,height:667}});
  await ctx.addInitScript({path:HERE+'/fake-supabase.js'});
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});

  // Als wer sind wir angemeldet? Setzt Token, Konto im Ersatz-Client und Modus.
  const asUser=async(uid)=>{
    await pg.addInitScript(([u])=>{try{
      localStorage.setItem('sb-ihbyurdtfjwhpladpmwz-auth-token', JSON.stringify({user:{id:u}}));
      localStorage.setItem('__fakeuid', u);
      localStorage.setItem('kt2_settings', JSON.stringify({onb:true, mode:'play'}));
    }catch(e){}}, [uid]);
    await pg.goto('http://127.0.0.1:8117/',{waitUntil:'networkidle'});
    await pg.waitForTimeout(800);
    await pg.evaluate(()=>{document.querySelectorAll('.overlay.dlg').forEach(e=>e.remove())});
    await pg.waitForTimeout(400);   // Profil wird im Hintergrund nachgeladen
  };
  const vis=id=>pg.evaluate(i=>!document.querySelector('#'+i).classList.contains('hidden'),id);
  const txt=sel=>pg.textContent(sel);
  const setNick=async(name)=>{
    await pg.waitForSelector('#pNick',{timeout:8000});
    await pg.click('#pNick'); await pg.waitForTimeout(250);
    await pg.fill('.dlg .dinput',name); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(500);
  };

  console.log('== Host öffnet eine Lobby ==');
  await asUser(HOST);
  await setNick('Olli');
  ok((await txt('#playBody')).includes('Neues Spiel'),'Host hat ein Profil');
  await pg.click('#pcMode button:has-text("Doppel")'); await pg.waitForTimeout(150);
  await pg.click('#pcDetail button:has-text("Erweitert")'); await pg.waitForTimeout(150);
  await pg.click('#pcGps button:has-text("3 Tore")'); await pg.waitForTimeout(150);
  ok(await pg.isVisible('#pLineup'),'Bei „Nur Gäste“ gibt es die Aufstellung');
  await pg.click('#pcInvite button:has-text("Per Code")'); await pg.waitForTimeout(250);
  ok(!(await pg.$('#pLineup')),'Bei „Per Code“ verschwindet die Aufstellung');
  ok(await pg.isVisible('#pLobby'),'Knopf heißt jetzt „Lobby öffnen“');
  await pg.click('#pLobby'); await pg.waitForTimeout(800);
  ok(await vis('lobby'),'Lobby-Bildschirm offen');
  const code=(await txt('.codecard .code')).trim();
  ok(/^\d{6}$/.test(code),'Sechsstelliger Code wird angezeigt: '+code);
  ok((await txt('#lobBody')).includes('Noch frei'),'Freie Plätze sind ausgewiesen');
  ok(await pg.isDisabled('#lobStart'),'Start gesperrt, solange Plätze frei sind');
  ok(await pg.isVisible('#lobCancel'),'Host kann abbrechen');

  console.log('== Mitspieler tritt bei ==');
  await asUser(GUEST2);
  await setNick('Basti');
  ok((await txt('#playBody')).includes('Mitspielen'),'Mitspieler sieht den Beitritts-Bereich');
  await pg.click('#pJoinBtn'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput','000000'); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(600);
  ok(!(await vis('lobby')),'Falscher Code führt nirgendwohin');
  // Die letzte Meldung zählt – die vom Nickname-Speichern steht evtl. noch da
  const toastTxt=await pg.evaluate(()=>{const t=document.querySelectorAll('.toast');return t.length?t[t.length-1].textContent:''});
  ok(/Kein offenes Spiel/.test(toastTxt),'Falscher Code nennt keine Einzelheiten: '+toastTxt);

  await pg.click('#pJoinBtn'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput',code); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(800);
  ok(await vis('lobby'),'Mit richtigem Code in der Lobby');
  const jb=await txt('#lobBody');
  ok(jb.includes('Du bist dabei'),'Mitspieler sieht „Du bist dabei“');
  ok(!jb.includes('Code zum Beitreten'),'Mitspieler sieht den Code NICHT');
  ok(jb.includes('Olli')&&jb.includes('Basti'),'Beide stehen in der Aufstellung');
  ok(!(await pg.$('#lobStart')),'Mitspieler kann nicht starten');
  ok(await pg.isVisible('#lobLeave'),'Mitspieler kann verlassen');
  ok((await pg.$$('#lobBody .lbtn')).length===0,'Mitspieler kann nichts umstellen');

  console.log('== Host sieht den Beitritt ==');
  await asUser(HOST);
  ok((await txt('#pRunning')).includes('Lobby ist offen')||(await txt('#pRunning')).includes('Deine Lobby'),
     'Offene Lobby wird beim Start angeboten');
  await pg.click('#pResume'); await pg.waitForTimeout(800);
  ok(await vis('lobby'),'Host zurück in der Lobby');
  const hb=await txt('#lobBody');
  ok(hb.includes('Basti'),'Beigetretener steht in der Aufstellung');
  ok(hb.includes('Host'),'Host ist als solcher markiert');
  ok(await pg.isDisabled('#lobStart'),'Noch immer zwei Plätze frei');

  console.log('== Host ordnet zu und füllt mit Gästen auf ==');
  // Basti landete in Team 2 – Team wechseln und wieder zurück
  const t2before=await pg.$$eval('#lobBody .blockh',e=>e.map(x=>x.textContent));
  ok(t2before.join()==='Team 1,Team 2','Beide Teams werden gezeigt');
  await pg.click('#lobBody [data-team] >> nth=1'); await pg.waitForTimeout(600);
  ok((await pg.$$eval('#lobBody .lrow b',b=>b.map(x=>x.textContent))).length===4,'Vier Zeilen (zwei besetzt, zwei frei)');
  await pg.click('#lobBody [data-team] >> nth=1'); await pg.waitForTimeout(600);

  for(const name of ['Jan','Mara']){
    await pg.click('#lobBody [data-guest] >> nth=0'); await pg.waitForTimeout(350);
    await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(300);   // Neuer Gast
    await pg.fill('.dlg .dinput',name); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(700);
  }
  const voll=await txt('#lobBody');
  ok(voll.includes('Jan')&&voll.includes('Mara'),'Gäste sind eingesetzt');
  ok(!voll.includes('Noch frei'),'Keine freien Plätze mehr');
  await pg.screenshot({path:path.join(require('os').tmpdir(),'lobby.png')});

  console.log('== Starten ==');
  const dis=await pg.isDisabled('#lobStart');
  if(dis) console.log('     Hinweis:', (await txt('#lobBody')).slice(-160));
  ok(!dis,'Start jetzt möglich');
  await pg.click('#lobStart'); await pg.waitForTimeout(1000);
  ok(await vis('match'),'Host landet im Zählbildschirm');
  ok((await pg.$$('#mArea .ptile')).length===4,'Vier Kacheln');
  ok(await pg.evaluate(()=>__fake.DB.matches.some(m=>m.state==='running'&&m.join_code===null)),
     'Code ist mit dem Start entwertet');

  console.log('== Zählen und Ergebnis ==');
  for(let i=0;i<3;i++){ await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300) }
  await pg.waitForTimeout(300);
  ok((await txt('#mHead')).includes('Satz 2'),'Satz 1 ist durch');
  for(let i=0;i<3;i++){ await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300) }
  await pg.waitForTimeout(600);
  ok(await vis('msummary'),'Auswertung erscheint');
  await pg.click('#msumDone'); await pg.waitForTimeout(600);

  console.log('== Mitspieler sieht das Ergebnis ==');
  await asUser(GUEST2);
  const recent=await txt('#playBody');
  ok(recent.includes('Letzte Spiele'),'Mitspieler hat eine Spielliste');
  ok(recent.includes('als Mitspieler'),'Fremde Spiele sind als solche gekennzeichnet');
  ok(recent.includes('2 : 0'),'Ergebnis stimmt');

  console.log('== Verlassen ==');
  await asUser(HOST);
  await pg.click('#pcInvite button:has-text("Per Code")').catch(()=>{});
  await pg.waitForTimeout(200);
  await pg.click('#pLobby'); await pg.waitForTimeout(800);
  const code2=(await txt('.codecard .code')).trim();
  await asUser(GUEST2);
  await pg.click('#pJoinBtn'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput',code2); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(800);
  ok(await vis('lobby'),'In der zweiten Lobby');
  await pg.click('#lobLeave'); await pg.waitForTimeout(250);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(700);
  ok(await vis('play'),'Nach dem Verlassen zurück auf dem Spiel-Bildschirm');
  ok(await pg.evaluate(()=>__fake.DB.match_players.filter(p=>p.match_id===__fake.DB.matches.slice(-1)[0].id).length===1),
     'Nur noch der Host in der Lobby');

  console.log('== Lobby abbrechen ==');
  await asUser(HOST);
  await pg.click('#pResume'); await pg.waitForTimeout(800);
  await pg.click('#lobCancel'); await pg.waitForTimeout(250);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(700);
  ok(await vis('play'),'Nach dem Abbruch zurück');
  ok(await pg.evaluate(()=>__fake.DB.matches.slice(-1)[0].state==='cancelled'),'Lobby ist abgebrochen');
  ok(await pg.evaluate(()=>__fake.DB.matches.slice(-1)[0].join_code===null),'Code ist entwertet');

  console.log(errs.length?'\nFEHLER IM BROWSER:\n'+errs.join('\n'):'\nKeine Browser-Fehler');
  console.log(fails?'FEHLGESCHLAGEN: '+fails:'ALLE OK');
  await br.close(); srv.close(); process.exit(fails||errs.length?1:0);
})();
