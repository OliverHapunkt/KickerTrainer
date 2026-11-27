'use strict';
/* KickerTrainer · Oberflächen-Bausteine: Icons, Dialoge, Einführung */

/* ---------- Icons (Linien-Stil wie die Tab-Leiste, 24×24, currentColor) ---------- */
const ICP={
  flame:'<path d="M12 22c3.9 0 7-2.9 7-6.8 0-3.2-2.1-5.3-3.6-7.2-.5 1.8-1.4 3-2.6 3.6.3-3.4-1.2-6.4-4-8.6-.2 3.4-1.8 5.4-3.3 7.3C4.4 12 5 13.7 5 15.2 5 19.1 8.1 22 12 22z"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" class="f"/>',
  chain:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  clock:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  repeat:'<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  rocket:'<path d="M5 19l3-1 8-8a6 6 0 0 0 3-6 6 6 0 0 0-6 3l-8 8-1 3z"/><path d="M14 10l-2-2M8 16l-2-2M15 14v4l-3 3-1-4M10 9H6l-3 3 4 1"/>',
  wrench:'<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3 18 3a5 5 0 0 0-3.3 3.3z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  trophy:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  up:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pin:'<path d="M12 17v5M8 3h8l-1 6 3 3H6l3-3z"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play:'<path d="M8 5v14l11-7z" class="f"/>',
  chevron:'<path d="M9 6l6 6-6 6"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  // Tab-Leiste (werden über renderTabbar() in core.js eingesetzt)
  swap:'<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  tTrain:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" class="f"/>',
  tChal:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  tStats:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  tSettings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  // Tisch von oben: Mittellinie und Ball
  tPlay:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.2" class="f"/>',
  tGroups:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="17.5" cy="9.5" r="2.4"/><path d="M16 14.6a4.6 4.6 0 0 1 4.5 4.9"/>',
  tRank:'<path d="M3 20h18"/><path d="M5 20v-6h4v6M10 20V8h4v12M15 20v-4h4v4"/>',
};
function icon(n,cls){return'<svg class="ic'+(cls?' '+cls:'')+'" viewBox="0 0 24 24" aria-hidden="true">'+(ICP[n]||'')+'</svg>'}

/* ---------- Dialoge (statt confirm/prompt: gleiche Gestaltung, keine Web-Adresse im Fenster) ---------- */
// ask('Text',{title,ok,cancel,danger}) → Promise<boolean>
// askText('Titel',{value,placeholder,ok,hint,max}) → Promise<string|null>
let dlgOpen=null;
function dlg(html,buttons,onOpen){
  return new Promise(res=>{
    if(dlgOpen)dlgOpen(null); // höchstens ein Dialog gleichzeitig
    const o=document.createElement('div');o.className='overlay dlg';o.setAttribute('role','dialog');o.setAttribute('aria-modal','true');
    o.innerHTML='<div class="sheet dsheet">'+html+'<div class="dbtns">'+buttons.map((b,i)=>'<button class="big'+(b.cls?' '+b.cls:'')+'" data-i="'+i+'">'+esc(b.t)+'</button>').join('')+'</div></div>';
    const close=v=>{if(!o.isConnected)return;o.remove();dlgOpen=null;res(v)};
    dlgOpen=close;
    o.addEventListener('click',e=>{
      const b=e.target.closest('[data-i]');
      if(b){const x=buttons[+b.dataset.i];close(x.v===undefined?true:(typeof x.v==='function'?x.v(o):x.v));return}
      if(e.target===o)close(buttons.find(x=>x.cancel)?buttons.find(x=>x.cancel).v:null);
    });
    o.addEventListener('keydown',e=>{if(e.key==='Escape')close(null);if(e.key==='Enter'&&e.target.tagName==='INPUT'){const p=buttons.find(x=>x.primary);if(p)close(typeof p.v==='function'?p.v(o):p.v)}});
    document.body.appendChild(o);if(onOpen)onOpen(o);
  });
}
function ask(msg,o={}){
  return dlg((o.title?'<h3 class="dtitle">'+esc(o.title)+'</h3>':'')+'<p class="dmsg">'+esc(msg).replace(/\n/g,'<br>')+'</p>',
    [{t:o.ok||'OK',v:true,cls:o.danger?'dangerbtn':'primary',primary:true},{t:o.cancel||'Abbrechen',v:false,cancel:true}]).then(v=>v===true);
}
function askText(title,o={}){
  return dlg('<h3 class="dtitle">'+esc(title)+'</h3>'+(o.hint?'<p class="dmsg">'+esc(o.hint)+'</p>':'')
      +'<input type="text" class="dinput" maxlength="'+(o.max||60)+'" placeholder="'+esc(o.placeholder||'')+'" value="'+esc(o.value||'')+'">',
    [{t:o.ok||'Speichern',v:x=>x.querySelector('.dinput').value,cls:'primary',primary:true},{t:'Abbrechen',v:null,cancel:true}],
    x=>{const i=x.querySelector('.dinput');setTimeout(()=>{i.focus();i.select()},60)}).then(v=>typeof v==='string'?v:null);
}
function info(title,html){return dlg('<h3 class="dtitle">'+esc(title)+'</h3>'+html,[{t:'OK',v:true,cls:'primary',primary:true}])}

