'use strict';
/* KickerTrainer · Start */
// Läuft erst, wenn alle Dateien geladen sind (Reihenfolge siehe index.html)
requestAnimationFrame(drawMeters);
setInterval(()=>{if(actx&&actx.state==='suspended'&&(mic.on||(R&&R.active)))actx.resume().catch(()=>{})},1000);
document.body.classList.toggle('play',curMode()==='play');
renderHome();
renderTabbar();
go(MODES[curMode()].start);
maybeOnboarding();
cloudBoot();
/* Service Worker: offline starten, Updates zuverlässig. Nur über HTTPS bzw. localhost. */
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
  const hadSW=!!navigator.serviceWorker.controller;let reloadWanted=false;
  const reloadIfIdle=()=>{if(R&&R.active){reloadWanted=true;return}location.reload()};
  navigator.serviceWorker.register('sw.js?v='+KT_VER.v).then(reg=>{
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})});
  }).catch(()=>{});
  // Neue Version aktiv: sofort neu laden, außer mitten im Training (dann nach dem Training)
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadSW)reloadIfIdle()});
  setInterval(()=>{if(reloadWanted&&!(R&&R.active)&&$('#summary').classList.contains('hidden'))location.reload()},5000);
}
