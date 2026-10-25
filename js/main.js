'use strict';
/* KickerTrainer · Start */
// Läuft erst, wenn alle Dateien geladen sind (Reihenfolge siehe index.html)
requestAnimationFrame(drawMeters);
setInterval(()=>{if(actx&&actx.state==='suspended'&&(mic.on||(R&&R.active)))actx.resume().catch(()=>{})},1000);
renderHome();
show('home');
maybeOnboarding();
cloudBoot();