/* ---------- Einführung beim ersten Start ---------- */
const ONB=[
  ['target','Zielen und eintragen','Die App sagt ein Ziel an und lässt es aufleuchten. Nach dem Schuss tippst du <b>Treffer</b> oder <b>Daneben</b> (bei „Genau“ das Segment, in dem der Ball landete, oder links/rechts neben dem Tor).<br><br><b>Segment 1 = links aus Sicht des Schützen.</b> Das ⓘ im Training erklärt alle Eingaben.'],
  ['repeat','Übung wählen','Unter <b>Training</b> siehst du die aktuelle Übung. Mit „Anpassen“ wählst du Disziplin, Technik, Ziele, Tempo und Umfang. Gute Kombinationen speicherst du als eigene Übung.'],
  ['trophy','Fortschritt','<b>Statistik</b> zeigt deine Schwachstellen, <b>Challenges</b> geben dir Ziele. Ein Konto ist freiwillig – ohne Konto bleibt alles auf diesem Gerät.<br><br>Tipp: App über „Teilen › Zum Home-Bildschirm“ hinzufügen.'],
];
function onboarding(){
  let i=0;
  const step=()=>{
    const [ic,t,b]=ONB[i],last=i===ONB.length-1;
    dlg('<div class="onbico">'+icon(ic)+'</div><h3 class="dtitle" style="text-align:center">'+t+'</h3><p class="dmsg">'+b+'</p><div class="onbdots">'+ONB.map((_,k)=>'<i'+(k===i?' class="on"':'')+'></i>').join('')+'</div>',
      [{t:last?'Los geht’s':'Weiter',v:'next',cls:'primary',primary:true}].concat(last?[]:[{t:'Überspringen',v:'skip',cancel:true}])
    ).then(v=>{if(v==='next'&&!last){i++;step()}else{S.onb=true;saveS()}});
  };
  step();
}
/* ---------- Web-App: Hinweis zum Installieren ---------- */
// Im Browser (nicht vom Home-Bildschirm gestartet) einmal beim ersten Aufruf, danach unter Optionen › Hilfe.
function isStandalone(){try{return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}catch(e){return false}}
function devPlatform(){const u=navigator.userAgent||'';
  if(/android/i.test(u))return'android';
  if(/iphone|ipad|ipod/i.test(u)||(/Macintosh/.test(u)&&navigator.maxTouchPoints>1))return'ios';
  return'other'}
