'use strict';
/* KickerTrainer · Konto und Cloud-Sync (optional) */
/* ---------- Konto & Cloud-Sync (optional) ---------- */
// Ohne Anmeldung passiert hier nichts: keine Netzwerkzugriffe, die Bibliothek wird nicht einmal geladen.
// Der Schlüssel ist öffentlich vorgesehen; der Schutz der Daten liegt in den Zugriffsregeln (RLS) der Datenbank.
const SB_URL='https://ihbyurdtfjwhpladpmwz.supabase.co',SB_KEY='sb_publishable_Rdw395pb94xPIKioLD8Z-A_ryjK8qTV';
const SB_LIB='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
const SB_SRI='sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';
const SB_AUTH='sb-ihbyurdtfjwhpladpmwz-auth-token',LS_SYNC='kt2_sync';
const SY0=()=>({uid:null,email:null,last:null,at:null,h:{},delS:[],delT:[]});
let SY=Object.assign(SY0(),load(LS_SYNC,{}));
function saveSY(){save(LS_SYNC,SY)}
var CL={sb:null,user:null,busy:false,again:false,timer:0,apply:false,err:'',step:'out',pend:'',cd:0,info:null};

/* Abbildung lokal <-> Datenbank (verlustfrei: unbekannte Felder wandern in "extra") */
const fnv=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}return(h>>>0).toString(36)};
const nz=v=>v===undefined?null:v;
const num=v=>typeof v==='number'&&isFinite(v)?Math.round(v):null;
const SH_K=['s','t','d','st','k','g','l','h','rt','late','sig','end','auto'],SE_K=['id','start','d','cfg','note','x'];
function extraOf(o,known){const x={};Object.keys(o).sort().forEach(k=>{if(!known.includes(k)&&o[k]!==undefined)x[k]=o[k]});return x}
const kS=x=>'s:'+x.id,kT=e=>'t:'+e.s+'|'+e.t+'|'+e.st;
const okS=x=>!!(x&&x.id),okT=e=>!!(e&&e.s&&isFinite(e.t)&&(e.st==='shot'||e.st==='pass'));
function sessRow(x){return{id:x.id,started_at:new Date(+x.start||0).toISOString(),discipline:nz(x.d),cfg:x.cfg||{},note:x.note||null,excluded:!!x.x,extra:extraOf(x,SE_K)}}
function shotRow(e){return{session_id:e.s,t:e.t,kind:e.st,discipline:nz(e.d),technique:nz(e.k),target:e.g==null?null:String(e.g),landed:num(e.l),hit:e.h==null?null:!!e.h,rt:num(e.rt),late:e.late==null?null:!!e.late,signal:!!e.sig,is_end:e.end!==false,auto:!!e.auto,extra:extraOf(e,SH_K)}}
function toSess(r){const x=Object.assign({},r.extra||{},{id:r.id,start:Date.parse(r.started_at),d:r.discipline,cfg:r.cfg||{}});if(r.note)x.note=r.note;if(r.excluded)x.x=true;return x}
function toShot(r){const e=Object.assign({},r.extra||{},{s:r.session_id,t:+r.t,d:r.discipline,st:r.kind,k:r.technique,g:r.target==null?null:(/^\d+$/.test(r.target)?+r.target:r.target),l:r.landed,h:r.hit,rt:r.rt,late:r.late,sig:!!r.signal,end:r.is_end!==false});if(r.auto)e.auto=true;return e}
const hashOf=row=>fnv(JSON.stringify(row));
function replaceIn(o,n){Object.keys(o).forEach(k=>delete o[k]);Object.assign(o,n)}

/* Bibliothek erst bei Bedarf laden (mit Prüfsumme) */
function sbLib(){return new Promise((ok,no)=>{
  if(window.supabase&&window.supabase.createClient)return ok(window.supabase);
  const s=document.createElement('script');s.src=SB_LIB;s.integrity=SB_SRI;s.crossOrigin='anonymous';
  s.onload=()=>window.supabase&&window.supabase.createClient?ok(window.supabase):no(new Error('Bibliothek ungültig'));
  s.onerror=()=>no(new Error('offline'));document.head.appendChild(s)})}
async function sbInit(){
  if(CL.sb)return CL.sb;
  const lib=await sbLib();
  const sb=lib.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  sb.auth.onAuthStateChange(ev=>{if(ev==='SIGNED_OUT'&&CL.user)setTimeout(()=>{CL.user=null;CL.err='';CL.step='out';renderAcct()},0)});
  CL.sb=sb;return sb}

