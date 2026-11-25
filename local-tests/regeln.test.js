/* Test der Regel-Logik (js/regeln.js) ohne Browser. Dieselben Fälle wie
   supabase/local-tests/70_test_regeln.sql – Client und Server müssen gleich zählen. */
const vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={};vm.createContext(ctx);
const src=fs.readFileSync(path.resolve(__dirname,'../js/regeln.js'),'utf8');
vm.runInContext(src.slice(0,src.indexOf('/* ---------- Bedienung'))+';Object.assign(this,{rlFromCfg,rlFromMatch,rlSetEnd,rlPredict,rlText,rlShort});',ctx);
const {rlFromCfg,rlFromMatch,rlPredict,rlText,rlShort}=ctx;
let fails=0;const ok=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m);if(!c)fails++};

// Folge von Toren spielen und den Stand wie r_st() in SQL beschreiben
function play(r,gps,stw,seq){
  let st={state:'running',set_no:1,score1:0,score2:0,sets1:0,sets2:0,match_done:false,sets:[]};
  for(const ch of seq){ if(st.match_done) return 'ZU VIELE TORE'; st=rlPredict(st,r,gps,stw,+ch) }
  const done=st.sets.map(x=>x.score1+':'+x.score2+'/'+x.winner_team);
  if(!st.match_done) done.push(st.score1+':'+st.score2+'/-');
  return (st.match_done?'over ':'running ')+done.join(' ');
}
const R=o=>Object.assign({win_by:1,scope:'decider',cap:null,draw_at:null},o);

console.log('== Wie SQL 70_test_regeln ==');
ok(play(R(),5,1,'111122221')==='over 5:4/1','Ohne Regeln: 5:4 beendet');
ok(play(R({win_by:2}),5,1,'111122221')==='running 5:4/-','Vorsprung: 5:4 läuft');
ok(play(R({win_by:2}),5,1,'11112222121')==='running 6:5/-','6:5 läuft');
ok(play(R({win_by:2}),5,1,'111122221211')==='over 7:5/1','7:5 beendet');
ok(play(R({win_by:2}),3,2,'11221')==='running 3:2/1 0:0/-','Nur Entscheid: Satz 1 endet 3:2');
ok(play(R({win_by:2}),3,2,'11221'+'11222'+'11221')==='running 3:2/1 2:3/2 3:2/-','Entscheidungssatz läuft bei 3:2');
ok(play(R({win_by:2}),3,2,'11221'+'11222'+'112211')==='over 3:2/1 2:3/2 4:2/1','…endet 4:2');
ok(play(R({win_by:2,scope:'all',cap:8}),5,1,'12121212121212')==='running 7:7/-','Obergrenze: 7:7 läuft');
ok(play(R({win_by:2,scope:'all',cap:8}),5,1,'121212121212122')==='over 7:8/2','…7:8 beendet');
ok(play(R({draw_at:4}),5,2,'11112222')==='running 4:4/-','Remis nicht im ersten Satz');
ok(play(R({draw_at:4}),5,2,'111122221'+'22222'+'12121212')==='over 5:4/1 0:5/2 4:4/0','Remis im Entscheidungssatz');
{let st={set_no:1,score1:0,score2:0,sets1:0,sets2:0,sets:[]};for(const c of '12')st=rlPredict(st,R({draw_at:1}),2,1,+c);
 ok(st.match_done&&st.draw,'Remis meldet draw und Spielende')}

console.log('== Umwandlungen ==');
ok(JSON.stringify(rlFromCfg({winBy:1,scope:'all',cap:8,draw:false,gps:5}))==='{"win_by":1,"scope":"all","cap":null,"draw_at":null}','Ohne Vorsprung keine Obergrenze');
ok(rlFromCfg({winBy:2,scope:'decider',cap:8,draw:true,gps:5}).draw_at===4,'Remis = Satzziel − 1');
ok(rlFromMatch({win_by:2,win_by_scope:'all',goal_cap:9,draw_at:null}).cap===9,'Aus der Tabelle');
ok(rlFromMatch({}).win_by===1&&rlFromMatch({}).cap===null,'Alte Spiele ohne Regelspalten: Standard');
ok(rlText(R(),5,2)==='Ein Tor reicht, kein Remis','Text Standard');
ok(rlText(R({win_by:2,cap:8}),5,2).includes('höchstens bis 8'),'Text mit Obergrenze');
ok(rlShort(5,2,R({draw_at:4})).includes('Remis 4:4'),'Kurztext Remis');

console.log(fails?'\n'+fails+' FEHLER':'\nAlle Prüfungen bestanden');
process.exit(fails?1:0);
