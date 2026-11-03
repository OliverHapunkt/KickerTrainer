/* Test der Kamera-Probe (Labor): Auswertung mit künstlichen Bildfolgen im Terminal, dazu Browser mit dem Fake-Video von Chromium.
   Der Browserteil prüft die Kette (Freischalten, Kamera, Messung, Schuss, Auswertung), NICHT ob echte Tischbilder taugen. */
const vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={};vm.createContext(ctx);
const src=fs.readFileSync(path.resolve(__dirname,'../js/lab.js'),'utf8');
vm.runInContext(src.slice(0,src.indexOf('/* ---------- Anbindung'))+';this.LAB=LAB;this.labAnalyze=labAnalyze;',ctx);
const {LAB,labAnalyze}=ctx;
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};
let seed=3;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};

/* Bildfolge: Rauschen ~0,5, optional Ball (Streifen s, Stärke) kurz nach dem Schuss, Wackeln (alle Streifen) */
function frames({fps=30,secs=3,shot=2000,ball=null,shake=0}={}){
  const out=[];for(let t=0;t<secs*1000;t+=1000/fps){
    const a=[0,0,0,0,0].map(()=>.3+rnd()*.5);
    if(ball&&t>=shot+ball.at&&t<shot+ball.at+ball.len)a[ball.s-1]+=ball.v*(.7+rnd()*.3);
    if(shake&&t>=shot&&t<shot+120)a.forEach((_,i)=>a[i]+=shake*(.7+rnd()*.3));
    out.push({t,a,g:a.reduce((p,c)=>p+c,0)/5})}
  return out}
console.log('== Auswertung ==');
for(const s of [1,2,3,4,5]){const r=labAnalyze(frames({ball:{s,v:12,at:60,len:70}}),2000);ok(r.pick===s&&r.clear,'Ball in Streifen '+s+': erkannt, eindeutig ('+r.pick+', Abstand '+r.margin.toFixed(1)+')')}
let r=labAnalyze(frames({fps:60,ball:{s:4,v:10,at:50,len:40}}),2000);ok(r.pick===4&&r.n>=30,'60 fps: '+r.n+' Bilder im Fenster, Streifen 4');
r=labAnalyze(frames({fps:30,ball:{s:2,v:10,at:90,len:34}}),2000);ok(r.pick===2&&r.n>=15&&r.n<=20,'30 fps, Ball nur in ~1 Bild sichtbar: trotzdem erkannt ('+r.n+' Bilder)');
r=labAnalyze(frames({fps:30,ball:{s:2,v:10,at:200,len:40}}),2000);ok(r.pick===2,'Ball erst 200 ms nach dem Schuss: noch im Fenster');
r=labAnalyze(frames({fps:30,ball:{s:2,v:10,at:700,len:30}}),2000);ok(r.pick===0,'Ball erst 700 ms später: nicht mehr im Fenster, nichts erkannt');
r=labAnalyze(frames(),2000);ok(r.pick===0&&!r.clear,'Kein Ball (Schuss daneben): „nichts“');
r=labAnalyze(frames({shake:6}),2000);ok(!r.clear,'Wackeln des Tisches (alle Streifen gleich): nie „eindeutig“ (Abstand '+r.margin.toFixed(2)+')');
r=labAnalyze(frames({ball:{s:3,v:10,at:60,len:70},shake:6}),2000);ok(r.pick===3,'Ball plus Wackeln: Streifen 3 gewinnt trotzdem (Abstand '+r.margin.toFixed(2)+')');
{const f=frames({ball:{s:1,v:8,at:60,len:70}});f.forEach(x=>{if(x.t>=2060&&x.t<2130)x.a[2]+=7.5});r=labAnalyze(f,2000);ok(r.pick>0&&!r.clear,'Zwei fast gleiche Streifen: Ergebnis „unsicher“ ('+r.margin.toFixed(2)+')')}
r=labAnalyze(frames({secs:1,shot:500}).filter(f=>f.t<400),2000);ok(r.pick===0&&r.n===0,'Keine Bilder im Fenster (Kamera hängt): nichts erkannt, kein Absturz');