function errText(e,dflt){const m=String((e&&e.message)||e||'');
  if(/failed to fetch|network|load failed|offline|bibliothek/i.test(m))return'Offline – keine Verbindung';
  if(/rate limit|security purposes|too many/i.test(m))return'Zu viele Versuche – bitte kurz warten';
  if(/expired|invalid/i.test(m)&&dflt)return dflt;
  return(dflt?dflt+': ':'')+m.slice(0,100)}

/* Abgleich: erst holen, dann hochladen. Lokal geänderte Zeilen gewinnen, unveränderte werden aktualisiert. */
function mergeRows(arr,map,rows,conv,rowFn,keyFn,skip){
  let ch=0;
  for(const r of rows){
    const n=conv(r);if(skip(n))continue;
    const k=keyFn(n),nh=hashOf(rowFn(n)),cur=map.get(k);
    if(!cur){arr.push(n);map.set(k,n);SY.h[k]=nh;ch++;continue}
    const lh=hashOf(rowFn(cur));
    if(lh===nh){SY.h[k]=nh;continue}
    if(SY.h[k]!==undefined&&lh===SY.h[k]){replaceIn(cur,n);SY.h[k]=nh;ch++} // lokal unverändert: Konto gewinnt
    // sonst lokal geändert oder nie abgeglichen: lokal gewinnt und wird gleich hochgeladen
  }
  return ch}
async function pullAll(sb,table,order,since){
  const out=[];
  for(let from=0;;from+=1000){
    let q=sb.from(table).select('*');if(since)q=q.gte('updated_at',since);
    for(const o of order)q=q.order(o,{ascending:true});
    const{data,error}=await q.range(from,from+999);if(error)throw error;
    out.push(...data);if(data.length<1000)break}
  return out}
async function cloudPull(sb){
  if(!D.shots.length&&!D.sessions.length&&Object.keys(SY.h).length){SY.h={};SY.last=null} // lokale Daten weg (z. B. von iOS gelöscht): alles neu holen
  const p=Date.parse(SY.last||''),since=isNaN(p)?null:new Date(p-3e5).toISOString(); // 5 Minuten Überlappung gegen Zeitgleichheit
  const rs=await pullAll(sb,'sessions',['updated_at','id'],since);
  const rt=await pullAll(sb,'shots',['updated_at','session_id','t','kind'],since);
  const delT=new Set(SY.delT.map(a=>'t:'+a[0]+'|'+a[1]+'|'+a[2]));
  CL.apply=true;let ch=0;
  try{
    ch+=mergeRows(D.sessions,new Map(D.sessions.filter(okS).map(x=>[kS(x),x])),rs,toSess,sessRow,kS,x=>SY.delS.includes(x.id));
    ch+=mergeRows(D.shots,new Map(D.shots.filter(okT).map(e=>[kT(e),e])),rt,toShot,shotRow,kT,e=>SY.delS.includes(e.s)||delT.has(kT(e)));
    if(ch){D.shots.sort((a,b)=>a.t-b.t);D.sessions.sort((a,b)=>a.start-b.start);save(LS_DATA,D)}
  }finally{CL.apply=false}
  for(const r of rs.concat(rt))if(r.updated_at&&(!SY.last||r.updated_at>SY.last))SY.last=r.updated_at;
  saveSY();return{down:ch,rerender:ch>0}}
async function cloudPush(sb,uid){
  let up=0;
  for(const id of SY.delS.slice()){ // gemerkte Löschungen zuerst
    let r=await sb.from('shots').delete().eq('user_id',uid).eq('session_id',id);if(r.error)throw r.error;
    r=await sb.from('sessions').delete().eq('user_id',uid).eq('id',id);if(r.error)throw r.error;
    SY.delS=SY.delS.filter(x=>x!==id);saveSY()}
  for(const a of SY.delT.slice()){
    const r=await sb.from('shots').delete().eq('user_id',uid).eq('session_id',a[0]).eq('t',a[1]).eq('kind',a[2]);if(r.error)throw r.error;
    SY.delT=SY.delT.filter(x=>!(x[0]===a[0]&&x[1]===a[1]&&x[2]===a[2]));saveSY()}
  const send=async(table,conf,items)=>{
    for(let i=0;i<items.length;i+=500){
      const b=items.slice(i,i+500),{error}=await sb.from(table).upsert(b.map(x=>Object.assign({user_id:uid},x.row)),{onConflict:conf});
      if(error)throw error;
      b.forEach(x=>{SY.h[x.k]=x.h});saveSY();up+=b.length}};
  const ses=[],sh=[];
  for(const x of D.sessions){if(!okS(x))continue;const row=sessRow(x),h=hashOf(row),k=kS(x);if(SY.h[k]!==h)ses.push({row,h,k})}
  for(const e of D.shots){if(!okT(e))continue;const row=shotRow(e),h=hashOf(row),k=kT(e);if(SY.h[k]!==h)sh.push({row,h,k})}
  await send('sessions','user_id,id',ses);
  await send('shots','user_id,session_id,t,kind',sh);
  return{up}}
