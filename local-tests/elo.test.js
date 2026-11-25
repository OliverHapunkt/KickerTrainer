/* Browsertest: Elo (Schritt 5).
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
  await new Promise(r=>srv.listen(8132,'127.0.0.1',r));
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
      const s=JSON.parse(localStorage.getItem('kt2_settings')||'{}'); s.onb=true; s.mode='play';
      localStorage.setItem('kt2_settings', JSON.stringify(s));
    }catch(e){}}, [uid]);
    await pg.goto('http://127.0.0.1:8132/',{waitUntil:'networkidle'});
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


  console.log('== Erstes gewertetes Spiel ==');
  await asUser(HOST);
  await setNick('Olli');
  await pg.click('#pcMode button:has-text("Einzel")'); await pg.waitForTimeout(150);
  await pg.click('#pcDetail button:has-text("Einfach")'); await pg.waitForTimeout(150);
  await pg.fill('#pcGps input','3'); await pg.waitForTimeout(100);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  await newGuestInSlot(1,'Frank');
  // nicht quick(): Auswertung ansehen, bevor sie geschlossen wird
  await pg.click('#pStart'); await pg.waitForTimeout(500);
  for(let i=0;i<3;i++){ await pg.click('#mArea [data-team="1"] >> nth=0'); await pg.waitForTimeout(350) }
  await pg.waitForSelector('#msumDone',{state:'visible',timeout:5000}); await pg.waitForTimeout(400);
  let sum=(await txt('#msumBody')).replace(/\s+/g,' ');
  ok(sum.includes('Deine Wertung')&&sum.includes('+24 → 1024'),'Auswertung: +24 → 1024');
  await pg.click('#msumDone'); await pg.waitForTimeout(500);

  console.log('== Lockeres Spiel ändert nichts ==');
  await pg.click('#pcCat button:has-text("Locker")'); await pg.waitForTimeout(150);
  await pg.click('#pStart'); await pg.waitForTimeout(500);
  for(let i=0;i<3;i++){ await pg.click('#mArea [data-team="2"] >> nth=0'); await pg.waitForTimeout(350) }
  await pg.waitForSelector('#msumDone',{state:'visible',timeout:5000}); await pg.waitForTimeout(400);
  sum=(await txt('#msumBody')).replace(/\s+/g,' ');
  ok(!sum.includes('Deine Wertung'),'Locker: keine Elo-Zeile');
  await pg.click('#msumDone'); await pg.waitForTimeout(500);
  await pg.click('#pcCat button:has-text("Wertung")'); await pg.waitForTimeout(150);

  console.log('== Wertungskarte ==');
  await tab('rank');
  let b=(await txt('#rankBody')).replace(/\s+/g,' ');
  ok(b.includes('Wertung')&&b.includes('1024'),'Einzel 1024');
  ok(b.includes('vorläufig'),'Vorläufig unter 10 Spielen');
  ok(b.includes('noch keine'),'Doppel: noch keine');
  ok((await pg.$$('#rankBody .bzspark')).length===1,'Eine Kurve (Einzel)');
  await pg.click('#rankBody [data-opp] >> nth=0'); await pg.waitForTimeout(400);
  b=(await txt('#rankBody')).replace(/\s+/g,' ');
  ok(b.includes('Elo +24'),'Begegnung zeigt Elo +24');
  ok(b.includes('Elo Einzel 976'),'Gegner-Elo im Direktvergleich (Frank 976)');
  await pg.click('#bzBack'); await pg.waitForTimeout(300);

  console.log('== Rangliste ==');
  await pg.click('#bzRank'); await pg.waitForTimeout(600);
  b=(await txt('#rankBody')).replace(/\s+/g,' ');
  ok(b.includes('Noch niemand'),'Rangliste leer');
  ok(b.includes('Du stehst nicht in der Rangliste'),'Nicht zugestimmt');
  await pg.click('#lbOpt'); await pg.waitForTimeout(300);
  ok((await txt('.dlg')).includes('Alle Nutzer der App sehen'),'Zustimmung erklärt, was sichtbar wird');
  await pg.click('.dlg .dbtns [data-i="1"]'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(()=>!__fake.DB.players.find(p=>p.nickname==='Olli').ranking_opt_in),'Abbrechen: keine Zustimmung');
  await pg.click('#lbOpt'); await pg.waitForTimeout(300); await dlgOk(); await pg.waitForTimeout(400);
  ok(await pg.evaluate(()=>__fake.DB.players.find(p=>p.nickname==='Olli').ranking_opt_in),'Zugestimmt');
  ok((await txt('#rankBody')).includes('Noch niemand'),'Unter 10 Spielen noch nicht drin');

  console.log('== Zehn Spiele ==');
  await tab('play');
  for(let i=0;i<9;i++) await quick(1);
  await tab('rank');
  b=(await txt('#rankBody')).replace(/\s+/g,' ');
  ok(!b.includes('vorläufig'),'Nach 10 Spielen nicht mehr vorläufig');
  await pg.click('#bzRank'); await pg.waitForTimeout(700);
  ok((await pg.$$('#rankBody .lbrow')).length===1,'Jetzt in der Rangliste');
  ok((await pg.$$('#rankBody .lbrow.me')).length===1,'Eigene Zeile hervorgehoben');
  ok(!(await txt('#rankBody')).includes('Frank'),'Gast nie in der Rangliste');
  await pg.screenshot({path:path.join(require('os').tmpdir(),'rangliste.png'),fullPage:true});
  await pg.click('#lbKind button:has-text("Doppel")'); await pg.waitForTimeout(600);
  ok((await txt('#rankBody')).includes('Noch niemand'),'Doppel-Rangliste leer');
  await pg.click('#lbKind button:has-text("Einzel")'); await pg.waitForTimeout(600);
  await pg.click('#lbOpt'); await pg.waitForTimeout(700);
  ok((await pg.$$('#rankBody .lbrow')).length===0,'Widerruf: sofort raus, ohne Rückfrage');
  await pg.click('#bzBack'); await pg.waitForTimeout(300);
  await pg.screenshot({path:path.join(require('os').tmpdir(),'elo-karte.png'),fullPage:true});

  console.log('== Korrektur rechnet neu ==');
  const before=await pg.evaluate(()=>Math.round(__fake.DB.ratings.find(r=>r.kind==='single'&&__fake.DB.players.find(p=>p.id===r.player_id).nickname==='Olli').rating));
  await tab('play');
  await pg.click('#pRecent .mrow >> nth=0'); await pg.waitForTimeout(700);
  ok((await pg.$('#lobFix'))!==null,'Korrektur-Knopf im letzten Spiel');
  {
    await pg.click('#lobFix'); await pg.waitForTimeout(300); await dlgOk(); await pg.waitForTimeout(700);
    const mid=await pg.evaluate(()=>{const ms=__fake.DB.matches.filter(m=>m.state==='running');return ms.length});
    ok(mid===1,'Spiel wieder offen');
    const after=await pg.evaluate(()=>Math.round(__fake.DB.ratings.find(r=>r.kind==='single'&&__fake.DB.players.find(p=>p.id===r.player_id).nickname==='Olli').rating));
    ok(after<before,'Wieder aufgenommen: Elo ohne dieses Spiel ('+before+' → '+after+')');
  }

  const bad=errs.filter(e=>!/Failed to fetch|ERR_|favicon/i.test(e));
  if(bad.length) console.log(bad.join('\n'));
  ok(!bad.length,'Keine Browser-Fehler');
  await br.close(); srv.close();
  console.log(fails?'\n'+fails+' FEHLER':'\nALLE OK');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
