'use strict';
/* KickerTrainer · Statistik */
/* ================= Statistik ================= */
const ST={range:'7',disc:'all',tech:'all',timing:'all',session:null,open:null,edit:null,more:false};
const C_TXT='#e8eaed',C_MUTE='#8b929c',C_ACC='#ffb020',C_HIT='#2ecc71',C_MISS='#ff4d4f',C_S1='#3987e5',C_S2='#d95926';
function exSet(){return new Set(D.sessions.filter(x=>x.x).map(x=>x.id))}
function sessMeta(id){return D.sessions.find(x=>x.id===id)}
function dayStart(t){const d=new Date(t);d.setHours(0,0,0,0);return d.getTime()}
function fmtDate(t,time){const d=new Date(t);return d.toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'})+(time?' · '+d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'')}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function discName(d){return DISC[d]?DISC[d].n:d}
function baseFilter(s){return(ST.disc==='all'||s.d===ST.disc)&&(ST.tech==='all'||s.k===ST.tech)&&(ST.timing==='all'||(ST.timing==='sig')===!!s.sig)}
function sessionsList(){
  const ex=exSet(),m=new Map();
  for(const s of D.shots){if(!m.has(s.s))m.set(s.s,[]);m.get(s.s).push(s)}
  return[...m.entries()].map(([id,arr])=>{const meta=sessMeta(id);return{id,meta,arr,start:(meta&&meta.start)||arr[0].t,ex:ex.has(id)}}).sort((a,b)=>b.start-a.start);
}
function rangeWindow(){
  const now=Date.now();
  if(ST.session)return{sid:ST.session};
  switch(ST.range){
    case'last':{const l=sessionsList().find(x=>!x.ex&&x.arr.some(baseFilter));return{sid:l?l.id:'-',auto:true}}
    case'today':return{from:dayStart(now),to:Infinity};
    case'7':return{from:now-7*864e5,to:Infinity,len:7*864e5};
    case'30':return{from:now-30*864e5,to:Infinity,len:30*864e5};
    default:return{from:0,to:Infinity};
  }
}
function selShots(w){const ex=exSet();return D.shots.filter(s=>!ex.has(s.s)&&baseFilter(s)&&(w.sid?s.s===w.sid:(s.t>=w.from&&s.t<w.to)))}
function compareShots(w){
  const ex=exSet();
  if(w.sid){
    const ls=sessionsList().filter(x=>!x.ex),i=ls.findIndex(x=>x.id===w.sid);if(i<0)return null;
    const prev=ls.slice(i+1).filter(x=>x.arr.some(baseFilter)).slice(0,5);if(!prev.length)return null;
    const ids=new Set(prev.map(x=>x.id));return{label:'Ø '+prev.length+' Sessions davor',a:D.shots.filter(s=>ids.has(s.s)&&baseFilter(s))};
  }
  if(w.len){const a=D.shots.filter(s=>!ex.has(s.s)&&baseFilter(s)&&s.t>=w.from-w.len&&s.t<w.from);return a.length?{label:'vorherige '+Math.round(w.len/864e5)+' Tage',a}:null}
  if(ST.range==='today'){
    const b=D.shots.filter(s=>!ex.has(s.s)&&baseFilter(s)&&s.t<w.from);if(!b.length)return null;
    const d0=dayStart(b[b.length-1].t);return{label:'letzter Trainingstag',a:b.filter(s=>s.t>=d0)};
  }
  return null;
}
function chipsS(el,opts,isOn,onTap){
  el.innerHTML='';
  opts.forEach(o=>{const b=document.createElement('button');b.className='chip'+(isOn(o.v)?' on':'');b.textContent=o.t;
    b.onclick=()=>{onTap(o.v);renderStats()};el.appendChild(b)});
}
/* Farbskala: eine Farbe (Akzent), dunkel = wenig, hell = viel */
function seq(t){t=Math.max(0,Math.min(1,t));const a=[30,34,41],b=[255,176,32];return'rgb('+a.map((x,i)=>Math.round(x+(b[i]-x)*(.1+.9*t))).join(',')+')'}
function seqTxt(t){return t>.6?'#111':C_TXT}
function svg(W,H,inner){return'<svg class="chart" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+inner+'</svg>'}
function card(title,body,sub){return'<div class="card"><h2>'+title+'</h2>'+(sub?'<p class="hint" style="margin:-4px 0 10px">'+sub+'</p>':'')+body+'</div>'}
function legend(items){return'<div class="legend">'+items.map(([c,t,shape])=>'<span><i style="background:'+c+(shape==='line'?';height:3px;width:14px;border-radius:2px;vertical-align:3px':'')+(shape==='dot'?';border-radius:50%':'')+'"></i>'+t+'</span>').join('')+'</div>'}
function bestRun(a){let b=0,c=0;for(const s of a){c=s.h?c+1:0;if(c>b)b=c}return b}
function minutesOf(a){const m=new Map();for(const s of a){const x=m.get(s.s);if(!x)m.set(s.s,[s.t,s.t]);else{x[0]=Math.min(x[0],s.t);x[1]=Math.max(x[1],s.t)}}let t=0;for(const[x,y]of m.values())t+=(y-x)/60000+.3;return t}

/* ---------- Diagramme ---------- */
function chartTrend(W,a,single){
  const H=210,L=40,R=12,T=14,B=single?44:28,iw=W-L-R,ih=H-T-B,y=v=>T+ih*(1-v);
  let s='';
  [0,.5,1].forEach(v=>{s+='<line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v)+'" y2="'+y(v)+'"/><text x="'+(L-8)+'" y="'+(y(v)+4)+'" text-anchor="end">'+v*100+' %</text>'});
  if(single){
    const n=a.length,k=Math.min(10,Math.max(3,Math.round(n/4))),x=i=>L+(n<=1?iw/2:i*iw/(n-1));
    const roll=a.map((_,i)=>{const w=a.slice(Math.max(0,i-k+1),i+1);return w.filter(z=>z.h).length/w.length});
    s+='<path class="ln" d="'+roll.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)).join(' ')+'"/>';
    const tw=Math.max(2,Math.min(10,iw/n-2));
    a.forEach((z,i)=>{
      const tip='#'+(i+1)+' · '+z.k+' → '+tl(z.g,z.st)+(typeof z.l==='number'&&z.l>0&&!z.h?' (gelandet '+z.l+')':'')+'\n'+(z.h?'✓ '+(z.st==='pass'?'gefangen':'Treffer'):'✗ '+(z.st==='pass'?'verloren':'daneben'))+'\nlaufende Quote '+pct(roll[i]);
      s+='<rect x="'+(x(i)-tw/2).toFixed(1)+'" y="'+(H-B+12)+'" width="'+tw.toFixed(1)+'" height="14" rx="2" fill="'+(z.h?C_HIT:C_MISS)+'"/>';
      s+='<rect class="hit" x="'+(x(i)-Math.max(tw,12)/2).toFixed(1)+'" y="'+T+'" width="'+Math.max(tw,12)+'" height="'+(H-T)+'" data-tip="'+esc(tip)+'"/>';
    });
    const last=roll[roll.length-1];
    s+='<circle cx="'+x(n-1)+'" cy="'+y(last)+'" r="5" fill="'+C_ACC+'" stroke="#171a1f" stroke-width="2"/><text class="val" x="'+(x(n-1)-8)+'" y="'+(y(last)-10)+'" text-anchor="end">'+pct(last)+'</text>';
    return svg(W,H,s)+legend([[C_ACC,'laufende Quote (letzte '+k+')','line'],[C_HIT,'Treffer / gefangen'],[C_MISS,'daneben / verloren']]);
  }
  const m=new Map();for(const z of a){if(!m.has(z.s))m.set(z.s,[]);m.get(z.s).push(z)}
  let ss=[...m.values()].sort((p,q)=>p[0].t-q[0].t).slice(-40);
  const n=ss.length,x=i=>L+(n<=1?iw/2:i*iw/(n-1)),rates=ss.map(arr=>arr.filter(z=>z.h).length/arr.length);
  const avg=rates.map((_,i)=>{const w=ss.slice(Math.max(0,i-4),i+1);let h=0,t=0;w.forEach(arr=>{t+=arr.length;h+=arr.filter(z=>z.h).length});return h/t});
  ss.forEach((arr,i)=>{
    const r=Math.max(3.5,Math.min(8,Math.sqrt(arr.length)*1.1));
    s+='<circle cx="'+x(i)+'" cy="'+y(rates[i])+'" r="'+r+'" fill="#6b7280" stroke="#171a1f" stroke-width="2"/>';
  });
  if(n>1)s+='<path class="ln" d="'+avg.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)).join(' ')+'"/>';
  ss.forEach((arr,i)=>{
    const tip=fmtDate(arr[0].t,true)+'\n'+discName(arr[0].d)+' · '+arr.length+' Aktionen\nQuote '+pct(rates[i])+' · Ø5 '+pct(avg[i]);
    s+='<rect class="hit" x="'+(x(i)-Math.max(12,iw/n)/2).toFixed(1)+'" y="'+T+'" width="'+Math.max(12,iw/n).toFixed(1)+'" height="'+ih+'" data-tip="'+esc(tip)+'"/>';
  });
  s+='<circle cx="'+x(n-1)+'" cy="'+y(avg[n-1])+'" r="5" fill="'+C_ACC+'" stroke="#171a1f" stroke-width="2"/><text class="val" x="'+(x(n-1)-8)+'" y="'+(y(avg[n-1])-10)+'" text-anchor="end">'+pct(avg[n-1])+'</text>';
  const d0=new Date(ss[0][0].t),d1=new Date(ss[n-1][0].t),f=d=>d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
  s+='<text x="'+L+'" y="'+(H-8)+'">'+f(d0)+'</text><text x="'+(W-R)+'" y="'+(H-8)+'" text-anchor="end">'+f(d1)+'</text>';
  return svg(W,H,s)+legend([['#6b7280','Session (Größe = Anzahl)','dot'],[C_ACC,'gleitender Ø (5 Sessions)','line']]);
}
function chartGoal(W,a){
  const sh=a.filter(z=>typeof z.g==='number'&&z.g>0);if(!sh.length)return'';
  const gap=6,cw=(W-gap*4)/5,H=118;let s='';
  for(let g=1;g<=5;g++){
    const x=sh.filter(z=>z.g===g),n=x.length,h=x.filter(z=>z.h).length,r=n?h/n:0,X=(g-1)*(cw+gap);
    const fill=n?seq(r):'#1e2229',op=n&&n<5?.55:1;
    s+='<g opacity="'+op+'"><rect x="'+X+'" y="16" width="'+cw+'" height="'+(H-36)+'" rx="10" fill="'+fill+'"/>'
      +'<text x="'+(X+cw/2)+'" y="'+(H/2+10)+'" text-anchor="middle" style="font-size:'+Math.min(26,cw/3)+'px;font-weight:800;fill:'+(n?seqTxt(r):C_MUTE)+'">'+(n?Math.round(r*100)+'%':'–')+'</text>'
      +'<text x="'+(X+cw/2)+'" y="'+(H/2+28)+'" text-anchor="middle" style="fill:'+(n?seqTxt(r):C_MUTE)+';opacity:.8">'+(n?h+'/'+n:'')+'</text></g>'
      +'<text x="'+(X+cw/2)+'" y="11" text-anchor="middle">'+g+'</text>'
      +'<rect class="hit" x="'+X+'" y="0" width="'+cw+'" height="'+H+'" data-tip="Segment '+g+'\n'+(n?h+' von '+n+' getroffen ('+pct(r)+')':'keine Daten')+'"/>';
  }
  s+='<line x1="0" x2="'+W+'" y1="'+(H-12)+'" y2="'+(H-12)+'" stroke="#3a404a" stroke-width="3" stroke-linecap="round"/>';
  return card('Torkarte','<div class="scrollx">'+svg(W,H,s)+'</div>'+scaleLegend(),'Trefferquote je Zielsegment · Segment 1 = links aus Schützensicht');
}
function scaleLegend(){return'<div class="legend"><span><i style="background:linear-gradient(90deg,'+seq(0)+','+seq(1)+');width:60px"></i>0 → 100 %</span><span>blass = weniger als 5 Versuche</span></div>'}
function chartMatrix(W,a){
  const sh=a.filter(z=>z.st==='shot'&&typeof z.g==='number'&&z.g>0&&(typeof z.l==='number'));if(sh.length<5)return'';
  const rows=[1,2,3,4,5].filter(g=>sh.some(z=>z.g===g)),cols=[1,2,3,4,5,0];
  const L=58,Rr=30,cell=Math.min(54,(W-L-Rr)/6),H=24+rows.length*(cell+4);let s='';
  cols.forEach((c,j)=>s+='<text x="'+(L+j*cell+cell/2)+'" y="14" text-anchor="middle">'+(c?c:'✗')+'</text>');
  rows.forEach((g,i)=>{
    const x=sh.filter(z=>z.g===g),Y=22+i*(cell+4);
    s+='<text x="'+(L-10)+'" y="'+(Y+cell/2+4)+'" text-anchor="end">Ziel '+g+'</text>';
    cols.forEach((c,j)=>{
      const k=x.filter(z=>z.l===c).length,r=k/x.length,X=L+j*cell;
      s+='<rect x="'+(X+2)+'" y="'+Y+'" width="'+(cell-4)+'" height="'+cell+'" rx="7" fill="'+(k?seq(r):'#1e2229')+'"'+(c===g?' stroke="'+C_TXT+'" stroke-width="2"':'')+'/>';
      if(k)s+='<text x="'+(X+cell/2)+'" y="'+(Y+cell/2+4)+'" text-anchor="middle" style="fill:'+seqTxt(r)+';font-weight:600">'+Math.round(r*100)+'</text>';
      s+='<rect class="hit" x="'+X+'" y="'+Y+'" width="'+cell+'" height="'+cell+'" data-tip="Ziel '+g+' → '+(c?'Segment '+c:'daneben')+'\n'+k+' von '+x.length+' ('+pct(r)+')'+(c===g?'\n= Treffer':'')+'"/>';
    });
    const w=x.filter(z=>z.l>0&&!z.h);const dev=w.length?w.reduce((p,z)=>p+(z.l-z.g),0)/w.length:0;
    s+='<text x="'+(L+6*cell+10)+'" y="'+(Y+cell/2+4)+'">'+(w.length<2?'':dev<-.25?'←':dev>.25?'→':'·')+'</text>';
  });
  return card('Wohin geht der Ball?','<div class="scrollx">'+svg(W,H,s)+'</div><div class="legend"><span>Zeile = angesagtes Ziel · Spalte = wo der Ball landete · Rahmen = Treffer · Werte in % der Zeile · ← / → = Fehlschüsse gehen eher links / rechts</span></div>','Nur Schüsse mit Segment-Eingabe');
}
function chartTechTarget(W,group){
  const a=group.arr,techs=[...new Set(a.map(z=>z.k))],ts=TORDER.filter(t=>a.some(z=>z.g===t));
  if(techs.length<2&&ts.length<2)return'';
  const L=78,cell=Math.min(70,(W-L)/ts.length),ch=40,H=24+techs.length*(ch+4);let s='',combos=[];
  ts.forEach((t,j)=>s+='<text x="'+(L+j*cell+cell/2)+'" y="14" text-anchor="middle">'+tl(t,group.st)+'</text>');
  techs.forEach((k,i)=>{
    const Y=22+i*(ch+4);s+='<text x="'+(L-10)+'" y="'+(Y+ch/2+4)+'" text-anchor="end">'+esc(k)+'</text>';
    ts.forEach((t,j)=>{
      const x=a.filter(z=>z.k===k&&z.g===t),n=x.length,h=x.filter(z=>z.h).length,r=n?h/n:0,X=L+j*cell;
      if(n>=5)combos.push({k,t,r,n,X,Y});
      s+='<rect x="'+(X+2)+'" y="'+Y+'" width="'+(cell-4)+'" height="'+ch+'" rx="7" fill="'+(n?seq(r):'#1e2229')+'" opacity="'+(n&&n<5?.55:1)+'"/>';
      if(n)s+='<text x="'+(X+cell/2)+'" y="'+(Y+ch/2+5)+'" text-anchor="middle" style="fill:'+seqTxt(r)+';font-weight:600">'+Math.round(r*100)+'</text>';
      s+='<rect class="hit" x="'+X+'" y="'+Y+'" width="'+cell+'" height="'+ch+'" data-tip="'+esc(k)+' → '+tl(t,group.st)+'\n'+(n?h+' von '+n+' ('+pct(r)+')':'keine Daten')+'"/>';
    });
  });
  let note='';
  if(combos.length>1){const w=combos.sort((p,q)=>p.r-q.r)[0];
    s+='<rect x="'+(w.X+1)+'" y="'+(w.Y-1)+'" width="'+(cell-2)+'" height="'+(ch+2)+'" rx="8" fill="none" stroke="'+C_TXT+'" stroke-width="2"/>';
    note='<p class="hint">Schwachpunkt (umrandet): <b style="color:var(--text)">'+esc(w.k)+' → '+tl(w.t,group.st)+'</b> mit '+pct(w.r)+' bei '+w.n+' Versuchen.</p>'}
  return'<div class="scrollx">'+svg(Math.max(W,L+ts.length*44),H,s)+'</div>'+scaleLegend()+note;
}
function chartTechBars(W,group){
  const a=group.arr,techs=[...new Set(a.map(z=>z.k))],isPass=group.st==='pass',split=isPass&&a.some(z=>z.g==='wall')&&a.some(z=>z.g==='lane');
  const series=split?[['wall','Wall',C_S1],['lane','Lane',C_S2]]:[[null,'Quote',C_ACC]];
  const rows=techs.map(k=>({k,v:series.map(([g])=>{const x=a.filter(z=>z.k===k&&(g==null||z.g===g));return{n:x.length,h:x.filter(z=>z.h).length}})}))
    .sort((p,q)=>{const r=o=>{const n=o.v.reduce((x,y)=>x+y.n,0);return n?o.v.reduce((x,y)=>x+y.h,0)/n:0};return r(q)-r(p)});
  if(rows.length<2&&!split)return'';
  const L=78,Rr=74,bh=split?12:16,gap=split?4:0,rowH=series.length*bh+gap*(series.length-1)+14,H=rows.length*rowH+4,iw=W-L-Rr;let s='';
  rows.forEach((o,i)=>{
    const Y=4+i*rowH;s+='<text x="'+(L-10)+'" y="'+(Y+(rowH-14)/2+5)+'" text-anchor="end">'+esc(o.k)+'</text>';
    o.v.forEach((v,j)=>{
      const r=v.n?v.h/v.n:0,y0=Y+j*(bh+gap),w=Math.max(v.n?4:0,iw*r);
      s+='<rect x="'+L+'" y="'+y0+'" width="'+iw+'" height="'+bh+'" rx="4" fill="#1e2229"/>';
      if(v.n)s+='<rect x="'+L+'" y="'+y0+'" width="'+w.toFixed(1)+'" height="'+bh+'" rx="4" fill="'+series[j][2]+'"/>';
      s+='<text class="val" x="'+(L+iw+8)+'" y="'+(y0+bh-2)+'">'+(v.n?pct(r):'–')+'</text>';
      s+='<rect class="hit" x="'+L+'" y="'+(y0-2)+'" width="'+(iw+Rr)+'" height="'+(bh+4)+'" data-tip="'+esc(o.k)+(split?' · '+series[j][1]:'')+'\n'+(v.n?v.h+' von '+v.n+' ('+pct(r)+')':'keine Daten')+'"/>';
    });
  });
  return svg(W,H,s)+(split?legend(series.map(z=>[z[2],z[1]])):'');
}
function chartFunnel(W,a){
  const k=a.filter(z=>z.d==='k53');if(!k.length)return'';
  const p=k.filter(z=>z.st==='pass'),c=p.filter(z=>z.h),g=k.filter(z=>z.st==='shot'&&z.h),sh=k.filter(z=>z.st==='shot');
  if(!p.length)return'';
  const steps=[['Pässe',p.length,'#ffb020',''],['gefangen',c.length,'#c98a1a',pct(c.length/p.length)+' der Pässe'],['Tore',g.length,'#8f6418',(sh.length?pct(g.length/sh.length)+' der Schüsse · ':'')+pct(g.length/p.length)+' gesamt']];
  const L=86,iw=W-L-10,bh=26;let s='';
  steps.forEach(([t,n,col,sub],i)=>{const Y=i*(bh+18),w=Math.max(4,iw*n/p.length);
    s+='<text x="'+(L-10)+'" y="'+(Y+bh/2+5)+'" text-anchor="end">'+t+'</text><rect x="'+L+'" y="'+Y+'" width="'+w.toFixed(1)+'" height="'+bh+'" rx="4" fill="'+col+'"/>'
     +'<text class="val" x="'+(L+8)+'" y="'+(Y+bh/2+5)+'" style="fill:#111">'+n+'</text>'+(sub?'<text x="'+L+'" y="'+(Y+bh+13)+'">'+sub+'</text>':'');});
  return card('Kombi: Pass → Tor',svg(W,3*(bh+18),s));
}
function chartReaction(W,a){
  const r=a.filter(z=>z.rt!=null).map(z=>z.rt/1000);if(r.length<3)return'';
  const bin=.25,max=Math.min(6,Math.ceil(Math.max(...r)/bin)*bin),nb=Math.max(4,Math.round(max/bin)),cnt=Array(nb).fill(0);
  r.forEach(v=>cnt[Math.min(nb-1,Math.floor(v/bin))]++);
  const srt=r.slice().sort((p,q)=>p-q),med=srt[Math.floor(srt.length/2)],top=Math.max(...cnt);
  const H=170,L=10,R=10,T=18,B=24,iw=W-L-R,ih=H-T-B,bw=iw/nb;let s='<line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+(T+ih)+'" y2="'+(T+ih)+'"/>';
  cnt.forEach((c,i)=>{const h=ih*c/top,X=L+i*bw;
    if(c)s+='<path d="M'+(X+1)+' '+(T+ih)+'V'+(T+ih-h+4)+'q0-4 4-4h'+(bw-10)+'q4 0 4 4V'+(T+ih)+'Z" fill="'+C_ACC+'"/>';
    s+='<rect class="hit" x="'+X+'" y="'+T+'" width="'+bw+'" height="'+ih+'" data-tip="'+fmt(i*bin)+'–'+fmt((i+1)*bin)+' s\n'+c+' Schüsse"/>';});
  for(let v=0;v<=max+.001;v+=max>3?1:.5)s+='<text x="'+(L+v/bin*bw)+'" y="'+(H-6)+'" text-anchor="middle">'+fmt(v,v%1?1:0)+' s</text>';
  const mx=L+med/bin*bw;s+='<line x1="'+mx+'" x2="'+mx+'" y1="'+(T-6)+'" y2="'+(T+ih)+'" stroke="'+C_TXT+'" stroke-width="1.5"/><text class="val" x="'+(mx+6)+'" y="'+(T+4)+'">Median '+fmt(med)+' s</text>';
  const win=a.filter(z=>z.late!=null);
  return card('Reaktionszeit',svg(W,H,s),r.length+' gemessene Schüsse (nur mit Schusserkennung)'+(win.length?' · im Fenster: '+pct(win.filter(z=>!z.late).length/win.length):''));
}
function chartCalendar(W){
  const ex=exSet(),a=D.shots.filter(z=>!ex.has(z.s)&&baseFilter(z));
  const weeks=Math.max(10,Math.min(26,Math.floor((W-26)/22))),cs=Math.min(20,Math.floor((W-26)/weeks)-3),step=cs+3;
  const today=dayStart(Date.now()),dow=(new Date(today).getDay()+6)%7,start=today-(dow+7*(weeks-1))*864e5;
  const m=new Map();for(const z of a){if(z.t<start)continue;const d=dayStart(z.t);const o=m.get(d)||{n:0,h:0};o.n++;if(z.h)o.h++;m.set(d,o)}
  const top=Math.max(1,...[...m.values()].map(o=>o.n));let s='',lastMonth=-1;
  ['Mo','','Mi','','Fr','','So'].forEach((t,i)=>{if(t)s+='<text x="0" y="'+(18+i*step+cs-4)+'">'+t+'</text>'});
  for(let w=0;w<weeks;w++)for(let d=0;d<7;d++){
    const t=start+(w*7+d)*864e5;if(t>today)continue;const o=m.get(t),X=26+w*step,Y=18+d*step;
    const mo=new Date(t).getMonth();if(d===0&&mo!==lastMonth){lastMonth=mo;s+='<text x="'+X+'" y="10">'+new Date(t).toLocaleDateString('de-DE',{month:'short'})+'</text>'}
    s+='<rect x="'+X+'" y="'+Y+'" width="'+cs+'" height="'+cs+'" rx="4" fill="'+(o?seq(.15+.85*Math.sqrt(o.n/top)):'#1e2229')+'"'+(t===today?' stroke="'+C_TXT+'" stroke-width="1.5"':'')+'/>';
    s+='<rect class="hit" x="'+X+'" y="'+Y+'" width="'+step+'" height="'+step+'" data-tip="'+fmtDate(t)+'\n'+(o?o.n+' Aktionen · '+pct(o.h/o.n):'kein Training')+'"/>';
  }
  const days=new Set(a.map(z=>dayStart(z.t)));let streak=0,d=today;if(!days.has(d))d-=864e5;while(days.has(d)){streak++;d-=864e5}
  const recent=[...days].filter(t=>t>=today-27*864e5).length;
  return card('Trainingskalender',svg(26+weeks*step,18+7*step,s),'Trainingstage in Folge: <b style="color:var(--text)">'+streak+'</b> · Trainingstage in den letzten 4 Wochen: <b style="color:var(--text)">'+recent+'</b>');
}