async function cloudSync(manual){
  if(!CL.user)return;
  if(CL.busy){CL.again=true;return}
  if(R&&R.active&&!manual){scheduleSync(60000);return} // nicht mitten im Training
  if(!navigator.onLine){CL.err='Offline – wird später abgeglichen';renderAcct();return}
  CL.busy=true;CL.err='';CL.info=null;renderAcct();
  try{
    const sb=await sbInit(),{data,error}=await sb.auth.getSession();
    if(error)throw error;
    if(!data.session){CL.user=null;CL.step='out';toast('Sitzung abgelaufen – bitte neu anmelden');return}
    const uid=data.session.user.id;
    if(SY.uid&&SY.uid!==uid)throw new Error('Gerätedaten gehören zu einem anderen Konto');
    const d=await cloudPull(sb),u=await cloudPush(sb,uid);
    SY.at=Date.now();saveSY();CL.info={up:u.up,down:d.down};
    if(d.rerender){renderHome();if(!$('#stats').classList.contains('hidden'))renderStats()}
  }catch(e){CL.err=errText(e)}
  finally{CL.busy=false;renderAcct();if(CL.again){CL.again=false;scheduleSync(2000)}}}
function scheduleSync(ms){clearTimeout(CL.timer);CL.timer=setTimeout(()=>cloudSync(false),ms)}
function cloudTouch(){if(!CL||CL.apply||!CL.user)return;scheduleSync(20000)} // von save() bei jeder Datenänderung aufgerufen
function cloudDelS(id){ // Session samt Einträgen gelöscht
  if(!SY.uid)return;
  Object.keys(SY.h).forEach(k=>{if(k==='s:'+id||k.startsWith('t:'+id+'|'))delete SY.h[k]});
  if(!SY.delS.includes(id))SY.delS.push(id);saveSY();cloudTouch()}
function cloudDelT(z){ // einzelner Eintrag gelöscht
  if(!SY.uid)return;
  delete SY.h[kT(z)];SY.delT.push([z.s,z.t,z.st]);saveSY();cloudTouch()}
async function cloudWipe(){ // alles im Konto löschen (bei "Alle Daten löschen")
  const sb=await sbInit(),{data,error}=await sb.auth.getSession();
  if(error||!data.session)throw error||new Error('Nicht angemeldet');
  const uid=data.session.user.id;
  for(const t of['shots','sessions']){const r=await sb.from(t).delete().eq('user_id',uid);if(r.error)throw r.error}
  const u=SY.uid,m=SY.email;SY=SY0();SY.uid=u;SY.email=m;saveSY()}

/* Oberfläche */
function renderAcct(){
  const li=!!CL.user,s=CL.step;
  $('#acOut').classList.toggle('hidden',li||s!=='out');
  $('#acMail').classList.toggle('hidden',li||s!=='mail');
  $('#acCode').classList.toggle('hidden',li||s!=='code');
  $('#acIn').classList.toggle('hidden',!li);
  if(li){
    $('#acUser').textContent=CL.user.email||'–';
    const st=$('#acState');
    st.textContent=CL.busy?'Synchronisiere …':CL.err?CL.err:SY.at?'Zuletzt '+new Date(SY.at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'Noch nicht abgeglichen';
    st.style.color=CL.err&&!CL.busy?'var(--miss)':'';
    $('#acSync').disabled=CL.busy}
  $('#acResend').disabled=CL.cd>0;
  $('#acResend').textContent=CL.cd>0?'Neuen Code senden ('+CL.cd+')':'Neuen Code senden'}
function acStep(s){CL.step=s;renderAcct()}
function startCd(n){CL.cd=n;clearInterval(startCd.t);startCd.t=setInterval(()=>{CL.cd--;if(CL.cd<=0){CL.cd=0;clearInterval(startCd.t)}renderAcct()},1000)}
async function signOutLocal(){
  try{if(CL.sb)await CL.sb.auth.signOut({scope:'local'})}catch(e){}
  try{localStorage.removeItem(SB_AUTH)}catch(e){}
  clearTimeout(CL.timer);CL.user=null;CL.err='';CL.step='out';renderAcct()}
async function sendCode(again){
  const em=again?CL.pend:$('#acEmail').value.trim().toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(em)){toast('Bitte eine gültige E-Mail eintragen');return}
  const b=$(again?'#acResend':'#acSend');b.disabled=true;
  try{
    const sb=await sbInit(),{error}=await sb.auth.signInWithOtp({email:em,options:{shouldCreateUser:true}});
    if(error)throw error;
    CL.pend=em;$('#acCodeHint').textContent='Wir haben einen Code an '+em+' geschickt. Gib ihn hier ein.';
    startCd(60);acStep('code');$('#acToken').value='';setTimeout(()=>$('#acToken').focus(),50)
  }catch(e){toast(errText(e,'Code konnte nicht gesendet werden'))}
  finally{b.disabled=false;renderAcct()}}
