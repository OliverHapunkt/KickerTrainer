/* Browsertest: Spielregeln, Vorlagen, Seitenwechsel, Regeln ändern, Lobby Einzel/Doppel, Live-Stand, Stand-Kennzeichen.
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
  await new Promise(r=>srv.listen(8133,'127.0.0.1',r));
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
    await pg.goto('http://127.0.0.1:8133/',{waitUntil:'networkidle'});
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




  const score=async()=>(await txt('#mScore')).replace(/\s/g,'');
  const tapTeam=async(t,n=1)=>{ for(let i=0;i<n;i++){ await pg.click('#mArea [data-team="'+t+'"] >> nth=0'); await pg.waitForTimeout(300) } };

  console.log('== Regeln einstellen und als Vorlage speichern ==');
  await asUser(BB); await setNick('Basti');
  await asUser(HOST); await setNick('Olli');
  await pg.click('#pcMode button:has-text("Einzel")'); await pg.waitForTimeout(150);
  await pg.click('#pcDetail button:has-text("Einfach")'); await pg.waitForTimeout(150);
  await pg.fill('#pcGps input','3'); await pg.waitForTimeout(100);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  ok((await txt('#pRulesTog')).includes('Ein Tor reicht'),'Regeln zugeklappt mit Zusammenfassung');
  await pg.click('#pRulesTog'); await pg.waitForTimeout(200);
  ok((await pg.$('#pRules'))!==null,'Aufgeklappt');
  await pg.click('#pRules [data-k="lead"] button:has-text("Entscheid")'); await pg.waitForTimeout(200);
  ok((await pg.$('#pRules [data-k="cap"]'))!==null,'Obergrenze erscheint mit Vorsprung');
  ok((await txt('#pRulesTog')).includes('2 Tore Vorsprung im Entscheidungssatz'),'Zusammenfassung aktualisiert');
  await pg.click('#pcPreSave'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput','Kneipe'); await dlgOk();
  ok((await pg.$$('#pcPreset [data-pre]')).length===1,'Vorlage „Kneipe“ angelegt');
  ok((await pg.$eval('#pcPreset [data-pre]',b=>b.classList.contains('on'))),'…und aktiv markiert');
  await pg.click('#pRules [data-k="lead"] button:has-text("Nein")'); await pg.waitForTimeout(200);
  await pg.click('#pcStw button:has-text("2 Gewinnsätze")'); await pg.waitForTimeout(200);
  ok(!(await pg.$eval('#pcPreset [data-pre]',b=>b.classList.contains('on'))),'Nach Änderung nicht mehr aktiv');
  await pg.click('#pcPreset [data-pre]'); await pg.waitForTimeout(300);
  ok((await txt('#pRulesTog')).includes('Entscheidungssatz')&&(await pg.$eval('#pcStw .chip.on',b=>b.textContent))==='Nur ein Satz','Vorlage stellt alles wieder her');

  console.log('== Zwei Tore Vorsprung beim Zählen ==');
  await newGuestInSlot(1,'Frank');
  await pg.click('#pStart'); await pg.waitForTimeout(500);
  await tapTeam(1,2); await tapTeam(2,2); await tapTeam(1,1);
  ok((await score())==='3:2' && !(await vis('msummary')),'3:2 läuft weiter (Entscheidungssatz, +2)');
  ok(await pg.evaluate(()=>__fake.DB.matches.slice(-1)[0].state==='running'),'Server: läuft');
  await tapTeam(1,1); await pg.waitForTimeout(500);
  ok(await vis('msummary'),'4:2 beendet');
  let sum=(await txt('#msumBody')).replace(/\s+/g,' ');
  ok(sum.includes('2 Tore Vorsprung'),'Auswertung nennt die Regeln');
  await pg.click('#msumDone'); await pg.waitForTimeout(500);

  console.log('== Seitenwechsel ==');
  await pg.click('#pStart'); await pg.waitForTimeout(500);
  const names=async()=>pg.$$eval('#mArea .ptile b',b=>b.map(x=>x.textContent));
  ok((await names()).join('|')==='Team 1|Team 2','Team 1 links');
  await tapTeam(1,1);
  ok((await score())==='1:0','1:0');
  await pg.click('#mFlip'); await pg.waitForTimeout(200);
  ok((await names()).join('|')==='Team 2|Team 1','Nach ⇆: Team 2 links');
  ok((await score())==='0:1','Stand folgt den Seiten');
  await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(400);   // links = Team 2
  ok(await pg.evaluate(()=>{const s=__fake.DB.match_sets.slice(-1)[0];return s.score1===1&&s.score2===1}),'Tipp links zählt jetzt für Team 2');

  console.log('== Regeln im Spiel ändern ==');
  await pg.click('#mRules'); await pg.waitForTimeout(300);
  ok((await pg.$('.dlg [data-f="mode"]'))===null,'Im Spiel kein Einzel/Doppel');
  await pg.click('.dlg [data-f="rules"] [data-k="draw"] button:nth-child(2)'); await pg.waitForTimeout(200);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(600);
  ok((await toast()).includes('Regeln geändert'),'Geändert');
  ok(await pg.evaluate(()=>__fake.DB.matches.slice(-1)[0].draw_at===2),'Remis bei 2:2 gesetzt');

  console.log('== Unentschieden ==');
  await tapTeam(1,1); await tapTeam(2,1); await pg.waitForTimeout(600);   // 2:2
  ok(await vis('msummary'),'2:2 im Entscheidungssatz beendet das Spiel');
  sum=(await txt('#msumBody')).replace(/\s+/g,' ');
  ok(sum.includes('Unentschieden'),'Auswertung: Unentschieden');
  ok(await pg.evaluate(()=>__fake.DB.match_sets.slice(-1)[0].winner_team===0),'Satz mit Sieger 0');
  await pg.click('#msumDone'); await pg.waitForTimeout(500);

  console.log('== Änderung, die rückwirkend entscheiden würde ==');
  await pg.click('#pStart'); await pg.waitForTimeout(500);
  await pg.click('#mRules'); await pg.waitForTimeout(300);
  await pg.click('.dlg [data-f="rules"] [data-k="draw"] button:has-text("Nein")'); await pg.waitForTimeout(150);
  await pg.click('.dlg [data-f="stw"] button:has-text("2 Sätze")'); await pg.waitForTimeout(150);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(600);
  ok(await pg.evaluate(()=>__fake.DB.matches.slice(-1)[0].sets_to_win===2),'Auf 2 Gewinnsätze umgestellt');
  await tapTeam(1,3); await pg.waitForTimeout(400);
  ok(/Sätze\s*1\s*:\s*0/.test(await txt('#mHead')),'Satz 1 gewonnen, Satzanzeige 1 : 0');
  await pg.click('#mRules'); await pg.waitForTimeout(300);
  await pg.click('.dlg [data-f="stw"] button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(600);
  ok((await toast()).includes('schon entschieden'),'Abgelehnt: Spiel wäre schon entschieden');
  ok(await pg.evaluate(()=>{const m=__fake.DB.matches.slice(-1)[0];return m.state==='running'&&m.sets_to_win===2}),'Nichts geändert, läuft weiter');
  await tapTeam(1,3); await pg.waitForTimeout(600);
  await pg.click('#msumDone'); await pg.waitForTimeout(500);

  console.log('== Bilanz zeigt das Remis ==');
  await tab('rank');
  const bb=(await txt('#rankBody')).replace(/\s+/g,' ');
  ok(bb.includes('Siege – Remis – Niederlagen'),'Übersicht mit Remis');
  ok((await pg.$$('#rankBody .bzform i.d')).length===1,'Form zeigt ein U');
  await tab('play');

  console.log('== Historie: Stand sichtbar ==');
  ok((await pg.$$('#pRecent .stbadge.ok')).length>=3,'Gast-Spiele als ✓ bestätigt markiert');

  console.log('== Lobby: Doppel → Einzel, Live-Stand für Mitspieler ==');
  await pg.click('#pcMode button:has-text("Doppel")'); await pg.waitForTimeout(150);
  await pg.click('#pcInvite button:has-text("Per Code")'); await pg.waitForTimeout(250);
  await pg.click('#pLobby'); await pg.waitForTimeout(800);
  const code=(await txt('.codecard .code')).trim();
  ok((await txt('#lobBody')).includes('Doppel'),'Lobby ist Doppel');
  await pg.click('#lobRules'); await pg.waitForTimeout(300);
  await pg.click('.dlg [data-f="mode"] button:has-text("Einzel")'); await pg.waitForTimeout(200);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(700);
  ok((await txt('#lobBody')).includes('Einzel'),'Auf Einzel umgestellt');
  ok(await pg.evaluate(()=>__fake.DB.matches.slice(-1)[0].mode==='single'),'Server: Einzel');
  ok((await pg.$$('#lobBody .lrow.empty')).length===1,'Nur noch ein freier Platz');
  await asUser(BB);
  await pg.click('#pJoinBtn'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput',code); await dlgOk();
  ok((await txt('#lobBody')).includes('Einzel'),'Basti sieht Einzel und die Regeln');
  await asUser(HOST);
  await pg.click('#pResume'); await pg.waitForTimeout(800);
  await pg.click('#lobStart'); await pg.waitForTimeout(900);
  await tapTeam(1,1); await pg.waitForTimeout(400);
  await asUser(BB);
  await pg.click('#pResume'); await pg.waitForTimeout(1200);
  let lv=(await txt('#lobBody')).replace(/\s+/g,' ');
  ok(lv.includes('live')&&lv.includes('1 : 0'),'Mitspieler sieht den Stand live: 1 : 0');
  await pg.evaluate(()=>{const s=__fake.DB.match_sets.slice(-1)[0];s.score1=2;__fake.persist()});
  await pg.waitForTimeout(4800);
  lv=(await txt('#lobBody')).replace(/\s+/g,' ');
  ok(lv.includes('2 : 0'),'…und aktualisiert sich von selbst');

  const bad=errs.filter(e=>!/Failed to fetch|ERR_|favicon/i.test(e));
  if(bad.length) console.log(bad.join('\n'));
  ok(!bad.length,'Keine Browser-Fehler');
  await br.close(); srv.close();
  console.log(fails?'\n'+fails+' FEHLER':'\nALLE OK');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