let pwaPrompt=null; // Android/Chrome: Installationsdialog des Browsers, falls angeboten
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();pwaPrompt=e});
const PWA_HOW={
  ios:['iPhone / iPad','In <b>Safari</b> unten bzw. oben auf <b>Teilen</b> tippen (Quadrat mit Pfeil nach oben) › <b>Zum Home-Bildschirm</b> › <b>Hinzufügen</b>.'],
  android:['Android','In <b>Chrome</b> oben rechts auf <b>⋮</b> tippen › <b>App installieren</b> oder <b>Zum Startbildschirm hinzufügen</b>.'],
  other:['Computer','In Chrome oder Edge rechts in der Adresszeile auf das Installieren-Symbol klicken. Safari am Mac: Ablage › Zum Dock hinzufügen.'],
};
function pwaHelpHtml(){
  const p=devPlatform(),order=[p].concat(['ios','android','other'].filter(x=>x!==p));
  return'<p class="dmsg">KickerTrainer ist eine <b>Web-App</b>: Sie läuft im Browser, ganz ohne App Store. Legst du sie auf den Home-Bildschirm, startet sie wie eine normale App im Vollbild, läuft auch offline und das Handy löscht ihre Daten nicht nach ein paar Tagen ohne Besuch.</p>'
    +order.map((k,i)=>'<div class="pwahow'+(i?'':' on')+'"><b>'+PWA_HOW[k][0]+'</b><span>'+PWA_HOW[k][1]+'</span></div>').join('')
    +'<p class="dmsg pwawarn"><b>Erst installieren, dann anmelden.</b> Auf iPhone und iPad haben Safari und die App vom Home-Bildschirm getrennte Speicher: Was du in Safari anmeldest oder trainierst, ist in der App nicht da.</p>'}
function pwaHint(){
  const btns=[{t:'Verstanden',v:true,cls:'primary',primary:true}];
  if(pwaPrompt)btns.unshift({t:'Jetzt installieren',v:'install',cls:'primary'});
  return dlg('<h3 class="dtitle">App auf den Home-Bildschirm</h3>'+pwaHelpHtml(),btns).then(v=>{
    if(v==='install'&&pwaPrompt){const e=pwaPrompt;pwaPrompt=null;try{e.prompt()}catch(x){}}})}
function maybeOnboarding(){
  if(!S.pwa&&!isStandalone()){setTimeout(()=>pwaHint().then(()=>{S.pwa=true;saveS();maybeOnboarding()}),400);return}
  if(S.onb)return;
  if(D.shots.length){S.onb=true;saveS();return} // bestehende Nutzer: nicht mehr zeigen
  setTimeout(onboarding,400);
}

