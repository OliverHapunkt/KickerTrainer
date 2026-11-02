'use strict';
/* KickerTrainer · Labor: Kamera-Probe für eine mögliche Trefferermittlung
   Frage, die hier beantwortet wird: Kann ein iPhone, das am Tischrand liegt und aufs Tor schaut, erkennen, in welches
   Segment der Ball ging? Die Probe ändert nichts im Training. Das Kamerabild bleibt auf dem Gerät.
   Idee: Das Tor im Bild (rotes Rechteck) wird in 5 Streifen geteilt. Pro Kamerabild wird gemessen, wie stark sich jeder
   Streifen gegenüber dem Bild davor verändert hat. Der Ton löst aus („es wurde geschossen“), danach wird ~0,4 s lang
   geschaut, in welchem Streifen am meisten passiert ist.
   Der obere Teil (labAnalyze) ist reine Rechnung ohne DOM und im Terminal testbar. */
const LAB={PRE:150,POST:400,BASE:1000,STRIPS:5,GW:100,GH:40,CLEAR:1.5,MIN:3,KEEP:2500};

/* frames: [{t,a:[5 Werte],g}] aufsteigend nach t. tShot = Zeitpunkt des erkannten Schusses (gleiche Uhr wie t).
   Ergebnis: Streifen mit der stärksten Veränderung (1–5) oder 0 = nichts Auffälliges, dazu Abstand zum Zweitbesten. */
function labAnalyze(frames,tShot){
  const win=frames.filter(f=>f.t>=tShot-LAB.PRE&&f.t<=tShot+LAB.POST);
  const pre=frames.filter(f=>f.t>=tShot-LAB.BASE&&f.t<tShot-LAB.PRE-100);
  const out={n:win.length,fps:null,scores:[0,0,0,0,0],base:0,pick:0,margin:0,clear:false,nPre:pre.length};
  if(win.length>1)out.fps=(win.length-1)/((win[win.length-1].t-win[0].t)/1000);
  const pool=[];pre.forEach(f=>f.a.forEach(v=>pool.push(v)));pool.sort((x,y)=>x-y);
  out.base=pool.length?pool[Math.floor(pool.length/2)]:0;
  for(let s=0;s<LAB.STRIPS;s++){let m=0;win.forEach(f=>{if(f.a[s]>m)m=f.a[s]});out.scores[s]=m}
  const idx=out.scores.map((v,i)=>[v,i]).sort((x,y)=>y[0]-x[0]),best=idx[0],sec=idx[1];
  out.margin=sec[0]>0?best[0]/sec[0]:(best[0]>0?99:0);
  const floor=Math.max(out.base*LAB.MIN,2);                // mindestens 3× das normale Rauschen, und nicht unter 2 Helligkeitsstufen
  if(win.length&&best[0]>=floor){out.pick=best[1]+1;out.clear=out.margin>=LAB.CLEAR}
  return out;
}

/* ---------- Anbindung ---------- */
const lab={on:false,stream:null,vid:null,cvs:null,ctx:null,ov:null,prev:null,fr:[],shots:[],roi:{l:25,r:75,t:30,b:70},fpsReq:60,
  nf:0,t0:0,fps:0,taps:0,tapT:0,vfc:false,micWas:false,detWas:null};
