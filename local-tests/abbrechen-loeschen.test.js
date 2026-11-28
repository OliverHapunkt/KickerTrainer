/* Browsertest: Abbrechen und Löschen mit Zustimmung (v3.27).
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
  await new Promise(r=>srv.listen(8133,'127.0.0.1',r));
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
    await pg.goto('http://127.0.0.1:8133/',{waitUntil:'networkidle'});
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


  const dlgTitle=()=>pg.textContent('.dlg .dtitle').catch(()=>'');
  const dlgBtn=t=>pg.click('.dlg .dbtns button:has-text("'+t+'")');
  const lastState=()=>DB(()=>{const m=__fake.DB.matches.slice(-1)[0];return m?m.state+(m.end_req?'/'+m.end_req:''):'keins'});

  console.log('== Host gegen Gast: sofort abbrechen ==');
  await asUser(H); await setNick('Olli');
  await pg.click('#pcMode button:has-text("Einzel")'); await pg.waitForTimeout(150);
  await pg.fill('#pcGps input','3'); await pg.waitForTimeout(150);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  await (await pg.$$('#pLineup .slot'))[1].click(); await pg.waitForTimeout(250);
  await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(250);
  await pg.fill('.dlg .dinput','Jan'); await pg.click('.dlg .dbtns [data-i="0"]'); await pg.waitForTimeout(350);
  await pg.click('#pStart'); await pg.waitForTimeout(600);
  await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(400);
  await pg.click('#mEnd'); await pg.waitForTimeout(300);
  ok((await dlgTitle())==='Spiel abbrechen?','Dialog „Spiel abbrechen?“ (niemand muss zustimmen)');
  ok(!(await txt('.dlg')).includes('zustimmen'),'Kein Hinweis auf Zustimmung');
  await dlgBtn('Spiel abbrechen'); await pg.waitForTimeout(600);
  ok((await lastState())==='cancelled','Spiel abgebrochen');
  ok(await vis('play'),'Zurück auf der Spielen-Seite');

  console.log('== Host gegen Gast: beendetes Spiel löschen ==');
  await pg.click('#pStart'); await pg.waitForTimeout(600);
  for(let i=0;i<3;i++){ await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(250) }
  await pg.waitForTimeout(500);
  await pg.click('#msumDone'); await pg.waitForTimeout(600);
  ok((await txt('#pRecent')).includes('Letzte Spiele'),'Spiel in „Letzte Spiele“');
  await pg.click('#pRecent .mrow >> nth=0'); await pg.waitForTimeout(700);
  ok(await pg.isVisible('#lobDel'),'Knopf „Spiel löschen“');
  await pg.click('#lobDel'); await pg.waitForTimeout(300);
  ok((await dlgTitle())==='Spiel löschen?','Dialog „Spiel löschen?“');
  ok((await txt('.dlg')).includes('endgültig weg'),'Hinweis: endgültig, auch Bilanz und Wertung');
  await dlgBtn('Löschen'); await pg.waitForTimeout(700);
  ok(await DB(()=>__fake.DB.matches.filter(m=>m.state!=='cancelled').length===0),'Gelöscht, Abgebrochenes bleibt unsichtbar');
  ok((await toasts()).includes('Spiel gelöscht'),'Meldung „Spiel gelöscht“');

  console.log('== Doppel mit Konten: Lobby, Start ==');
  await pg.click('#pcMode button:has-text("Doppel")'); await pg.waitForTimeout(150);
  await pg.click('#pcInvite button:has-text("Per Code")'); await pg.waitForTimeout(250);
  await pg.click('#pLobby'); await pg.waitForTimeout(800);
  const code=(await txt('.codecard .code')).trim();
  await asUser(B); await setNick('Basti'); await join(code);
  await pg.click('#lobDev [data-dev="own"]'); await pg.waitForTimeout(500);
  await asUser(C); await setNick('Chris'); await join(code);
  await asUser(D); await setNick('Dani'); await join(code);
  await asUser(H); await pg.click('#pResume'); await pg.waitForTimeout(800);
  await pg.click('#lobStart'); await pg.waitForTimeout(900);
  ok(await vis('match'),'Spiel läuft (Olli+Chris gegen Basti+Dani)');

  console.log('== Basti beantragt Abbruch am eigenen Handy ==');
  await asUser(B); await pg.click('#pResume'); await pg.waitForTimeout(1000);
  ok(await vis('mine'),'Basti in der Zählansicht');
  await pg.click('#miEnd'); await pg.waitForTimeout(300);
  ok((await dlgTitle())==='Spiel abbrechen beantragen?','Dialog „… beantragen?“');
  ok((await txt('.dlg')).includes('Olli oder Chris muss zustimmen'),'Nennt, wer zustimmen muss');
  await dlgBtn('Beantragen'); await pg.waitForTimeout(800);
  ok((await lastState())==='running/cancel','Spiel läuft weiter, Anfrage offen');
  ok((await toasts()).includes('Beantragt'),'Meldung „Beantragt“');
  ok((await txt('#miSync')).includes('Abbruch beantragt'),'Zählansicht zeigt die offene Anfrage');

  console.log('== Host lehnt ab ==');
  await asUser(H); await pg.click('#pResume'); await pg.waitForTimeout(800);
  ok((await txt('#mSync')).includes('Basti möchte das Spiel abbrechen'),'Host-Kopfzeile zeigt die Anfrage');
  await pg.waitForTimeout(3300);
  ok((await dlgTitle()).includes('Basti möchte das Spiel abbrechen'),'Host bekommt die Frage als Dialog');
  await dlgBtn('Ablehnen'); await pg.waitForTimeout(800);
  ok((await lastState())==='running','Abgelehnt: Spiel läuft, Anfrage weg');
  ok((await toasts()).includes('Abgelehnt'),'Meldung „Abgelehnt“');

  console.log('== Host beantragt, zieht zurück, beantragt erneut ==');
  await pg.click('#mEnd'); await pg.waitForTimeout(300);
  ok((await txt('.dlg')).includes('Basti oder Dani muss zustimmen'),'Host braucht jetzt auch die Gegenseite');
  await dlgBtn('Beantragen'); await pg.waitForTimeout(800);
  ok((await lastState())==='running/cancel'&&(await txt('#mSync')).includes('wartet auf Zustimmung'),'Beantragt, Kopfzeile wartet');
  await pg.click('#mEnd'); await pg.waitForTimeout(300);
  ok((await dlgTitle())==='Anfrage zurückziehen?','Zweites „Ende“ bietet Zurückziehen');
  await dlgBtn('Zurückziehen'); await pg.waitForTimeout(800);
  ok((await lastState())==='running','Zurückgezogen');
  await pg.click('#mEnd'); await pg.waitForTimeout(300); await dlgBtn('Beantragen'); await pg.waitForTimeout(800);

  console.log('== Dani stimmt über „Warten auf dich“ zu ==');
  await asUser(D); await pg.waitForTimeout(500);
  ok((await txt('#pTodo')).includes('Abbruch beantragt'),'Startseite: „Abbruch beantragt – zustimmen oder ablehnen“');
  await pg.click('#pTodo [data-conf]'); await pg.waitForTimeout(800);
  ok((await txt('#lobBody')).includes('Olli möchte das Spiel abbrechen'),'Lobby-Karte nennt den Antragsteller');
  await pg.click('#lobReqOk'); await pg.waitForTimeout(800);
  ok((await lastState())==='cancelled','Dani stimmt zu: abgebrochen');
  ok((await toasts()).includes('Spiel abgebrochen'),'Meldung „Spiel abgebrochen“');

  console.log('== Beendetes Spiel mit Konto löschen: beide stimmen zu ==');
  await asUser(H);
  await pg.click('#pcMode button:has-text("Einzel")'); await pg.waitForTimeout(150);
  await pg.fill('#pcGps input','3'); await pg.waitForTimeout(150);
  await pg.click('#pcStw button:has-text("Nur ein Satz")'); await pg.waitForTimeout(150);
  await pg.click('#pcInvite button:has-text("Per Code")'); await pg.waitForTimeout(250);
  await pg.click('#pLobby'); await pg.waitForTimeout(800);
  const code2=(await txt('.codecard .code')).trim();
  await asUser(B); await join(code2);
  await asUser(H); await pg.click('#pResume'); await pg.waitForTimeout(800);
  await pg.click('#lobStart'); await pg.waitForTimeout(900);
  for(let i=0;i<3;i++){ await pg.click('#mArea .ptile >> nth=0'); await pg.waitForTimeout(300) }
  await pg.waitForTimeout(600);
  await pg.click('#msumDone'); await pg.waitForTimeout(500);
  const gid=await DB(()=>__fake.DB.matches.slice(-1)[0].id);
  await asUser(B);
  await pg.click('#pTodo [data-conf]'); await pg.waitForTimeout(800);
  await pg.click('#lobOk'); await pg.waitForTimeout(300); await dlgBtn('Bestätigen'); await pg.waitForTimeout(800);
  ok(await DB(()=>__fake.DB.matches.slice(-1)[0].state==='confirmed'),'Spiel bestätigt');
  ok(await DB(()=>__fake.DB.rating_history.length>0),'Elo-Verlauf vorhanden');
  await pg.click('#lobDel'); await pg.waitForTimeout(300);
  ok((await txt('.dlg')).includes('Olli muss zustimmen'),'Löschen braucht Ollis Zustimmung');
  await dlgBtn('Beantragen'); await pg.waitForTimeout(800);
  ok((await lastState())==='confirmed/delete','Löschen beantragt');
  ok((await txt('#lobBody')).includes('Wartet auf die Zustimmung'),'Karte: wartet auf die Gegenseite');
  ok(!(await pg.$('#lobDel')),'Kein zweiter Antrag möglich');
  await asUser(H);
  ok((await txt('#pTodo')).includes('Löschen beantragt'),'Olli sieht die Anfrage auf der Startseite');
  await pg.click('#pTodo [data-conf]'); await pg.waitForTimeout(800);
  ok((await txt('#lobBody')).includes('auch aus Bilanz und Wertung'),'Karte erklärt die Folgen');
  await pg.click('#lobReqOk'); await pg.waitForTimeout(800);
  ok(await DB(id=>!__fake.DB.matches.some(m=>m.id===id)&&!__fake.DB.rating_history.some(r=>r.match_id===id)&&!__fake.DB.goals.some(g=>g.match_id===id),gid),
     'Endgültig weg: Spiel, Tore, Elo-Verlauf');
  ok(await vis('play'),'Zurück auf der Spielen-Seite');

  console.log('== Gelöschtes Spiel noch offen ==');
  await asUser(B);
  await pg.evaluate(id=>pOpenLobby(id), gid); await pg.waitForTimeout(800);
  ok(!(await vis('lobby')),'Gelöschtes Spiel öffnet nicht');

  ok(errs.length===0,'Keine Fehler in der Konsole'+(errs.length?': '+errs.join(' / '):''));
  await br.close(); srv.close();
  console.log(fails?('\n'+fails+' FEHLER'):'\nALLE GRÜN'); process.exit(fails?1:0);
})();
