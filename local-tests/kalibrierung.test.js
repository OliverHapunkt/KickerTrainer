/* Browsertest: Kalibrierung und Schusserkennung im Training, über die ganze Kette.
   Chromium bekommt ein Fake-Mikrofon (nur damit getUserMedia klappt); danach ersetzt der Test, was der Analyser
   liefert, durch künstliche Signale: Grundrauschen, Knalle, Sprechen, und schickt Bewegungsereignisse.
   Geprüft wird also die Programmkette (Messen → Kalibrieren → Schwellen übernehmen → im Training auslösen),
   NICHT wie ein echter Tisch klingt. Das geht nur am Gerät. */
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((rq,rs)=>{let p=rq.url.split('?')[0];if(p==='/')p='/index.html';
  try{const b=fs.readFileSync(path.join(ROOT,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(b)}catch(e){rs.writeHead(404);rs.end()}});
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};

(async()=>{
  await new Promise(r=>srv.listen(8126,'127.0.0.1',r));
  const br=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const ctx=await br.newContext({viewport:{width:390,height:844},permissions:['microphone']});
  const pg=await ctx.newPage();const errs=[];
  pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
  pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
  // Desktop-Chromium hat keinen echten Bewegungssensor (und fragt bei requestPermission nach) – hier durch ein iPhone-ähnliches Ereignis ersetzt.
  await pg.addInitScript(()=>{window.DeviceMotionEvent=class extends Event{constructor(t,i){super(t);Object.assign(this,i||{})}}});
  await pg.addInitScript(()=>localStorage.setItem('kt2_settings',JSON.stringify({onb:true,mode:'train'})));
  await pg.goto('http://127.0.0.1:8126/',{waitUntil:'networkidle'});await pg.waitForTimeout(500);

  // Künstliche Signalquelle einhängen: Mikrofonpuffer und Bewegungssensor
  await pg.evaluate(async()=>{
    S.det='either';await detStart();
    window.__sy={knocks:[],speech:[],jolts:[]};
    const SR=48000;
    mic.an.getFloatTimeDomainData=function(buf){
      const now=performance.now(),n=buf.length,ks=__sy.knocks.filter(k=>now-k.t<400);__sy.knocks=ks;
      for(let i=0;i<n;i++){
        const t=now-(n-1-i)/SR*1000;let v=(Math.random()*2-1)*.0052;                     // Grundrauschen, Effektivwert ≈ 0,003
        for(const k of ks)if(t>=k.t)v+=(Math.random()*2-1)*k.p*Math.exp(-(t-k.t)/12);   // Knall: Rauschstoß, klingt in ~12 ms ab
        for(const s of __sy.speech)if(t>=s.from&&t<=s.to)                                // Sprechen: moduliert, setzt über 60 ms ein
          v+=(Math.random()*2-1)*s.rms*1.732*Math.min(1,(t-s.from)/60)*(.35+.65*Math.abs(Math.sin(2*Math.PI*3.2*t/1000)));
        buf[i]=v;
      }
    };
    setInterval(()=>{const now=performance.now();let j=0;for(const x of __sy.jolts)if(now>=x.t&&now<x.t+20)j=x.a;
      window.dispatchEvent(new DeviceMotionEvent('devicemotion',{accelerationIncludingGravity:{x:(Math.random()-.5)*.02+j,y:0,z:9.8}}))},16);
    window.__shot=(delay,pa,pm)=>{const t=performance.now()+delay;__sy.knocks.push({t,p:pa});if(pm)__sy.jolts.push({t,a:pm});return t};
    renderTest();show('test');
  });

  console.log('== Kalibrierung ==');
  ok((await pg.textContent('#calMsg')).includes('Nicht kalibriert'),'Ausgangslage: nicht kalibriert');
  ok(await pg.isVisible('#rowSens')&&await pg.isVisible('#rowMSens'),'Regler sind sichtbar, solange nicht kalibriert');
  ok(await pg.isHidden('#btnCalReset'),'„Verwerfen“ gibt es noch nicht');
  await pg.click('#btnCal');
  await pg.waitForTimeout(400);
  ok((await pg.textContent('#calMsg')).includes('Ruhe messen'),'Schritt 1: Ruhe messen');
  ok((await pg.textContent('#btnCal'))==='Abbrechen','Knopf wird zu „Abbrechen“');
  await pg.waitForFunction(()=>cal.phase==='shoot',null,{timeout:8000});
  ok((await pg.textContent('#calMsg')).includes('Schuss 1 von 3'),'Schritt 2: Schuss 1 von 3');
  ok(await pg.evaluate(()=>cal.tmpA>=DET.A_MIN&&cal.tmpA<.05),'Messschwelle liegt knapp über der Ruhe (Ton '+(await pg.evaluate(()=>cal.tmpA.toFixed(3)))+')');

  // Drei Schüsse: Abschlag laut/leise gemischt, Einschlag 80 ms später; Erschütterung gleichzeitig
  const kicks=[.34,.22,.40];
  for(let i=0;i<3;i++){
    await pg.evaluate(([p])=>{__shot(250,p,1.2);__shot(330,p*.7,0)},[kicks[i]]);
    await pg.waitForFunction(n=>cal.shots.length>=n||cal.phase==='done',i+1,{timeout:6000});
    if(i<2){ok((await pg.textContent('#calDots')).includes('✓'),'Schuss '+(i+1)+' bekommt ein Häkchen');
      ok((await pg.textContent('#calMsg')).includes('Schuss '+(i+2)+' von 3'),'… und weiter mit Schuss '+(i+2))}
  }
  await pg.waitForFunction(()=>cal.phase==='done',null,{timeout:4000});
  const r=await pg.evaluate(()=>({sum:cal.sum,mot:{on:mot.on,n:mot.n,thr:mot.thr,lvl:mot.lvl},cal:S.cal,det:S.det,mic:S.mic,shots:cal.shots,msg:document.querySelector('#calMsg').textContent,info:document.querySelector('#calInfo').textContent}));
  console.log('     Schüsse:',JSON.stringify(r.shots.map(s=>({a:+s.a.toFixed(3),m:+s.m.toFixed(2)}))),' Schwellen:',JSON.stringify(r.cal),JSON.stringify(r.sum),JSON.stringify(r.mot));
  ok(r.shots.length===3&&r.shots.every(s=>s.a>0&&s.m>0),'Drei Schüsse, jeder mit Ton UND Erschütterung (Abschlag und Einschlag zählen als ein Schuss)');
  const minA=Math.min(...r.shots.map(s=>s.a)),minM=Math.min(...r.shots.map(s=>s.m));
  ok(Math.abs(r.cal.a-Math.max(.012,minA*.4))<.002,'Ton-Schwelle = 40 % des leisesten Schusses');
  ok(Math.abs(r.cal.m-minM*.4)<.02,'Erschütterungs-Schwelle = 40 % des leisesten Rucks');
  ok(r.det==='both','Die App wählt „Ton + Erschütterung“, weil beides klar erkannt wurde');
  ok(r.mic===true,'Schusserkennung ist danach eingeschaltet');
  ok(r.msg.includes('Fertig'),'Anzeige: '+r.msg);
  ok(await pg.isHidden('#rowSens')&&await pg.isHidden('#rowMSens'),'Handregler verschwinden nach der Kalibrierung');
  ok(await pg.isVisible('#btnCalReset')&&(await pg.textContent('#btnCal'))==='Neu kalibrieren','„Neu kalibrieren“ und „Verwerfen“ sind da');
  ok(await pg.evaluate(()=>mic.thr===S.cal.a),'Das Messgerät im Test zeigt die kalibrierte Schwelle');

  console.log('== Prüfen im Test ==');
  await pg.evaluate(()=>{__shot(150,.3,1.0)});await pg.waitForTimeout(600);
  ok((await pg.textContent('#micVerdict')).includes('Schuss erkannt'),'Schuss aufs Tor → „Schuss erkannt ✓“');
  await pg.evaluate(()=>{__sy.speech.push({from:performance.now()+100,to:performance.now()+2000,rms:.03})});
  await pg.waitForTimeout(2300);
  ok(!(await pg.textContent('#micVerdict')).includes('Schuss erkannt'),'Dauerhaftes Sprechen löst nichts aus');

  console.log('== Training: Auslösen mit den kalibrierten Schwellen ==');
  await pg.evaluate(()=>{S.autoCount=true;S.corrWin=2;saveS();
    const c=clone(S.cfg);c.d='s3';c.scoring='exact';c.timing='free';c.ready='tap';c.amt='count';c.count=10;startSession(c,null)});
  await pg.waitForFunction(()=>R&&R.phase==='ready',null,{timeout:4000});
  await pg.evaluate(()=>input('ready'));
  await pg.waitForFunction(()=>R.phase==='aim',null,{timeout:4000});
  await pg.waitForTimeout(300);
  ok(await pg.evaluate(()=>R.detectAt==null),'Vor dem Schuss: nichts erkannt');
  const tgt=await pg.evaluate(()=>R.target);
  await pg.evaluate(()=>{window.__t=__shot(400,.30,1.0)});
  await pg.waitForFunction(()=>R.entries.length===1,null,{timeout:3000});
  const e=await pg.evaluate(()=>({e:R.entries[0],lat:R.detectAt-__t}));
  ok(e.e.auto===true,'Erkannter Schuss wird automatisch als Treffer eingetragen (Auto-Treffer)');
  ok(e.e.l===tgt&&e.e.h===true,'… auf das angesagte Segment '+tgt);
  ok(Math.abs(e.lat)<60,'Erkennung innerhalb von 60 ms nach dem Knall: '+Math.round(e.lat)+' ms');
  await pg.waitForFunction(()=>R.phase==='ready',null,{timeout:6000});
  await pg.evaluate(()=>input('ready'));
  await pg.waitForFunction(()=>R.phase==='aim',null,{timeout:4000});
  await pg.waitForTimeout(300);

  console.log('== Training: was nicht auslösen darf ==');
  await pg.evaluate(()=>{__sy.speech.push({from:performance.now()+50,to:performance.now()+1800,rms:.04})});
  await pg.waitForTimeout(2000);
  ok(await pg.evaluate(()=>R.detectAt==null&&R.entries.length===1),'Sprechen (laut genug für den Ton-Kanal, aber ohne Erschütterung): keine Erkennung');
  await pg.evaluate(()=>{__sy.jolts.push({t:performance.now()+50,a:1.0})});
  await pg.waitForTimeout(700);
  ok(await pg.evaluate(()=>R.detectAt==null&&R.entries.length===1),'Ruck ohne Knall (Tisch angestoßen): keine Erkennung');
  await pg.evaluate(()=>{__shot(50,.3,1.0)});
  await pg.waitForFunction(()=>R.entries.length===2,null,{timeout:3000});
  ok(true,'Danach funktioniert der echte Schuss wieder');
  await pg.evaluate(()=>finish());await pg.waitForTimeout(300);

  console.log('== Neu starten und verwerfen ==');
  await pg.evaluate(()=>{$('#summary').classList.add('hidden');R=null;renderTest();show('test')});
  await pg.click('#btnCalReset');await pg.waitForTimeout(200);
  ok(await pg.evaluate(()=>S.cal===null),'Verwerfen löscht die Kalibrierung');
  ok(await pg.isVisible('#rowSens')&&await pg.isVisible('#rowMSens'),'Regler sind wieder da');
  ok(await pg.evaluate(()=>thrA()>=DET.A_MIN&&!S.cal),'Schwelle folgt wieder dem Umgebungspegel');

  console.log('== Abbrechen und Zeitüberschreitung ==');
  await pg.click('#btnCal');await pg.waitForTimeout(500);
  await pg.click('#btnCal');await pg.waitForTimeout(300);
  ok(await pg.evaluate(()=>!cal.on&&cal.phase==='idle'&&mic.gap===DET.GAP),'Abbrechen beendet alles und setzt die Pausen zurück');
  ok(await pg.evaluate(()=>S.cal===null),'… ohne etwas zu speichern');
  await pg.evaluate(()=>{cal.TIMEOUT_MS=1500;cal.REST_MS=600});
  await pg.click('#btnCal');
  await pg.waitForFunction(()=>cal.phase==='idle'&&cal.msg,null,{timeout:6000});
  ok((await pg.textContent('#calMsg')).includes('Nichts gehört'),'Ohne Schüsse: verständliche Meldung statt Stillstand ('+await pg.textContent('#calMsg')+')');
  ok(await pg.evaluate(()=>S.cal===null),'… und nichts wird gespeichert');

  console.log(errs.length?'\nFEHLER IM BROWSER:\n'+errs.join('\n'):'\nKeine Browser-Fehler');
  console.log(fails?'FEHLGESCHLAGEN: '+fails:'ALLE OK');
  await br.close();srv.close();process.exit(fails||errs.length?1:0);
})();