function labFrame(now){
  const v=lab.vid;if(!lab.on||!v||!v.videoWidth)return;
  const W=v.videoWidth,H=v.videoHeight,r=lab.roi;
  const sx=W*r.l/100,sy=H*r.t/100,sw=Math.max(8,W*(r.r-r.l)/100),sh=Math.max(8,H*(r.b-r.t)/100);
  lab.ctx.drawImage(v,sx,sy,sw,sh,0,0,LAB.GW,LAB.GH);
  const d=lab.ctx.getImageData(0,0,LAB.GW,LAB.GH).data,g=new Uint8Array(LAB.GW*LAB.GH);
  for(let i=0,j=0;i<d.length;i+=4,j++)g[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
  if(lab.prev){
    const sw5=LAB.GW/LAB.STRIPS,a=[0,0,0,0,0];
    for(let y=0;y<LAB.GH;y++)for(let x=0;x<LAB.GW;x++){const s=Math.min(4,Math.floor(x/sw5));a[s]+=Math.abs(g[y*LAB.GW+x]-lab.prev[y*LAB.GW+x])}
    const n=sw5*LAB.GH;for(let s=0;s<5;s++)a[s]/=n;
    lab.fr.push({t:now,a,g:a.reduce((p,c)=>p+c,0)/5});
    while(lab.fr.length&&now-lab.fr[0].t>LAB.KEEP)lab.fr.shift();
    labBars(a);
  }
  lab.prev=g;lab.nf++;
  if(now-lab.t0>=1000){lab.fps=lab.nf*1000/(now-lab.t0);lab.nf=0;lab.t0=now;labInfo()}
}
function labLoop(now,meta){
  if(!lab.on)return;
  labFrame(performance.now());
  if(lab.vfc)lab.vid.requestVideoFrameCallback(labLoop);else requestAnimationFrame(labLoop);
}
function labBars(a){
  const el=$('#labBars');if(!el)return;
  [...el.children].forEach((b,i)=>{const h=Math.min(100,a[i]*5);b.firstChild.style.height=h+'%';b.lastChild.textContent=fmt(a[i],1)});
  drawOv();
}
function drawOv(){
  const c=lab.ov;if(!c)return;const w=c.width=c.clientWidth,h=c.height=c.clientHeight,x=c.getContext('2d'),r=lab.roi;
  x.clearRect(0,0,w,h);x.strokeStyle='#ff4d4d';x.lineWidth=2;
  // Video wird mit „contain“ eingepasst: Rechteck auf die tatsächliche Bildfläche rechnen, nicht auf die ganze Box
  const v=lab.vid,vw=v&&v.videoWidth||w,vh=v&&v.videoHeight||h,k=Math.min(w/vw,h/vh),bw=vw*k,bh=vh*k,ox=(w-bw)/2,oy=(h-bh)/2;
  const l=ox+bw*r.l/100,t=oy+bh*r.t/100,ww=bw*(r.r-r.l)/100,hh=bh*(r.b-r.t)/100;
  x.strokeRect(l,t,ww,hh);x.fillStyle='rgba(255,77,77,.9)';x.font='bold 16px sans-serif';
  for(let i=1;i<5;i++){x.beginPath();x.moveTo(l+ww*i/5,t);x.lineTo(l+ww*i/5,t+hh);x.stroke()}
  for(let i=0;i<5;i++)x.fillText(String(i+1),l+ww*(i+.5)/5-4,t+18);
}
function labInfo(){
  const t=lab.stream&&lab.stream.getVideoTracks()[0],s=t?t.getSettings():{};
  $('#labInfo').textContent=lab.on?(s.width+'×'+s.height+' · angefragt '+lab.fpsReq+' fps · Treiber meldet '+(s.frameRate?Math.round(s.frameRate):'?')+' fps · gemessen '+fmt(lab.fps,1)+' Bilder/s'):'';
}
async function labStart(){
  if(lab.on)return;
  try{
    // getUserMedia direkt im Tap (iOS)
    const p=navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:lab.fpsReq}},audio:false});
    ensureAudio();
    lab.stream=await p;
    const v=lab.vid;v.srcObject=lab.stream;v.setAttribute('playsinline','');v.muted=true;await v.play();
    lab.cvs=document.createElement('canvas');lab.cvs.width=LAB.GW;lab.cvs.height=LAB.GH;lab.ctx=lab.cvs.getContext('2d',{willReadFrequently:true});
    lab.on=true;lab.prev=null;lab.fr=[];lab.nf=0;lab.t0=performance.now();lab.vfc=typeof v.requestVideoFrameCallback==='function';
    // Ton als Auslöser: nur Ton, ohne die gespeicherte Einstellung zu ändern
    lab.detWas=S.det;S.det='audio';lab.micWas=mic.on;if(!mic.on)await micStart();
    wake(true);labRender();drawOv();
    if(lab.vfc)v.requestVideoFrameCallback(labLoop);else requestAnimationFrame(labLoop);
  }catch(e){toast('Kamera: '+(e.message||e.name));lab.on=false;labStop()}
}
function labStop(){
  lab.on=false;
  if(lab.stream){lab.stream.getTracks().forEach(t=>t.stop());lab.stream=null}
  if(lab.vid)lab.vid.srcObject=null;
  if(lab.detWas!=null){S.det=lab.detWas;lab.detWas=null}
  if(mic.on&&!lab.micWas&&!R)micStop();
  wake(false);labRender();
}
/* Vom Mikrofon aufgerufen (onImpulse), wenn ein Schuss erkannt wurde */
function labShot(now){
  if(!lab.on)return;
  const id=lab.shots.length+1,row={id,t:now,res:null,truth:null};lab.shots.push(row);labRender();
  setTimeout(()=>{row.res=labAnalyze(lab.fr,now);labRender()},LAB.POST+80);
}
function labTruth(v){ // v = 1–5 (Segment) oder 0 (daneben)
  const row=[...lab.shots].reverse().find(s=>s.res&&s.truth==null);if(!row)return;
  row.truth=v;labRender();
}
function labSummary(){
  const rated=lab.shots.filter(s=>s.res&&s.truth!=null),seg=rated.filter(s=>s.truth>0),ok=seg.filter(s=>s.res.pick===s.truth),
    miss=rated.filter(s=>s.truth===0),missOk=miss.filter(s=>s.res.pick===0),clear=seg.filter(s=>s.res.clear),clearOk=clear.filter(s=>s.res.pick===s.truth);
  return{rated:rated.length,seg:seg.length,ok:ok.length,miss:miss.length,missOk:missOk.length,clear:clear.length,clearOk:clearOk.length};
}
function labText(){
  const sm=labSummary(),l=['KickerTrainer Kamera-Probe '+APP_VERSION,$('#labInfo').textContent,
    'Ausschnitt L'+lab.roi.l+' R'+lab.roi.r+' O'+lab.roi.t+' U'+lab.roi.b+' %',
    'Segment richtig: '+sm.ok+'/'+sm.seg+' · eindeutig: '+sm.clearOk+'/'+sm.clear+' · daneben richtig: '+sm.missOk+'/'+sm.miss];
  lab.shots.forEach(s=>{if(s.res)l.push('#'+s.id+' wahr '+(s.truth==null?'?':s.truth)+' erkannt '+s.res.pick+(s.res.clear?'!':'')+' Bilder '+s.res.n+' ('+(s.res.fps?fmt(s.res.fps,0):'–')+' fps) Werte '+s.res.scores.map(v=>fmt(v,1)).join('/')+' Ruhe '+fmt(s.res.base,2))});
  return l.join('\n');
}
function labRender(){
  const el=$('#lab');if(!el)return;
  $('#btnLabCam').textContent=lab.on?'Kamera aus':'Kamera an';
  chips($('#labFps'),[{v:30,t:'30 fps'},{v:60,t:'60 fps'}],v=>lab.fpsReq===v,v=>lab.fpsReq=v,()=>{if(lab.on){labStop();labStart()}else labRender()});
  const ro=$('#labRows');ro.innerHTML='';
  [...lab.shots].reverse().slice(0,12).forEach(s=>{
    const r=document.createElement('div');r.className='labrow';
    if(!s.res){r.innerHTML='<b>#'+s.id+'</b><span>Schuss gehört, werte aus …</span>';ro.appendChild(r);return}
    const q=s.res,hit=s.truth!=null&&(s.truth===q.pick);
    r.innerHTML='<b>#'+s.id+'</b><span>erkannt: <b>'+(q.pick||'nichts')+'</b>'+(q.clear?' ✓eindeutig':q.pick?' (unsicher)':'')+' · '+q.n+' Bilder'+(q.fps?' ('+fmt(q.fps,0)+' fps)':'')+'<br><small>'+q.scores.map(v=>fmt(v,1)).join(' · ')+' | Ruhe '+fmt(q.base,2)+'</small></span>'
      +'<em class="'+(s.truth==null?'':hit?'ok':'bad')+'">'+(s.truth==null?'wohin?':'wahr '+(s.truth||'daneben'))+'</em>';
    ro.appendChild(r)});
  const sm=labSummary();
  $('#labSum').textContent=sm.rated?('Segment richtig: '+sm.ok+' von '+sm.seg+(sm.clear?' · davon eindeutig erkannt '+sm.clearOk+' von '+sm.clear:'')+(sm.miss?' · „daneben“ richtig: '+sm.missOk+' von '+sm.miss:'')):'Schieß aufs Tor, dann tippe, wohin der Ball wirklich ging.';
  $('#labTruth').classList.toggle('hidden',!lab.shots.some(s=>s.res&&s.truth==null));
  labInfo();
}
function labOpen(){S.lab=true;saveS();show('lab');labRender()}
/* 7× auf die Versionsnummer tippen schaltet das Labor frei */
$('#appVer').addEventListener('click',()=>{
  const now=Date.now();lab.taps=now-lab.tapT>2500?1:lab.taps+1;lab.tapT=now;
  if(lab.taps>=7){lab.taps=0;toast('Labor freigeschaltet');labOpen()}
});
$('#btnLab').onclick=()=>labOpen();
$('#btnLabBack').onclick=()=>{labStop();go('settings')};
$('#btnLabCam').onclick=()=>lab.on?labStop():labStart();
$('#btnLabClear').onclick=()=>{lab.shots=[];labRender()};
$('#btnLabCopy').onclick=async()=>{try{await navigator.clipboard.writeText(labText());toast('Kopiert')}catch(e){toast('Kopieren nicht möglich')}};
lab.vid=$('#labVid');lab.ov=$('#labOv');
$('#labBars').innerHTML=[1,2,3,4,5].map(n=>'<div><i></i><span>'+n+'</span><small>0</small></div>').join('');
$('#labTruth').innerHTML=[1,2,3,4,5,0].map(n=>'<button class="chip" data-v="'+n+'">'+(n||'daneben')+'</button>').join('');
$('#labTruth').addEventListener('click',e=>{const b=e.target.closest('button');if(b)labTruth(+b.dataset.v)});
['l','r','t','b'].forEach(k=>{
  const names={l:'Links',r:'Rechts',t:'Oben',b:'Unten'};
  const row=document.createElement('div');row.className='sub';row.innerHTML='<label>'+names[k]+'</label><div id="labS'+k+'"></div>';$('#labRoi').appendChild(row);
  slider($('#labS'+k),{min:0,max:100,step:1,value:lab.roi[k],fmt:n=>n+' %',after:()=>{drawOv()},onInput:v=>{
    lab.roi[k]=v;const r=lab.roi;if(r.r-r.l<10){if(k==='r')r.r=r.l+10;else if(k==='l')r.l=r.r-10}if(r.b-r.t<10){if(k==='b')r.b=r.t+10;else if(k==='t')r.t=r.b-10}drawOv();lab.prev=null}});
});
