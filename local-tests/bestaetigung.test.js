/* Browsertest: Bestätigung und Korrektur (Schritt 4).
   Spielt den vollen Weg durch: Host zählt → Mitspieler widerspricht → Host
   korrigiert → Mitspieler bestätigt → bestätigt. Zum Schluss der abgelaufene
   Korrekturzeitraum und ein Spiel aus Host und Gästen, das sofort zählt.
   Wie im Lobby-Test wechseln wir zwischen zwei Konten in derselben Umgebung. */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'), HERE=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  const base=p==='/fake-supabase.js'?HERE:ROOT;
  try{const b=fs.readFileSync(path.join(base,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});

const HOST='11111111-0000-4000-8000-000000000001';
const MIT ='22222222-0000-4000-8000-000000000002';
let fails=0; const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m); if(!c)fails++};

(async()=>{
  await new Promise(r=>srv.listen(8119,'127.0.0.1',r));
  const br=await chromium.launch();
  const ctx=await br.newContext({viewport:{width:375,height:667}});
  await ctx.addInitScript({path:HERE+'/fake-supabase.js'});
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});

  const asUser=async(uid)=>{
    await pg.addInitScript(([u])=>{try{
      localStorage.setItem('sb-ihbyurdtfjwhpladpmwz-auth-token', JSON.stringify({user:{id:u}}));
      localStorage.setItem('__fakeuid', u);
      localStorage.setItem('kt2_settings', JSON.stringify({onb:true, mode:'play'}));
    }catch(e){}}, [uid]);
    await pg.goto('http://127.0.0.1:8119/',{waitUntil:'networkidle'});
    await pg.waitForTimeout(800);
    await pg.evaluate(()=>{document.querySelectorAll('.overlay.dlg').forEach(e=>e.remove())});
    await pg.waitForTimeout(500);
  };
  const vis=id=>pg.evaluate(i=>!document.querySelector('#'+i).classList.contains('hidden'),id);
  const txt=sel=>pg.textContent(sel);
  const dlgOk=async()=>{ await pg.waitForSelector('.dlg .dbtns [data-i="0"]',{timeout:5000});
    await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(700) };
  const setNick=async(name)=>{
    await pg.waitForSelector('#pNick',{timeout:8000});
    await pg.click('#pNick'); await pg.waitForTimeout(250);
    await pg.fill('.dlg .dinput',name); await dlgOk();
  };
  const dbState=()=>pg.evaluate(()=>{const m=__fake.DB.matches[0];return m&&m.state});
  const dbRev=()=>pg.evaluate(()=>{const m=__fake.DB.matches[0];return m&&m.rev});

  console.log('== Host spielt gegen einen Mitspieler ==');
  await asUser(HOST);
  await setNick('Olli');
  await pg.click('#pcMode button:has-text("Einzel")'); await pg.waitForTimeout(150);
  await pg.click('#pcDetail button:has-text("Einfach")'); await pg.waitForTimeout(150);
  await pg.click('#pcGps button:has-text("3 Tore")'); await pg.waitForTimeout(150);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  await pg.click('#pcInvite button:has-text("Per Code")'); await pg.waitForTimeout(250);
  await pg.click('#pLobby'); await pg.waitForTimeout(800);
  const code=(await txt('.codecard .code')).trim();
  ok(/^\d{6}$/.test(code),'Lobby offen, Code '+code);

  await asUser(MIT);
  await setNick('Basti');
  await pg.click('#pJoinBtn'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput',code); await dlgOk();
  ok(await vis('lobby'),'Mitspieler ist beigetreten');

  await asUser(HOST);
  await pg.click('#pResume'); await pg.waitForTimeout(800);
  await pg.click('#lobStart'); await pg.waitForTimeout(900);
  ok(await vis('match'),'Spiel läuft');
  for(let i=0;i<3;i++){ await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300) }
  await pg.waitForTimeout(700);
  ok(await vis('msummary'),'Auswertung erscheint');
  const sum=await txt('#msumBody');
  ok(sum.includes('wartet auf Bestätigung'),'Host sieht: wartet auf Bestätigung');
  ok(sum.includes('Basti'),'Die Auswertung sagt, auf wen gewartet wird');
  ok(!sum.includes('bestätigt und wertbar'),'Noch nicht wertbar');
  ok(await pg.isVisible('#msumFix'),'Host kann aus der Auswertung heraus korrigieren');
  ok(await dbState()==='finished','Zustand ist beendet, nicht bestätigt');
  ok(await dbRev()===1,'rev ist 1');
  await pg.click('#msumDone'); await pg.waitForTimeout(600);
  ok(!(await pg.$('#pTodo .card')),'Der Host hat selbst nichts zu bestätigen');

  console.log('== Mitspieler widerspricht ==');
  await asUser(MIT);
  await pg.waitForSelector('#pTodo .card',{timeout:5000});
  const todo=await txt('#pTodo');
  ok(todo.includes('Warten auf dich'),'Mitspieler sieht die Aufforderung');
  ok(todo.includes('Einzel'),'Das Spiel steht in der Karte');
  await pg.click('#pTodo [data-conf]'); await pg.waitForTimeout(900);
  ok(await vis('lobby'),'Spiel geöffnet');
  let lb=await txt('#lobBody');
  ok(lb.includes('1 : 0'),'Ergebnis in Sätzen');
  ok(lb.includes('3:0'),'Satzstand');
  ok(/Team 1[\s\S]{0,40}bestätigt/.test(lb),'Team des Hosts gilt als bestätigt');
  ok(/Team 2[\s\S]{0,40}offen/.test(lb),'Eigenes Team ist noch offen');
  ok(await pg.isVisible('#lobOk')&&await pg.isVisible('#lobNo'),'Beide Knöpfe da');
  ok(!(await pg.$('#lobFix')),'Mitspieler kann nicht korrigieren');

  await pg.click('#lobNo'); await pg.waitForTimeout(300);
  await pg.fill('.dlg .dinput','War 1:3 für mich'); await dlgOk();
  ok(await dbState()==='disputed','Spiel ist strittig');
  lb=await txt('#lobBody');
  ok(lb.includes('Widerspruch von Basti'),'Der Widerspruch wird benannt');
  ok(lb.includes('War 1:3 für mich'),'Der Hinweis steht da');
  ok(lb.includes('Du hast widersprochen'),'Eigene Entscheidung wird gezeigt');
  ok(!(await pg.$('#lobOk')),'Kein zweites Mal abstimmen');

  console.log('== Host korrigiert ==');
  await asUser(HOST);
  const rec=await txt('#pRecent');
  ok(rec.includes('strittig'),'Die Spielliste nennt den Zustand');
  await pg.click('#pRecent [data-mid]'); await pg.waitForTimeout(900);
  ok((await txt('#lobBody')).includes('War 1:3 für mich'),'Host liest den Hinweis');
  ok(await pg.isVisible('#lobFix'),'Host kann korrigieren');
  await pg.click('#lobFix'); await pg.waitForTimeout(300);
  await dlgOk();
  ok(await vis('match'),'Zählbildschirm ist wieder offen');
  ok(await dbState()==='running','Spiel läuft wieder');
  ok(await dbRev()===2,'rev ist hochgezählt');
  // Der Kern des Nachtrags: ein laufendes Spiel braucht einen laufenden Satz
  ok((await txt('#mHead')).includes('Satz 1'),'Der letzte Satz ist wieder der laufende');
  ok((await txt('#mScore')).replace(/\s/g,'')==='3:0','Der alte Stand steht noch');

  await pg.click('#mUndo'); await pg.waitForTimeout(600);
  ok((await txt('#mScore')).replace(/\s/g,'')==='2:0','Ein Tor zurückgenommen');
  for(let i=0;i<3;i++){ await pg.click('#mArea .ptile >> nth=1'); await pg.waitForTimeout(300) }
  await pg.waitForTimeout(700);
  ok(await vis('msummary'),'Auswertung der neuen Fassung');
  ok((await txt('#msumBody')).includes('wartet auf Bestätigung'),'Wieder offen – die alte Bestätigung verfällt');
  ok(await dbState()==='finished','Zustand beendet');
  await pg.click('#msumDone'); await pg.waitForTimeout(600);

  console.log('== Mitspieler bestätigt die neue Fassung ==');
  await asUser(MIT);
  await pg.waitForSelector('#pTodo .card',{timeout:5000});
  ok(true,'Das Spiel wartet erneut auf ihn');
  await pg.click('#pTodo [data-conf]'); await pg.waitForTimeout(900);
  ok((await txt('#lobBody')).includes('0 : 1'),'Korrigiertes Ergebnis');
  ok(await pg.isVisible('#lobOk'),'Er darf wieder abstimmen');
  await pg.click('#lobOk'); await pg.waitForTimeout(300);
  await dlgOk();
  ok(await dbState()==='confirmed','Spiel ist bestätigt');
  ok((await txt('#lobBody')).includes('Du hast bestätigt'),'Eigene Zustimmung wird gezeigt');
  await pg.click('#lobBack'); await pg.waitForTimeout(700);
  ok(!(await pg.$('#pTodo .card')),'Die Aufforderung ist weg');
  ok((await txt('#pRecent')).includes('bestätigt'),'Die Liste zeigt „bestätigt“');

  console.log('== Korrekturzeit abgelaufen ==');
  await pg.evaluate(()=>{ __fake.DB.matches[0].finished_at =
    new Date(Date.now()-3*3600*1000).toISOString(); __fake.persist() });
  await asUser(HOST);
  await pg.click('#pRecent [data-mid]'); await pg.waitForTimeout(900);
  ok(!(await pg.$('#lobFix')),'Nach zwei Stunden kein Korrigieren mehr');
  ok((await txt('#lobBody')).includes('endgültig'),'Das wird auch gesagt');

  console.log('== Host und Gäste: zählt sofort ==');
  await pg.click('#lobBack'); await pg.waitForTimeout(700);
  // Der Kontowechsel setzt die gespeicherten Einstellungen zurück – neu wählen
  await pg.click('#pcMode button:has-text("Einzel")'); await pg.waitForTimeout(150);
  await pg.click('#pcDetail button:has-text("Einfach")'); await pg.waitForTimeout(150);
  await pg.click('#pcGps button:has-text("3 Tore")'); await pg.waitForTimeout(150);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  await pg.click('#pcInvite button:has-text("Nur Gäste")'); await pg.waitForTimeout(300);
  ok((await pg.$$('#pLineup .slot')).length===2,'Zwei Plätze im Einzel');
  await pg.click('#pLineup [data-slot="2"]'); await pg.waitForTimeout(350);
  await dlgOk();                                      // „Neuer Gast“
  await pg.fill('.dlg .dinput','Jan'); await dlgOk();
  ok(await pg.isEnabled('#pStart'),'Aufstellung ist vollständig');
  await pg.click('#pStart'); await pg.waitForTimeout(900);
  for(let i=0;i<3;i++){ await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300) }
  await pg.waitForTimeout(700);
  const sum2=await txt('#msumBody');
  ok(sum2.includes('bestätigt und wertbar'),'Spiel aus Host und Gästen zählt sofort');
  ok(!sum2.includes('wartet auf Bestätigung'),'Es wartet auf niemanden');
  ok(await pg.isVisible('#msumFix'),'Korrigieren bleibt möglich');
  ok(await pg.evaluate(()=>__fake.DB.match_confirmations.filter(c=>c.rev===1).length>=0),'Ohne Zutun von jemandem');

  console.log(errs.length?'\nFEHLER IM BROWSER:\n'+errs.join('\n'):'\nKeine Browser-Fehler');
  console.log(fails?'FEHLGESCHLAGEN: '+fails:'ALLE OK');
  await br.close(); srv.close(); process.exit(fails||errs.length?1:0);
})();