async function adopt(user){ // nach erfolgreicher Anmeldung: Gerätedaten zuordnen
  const n=D.shots.length;
  if(SY.uid&&SY.uid!==user.id){
    if(!confirm('Auf diesem Gerät liegen Daten eines anderen Kontos'+(SY.email?' ('+SY.email+')':'')+'. Mit diesem Konto zusammenführen?\n\nAbbrechen = wieder abmelden.')){await signOutLocal();return}
    SY=SY0();
  }else if(!SY.uid&&n>0){
    if(!confirm('Deine '+n+' bisherigen Einträge auf diesem Gerät in dein Konto übernehmen? Daten, die schon im Konto liegen, werden dazugemischt.\n\nAbbrechen = wieder abmelden.')){await signOutLocal();return}
  }
  SY.uid=user.id;SY.email=user.email||null;saveSY();
  CL.user=user;CL.step='out';CL.err='';renderAcct();cloudSync(true)}
$('#acStart').onclick=()=>{acStep('mail');setTimeout(()=>$('#acEmail').focus(),50)};
$('#acCancel1').onclick=()=>acStep('out');
$('#acCancel2').onclick=()=>acStep('out');
$('#acSend').onclick=()=>sendCode(false);
$('#acResend').onclick=()=>sendCode(true);
$('#acVerify').onclick=async()=>{
  const tok=$('#acToken').value.replace(/\s/g,'');
  if(!/^\d{6,10}$/.test(tok)){toast('Bitte den Code aus der E-Mail eintragen');return}
  const b=$('#acVerify');b.disabled=true;
  try{
    const sb=await sbInit(),{data,error}=await sb.auth.verifyOtp({email:CL.pend,token:tok,type:'email'});
    if(error)throw error;
    await adopt(data.user)
  }catch(e){toast(errText(e,'Code ungültig oder abgelaufen'))}
  finally{b.disabled=false}};
$('#acSync').onclick=async()=>{
  await cloudSync(true);
  if(!CL.err&&CL.info)toast(CL.info.up||CL.info.down?'Abgeglichen: '+CL.info.up+' hochgeladen, '+CL.info.down+' geholt':'Alles aktuell')};
$('#acOutBtn').onclick=async()=>{
  if(!confirm('Abmelden? Deine Daten bleiben im Konto und auf diesem Gerät erhalten.'))return;
  if(navigator.onLine&&!CL.busy)await cloudSync(true); // letzter Abgleich vor dem Abmelden
  await signOutLocal();toast('Abgemeldet')};
$('#acDelete').onclick=async()=>{
  if(!confirm('Konto wirklich löschen? Deine E-Mail-Adresse und ALLE Daten im Konto werden unwiderruflich gelöscht. Die Daten auf diesem Gerät bleiben erhalten.'))return;
  if(!confirm('Sicher? Das kann nicht rückgängig gemacht werden.'))return;
  const b=$('#acDelete');b.disabled=true;
  try{
    const sb=await sbInit(),{error}=await sb.rpc('delete_my_account');
    if(error)throw error;
    SY=SY0();saveSY();await signOutLocal();toast('Konto gelöscht')
  }catch(e){toast(errText(e,'Löschen fehlgeschlagen'))}
  finally{b.disabled=false}};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&CL.user&&CL.sb&&Date.now()-(SY.at||0)>6e4)scheduleSync(1500)});
window.addEventListener('online',()=>{if(!CL.user)return;if(CL.sb)scheduleSync(2000);else cloudBoot()});
async function cloudBoot(){
  let raw=null;try{raw=localStorage.getItem(SB_AUTH)}catch(e){}
  if(!raw){renderAcct();return} // nie angemeldet: nichts laden, nichts senden
  try{const u=JSON.parse(raw).user;if(u&&u.id)CL.user={id:u.id,email:u.email}}catch(e){}
  renderAcct();
  try{
    const sb=await sbInit(),{data}=await sb.auth.getSession();
    CL.user=data.session?data.session.user:null;
    if(!CL.user)toast('Sitzung abgelaufen – bitte neu anmelden');
    CL.err=''
  }catch(e){CL.err='Offline – wird später abgeglichen'}
  renderAcct();if(CL.user&&!CL.err)scheduleSync(1500)}
