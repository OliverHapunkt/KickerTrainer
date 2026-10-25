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
  ['target','Zielen und eintragen','Die App sagt ein Ziel an und lässt es aufleuchten. Nach dem Schuss tippst du <b>Treffer</b> oder <b>Daneben</b> (bei „Genau“ das Segment, in dem der Ball landete).<br><br><b>Segment 1 = links aus Sicht des Schützen.</b>'],
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
function maybeOnboarding(){
  if(S.onb)return;
  if(D.shots.length){S.onb=true;saveS();return} // bestehende Nutzer: nicht mehr zeigen
  setTimeout(onboarding,400);
}
