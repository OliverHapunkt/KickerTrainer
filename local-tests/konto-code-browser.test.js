/* Browsertest: Web-App-Hinweis und Konto mit Nickname + Code (v3.22).
   Die Server-Funktion code-login wird per page.route nachgebildet (ihre Logik
   prüft code-login.test.js), der Supabase-Client durch fake-supabase.js. */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'), HERE=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  const base=p==='/fake-supabase.js'?HERE:ROOT;
  try{const b=fs.readFileSync(path.join(base,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});
let fails=0; const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m); if(!c)fails++};
const URL='http://127.0.0.1:8121/';

// Nachbildung der Server-Funktion
const SRV={accounts:{},n:0,calls:[]};
const DOM='@code.kickertrainer.invalid';
function codeFn(body,auth){
  SRV.calls.push(body.action);
  const tokUser=t=>{const p=String(t||'').replace(/^Bearer /,'').split('|');return p[0]==='fake'?p[1]:null};
  const sess=a=>({access_token:'fake|'+a.uid+'|'+a.email,refresh_token:'r'});
  const nick=String(body.nick||'').trim().toLowerCase();
  switch(body.action){
    case 'signup':{
      if(SRV.accounts[nick])return[409,{error:'nick_taken'}];
      const code='K7PM2X9QFH'+String(++SRV.n).padStart(2,'0').replace(/0/g,'A').replace(/1/g,'B');
      const a={uid:'uid-'+SRV.n,email:'x'+SRV.n+DOM,code};SRV.accounts[nick]=a;return[200,{code,session:sess(a)}]}
    case 'login':{
      const a=SRV.accounts[nick],c=String(body.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      return a&&a.code===c?[200,{session:sess(a)}]:[401,{error:'login_failed'}]}
    case 'regen':{
      const uid=tokUser(auth),a=Object.values(SRV.accounts).find(x=>x.uid===uid);
      if(!a)return[401,{error:'auth'}];a.code='NEWC0DE23456'.replace('0','D');return[200,{code:a.code}]}
    case 'link':{
      const uid=tokUser(auth),a=Object.values(SRV.accounts).find(x=>x.uid===uid);
      if(!a)return[401,{error:'auth'}];a.email=String(body.email_token).split('|')[1];return[200,{email:a.email}]}
  }
  return[400,{error:'action'}]}

(async()=>{
  await new Promise(r=>srv.listen(8121,'127.0.0.1',r));
  const br=await chromium.launch();
  const errs=[];
  const mk=async(opt={})=>{
    const ctx=await br.newContext(Object.assign({viewport:{width:375,height:667}},opt));
    await ctx.addInitScript({path:HERE+'/fake-supabase.js'});
    await ctx.route('**/functions/v1/code-login',async route=>{
      const rq=route.request();
      const [st,j]=codeFn(JSON.parse(rq.postData()||'{}'),rq.headers()['authorization']);
      await route.fulfill({status:st,contentType:'application/json',body:JSON.stringify(j)})});
    const pg=await ctx.newPage();
    pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
    return{ctx,pg}};
  const dlgText=pg=>pg.evaluate(()=>{const d=document.querySelector('.overlay.dlg');return d?d.textContent:''});
  const toastSeen=async(pg,re)=>{for(let i=0;i<20;i++){const t=await pg.evaluate(()=>[...document.querySelectorAll('.toast')].map(x=>x.textContent).join(' | '));if(re.test(t))return t;await pg.waitForTimeout(100)}return''};

  // 1. Erster Aufruf im Browser: Web-App-Hinweis vor der Einführung
  {const{ctx,pg}=await mk();
    await pg.goto(URL,{waitUntil:'networkidle'});await pg.waitForTimeout(700);
    let t=await dlgText(pg);
    ok(/Web-App/.test(t)&&/Home-Bildschirm/.test(t),'Hinweis erscheint beim ersten Aufruf');
    ok(/Erst installieren, dann anmelden/.test(t),'Hinweis: erst installieren, dann anmelden');
    ok(/Android/.test(t)&&/iPhone/.test(t),'Anleitung für iOS und Android');
    await pg.screenshot({path:'/tmp/kt-pwa.png'});
    await pg.click('.overlay.dlg .dbtns button.primary');await pg.waitForTimeout(700);
    t=await dlgText(pg);
    ok(/Zielen und eintragen/.test(t),'danach die Einführung');
    ok(await pg.evaluate(()=>S.pwa===true),'Hinweis als gesehen gemerkt');
    await pg.reload({waitUntil:'networkidle'});await pg.waitForTimeout(700);
    t=await dlgText(pg);
    ok(!/Web-App/.test(t),'beim nächsten Start kein Hinweis mehr');
    await pg.evaluate(()=>{document.querySelectorAll('.overlay.dlg').forEach(e=>e.remove());S.onb=true;saveS();go('settings')});
    await pg.click('#btnPwa');await pg.waitForTimeout(200);
    ok(/Web-App/.test(await dlgText(pg)),'unter Optionen › Hilfe wieder aufrufbar');
    await ctx.close()}

  // 2. iPhone: passende Anleitung zuerst; vom Home-Bildschirm gestartet: kein Hinweis
  {const{ctx,pg}=await mk({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
    await pg.goto(URL,{waitUntil:'networkidle'});await pg.waitForTimeout(700);
    const first=await pg.evaluate(()=>{const e=document.querySelector('.pwahow.on');return e?e.textContent:''});
    ok(/iPhone/.test(first)&&/Teilen/.test(first),'iPhone: iOS-Anleitung hervorgehoben');
    await ctx.close()}
  {const{ctx,pg}=await mk();
    await ctx.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{get:()=>true})});
    await pg.goto(URL,{waitUntil:'networkidle'});await pg.waitForTimeout(700);
    const t=await dlgText(pg);
    ok(!/Web-App/.test(t)&&/Zielen/.test(t),'als App gestartet: kein Hinweis, gleich die Einführung');
    await ctx.close()}

  // 3. Konto mit Code
  const{ctx,pg}=await mk();
  await ctx.addInitScript(()=>{if(!localStorage.getItem('kt2_settings'))localStorage.setItem('kt2_settings',JSON.stringify({onb:true,pwa:true}))});
  await pg.goto(URL,{waitUntil:'networkidle'});await pg.waitForTimeout(400);
  await pg.evaluate(()=>go('settings'));await pg.waitForTimeout(200);
  let t=await pg.textContent('#acOut');
  ok(/Unter 18\?/.test(t)&&/Unter 16\?/.test(t)&&/Eltern/.test(t),'Hinweis zu Alter und Eltern');
  ok(/ab 18/.test(t),'E-Mail-Weg mit „ab 18“ gekennzeichnet');
  await pg.click('#acCodeNew');await pg.waitForTimeout(100);
  ok(await pg.isVisible('#acCNick'),'Schritt Nickname sichtbar');
  ok(/nicht deinen echten/i.test(await pg.textContent('#acCNew')),'Hinweis: nicht den echten Namen');
  await pg.fill('#acCNick','ab');await pg.click('#acCCreate');
  ok(!!await toastSeen(pg,/3 bis 20/),'zu kurzer Nickname abgelehnt');
  await pg.fill('#acCNick','  Kicki  ');await pg.click('#acCCreate');await pg.waitForTimeout(200);
  ok(/Eltern/.test(await dlgText(pg)),'ohne Haken: Hinweis Eltern fragen');
  ok(!SRV.calls.includes('signup'),'ohne Haken nichts angelegt');
  await pg.click('.overlay.dlg .dbtns button');await pg.waitForTimeout(100);
  await pg.check('#acCAge');await pg.click('#acCCreate');await pg.waitForTimeout(300);
  t=await dlgText(pg);
  ok(/Jetzt sichern/.test(t)&&/nur jetzt/.test(t)&&/Screenshot/.test(t),'fette Warnung zum Sichern');
  const shown=await pg.textContent('.codebox');
  ok(/^[A-Z0-9]{3}(-[A-Z0-9]{3}){3}$/.test(shown.trim()),'Code in Dreierblöcken: '+shown);
  ok(/Kicki/.test(t),'Nickname im Code-Dialog');
  ok(await pg.isDisabled('.overlay.dlg .dbtns button'),'Weiter erst nach dem Haken');
  await pg.evaluate(()=>{navigator.clipboard.writeText=()=>Promise.resolve()});
  await pg.click('[data-cc="copy"]');await pg.waitForTimeout(100);
  ok(/Kopiert/.test(await pg.textContent('[data-cc="copy"]')),'Kopieren: Rückmeldung am Knopf');
  await pg.evaluate(()=>{navigator.clipboard.writeText=()=>Promise.reject(new Error('x'))});
  await pg.click('[data-cc="copy"]');await pg.waitForTimeout(100);
  ok(/abschreiben/.test(await pg.textContent('[data-cc="copy"]')),'Kopieren schlägt fehl: Hinweis am Knopf');
  ok(await pg.evaluate(()=>{toast('x');const z=+getComputedStyle([...document.querySelectorAll('.toast')].pop()).zIndex,d=+getComputedStyle(document.querySelector('.overlay.dlg')).zIndex;return z>d}),'Meldungen liegen über Dialogen');
  await pg.waitForTimeout(2400);
  ok(/Kopieren/.test(await pg.textContent('[data-cc="copy"]')),'Knopftext kehrt zurück');
  await pg.screenshot({path:'/tmp/kt-code.png'});
  await pg.mouse.click(5,5);await pg.waitForTimeout(200);
  ok(/Jetzt sichern/.test(await dlgText(pg)),'Tippen daneben schließt den Code-Dialog nicht');
  await pg.check('.overlay.dlg .codeok');
  ok(!(await pg.isDisabled('.overlay.dlg .dbtns button')),'mit Haken: Weiter aktiv');
  await pg.click('.overlay.dlg .dbtns button');await pg.waitForTimeout(600);
  // ggf. Rückfrage „Daten übernehmen“ (keine Daten → keine)
  ok(await pg.isVisible('#acIn'),'angemeldet');
  t=await pg.textContent('#acUser');
  ok(t==='Kicki (mit Code)','Anzeige ohne Platzhalter-Adresse: '+t);
  ok(!(await pg.textContent('#acct')).includes('invalid'),'Platzhalter-Adresse nirgends sichtbar');
  ok(await pg.isVisible('#acLink')&&await pg.isVisible('#acRegen'),'E-Mail hinzufügen und neuer Code angeboten');

  // neuer Code
  await pg.click('#acRegen');await pg.waitForTimeout(100);
  ok(/funktioniert danach nicht mehr/.test(await dlgText(pg)),'Rückfrage vor neuem Code');
  await pg.click('.overlay.dlg .dbtns button.primary');await pg.waitForTimeout(300);
  const newCode=(await pg.textContent('.codebox')).trim();
  ok(newCode!==shown.trim()&&/neuer/i.test(await dlgText(pg)),'neuer Code angezeigt: '+newCode);
  await pg.check('.overlay.dlg .codeok');await pg.click('.overlay.dlg .dbtns button');await pg.waitForTimeout(200);

  // abmelden und wieder anmelden
  await pg.evaluate(()=>signOutLocal());await pg.waitForTimeout(200);
  await pg.click('#acCodeLogin');
  await pg.fill('#acLNick','kicki');await pg.fill('#acLCode',shown.trim());await pg.click('#acLGo');
  ok(!!await toastSeen(pg,/stimmt nicht/),'alter Code abgelehnt');
  await pg.fill('#acLCode',newCode.toLowerCase().replace(/-/g,' '));await pg.click('#acLGo');await pg.waitForTimeout(500);
  ok(await pg.isVisible('#acIn'),'Anmelden mit Nickname + neuem Code (Kleinschreibung, Leerzeichen)');
  ok((await pg.inputValue('#acLCode'))==='','Code-Feld danach geleert');

  // E-Mail hinzufügen
  await pg.click('#acLink');await pg.waitForTimeout(150);
  await pg.fill('.overlay.dlg .dinput','kicki@beispiel.de');await pg.click('.overlay.dlg .dbtns button.primary');await pg.waitForTimeout(300);
  ok(/kicki@beispiel\.de/.test(await dlgText(pg)),'Code an die Adresse geschickt');
  await pg.fill('.overlay.dlg .dinput','123456');await pg.click('.overlay.dlg .dbtns button.primary');await pg.waitForTimeout(500);
  ok(!!await toastSeen(pg,/E-Mail hinzugefügt/),'E-Mail hinzugefügt');
  ok((await pg.textContent('#acUser'))==='kicki@beispiel.de','Anzeige jetzt mit E-Mail');
  ok(!(await pg.isVisible('#acLink')),'„E-Mail hinzufügen“ verschwindet');

  // vergebener Nickname
  await pg.evaluate(()=>signOutLocal());await pg.waitForTimeout(200);
  await pg.click('#acCodeNew');await pg.fill('#acCNick','KICKI');await pg.check('#acCAge');await pg.click('#acCCreate');
  ok(!!await toastSeen(pg,/schon vergeben/),'vergebener Nickname gemeldet');

  // Bildschirmbreite
  const ov=await pg.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  ok(!ov,'kein waagerechtes Scrollen bei 375px');
  await pg.click('#acCancel3');await pg.screenshot({path:'/tmp/kt-acout.png',fullPage:false});
  await pg.evaluate(()=>document.querySelector('#acct').scrollIntoView());await pg.screenshot({path:'/tmp/kt-acout.png'});

  ok(errs.length===0,'Keine Browser-Fehler '+errs.join(' / '));
  await br.close();srv.close();
  console.log(fails?'FEHLER: '+fails:'ALLE OK');process.exit(fails?1:0);
})();
