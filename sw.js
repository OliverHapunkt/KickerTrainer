'use strict';
/* KickerTrainer · Service Worker
 *
 * Ziel: App startet auch ohne Netz, und Updates kommen zuverlässig an.
 * - Registriert als sw.js?v=<Version> (Version aus index.html). Neue Version = neue URL = neuer Service Worker.
 * - Seite (index.html): erst Netz (max. 3 s), sonst Kopie aus dem Cache → online immer aktuell, offline lauffähig.
 * - CSS/JS mit ?v=…: aus dem Cache, sonst Netz. Die Dateien ändern sich nie unter derselben URL.
 * - Fremde Adressen (Supabase, jsDelivr) werden nicht angefasst.
 */
const VER=new URL(self.location).searchParams.get('v')||'dev';
const CACHE='kt-'+VER;
const FILES=['css/app.css','js/core.js','js/ui.js','js/sensors.js','js/home.js','js/training.js','js/stats.js','js/gamification.js','js/learn.js','js/play.js','js/tools.js','js/cloud.js','js/main.js'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./'].concat(FILES.map(f=>f+'?v='+VER)))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('kt-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
function timeout(ms){return new Promise((_,no)=>setTimeout(()=>no(new Error('timeout')),ms))}
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);if(u.origin!==self.location.origin)return;
  if(r.mode==='navigate'){
    // Eigenständige Seiten (Impressum, Datenschutz) unter ihrer eigenen Adresse ablegen.
    // Sonst bekäme man offline unter /impressum.html die App-Startseite zu sehen.
    const key=/\.html$/.test(u.pathname)?r.url:'./';
    // no-cache: am Server nachfragen statt alte Kopie aus dem Browser-Cache (GitHub Pages cacht 10 min)
    e.respondWith(Promise.race([fetch(r.url,{cache:'no-cache',credentials:'same-origin'}),timeout(3000)])
      .then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(key,cp))}return res})
      .catch(()=>caches.match(key).then(m=>m||caches.match('./')).then(m=>m||fetch(r))));
    return;
  }
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{
    if(res&&res.ok&&u.searchParams.has('v')){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp))}
    return res;
  })));
});
