/* Test der Rechenlogik der Bilanz (js/bilanz.js), ohne Browser.
   Sieg/Niederlage aus meiner Sicht (Team 1 und Team 2), Filter, Serien, Gegner als
   Person statt Name (zwei Franks), Partner, Paare, Monate, eigene Tore. */
const vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={};vm.createContext(ctx);
const src=fs.readFileSync(path.resolve(__dirname,'../js/bilanz.js'),'utf8');
vm.runInContext(src.slice(0,src.indexOf('/* ---------- Darstellung'))
  +';Object.assign(this,{bzEloSeries,bzNorm,bzPrep,bzSum,bzStreaks,bzOpponents,bzPartners,bzPairs,bzMonths,bzGoals,BZ_MIN_RATE});',ctx);
const {bzEloSeries,bzNorm,bzPrep,bzSum,bzOpponents,bzPartners,bzPairs,bzMonths,bzGoals}=ctx;
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};

const ME='me', NOW=Date.parse('2026-11-25T18:00:00Z');
const P=(id,nick,team,kind='guest',pos=null)=>({id,nick,team,kind,pos,del:false});
let n=0;
// Einzel: ich in Team t, Gegner opp, Satzstände [[a,b,w],…], vor d Tagen
function single(t,opp,sets,d,o={}){
  n++;return Object.assign({id:'m'+n,me:ME,at:new Date(NOW-d*864e5).toISOString(),mode:'single',detail:'simple',
    category:'ranked',state:'confirmed',host:true,team:t,
    players:[P(ME,'Olli',t,'account'),Object.assign({},opp,{team:t===1?2:1})],sets,goals:[]},o)}
function double(t,partner,o1,o2,sets,d,o={}){
  n++;const ot=t===1?2:1;
  return Object.assign({id:'m'+n,me:ME,at:new Date(NOW-d*864e5).toISOString(),mode:'double',detail:'simple',
    category:'ranked',state:'confirmed',host:true,team:t,
    players:[P(ME,'Olli',t,'account','off'),Object.assign({},partner,{team:t}),Object.assign({},o1,{team:ot}),Object.assign({},o2,{team:ot})],sets,goals:[]},o)}

const frank=P('g-frank','Frank'), frank2=P('g-frank-b','Frank'), jan=P('g-jan','Jan'), basti=P('a-basti','Basti',0,'account'), kim=P('g-kim','Kim');

console.log('== Sieg aus meiner Sicht ==');
{const a=bzNorm(single(1,frank,[[5,3,1]],1)), b=bzNorm(single(2,frank,[[5,3,1]],1)), c=bzNorm(single(2,frank,[[2,5,2],[5,4,1],[1,5,2]],1));
 ok(a.win&&a.gf===5&&a.ga===3,'Team 1, 5:3 → Sieg, Tore 5:3');
 ok(!b.win&&b.gf===3&&b.ga===5,'Team 2, 5:3 → Niederlage, Tore aus meiner Sicht 3:5');
 ok(c.win&&c.sw===2&&c.sl===1&&c.gf===14&&c.ga===8,"Team 2, drei Sätze 2:1 → Sieg, Tore 14:8");
 ok(bzNorm(single(1,frank,[[3,3,null]],1))===null,'Ohne Satzsieger nicht wertbar');
 ok(bzNorm({id:'x'})===null,'Kaputter Eintrag wird übersprungen');}

console.log('== Filter ==');
const raw=[
  single(1,frank,[[5,1,1]],400),                         // alt
  single(1,frank,[[2,5,2]],100),
  single(2,jan,[[3,5,2]],40,{category:'casual'}),        // Sieg (Team 2)
  single(1,frank,[[5,4,1]],20,{state:'finished'}),        // unbestätigt
  single(1,frank,[[1,5,2]],10,{state:'disputed'}),        // zählt nicht
  double(1,basti,jan,kim,[[5,2,1]],5),
  double(1,basti,jan,kim,[[4,5,2]],3),
  double(2,kim,frank,jan,[[5,3,1],[2,5,2],[1,5,2]],2),   // Sieg (Team 2 gewinnt 2 Sätze)
  single(1,frank2,[[5,0,1]],1),                          // der ANDERE Frank
];
const all=bzPrep(raw,{range:'all',mode:'all',cat:'all'},NOW);
ok(all.length===8,'Strittiges Spiel fehlt, 8 bleiben (war '+all.length+')');
ok(all[0].at<all[all.length-1].at,'Sortiert: älteste zuerst');
ok(bzPrep(raw,{range:'30',mode:'all',cat:'all'},NOW).length===5,'30 Tage');
ok(bzPrep(raw,{range:'365',mode:'all',cat:'all'},NOW).length===7,'12 Monate');
ok(bzPrep(raw,{range:'all',mode:'single',cat:'all'},NOW).length===5,'Nur Einzel');
ok(bzPrep(raw,{range:'all',mode:'double',cat:'all'},NOW).length===3,'Nur Doppel');
ok(bzPrep(raw,{range:'all',mode:'all',cat:'casual'},NOW).length===1,'Nur locker');
ok(bzPrep(raw,{range:'all',mode:'all',cat:'ranked'},NOW).length===7,'Nur Wertung');

