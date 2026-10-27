const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');   // Repo-Wurzel
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  try{const b=fs.readFileSync(path.join(ROOT,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});
let fails=0; const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m); if(!c)fails++};
(async()=>{
  await new Promise(r=>srv.listen(8116,'127.0.0.1',r));
  const br=await chromium.launch();
  const ctx=await br.newContext({viewport:{width:375,height:667}});
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
  for(const [file,title] of [['impressum.html','Impressum'],['datenschutz.html','Datenschutz']]){
    await pg.goto('http://127.0.0.1:8116/'+file,{waitUntil:'networkidle'});
    const t=await pg.title();
    ok(t.includes(title), file+': Titel „'+t+'“');
    const ov=await pg.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
    ok(!ov, file+': kein waagerechtes Scrollen bei 375px');
    const css=await pg.evaluate(()=>getComputedStyle(document.body).backgroundColor);
    ok(css==='rgb(14, 16, 19)', file+': Stylesheet greift ('+css+')');
    const back=await pg.getAttribute('.back','href');
    ok(back==='./', file+': Rücklink zur App');
    await pg.screenshot({path:path.join(require('os').tmpdir(), file.replace('.html','')+'.png'),fullPage:false});
  }
  // Querverlinkung
  await pg.goto('http://127.0.0.1:8116/impressum.html',{waitUntil:'networkidle'});
  await pg.click('a[href="datenschutz.html"]'); await pg.waitForTimeout(300);
  ok((await pg.title()).includes('Datenschutz'),'Impressum verlinkt auf Datenschutz');
  await pg.click('a[href="impressum.html"] >> nth=0'); await pg.waitForTimeout(300);
  ok((await pg.title()).includes('Impressum'),'Datenschutz verlinkt zurück');

  // Inhaltliche Pflichtstücke
  await pg.goto('http://127.0.0.1:8116/datenschutz.html',{waitUntil:'networkidle'});
  const d=(await pg.textContent('main')).replace(/\s+/g,' ');
  for(const s of ['GitHub Pages','Supabase','Region EU','jsDelivr','Gelöschter Spieler',
                  'Art. 17 Abs. 3','keine Cookies','kt2_play','Beschwerderecht','Auftragsverarbeitung'])
    ok(d.includes(s),'Datenschutz nennt: '+s);
  ok(d.includes('ausschließlich dein Nickname'),'Datenschutz: nur der Nickname ist sichtbar');
  ok(!/o\.huebel|googlemail/i.test(d),'Keine echte E-Mail-Adresse eingetragen');

  await pg.goto('http://127.0.0.1:8116/impressum.html',{waitUntil:'networkidle'});
  const i=(await pg.textContent('main')).replace(/\s+/g,' ');
  ok(i.includes('VORNAME NACHNAME')&&i.includes('Noch auszufüllen'),'Impressum: Platzhalter deutlich markiert');
  ok(!/o\.huebel|googlemail/i.test(i),'Impressum: keine echte E-Mail eingetragen');
  ok(!/Bundeswehr|Planungsamt/i.test(i+d),'Kein Bezug zum Arbeitgeber');

  // Verlinkung aus der App
  await pg.goto('http://127.0.0.1:8116/',{waitUntil:'networkidle'}); await pg.waitForTimeout(700);
  await pg.evaluate(()=>{document.querySelectorAll('.overlay.dlg').forEach(e=>e.remove());S.onb=true;saveS();go('settings')});
  await pg.waitForTimeout(300);
  ok(await pg.isVisible('a[href="impressum.html"]'),'App verlinkt das Impressum');
  ok(await pg.isVisible('a[href="datenschutz.html"]'),'App verlinkt den Datenschutz');
  const h=await pg.evaluate(()=>{const a=document.querySelector('a[href="impressum.html"]');return Math.round(a.getBoundingClientRect().height)});
  ok(h>=44,'Links sind groß genug zum Treffen ('+h+'px)');
  await pg.click('a[href="impressum.html"]'); await pg.waitForTimeout(500);
  ok((await pg.title()).includes('Impressum'),'Aus der App ins Impressum');

  console.log(errs.length?'\nFEHLER:\n'+errs.join('\n'):'\nKeine Browser-Fehler');
  console.log(fails?'FEHLGESCHLAGEN: '+fails:'ALLE OK');
  await br.close(); srv.close(); process.exit(fails||errs.length?1:0);
})();