(async()=>{
  const {chromium}=require('playwright');const http=require('http');
  const ROOT=path.resolve(__dirname,'..'),MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
  const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';try{const b=fs.readFileSync(path.join(ROOT,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});
  await new Promise(r=>srv.listen(8129,'127.0.0.1',r));
  const br=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const cx=await br.newContext({viewport:{width:390,height:844},permissions:['camera','microphone']});const pg=await cx.newPage();const errs=[];
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message+' '+(e.stack||'').split('\n').slice(1,3).join('|')));pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
  await pg.addInitScript(()=>localStorage.setItem('kt2_settings',JSON.stringify({onb:true,mode:'train',voiceOut:false,cal:{a:.05,m:null,at:Date.now(),qa:9,qm:0}})));
  await pg.goto('http://127.0.0.1:8129/',{waitUntil:'networkidle'});await pg.waitForTimeout(500);
  console.log('== Freischalten ==');
  await pg.evaluate(()=>go('settings'));
  ok(await pg.isHidden('#btnLab'),'Ohne Freischalten gibt es keinen Labor-Knopf');
  for(let i=0;i<6;i++)await pg.click('#appVer');
  ok(await pg.isHidden('#lab'),'6× tippen reicht nicht');
  await pg.click('#appVer');
  ok(await pg.isVisible('#lab'),'7× auf die Versionsnummer öffnet das Labor');
  await pg.evaluate(()=>go('settings'));ok(await pg.isVisible('#btnLab'),'Danach gibt es in den Einstellungen den Knopf „Labor“');
  ok(await pg.evaluate(()=>!!S.lab),'… und das Freischalten bleibt gespeichert');
  await pg.evaluate(()=>{lab.taps=0;lab.tapT=0});
  await pg.click('#btnLab');
  console.log('== Kamera ==');
  await pg.evaluate(()=>{window.__sy={knocks:[]};const SR=48000;
    window.__hook=()=>{mic.an.getFloatTimeDomainData=function(buf){const now=performance.now(),n=buf.length,ks=__sy.knocks.filter(k=>now-k.t<400);__sy.knocks=ks;
      for(let i=0;i<n;i++){const t=now-(n-1-i)/SR*1000;let v=(Math.random()*2-1)*.0052;for(const k of ks)if(t>=k.t)v+=(Math.random()*2-1)*k.p*Math.exp(-(t-k.t)/12);buf[i]=v}}};
    window.__knock=()=>__sy.knocks.push({t:performance.now(),p:.4})});
  await pg.click('#btnLabCam');
  await pg.waitForFunction(()=>lab.on&&mic.on&&lab.fr.length>5,null,{timeout:10000});
  await pg.evaluate(()=>__hook());
  ok((await pg.textContent('#btnLabCam'))==='Kamera aus','Knopf wechselt auf „Kamera aus“');
  await pg.waitForTimeout(1500);
  const info=await pg.textContent('#labInfo');ok(/Bilder\/s/.test(info)&&/angefragt 60 fps/.test(info),'Info zeigt Auflösung und gemessene Bildrate ('+info.trim()+')');
  ok(await pg.evaluate(()=>lab.fps>5),'Bildrate gemessen ('+(await pg.evaluate(()=>lab.fps.toFixed(1)))+' Bilder/s)');
  ok(await pg.evaluate(()=>lab.fr.length>5&&lab.fr.every(f=>f.a.length===5)),'Pro Bild werden 5 Streifenwerte gemessen');
  await pg.click('#labFps .chip:has-text("30")');await pg.waitForTimeout(800);
  ok((await pg.textContent('#labInfo')).includes('angefragt 30 fps'),'Umstellen auf 30 fps startet die Kamera neu');
  await pg.waitForFunction(()=>lab.on&&lab.fr.length>5);await pg.evaluate(()=>__hook());
  console.log('== Schuss ==');
  await pg.waitForTimeout(1200);await pg.evaluate(()=>__knock());
  await pg.waitForFunction(()=>lab.shots.length===1&&lab.shots[0].res,null,{timeout:4000});
  const sh=await pg.evaluate(()=>({n:lab.shots[0].res.n,pick:lab.shots[0].res.pick}));
  ok(sh.n>3,'Schuss gehört, Auswertung hat '+sh.n+' Bilder im Fenster');
  ok(await pg.isVisible('#labTruth'),'Danach erscheint die Frage „wohin?“ (1–5, daneben)');
  await pg.click('#labTruth button[data-v="3"]');
  ok((await pg.evaluate(()=>lab.shots[0].truth))===3&&/Segment richtig: [01] von 1/.test(await pg.textContent('#labSum')),'Wahrheit eingetragen, Zusammenfassung zählt');
  ok(await pg.isHidden('#labTruth'),'Ohne offenen Schuss sind die Knöpfe wieder weg');
  const txt=await pg.evaluate(()=>labText());ok(/#1 wahr 3 erkannt/.test(txt)&&txt.includes('Kamera-Probe '+(await pg.evaluate(()=>APP_VERSION))),'Ergebnis-Text zum Kopieren enthält Schuss und Version');
  console.log('== Ausschnitt ==');
  await pg.fill('#labSr input','60');await pg.waitForTimeout(100);
  ok((await pg.evaluate(()=>lab.roi.r))===60,'Regler verschiebt den Ausschnitt (rechts 60 %)');
  console.log('== Aus ==');
  await pg.click('#btnLabBack');
  ok(await pg.evaluate(()=>!lab.on&&!lab.stream&&!mic.on),'Zurück: Kamera und Mikrofon sind aus');
  ok(!errs.length,'Keine Browser-Fehler'+(errs.length?': '+errs.join(' | '):''));
  await br.close();srv.close();
  console.log(fails?'\nFEHLGESCHLAGEN: '+fails:'\nALLE OK');process.exit(fails?1:0);
})();