/* ---------- Seite ---------- */
function renderStats(){
  const all=D.shots;
  // Filter
  const ranges=[['last','Letzte Session'],['today','Heute'],['7','7 Tage'],['30','30 Tage'],['all','Alles']];
  chipsS($('#cRange'),(ST.session?[['pin','📌 '+fmtDate((sessMeta(ST.session)||{start:(all.find(z=>z.s===ST.session)||{t:Date.now()}).t}).start,true)+' ✕']]:[]).concat(ranges).map(([v,t])=>({v,t})),
    v=>v==='pin'?true:!ST.session&&ST.range===v,v=>{ST.session=null;if(v!=='pin')ST.range=v});
  const present=Object.keys(DISC).filter(d=>all.some(z=>z.d===d));
  if(ST.disc!=='all'&&!present.includes(ST.disc))ST.disc='all';
  chipsS($('#cSDisc'),[{v:'all',t:'Alle Disziplinen'}].concat(present.map(d=>({v:d,t:DISC[d].n}))),v=>ST.disc===v,v=>{ST.disc=v;ST.tech='all'});
  const techs=[...new Set(all.filter(z=>ST.disc==='all'||z.d===ST.disc).map(z=>z.k))];
  if(!techs.includes(ST.tech))ST.tech='all';
  $('#cSTech').classList.toggle('hidden',techs.length<2);
  chipsS($('#cSTech'),[{v:'all',t:'Alle Techniken'}].concat(techs.map(t=>({v:t,t}))),v=>ST.tech===v,v=>ST.tech=v);
  const hasSig=all.some(z=>z.sig),hasFree=all.some(z=>!z.sig);
  $('#cSTime').classList.toggle('hidden',!(hasSig&&hasFree));
  chipsS($('#cSTime'),[{v:'all',t:'Frei + Signal'},{v:'free',t:'Nur frei'},{v:'sig',t:'Nur auf Signal'}],v=>ST.timing===v,v=>ST.timing=v);

  const W=Math.max(280,Math.min(728,$('#statsBody').clientWidth||document.documentElement.clientWidth-32)-30);
  const w=rangeWindow(),a=selShots(w),body=$('#statsBody');
  let html='';
  if(!a.length){
    html=card('Keine Daten','<p class="hint" style="margin:0">Für diese Auswahl gibt es noch keine Einträge. Zeitraum oder Filter ändern.</p>');
  }else{
    const b=agg(a),cmp=compareShots(w),single=!!w.sid||new Set(a.map(z=>z.s)).size===1;
    let delta='';
    if(cmp){const c=agg(cmp.a),d=Math.round((b.rate-c.rate)*100);
      delta='<div class="delta '+(d>0?'up':d<0?'down':'')+'">'+(d>0?'▲ +'+d:d<0?'▼ −'+(-d):'± 0')+' Pkt <span>ggü. '+cmp.label+' ('+pct(c.rate)+')</span></div>'}
    const scope=w.sid?(sessMeta(w.sid)?fmtDate(sessMeta(w.sid).start,true):'Session'):{today:'Heute','7':'Letzte 7 Tage','30':'Letzte 30 Tage',all:'Gesamter Zeitraum'}[ST.range];
    const rts=a.filter(z=>z.rt!=null);
    html+='<div class="card"><h2>'+scope+(w.sid&&sessMeta(w.sid)&&sessMeta(w.sid).note?' · '+esc(sessMeta(w.sid).note):'')+'</h2><div class="hero"><div class="heronum">'+pct(b.rate)+'</div><div><div class="hl">Erfolgsquote · '+b.h+' von '+b.n+'</div>'+delta+'</div></div>'
      +'<div class="tiles" style="margin-top:14px"><div class="tile"><b>'+b.n+'</b><span>Aktionen</span></div>'
      +'<div class="tile"><b>'+new Set(a.map(z=>z.s)).size+'</b><span>Sessions</span></div>'
      +'<div class="tile"><b>'+Math.round(minutesOf(a))+'</b><span>Minuten</span></div>'
      +'<div class="tile"><b>'+(rts.length?fmt(rts.reduce((p,z)=>p+z.rt,0)/rts.length/1000):bestRun(a))+'</b><span>'+(rts.length?'Ø Reaktion (s)':'Beste Serie')+'</span></div></div></div>';
    html+=card(single?'Verlauf in der Session':'Verlauf über Sessions',chartTrend(W,a,single));
    const shots=a.filter(z=>z.st==='shot');
    if(shots.length){html+=chartGoal(W,shots);html+=chartMatrix(W,shots)}
    for(const g of groups(a)){
      const tt=chartTechTarget(W,g),tb=chartTechBars(W,g);
      if(tt||tb)html+=card(g.title,(tb?'<div class="blockh" style="margin-top:0">Je Technik</div>'+tb:'')+(tt?'<div class="blockh">Technik × Ziel</div>'+tt:''));
    }
    html+=chartFunnel(W,a);
    html+=chartReaction(W,a);
    const sig=a.filter(z=>z.sig),fr=a.filter(z=>!z.sig);
    if(sig.length&&fr.length)html+=card('Frei vs. auf Signal','<div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile"><b>'+pct(agg(fr).rate)+'</b><span>freies Tempo · n='+fr.length+'</span></div><div class="tile"><b>'+pct(agg(sig).rate)+'</b><span>auf Signal · n='+sig.length+'</span></div></div>');
  }
  html+=chartCalendar(W);
  html+=renderSessionList();
  body.innerHTML=html;
}
function renderSessionList(){
  let ls=sessionsList().filter(x=>ST.disc==='all'||x.arr.some(z=>z.d===ST.disc));
  const total=ls.length;if(!ST.more)ls=ls.slice(0,15);
  let h='';
  for(const x of ls){
    const b=agg(x.arr),meta=x.meta||{},techs=[...new Set(x.arr.map(z=>z.k))].join(', '),open=ST.open===x.id;
    h+='<div class="srow'+(x.ex?' ex':'')+'"><div class="top" data-act="open" data-id="'+x.id+'"><span>'+fmtDate(x.start,true)+(x.ex?'<span class="badge">ausgeschlossen</span>':'')+'</span><b>'+pct(b.rate)+'</b></div>'
      +'<small data-act="open" data-id="'+x.id+'">'+discName(x.arr[0].d)+' · '+esc(techs)+' · '+b.n+' Aktionen'+(meta.note?' · „'+esc(meta.note)+'“':'')+'</small>';
    if(open){
      h+='<div class="acts"><button data-act="view" data-id="'+x.id+'">Ansehen</button><button data-act="edit" data-id="'+x.id+'">'+(ST.edit===x.id?'Bearbeiten schließen':'Einträge bearbeiten')+'</button>'
        +'<button data-act="note" data-id="'+x.id+'">Notiz</button><button data-act="ex" data-id="'+x.id+'">'+(x.ex?'Wieder einbeziehen':'Aus Statistik ausschließen')+'</button>'
        +'<button data-act="del" data-id="'+x.id+'" style="color:var(--miss)">Löschen</button></div>';
      if(ST.edit===x.id)h+=renderEntries(x);
    }
    h+='</div>';
  }
  if(total>ls.length)h+='<button class="big" data-act="more">Alle '+total+' Sessions zeigen</button>';
  return card('Sessions',h||'<p class="hint" style="margin:0">Noch keine Sessions.</p>','Antippen für Details, Notiz, Ausschließen (z. B. Testläufe) oder Korrekturen');
}
function renderEntries(x){
  let h='<div class="entries">';
  x.arr.forEach((z,i)=>{
    const idx=D.shots.indexOf(z),seg=z.st==='shot'&&typeof z.g==='number'&&z.g>0&&typeof z.l==='number';
    h+='<div class="erow"><span>'+(i+1)+'. '+esc(z.k)+' → '+tl(z.g,z.st)+(z.st==='pass'&&DISC[z.d]&&DISC[z.d].kind==='combo'?' (Pass)':'')+(z.fix?' ✎':'')+'</span>';
    if(seg){for(let n=1;n<=5;n++)h+='<button class="eb'+(z.l===n?(z.h?' on':' onm'):'')+'" data-act="set" data-i="'+idx+'" data-v="'+n+'">'+n+'</button>';
      h+='<button class="eb'+(z.l===0?' onm':'')+'" data-act="set" data-i="'+idx+'" data-v="0">✗</button>'}
    else h+='<button class="eb'+(z.h?' on':'')+'" data-act="hit" data-i="'+idx+'" data-v="1">✓</button><button class="eb'+(!z.h?' onm':'')+'" data-act="hit" data-i="'+idx+'" data-v="0">✗</button>';
    h+='<button class="eb" data-act="rm" data-i="'+idx+'" aria-label="Eintrag löschen">🗑</button></div>';
  });
  return h+'</div>';
}
function ensureMeta(id){let m=sessMeta(id);if(!m){const z=D.shots.find(s=>s.s===id);m={id,start:z?z.t:Date.now(),d:z?z.d:'s3'};D.sessions.push(m)}return m}
$('#statsBody').addEventListener('click',e=>{
  const t=e.target.closest('[data-tip]');
  if(t){showTip(t.dataset.tip,e.clientX,e.clientY);return}
  hideTip();
  const b=e.target.closest('[data-act]');if(!b)return;
  const act=b.dataset.act,id=b.dataset.id,i=+b.dataset.i;
  if(act==='open'){ST.open=ST.open===id?null:id;if(ST.open!==id)ST.edit=null}
  else if(act==='view'){ST.session=id;window.scrollTo(0,0)}
  else if(act==='edit'){ST.edit=ST.edit===id?null:id}
  else if(act==='note'){const m=ensureMeta(id),v=prompt('Notiz zur Session',m.note||'');if(v===null)return;m.note=v.trim();save(LS_DATA,D)}
  else if(act==='ex'){const m=ensureMeta(id);m.x=!m.x;save(LS_DATA,D);toast(m.x?'Session wird nicht mehr gezählt':'Session zählt wieder')}
  else if(act==='del'){if(!confirm('Diese Session mit allen Einträgen löschen?'))return;D.shots=D.shots.filter(z=>z.s!==id);D.sessions=D.sessions.filter(z=>z.id!==id);cloudDelS(id);if(ST.session===id)ST.session=null;ST.open=null;save(LS_DATA,D);toast('Session gelöscht')}
  else if(act==='more'){ST.more=true}
  else if(act==='set'){const z=D.shots[i];if(!z)return;const v=+b.dataset.v;z.l=v;z.h=v>0&&v===z.g;z.fix=true;save(LS_DATA,D)}
  else if(act==='hit'){const z=D.shots[i];if(!z)return;z.h=b.dataset.v==='1';if(typeof z.l==='number'&&z.g>0)z.l=z.h?z.g:0;z.fix=true;save(LS_DATA,D)}
  else if(act==='rm'){const z=D.shots[i];if(!z||!confirm('Eintrag löschen?'))return;D.shots.splice(i,1);cloudDelT(z);if(!D.shots.some(s=>s.s===z.s)){D.sessions=D.sessions.filter(m=>m.id!==z.s);cloudDelS(z.s);ST.open=null}save(LS_DATA,D)}
  const y=window.scrollY;renderStats();window.scrollTo(0,y);
});
function showTip(t,x,y){const el=$('#tip');el.textContent=t;el.classList.remove('hidden');const r=el.getBoundingClientRect();
  el.style.left=Math.max(8,Math.min(window.innerWidth-r.width-8,x-r.width/2))+'px';el.style.top=Math.max(8,y-r.height-14)+'px'}
function hideTip(){$('#tip').classList.add('hidden')}
window.addEventListener('scroll',hideTip,{passive:true});
let rsT=0;window.addEventListener('resize',()=>{clearTimeout(rsT);rsT=setTimeout(()=>{if(!$('#stats').classList.contains('hidden'))renderStats()},200)});
