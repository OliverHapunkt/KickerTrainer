/* Browsertest: Bilanz (Gegner-Statistik), Kategorie Wertung/locker, Gastnamen je Besitzer.
   Zwei Konten in derselben Umgebung: B legt zuerst einen Gast „Frank" an, danach
   legt der Host ebenfalls einen „Frank" an – das muss gehen. Dann spielt der Host
   mehrere Spiele und prüft Übersicht, Gegner-Liste, Direktvergleich und Filter. */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'), HERE=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  const base=p==='/fake-supabase.js'?HERE:ROOT;
  try{const b=fs.readFileSync(path.join(base,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});

const HOST='11111111-0000-4000-8000-000000000001';
const BB  ='22222222-0000-4000-8000-000000000002';
let fails=0; const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m); if(!c)fails++};

(async()=>{
  await new Promise(r=>srv.listen(8131,'127.0.0.1',r));
  const br=await chromium.launch();
  const ctx=await br.newContext({viewport:{width:390,height:844}});
  await ctx.addInitScript({path:HERE+'/fake-supabase.js'});
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});

  const asUser=async(uid)=>{
    await pg.addInitScript(([u])=>{try{
      localStorage.setItem('sb-ihbyurdtfjwhpladpmwz-auth-token', JSON.stringify({user:{id:u}}));
      localStorage.setItem('__fakeuid', u);
      const s=JSON.parse(localStorage.getItem('kt2_settings')||'{}'); s.onb=true; s.pwa=true; s.mode='play';
      localStorage.setItem('kt2_settings', JSON.stringify(s));
    }catch(e){}}, [uid]);
    await pg.goto('http://127.0.0.1:8131/',{waitUntil:'networkidle'});
    await pg.waitForTimeout(800);
    await pg.evaluate(()=>{document.querySelectorAll('.overlay.dlg').forEach(e=>e.remove())});
    await pg.waitForTimeout(400);
  };
  const vis=id=>pg.evaluate(i=>!document.querySelector('#'+i).classList.contains('hidden'),id);
  const txt=sel=>pg.textContent(sel);
  const dlgOk=async()=>{ await pg.waitForSelector('.dlg .dbtns [data-i="0"]',{timeout:5000});
    await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(500) };
  const setNick=async(name)=>{ await pg.waitForSelector('#pNick',{timeout:8000});
    await pg.click('#pNick'); await pg.waitForTimeout(250); await pg.fill('.dlg .dinput',name); await dlgOk() };
  const newGuestInSlot=async(slot,name)=>{
    await (await pg.$$('#pLineup .slot'))[slot].click(); await pg.waitForTimeout(250);
    await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(250);
    await pg.fill('.dlg .dinput',name); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(400);
  };
  const pickInSlot=async(slot,name)=>{
    await (await pg.$$('#pLineup .slot'))[slot].click(); await pg.waitForTimeout(250);
    await pg.click('.dlg .pickrow:has-text("'+name+'")'); await pg.waitForTimeout(300);
  };
  const toast=()=>pg.evaluate(()=>[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | '));
  // Einzel, ein Satz bis 3: drei Tipps entscheiden. team = wer trifft (1 = ich)
  const quick=async(team)=>{
    await pg.click('#pStart'); await pg.waitForTimeout(500);
    for(let i=0;i<3;i++){ await pg.click('#mArea [data-team="'+team+'"] >> nth=0'); await pg.waitForTimeout(350) }
    await pg.waitForSelector('#msumDone',{state:'visible',timeout:5000}); await pg.waitForTimeout(200);
    await pg.click('#msumDone'); await pg.waitForTimeout(500);
  };
  const tab=async(id)=>{ await pg.click('#tabbar [data-tab="'+id+'"]'); await pg.waitForTimeout(700) };

  console.log('== B legt einen Gast Frank an ==');
  await asUser(BB);
  await setNick('Basti');
  await newGuestInSlot(2,'Frank');
  ok((await pg.$$eval('#pLineup .slot b',b=>b.map(x=>x.textContent))).includes('Frank'),'B hat seinen Frank');

  console.log('== Host legt auch einen Frank an ==');
  await asUser(HOST);
  await setNick('Olli');
  ok((await txt('#playBody')).includes('Neues Spiel'),'Host ist im Anlegen');
  ok((await pg.$('#pcCat'))!==null,'Auswahl „Art“ vorhanden');
  ok((await pg.$eval('#pcCat .chip.on',b=>b.textContent))==='Wertung','Standard: Wertung');
  await pg.click('#pcMode button:has-text("Einzel")'); await pg.waitForTimeout(150);
  await pg.click('#pcDetail button:has-text("Einfach")'); await pg.waitForTimeout(150);
  await pg.fill('#pcGps input','3'); await pg.waitForTimeout(100);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  await newGuestInSlot(1,'Frank');
  ok((await pg.$$eval('#pLineup .slot b',b=>b.map(x=>x.textContent))).includes('Frank'),'Host hat ebenfalls einen Frank – kein „schon vergeben“');
  ok(await pg.evaluate(()=>__fake.DB.players.filter(p=>p.nickname==='Frank'&&p.kind==='guest').length===2),'Zwei getrennte Franks in der Datenbank');
  const picks=async()=>{ await (await pg.$$('#pLineup .slot'))[1].click(); await pg.waitForTimeout(250);
    const r=await pg.$$eval('.dlg .pickrow',b=>b.map(x=>x.textContent)); await pg.click('.dlg .dbtns [data-i="1"]'); await pg.waitForTimeout(200); return r };
  // Gast von B in einem gemeinsamen Spiel wäre sichtbar – darf nicht in meiner Auswahl stehen
  const p1=await picks();
  ok(p1.filter(x=>x.includes('Frank')).length<=1,'In meiner Auswahl höchstens mein eigener Frank ('+JSON.stringify(p1)+')');

  console.log('== Zweiter Frank beim selben Host ==');
  await (await pg.$$('#pLineup .slot'))[1].click(); await pg.waitForTimeout(250);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput','frank'); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(300);
  ok(/schon einen Gast.*M\.“/.test(await toast()),'Doppelter Gast: Hinweis zum Unterscheiden ('+(await toast())+')');
  await pg.waitForTimeout(2500);
  await newGuestInSlot(1,'JK');
  ok((await pg.$$eval('#pLineup .slot b',b=>b.map(x=>x.textContent))).includes('JK'),'Gast-Kürzel mit 2 Zeichen geht');

  console.log('== Spiele gegen Frank und JK ==');
  await pickInSlot(1,'Frank');
  await quick(1); await quick(1); await quick(2);          // gegen Frank: S S N
  await pg.click('#pcCat button:has-text("Locker")'); await pg.waitForTimeout(200);
  ok((await txt('#pcCatHint')).includes('nur für deine Bilanz'),'Hinweis zu locker');
  await quick(1);                                           // gegen Frank, locker: S
  ok(await pg.evaluate(()=>__fake.DB.matches.slice(-1)[0].category==='casual'),'Lockeres Spiel als casual gespeichert');
  await pg.click('#pcCat button:has-text("Wertung")'); await pg.waitForTimeout(200);
  await pickInSlot(1,'JK');
  await quick(2);                                           // gegen JK: N
  ok((await txt('#pRecent')).includes('locker'),'Letzte Spiele markieren das lockere Spiel');

  console.log('== Bilanz ==');
  await tab('rank');
  ok(await vis('rank'),'Tab Bilanz offen');
  ok((await txt('#rank h1'))==='Bilanz','Überschrift Bilanz');
  ok((await txt('#tabbar [data-tab="rank"]')).includes('Bilanz'),'Tab heißt Bilanz');
  const body=()=>txt('#rankBody').then(t=>t.replace(/\s+/g,' '));
  let b=await body();
  console.log('     ', b.slice(0,220));
  ok(b.includes('3 – 2'),'Übersicht 3 Siege, 2 Niederlagen');
  ok(b.includes('Quote 60 %'),'Quote ab 5 Spielen sichtbar');
  ok(b.includes('Aktuelle Serie') && b.includes('1 Niederlage'),'Aktuelle Serie: 1 Niederlage');
  ok(b.includes('Wertung') && b.includes('Locker'),'Wertung und locker getrennt ausgewiesen');
  const rows=await pg.$$eval('#rankBody [data-opp]',r=>r.map(x=>x.textContent.replace(/\s+/g,' ')));
  console.log('      Gegner:',JSON.stringify(rows));
  ok(rows.length===2,'Zwei Gegner');
  ok(rows[0].includes('Frank')&&rows[0].includes('3 – 1'),'Frank oben, 3 – 1');
  ok(!rows[0].includes('%'),'Frank: keine Quote bei 4 Spielen');
  ok(rows[1].includes('JK')&&rows[1].includes('0 – 1'),'JK 0 – 1');
  await pg.screenshot({path:path.join(require('os').tmpdir(),'bilanz.png'),fullPage:true});

  console.log('== Filter ==');
  await pg.click('#bzCat button:has-text("Locker")'); await pg.waitForTimeout(300);
  ok((await body()).includes('1 – 0'),'Nur locker: 1 – 0');
  await pg.click('#bzCat button:has-text("Wertung")'); await pg.waitForTimeout(300);
  ok((await body()).includes('2 – 2'),'Nur Wertung: 2 – 2');
  await pg.click('#bzMode button:has-text("Doppel")'); await pg.waitForTimeout(300);
  ok((await body()).includes('Für diese Auswahl gibt es keine Spiele'),'Doppel: leer, mit Hinweis');
  await pg.click('#bzMode button:has-text("Alle")'); await pg.click('#bzCat button:has-text("Alle")'); await pg.waitForTimeout(300);
  await tab('play'); await tab('rank');
  ok((await pg.$eval('#bzCat .chip.on',x=>x.textContent))==='Alle','Filter bleibt gemerkt');

  console.log('== Direktvergleich ==');
  await pg.click('#rankBody [data-opp] >> nth=0'); await pg.waitForTimeout(400);
  b=await body();
  ok(b.includes('Du gegen Frank'),'Titel Du gegen Frank');
  ok(b.includes('3 – 1'),'Bilanz gegen Frank 3 – 1');
  ok(b.includes('Quote ab 5 Spielen'),'Unter 5 Spielen: Hinweis statt Quote');
  ok((await pg.$$('#rankBody [data-mid]')).length===4,'Vier Begegnungen gelistet');
  ok(b.includes('locker'),'Lockere Begegnung gekennzeichnet');
  await pg.screenshot({path:path.join(require('os').tmpdir(),'bilanz-gegner.png'),fullPage:true});
  await pg.click('#bzBack'); await pg.waitForTimeout(300);
  ok((await body()).includes('Gegner'),'Zurück zur Übersicht');

  console.log('== Offline ==');
  await pg.evaluate(()=>{__fake.offline=true});
  await tab('play'); await tab('rank');
  ok((await body()).includes('3 – 2'),'Ohne Netz: zwischengespeicherte Bilanz');
  await pg.evaluate(()=>{__fake.offline=false});

  console.log('== Lobby zeigt die Art ==');
  await tab('play');
  await pg.click('#pcCat button:has-text("Locker")'); await pg.waitForTimeout(150);
  await pg.click('#pcInvite button:has-text("Per Code")'); await pg.waitForTimeout(250);
  await pg.click('#pLobby'); await pg.waitForTimeout(700);
  ok((await txt('#lobBody')).includes('locker – zählt nicht'),'Lobby nennt die Art');
  ok(await pg.evaluate(()=>__fake.DB.matches.slice(-1)[0].category==='casual'),'Lobby als casual angelegt');

  console.log('== B sieht nur seine eigene Bilanz ==');
  await asUser(BB);
  await tab('rank');
  ok((await body()).includes('Noch nichts'),'B hat noch keine Spiele');

  const bad=errs.filter(e=>!/Failed to fetch|ERR_|favicon/i.test(e));
  if(bad.length) console.log(bad.join('\n'));
  ok(!bad.length,'Keine Browser-Fehler');
  await br.close(); srv.close();
  console.log(fails?'\n'+fails+' FEHLER':'\nALLE OK');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