/* ---------- Erklärungen (ⓘ) ---------- */
// Ein Knopf mit data-tip-k="schlüssel" öffnet die passende Erklärung. Neue Erklärung = neuer Eintrag in TIPS, Knopf mit tipBtn('schlüssel') einbauen.
// (data-tip ohne -k gehört den Diagrammen in der Statistik und ist etwas anderes.)
function tipBtn(k){return'<button type="button" class="tipb" data-tip-k="'+k+'" aria-label="Erklärung">ⓘ</button>'}
// Wörter zu einer Bedeutung, direkt aus dem Wörterbuch (WORDS in sensors.js), damit Hilfe und Verhalten nicht auseinanderlaufen
function vw(t){return Object.keys(WORDS).filter(w=>WORDS[w]===t&&!/^\d$/.test(w)).map(w=>'„'+w+'“').join(' ')}
function vocabHtml(){
  const row=(w,m)=>'<tr><td>'+w+'</td><td>'+m+'</td></tr>';
  return'<table class="vt">'
    +'<tr><th colspan="2">Aufbauzeit</th></tr>'+row(vw('yes')+' '+vw('ready'),'bereit – beendet die Aufbauzeit früher (wie Tippen auf BEREIT)')
    +'<tr><th colspan="2">Schuss · Wertung „Genau“</th></tr>'
    +row('„eins“ … „fünf“','Ball landete in diesem Segment')
    +row(vw('ml'),'Ball ging <b>links neben</b> das Tor (aus Sicht des Schützen)')
    +row(vw('mr'),'Ball ging <b>rechts neben</b> das Tor')
    +row('„miss“ („daneben“, „nein“ …)','daneben, unklar wohin – kommt nicht in die genaue Auswertung')
    +row('„ja“','Zielsegment getroffen (nur wenn ein bestimmtes Ziel angesagt war)')
    +'<tr><th colspan="2">Schuss · Wertung „Einfach“</th></tr>'
    +row('„ja“ („treffer“)','Treffer')+row('„miss“ („daneben“ …)','Daneben')
    +'<tr><th colspan="2">Pass</th></tr>'
    +row('„ja“ („gefangen“)','gefangen')+row('„miss“ („nein“, „verloren“)','verloren')
    +'<tr><th colspan="2">Nach einem erkannten Schuss</th></tr>'
    +row('„ja“','stimmt so, weiter ohne Restzeit des Korrekturfensters')
    +'</table>'
    +'<p class="dmsg">Ein Wort pro Ergebnis genügt. Bei Wortgruppen wie „links daneben“ zählt nur das erste Wort. Antippen geht immer.</p>'
    +'<p class="dmsg">Alle erkannten Wörter: '+Object.keys(WORDS).filter(w=>!/^\d$/.test(w)).map(w=>'„'+w+'“').join(' ')+'</p>'
    +'<p class="dmsg">Wie gut „miss“ erkannt wird, hängt von iOS ab. Probier es auf der Testseite (Einstellungen › Mikrofon &amp; Sprache testen).</p>';
}
const TIPS={
  react:{t:'Reaktionsschießen',h:()=>rxHelpFor(S.cfg)},
  vocab:{t:'Sprachbefehle',h:vocabHtml},
  voiceAvail:{t:'Spracheingabe: Verfügbarkeit',h:'<p class="dmsg">Safari erkennt Sprache teils über Apple-Server. Dafür braucht die App <b>Internet</b>. Ohne Netz oder (evtl.) bei ausgeschalteter Diktierfunktion (iOS: Einstellungen › Allgemein › Tastatur) fällt sie aus, dann bleibt nur <b>Tippen</b>.</p><p class="dmsg">Außerdem kann iOS Mikrofon (Schusserkennung) und Spracheingabe nicht immer gleichzeitig bedienen. Zeigt die Schusserkennung „Mikrofon stumm“, tippe auf die Anzeige zum Neustart.</p><p class="dmsg">Tippen funktioniert immer und gleichwertig.</p>'},
  segs:{t:'Segmente 1–5',h:'<p class="dmsg">Das Tor ist in fünf Segmente geteilt, von links nach rechts <b>aus Sicht des Schützen</b>: <b>1</b> = ganz links, <b>5</b> = ganz rechts.</p><p class="dmsg">Bei der Wertung „Genau“ meldest du das Segment, in dem der Ball landete – nicht das angesagte Ziel.</p>'},
  miss:{t:'Daneben: links, rechts, unklar',h:'<p class="dmsg"><b>← links</b> und <b>rechts →</b>: Der Ball ging neben dem Tor in die Wand. Links/rechts immer aus Sicht des Schützen.</p><p class="dmsg"><b>Daneben (unklar)</b> bzw. „Miss“: Fehlschuss, du weißt oder willst nicht sagen, wohin. Er zählt in der Quote als Fehlschuss, kommt aber nicht in „Wohin geht der Ball?“.</p>'},
  scoring:{t:'Wertung Schuss',h:'<p class="dmsg"><b>Einfach</b>: Du meldest Treffer („Ja“) oder Daneben („Miss“). Ein erkannter Schuss kann automatisch als Treffer zählen.</p><p class="dmsg"><b>Genau</b>: Du meldest, wohin der Ball ging (1–5, links, rechts, Miss). Daraus entsteht die Auswertung „Wohin geht der Ball?“. Ohne Auto-Treffer kannst du dir beliebig Zeit lassen.</p>'},
  setup:{t:'Aufbauzeit',h:'<p class="dmsg">Nach jedem Versuch bleibt Zeit zum Aufbauen: Ball holen, hinlegen, positionieren, Hände an die Griffe.</p><p class="dmsg"><b>Auto</b>: Ein Countdown läuft. „Ja“ oder Tippen auf BEREIT beendet ihn früher. <b>Tippen</b>: Die App wartet auf „Ja“ oder Tippen. <b>Aus</b>: Das Ziel kommt sofort (nur bei freiem Tempo).</p><p class="dmsg">Nach „Bereit“ folgen 0,5 s Griffzeit, dann kommt die Ansage. Bei „Auf Signal“ kommt danach noch eine Zufallszeit.</p>'},
  timing:{t:'Timing',h:'<p class="dmsg"><b>Freies Tempo</b>: Nach der Aufbauzeit wird das Ziel angesagt, du spielst in deinem Rhythmus.</p><p class="dmsg"><b>Auf Signal</b>: Nach „Bereit“ kommt das Ziel zu einem zufälligen Zeitpunkt. Du reagierst darauf, es zählt nur das Reaktionsfenster. Das trainiert Reaktion statt Ablauf.</p>'},
  calib:{t:'Kalibrierung',h:'<p class="dmsg">Jeder Tisch klingt anders, und jedes Gerät liegt anders. Statt an Reglern zu raten, hört die App deinen Tisch einmal an:</p><p class="dmsg"><b>1.</b> Drei Sekunden Ruhe: Sie misst, wie laut und wie unruhig die Umgebung ist.</p><p class="dmsg"><b>2.</b> Drei Schüsse aufs Tor: Sie merkt sich, wie laut und wie kräftig der Tisch dabei wird – jeweils Ton und Erschütterung.</p><p class="dmsg"><b>3.</b> Die Schwelle wird auf 40 % des leisesten Schusses gesetzt, aber nie unter das Dreifache der Ruhe. Damit liegt jeder Schuss sicher darüber und der Lärm weit darunter.</p><p class="dmsg">Außerdem wählt die App, worüber erkannt wird: Sind Ton <i>und</i> Erschütterung klar zu erkennen, nimmt sie beides zusammen. Das Ergebnis gilt für dieses Gerät und diese Aufstellung – bei anderem Tisch oder Ort einfach neu kalibrieren.</p>'},
  detect:{t:'So erkennt die App Schüsse',h:'<p class="dmsg">Ein Schuss ist ein <b>plötzlicher, lauter Knall</b>. Die App löst aus, wenn beides stimmt: Er ist laut genug (über der Schwelle) <b>und</b> deutlich lauter als das, was gerade davor zu hören war. Dauerhaftes Sprechen, Musik oder rollender Ball sind laut, aber nicht plötzlich – sie lösen nichts aus.</p><p class="dmsg"><b>Ton</b>: Das Mikrofon hört den Knall. <b>Erschütterung</b>: Der Bewegungssensor spürt den Ruck, der durch den Tisch geht. Das Gerät muss direkt auf dem Tisch liegen.</p><p class="dmsg"><b>Ton + Erschütterung</b>: Beides innerhalb von 0,25 s. Das löst am seltensten falsch aus (Stimmen, Nachbartisch).</p><p class="dmsg"><b>Schwelle</b>: Am besten kalibrieren (Knopf unter den Einstellungen) – dann ist sie auf deinen Tisch abgestimmt. Ohne Kalibrierung folgt sie dem Umgebungspegel.</p><p class="dmsg">Nach einer Erkennung ist 0,4 s Pause. Eigene Signaltöne und Sprachansagen werden ignoriert. Erkannt wird nur, solange ein Ziel läuft, nicht beim Aufbauen. Das Ergebnis ist die <b>Reaktionszeit</b> ab Ansage.</p>'},
  autocount:{t:'Auto-Treffer',h:'<p class="dmsg"><b>Schusserkennung</b> misst nur die Reaktionszeit. <b>Auto-Treffer</b> geht einen Schritt weiter: Ein erkannter Schuss zählt sofort als Treffer auf das <b>angesagte Ziel</b> (bei „Genau“ auf dessen Segment).</p><p class="dmsg">Danach läuft das <b>Korrekturfenster</b> (2/3/5 s, mit Restzeit in der Statusleiste). Stimmt es nicht, überschreibst du den Eintrag: Segment, links, rechts oder „Miss“ sagen bzw. antippen. „Ja“ bestätigt und geht sofort weiter. Ohne Eingabe bleibt es ein Treffer.</p><p class="dmsg">Achtung: Wer im Fenster nichts sagt, bestätigt damit einen Treffer. Willst du jedes Ergebnis bewusst melden, schalte Auto-Treffer aus.</p>'},
  missdir:{t:'Daneben mit Richtung',h:'<p class="dmsg">Gilt für Wertung „Einfach“: „Daneben“ wird in <b>← links</b> und <b>rechts →</b> geteilt (aus Sicht des Schützen), damit die Statistik zeigt, wohin du verziehst. Bei Wertung „Genau“ sind links, rechts und unklar immer da.</p>'},
  voiceOut:{t:'Sprachansage',h:'<p class="dmsg">Schuss: nur die Zahl des Segments. Pass: „wall“ oder „lane“. Bei „Auf Signal“ kommt zusätzlich ein Ton, bei Ziel „egal“ nur ein Ton.</p>'},
  torkarte:{t:'Torkarte',h:'<p class="dmsg">Trefferquote je <b>angesagtem</b> Zielsegment. Segment 1 = links aus Sicht des Schützen. Blass = weniger als 5 Versuche. Daneben-Schüsse zählen als nicht getroffen.</p>'},
  pJoin:{t:'Mitspieler',h:'<p class="dmsg"><b>Nur Gäste</b>: Du trägst alle Mitspieler selbst ein. Das Spiel beginnt sofort, es braucht kein zweites Gerät.</p><p class="dmsg"><b>Per Code einladen</b>: Die App öffnet eine Lobby und zeigt einen sechsstelligen Code. Wer ihn in seiner App eingibt, ist dabei – mit eigenem Konto und eigener Wertung. Freie Plätze kannst du trotzdem mit Gästen auffüllen.</p><p class="dmsg">Der Code gilt nur, solange die Lobby offen ist, längstens 12 Stunden. Mit dem Start wird er ungültig.</p>'},
  pCat:{t:'Wertung oder locker',h:'<p class="dmsg"><b>Wertung</b>: Das Spiel zählt für die Wertung (Elo und Ranglisten, sobald es sie gibt). Mitspieler mit Konto sehen das in der Lobby, bevor es losgeht.</p><p class="dmsg"><b>Locker</b>: einfach kicken, ausprobieren. Das Spiel steht in deiner Bilanz, beeinflusst aber keine Wertung.</p><p class="dmsg">Das legst du vor dem Spiel fest, nicht danach.</p>'},
  bzSum:{t:'Bilanz',h:'<p class="dmsg">Alle deine zu Ende gespielten Spiele aus deiner Sicht: <b>S</b> = Sieg, <b>N</b> = Niederlage. Ein Spiel gewinnt, wer die nötigen Sätze zuerst hat.</p><p class="dmsg">Enthalten sind bestätigte Spiele und solche, die noch auf die Gegenseite warten. <b>Strittige</b> Spiele zählen nicht.</p><p class="dmsg">Die <b>Quote</b> erscheint erst ab 5 Spielen – bei weniger sagt sie nichts aus. Gegner werden als Person geführt, nicht nach Namen.</p>'},
  bzElo:{t:'Wertung (Elo)',h:'<p class="dmsg">Jeder startet bei <b>1000</b>. Wer gewinnt, bekommt Punkte vom Verlierer – gegen Stärkere mehr, gegen Schwächere weniger. Nur Sieg oder Niederlage zählt, nicht der Abstand.</p><p class="dmsg">Gewertet werden nur <b>bestätigte</b> Spiele mit der Art <b>Wertung</b>, bei denen auf <b>beiden Seiten mindestens ein Konto</b> spielt. Spiele gegen reine Gäste stehen in der Bilanz, zählen aber nicht – dort hat niemand gegengeprüft. Ein Remis zählt halb. Wird ein Spiel korrigiert, wird alles neu gerechnet.</p><p class="dmsg">Drei getrennte Wertungen: <b>Einzel</b>, <b>Doppel</b> (über alle Partner, Teamstärke = Mittel beider) und <b>feste Paarungen</b>.</p><p class="dmsg">In den ersten 10 Spielen ist die Wertung <b>vorläufig</b> und bewegt sich doppelt so schnell, damit sie zügig dort ankommt, wo du stehst.</p>'},
  bzRanking:{t:'Rangliste',h:'<p class="dmsg">Hier stehen nur Spieler mit Konto, die zugestimmt haben und mindestens <b>10 gewertete Spiele</b> haben. Gäste nie.</p><p class="dmsg">Die Zustimmung ist freiwillig und jederzeit widerrufbar. Deine Spiele bleiben dabei erhalten.</p>'},
  rlRules:{t:'Regeln',h:'<p class="dmsg">Jede Spielstätte zählt ein bisschen anders. Hier stellst du ein, wie dieses Spiel gezählt wird. Häufige Einstellungen speicherst du oben als <b>Vorlage</b>.</p><p class="dmsg">Während des Spiels kann der Host die Regeln über ⚙ ändern – solange damit nichts rückwirkend entschieden wäre.</p>'},
  rlLead:{t:'Zwei Tore Vorsprung',h:'<p class="dmsg"><b>Entscheid</b>: nur im entscheidenden Satz (bei 2 Gewinnsätzen also beim Stand 1:1). <b>Jeder Satz</b>: in allen Sätzen.</p><p class="dmsg">Mit <b>Obergrenze</b> endet der Satz spätestens dort, auch ohne Vorsprung – z. B. Satz bis 5, höchstens bis 8.</p>'},
  rlDraw:{t:'Unentschieden',h:'<p class="dmsg">Steht es im <b>entscheidenden Satz</b> ein Tor vor dem Ziel unentschieden (bei Satz bis 5 also 4:4), endet das Spiel als Remis.</p><p class="dmsg">In der Wertung zählt ein Remis halb, in der Bilanz als <b>U</b>.</p>'},
  bzGoals:{t:'Deine Tore',h:'<p class="dmsg">Nur aus Spielen mit Erfassung <b>Erweitert</b> – nur dort steht bei jedem Tor, wer es geschossen hat. Eigentore zählen getrennt.</p>'},
  pMode:{t:'Modus',h:'<p class="dmsg"><b>Einzel</b> ist 1 gegen 1, <b>Doppel</b> 2 gegen 2. Die Wertungen werden getrennt geführt: Einzel, Doppel über alle Partner, und feste Doppel-Paarungen.</p>'},
  pDetail:{t:'Erfassung: einfach oder erweitert',h:'<p class="dmsg"><b>Einfach</b>: Du tippst nur, welches Team getroffen hat. Schnell am Tisch, aber ohne Torschützen.</p><p class="dmsg"><b>Erweitert</b>: Du tippst die Person, die getroffen hat. Daraus entstehen Torschützen und – im Doppel – Tore je Position.</p><p class="dmsg">Für die Wertungen reicht beides: Einzel, Doppel und Doppel-Team laufen auch mit „Einfach“.</p>'},
  pLineup:{t:'Aufstellung',h:'<p class="dmsg">Du musst selbst mitspielen. Die anderen Plätze füllst du mit <b>Gästen</b> – Mitspielern ohne eigenes Konto, die du selbst anlegst.</p><p class="dmsg">Ein Gast bleibt gespeichert und taucht beim nächsten Mal wieder auf, damit seine Wertung über Wochen zusammenläuft.</p><p class="dmsg">Im Doppel steht oben der Sturm, darunter die Abwehr. Während des Spiels kannst du jederzeit tauschen.</p>'},
  matrix:{t:'Wohin geht der Ball?',h:'<p class="dmsg">Jede Zeile ist ein angesagtes Ziel, jede Spalte der Ort, an dem der Ball landete: Segment 1–5, <b>←</b> links neben dem Tor, <b>→</b> rechts neben dem Tor (aus Schützensicht). Die Werte sind Prozent der Zeile. Der Rahmen markiert den Treffer.</p><p class="dmsg">„Miss“ ohne Angabe wohin ist hier nicht enthalten, zählt aber in der Trefferquote als Fehlschuss.</p><p class="dmsg">Der Pfeil rechts zeigt, auf welche Seite die Fehlschüsse dieses Ziels eher gehen.</p>'},
};
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-tip-k]');if(!b)return;
  e.preventDefault();e.stopPropagation();
  const x=TIPS[b.dataset.tipK];if(x)info(x.t,typeof x.h==='function'?x.h():x.h);
});
