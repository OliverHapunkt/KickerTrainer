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



  const dbState=()=>pg.evaluate(()=>{const m=__fake.DB.matches.slice(-1)[0];return m&&m.state});
  const myElo=k=>pg.evaluate(k=>{const me=__fake.DB.players.find(p=>p.nickname==='Olli');
    const r=__fake.DB.ratings.find(x=>x.player_id===me.id&&x.kind===k);return r?Math.round(r.rating):null},k);

  console.log('== Spiel gegen Gast zählt nicht (Option A) ==');
  await asUser(BB);
  await setNick('Basti');
  await asUser(HOST);
  await setNick('Olli');
  await pg.click('#pcMode button:has-text("Einzel")'); await pg.waitForTimeout(150);
  await pg.click('#pcDetail button:has-text("Einfach")'); await pg.waitForTimeout(150);
  await pg.fill('#pcGps input','3'); await pg.waitForTimeout(100);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  await newGuestInSlot(1,'Frank');
  await pg.click('#pStart'); await pg.waitForTimeout(500);
  for(let i=0;i<3;i++){ await pg.click('#mArea [data-team="1"] >> nth=0'); await pg.waitForTimeout(350) }
  await pg.waitForSelector('#msumDone',{state:'visible',timeout:5000}); await pg.waitForTimeout(400);
  let sum=(await txt('#msumBody')).replace(/\s+/g,' ');
  ok(sum.includes('bestätigt und wertbar'),'Gast-Spiel ist bestätigt');
  ok(!sum.includes('Deine Wertung'),'…aber keine Elo-Änderung');
  ok(sum.includes('Zählt nicht für die Wertung'),'Auswertung erklärt, warum nicht');
  ok((await myElo('single'))===null,'Keine Wertung entstanden');
  await pg.click('#msumDone'); await pg.waitForTimeout(500);

  console.log('== Konto gegen Konto: zählt nach Bestätigung ==');
  await pg.click('#pcInvite button:has-text("Per Code")'); await pg.waitForTimeout(250);
  await pg.click('#pLobby'); await pg.waitForTimeout(800);
  const code=(await txt('.codecard .code')).trim();
  await asUser(BB);
  await pg.click('#pJoinBtn'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput',code); await dlgOk();
  ok(await vis('lobby'),'Basti ist in der Lobby');
  await asUser(HOST);
  await pg.click('#pResume'); await pg.waitForTimeout(800);
  await pg.click('#lobStart'); await pg.waitForTimeout(900);
  for(let i=0;i<3;i++){ await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(350) }
  await pg.waitForSelector('#msumDone',{state:'visible',timeout:5000}); await pg.waitForTimeout(400);
  sum=(await txt('#msumBody')).replace(/\s+/g,' ');
  ok(sum.includes('wartet auf Bestätigung')&&!sum.includes('Deine Wertung'),'Vor der Bestätigung: noch kein Elo');
  await pg.click('#msumDone'); await pg.waitForTimeout(500);
  await asUser(BB);
  await pg.waitForSelector('#pTodo .card',{timeout:5000});
  await pg.click('#pTodo [data-conf]'); await pg.waitForTimeout(900);
  await pg.click('#lobOk'); await pg.waitForTimeout(400); await dlgOk(); await pg.waitForTimeout(500);
  ok((await dbState())==='confirmed','Basti hat bestätigt');
  ok((await myElo('single'))===1024,'Olli 1024');

  console.log('== Wertungskarte ==');
  await asUser(HOST);
  await tab('rank');
  let b=(await txt('#rankBody')).replace(/\s+/g,' ');
  ok(b.includes('1024'),'Einzel 1024');
  ok(b.includes('vorläufig'),'Vorläufig unter 10 Spielen');
  ok(b.includes('noch keine'),'Doppel: noch keine');
  ok((await pg.$$('#rankBody .bzspark')).length===1,'Eine Kurve (Einzel)');
  ok(b.includes('Basti')&&b.includes('Frank'),'Bilanz führt beide Gegner (auch den Gast)');
  await pg.click('#rankBody [data-opp]:has-text("Basti")'); await pg.waitForTimeout(400);
  b=(await txt('#rankBody')).replace(/\s+/g,' ');
  ok(b.includes('Elo +24'),'Begegnung zeigt Elo +24');
  ok(b.includes('Elo Einzel 976'),'Gegner-Elo im Direktvergleich (Basti 976)');
  ok(b.includes('✓'),'Begegnung als bestätigt gekennzeichnet');
  await pg.click('#bzBack'); await pg.waitForTimeout(300);

  console.log('== Rangliste ==');
  await pg.click('#bzRank'); await pg.waitForTimeout(600);
  b=(await txt('#rankBody')).replace(/\s+/g,' ');
  ok(b.includes('Noch niemand'),'Rangliste leer');
  await pg.click('#lbOpt'); await pg.waitForTimeout(300);
  ok((await txt('.dlg')).includes('Alle Nutzer der App sehen'),'Zustimmung erklärt, was sichtbar wird');
  await pg.click('.dlg .dbtns [data-i="1"]'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(()=>!__fake.DB.players.find(p=>p.nickname==='Olli').ranking_opt_in),'Abbrechen: keine Zustimmung');
  await pg.click('#lbOpt'); await pg.waitForTimeout(300); await dlgOk(); await pg.waitForTimeout(400);
  ok(await pg.evaluate(()=>__fake.DB.players.find(p=>p.nickname==='Olli').ranking_opt_in),'Zugestimmt');
  ok((await txt('#rankBody')).includes('Noch niemand'),'Unter 10 Spielen noch nicht drin');

  console.log('== Neun weitere Spiele gegen Basti (direkt eingespielt) ==');
  await pg.evaluate(()=>{const D=__fake.DB, o=D.players.find(p=>p.nickname==='Olli'), b=D.players.find(p=>p.nickname==='Basti');
    for(let i=0;i<9;i++){const id='seed-'+i, t=new Date(Date.now()+(i+1)*60000).toISOString();
      D.matches.push({id,host_id:o.id,mode:'single',detail:'simple',goals_per_set:3,sets_to_win:1,state:'confirmed',category:'ranked',
        started_at:t,finished_at:t,rev:1,win_by:1,win_by_scope:'decider',goal_cap:null,draw_at:null});
      D.match_players.push({match_id:id,player_id:o.id,team:1,is_host:true},{match_id:id,player_id:b.id,team:2,is_host:false});
      D.match_sets.push({match_id:id,set_no:1,score1:3,score2:i%3?1:2,winner_team:1})}
    __fake.recompute()});
  await tab('play'); await tab('rank');
  b=(await txt('#rankBody')).replace(/\s+/g,' ');
  ok(!(await pg.textContent('#rankBody .bzelo > div:first-child')).includes('vorläufig'),'Einzel-Kachel nicht mehr vorläufig');
  await pg.click('#bzRank'); await pg.waitForTimeout(700);
  ok((await pg.$$('#rankBody .lbrow')).length===1,'Jetzt in der Rangliste');
  ok((await pg.$$('#rankBody .lbrow.me')).length===1,'Eigene Zeile hervorgehoben');
  ok(!(await txt('#rankBody')).includes('Frank'),'Gast nie in der Rangliste');
  await pg.screenshot({path:path.join(require('os').tmpdir(),'rangliste.png'),fullPage:true});
  await pg.click('#lbOpt'); await pg.waitForTimeout(700);
  ok((await pg.$$('#rankBody .lbrow')).length===0,'Widerruf: sofort raus, ohne Rückfrage');

  const bad=errs.filter(e=>!/Failed to fetch|ERR_|favicon/i.test(e));
  if(bad.length) console.log(bad.join('\n'));
  ok(!bad.length,'Keine Browser-Fehler');
  await br.close(); srv.close();
  console.log(fails?'\n'+fails+' FEHLER':'\nALLE OK');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