console.log('== Übersicht ==');
const s=bzSum(all);
// Folge alt→neu: S N S S S N S S
ok(s.n===8&&s.w===6&&s.l===2,'6 Siege, 2 Niederlagen ('+s.w+'–'+s.l+')');
ok(s.open===1,'1 unbestätigtes Spiel ausgewiesen');
ok(s.cur===2,'Aktuelle Serie: 2 Siege ('+s.cur+')');
ok(s.best===3,'Längste Siegserie 3 ('+s.best+')');
ok(s.form.length===8&&s.form[0]===true&&s.form[1]===false,'Form in zeitlicher Reihenfolge');
ok(bzSum(all.slice(0,2)).cur===-1,'Serie nach einer Niederlage: −1');
ok(bzSum([]).n===0&&bzSum([]).rate===0,'Leere Liste geht');
{const many=[];for(let i=0;i<14;i++)many.push(bzNorm(single(1,frank,[[5,0,1]],30-i)));ok(bzSum(many).form.length===10,'Form zeigt höchstens 10')}

console.log('== Gegner als Person ==');
const opps=bzOpponents(all);
const f1=opps.find(o=>o.id==='g-frank'), f2=opps.find(o=>o.id==='g-frank-b'), j=opps.find(o=>o.id==='g-jan');
ok(f1&&f2&&f1!==f2,'Zwei Franks sind zwei Einträge');
ok(f1.n===4&&f1.w===3,'Mein Frank: 4 Spiele, 3 Siege (Einzel + Doppel) ('+f1.n+'/'+f1.w+')');
ok(f2.n===1&&f2.w===1,'Der andere Frank: 1 Spiel');
ok(j.n===4&&j.w===3,'Jan: 4 Spiele (1 Einzel, 3 Doppel), 3 Siege ('+j.n+'/'+j.w+')');
ok(!opps.some(o=>o.id===ME),'Ich stehe nicht in meiner Gegnerliste');
ok(!opps.some(o=>o.id==='a-basti'),'Partner ist kein Gegner');
ok(opps[0].n>=opps[opps.length-1].n,'Sortiert nach Anzahl');

console.log('== Partner und Paare ==');
const parts=bzPartners(all);
ok(parts.length===2&&parts.find(p=>p.id==='a-basti').n===2&&parts.find(p=>p.id==='a-basti').w===1,'Basti: 2 Doppel zusammen, 1 Sieg');
ok(parts.find(p=>p.id==='g-kim').n===1,'Kim als Partner: 1');
const pairs=bzPairs(all);
const jk=pairs.find(p=>p.nick==='Jan & Kim'||p.nick==='Kim & Jan');
ok(jk&&jk.n===2&&jk.w===1,'Paar Jan & Kim: 2 Spiele, 1 Sieg');
ok(pairs.length===2,'Zwei verschiedene Paare');

console.log('== Monate ==');
const mon=bzMonths(all);
ok(mon.length>=4&&mon.every((x,i)=>!i||mon[i-1].key<x.key),'Monate aufsteigend ('+mon.map(x=>x.key).join(', ')+')');
ok(mon.reduce((a,x)=>a+x.n,0)===8,'Summe der Monate = alle Spiele');

console.log('== Eigene Tore (Erweitert) ==');
{const m=single(1,frank,[[5,3,1]],1,{detail:'full',goals:[[1,1,ME,null,false],[1,1,ME,null,false],[1,2,'g-frank',null,false],[1,2,ME,null,true]]});
 const d=double(1,basti,jan,kim,[[5,1,1]],1,{detail:'full',goals:[[1,1,ME,'off',false],[1,1,ME,'def',false],[1,1,'a-basti','def',false]]});
 const g=bzGoals(bzPrep([m,d,single(1,frank,[[5,0,1]],1)],{range:'all',mode:'all',cat:'all'},NOW));
 ok(g.matches===2,'Nur Erweitert-Spiele gezählt');
 ok(g.goals===4&&g.own===1,'4 eigene Tore, 1 Eigentor getrennt ('+g.goals+'/'+g.own+')');
 ok(g.off===1&&g.def===1,'Sturm/Abwehr 1/1');}

console.log('== Unentschieden ==');
{const dr=bzNorm(single(1,frank,[[5,4,1],[0,5,2],[4,4,0]],1));
 ok(dr&&dr.draw&&!dr.win,'Remis-Satz → Remis, kein Sieg');
 const l=[bzNorm(single(1,frank,[[5,0,1]],3)),dr,bzNorm(single(1,frank,[[0,5,2]],0))];
 const s=bzSum(l);
 ok(s.w===1&&s.d===1&&s.l===1,'S–U–N 1–1–1');
 ok(Math.abs(s.rate-0.5)<1e-9,'Quote: Remis halb (1,5 von 3)');
 ok(s.form.join(',')==='true,d,false','Form mit U');
 ok(bzSum(l.slice(0,2)).cur===0,'Remis unterbricht die Serie')}

console.log('== Elo-Kurve und Delta ==');
{const h=[{kind:'single',after:1024,delta:24},{kind:'double',after:976,delta:-24},{kind:'single',after:1045,delta:21}];
 const a=bzEloSeries(h,'single');
 ok(a.join(',')==='1000,1024,1045','Einzel-Kurve beginnt beim Wert vor dem ersten Spiel: '+a.join(','));
 ok(bzEloSeries(h,'double').join(',')==='1000,976','Doppel getrennt');
 ok(bzEloSeries([],'single').length===0&&bzEloSeries(null,'single').length===0,'Ohne Verlauf leer');
 ok(bzNorm(single(1,frank,[[5,3,1]],1,{elo:24})).elo===24,'Elo-Delta wird durchgereicht');
 ok(bzNorm(single(1,frank,[[5,3,1]],1)).elo===null,'Ohne Wertung: null');}

console.log(fails?'\n'+fails+' FEHLER':'\nAlle Prüfungen bestanden');
process.exit(fails?1:0);
