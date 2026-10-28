'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function between(a,b){
 const start=html.indexOf(a),end=html.indexOf(b,start+1);
 assert.ok(start>=0&&end>start,'Missing boundary '+a);
 return html.slice(start,end);
}
test('monthly report rounds only displayed figures to two decimal places',()=>{
 const src=between('const N=v=>','const EUR=v=>')+between('function reports(){','function ftBulkPanel(users)');
 const ST={selected:'',month:'2026-10',h:{reports:{u1:{
  target:25,worked:0.1333333333333,object:0.1333333333333,
  incident:0,standby:480,saldo:-24.866666667,runningBalance:-81.616666667,
  holiday:0}},months:[]}};
 const sandbox={ST, Number,Intl,isAdmin:()=>false,me:()=>({id:'u1',name:'Test User'}),
  E:x=>String(x),hint:()=>'',monthPick:()=>'',ftBalanceExplainer_:()=>'',has:()=>false,
  ftPdfMonthLabel:()=> 'Oktober 2026'};
 const report=vm.runInNewContext(src+';reports()',sandbox);
 assert.match(report,/0,13 h/);assert.match(report,/-24,87 h/);
 assert.match(report,/-81,62 h/);assert.match(report,/480 h/);
 assert.doesNotMatch(report,/0,133333/);assert.doesNotMatch(report,/24,86666/);
 assert.match(report,/ft-report-kpis/);
 assert.match(report,/Oktober 2026/);
});
test('mobile More menu includes Monatsberichte for licensed users',()=>{
 const src=between('function mobileNav(){','function render(){');
 const sandbox={ST:{tab:'reports'},LABELS:{reports:'Monatsberichte',dashboard:'Übersicht',
   messages:'Nachrichten & Aufgaben',time:'Zeiterfassung',standby:'Bereitschaftsplan'},
  nav:()=>['dashboard','time','standby','messages','reports','leave','profile'],
  E:x=>String(x),me:()=>({role:'STAFF'}),firm:()=>({id:'a'})};
 const result=vm.runInNewContext(src+';mobileNav()',sandbox);
 assert.match(result,/Alle Funktionen/);
 assert.match(result,/Zeit & Berichte/);
 assert.match(result,/>Monatsberichte<\/button>/);
 assert.match(result,/data-tab="reports"/);
 assert.match(result,/data-mobile-more="1"/);
});
test('report tiles have dedicated responsive overflow-safe styling',()=>{
 assert.match(html,/\.ft-report-kpis\{display:grid/);
 assert.match(html,/\.ft-report-kpis \.ft-report-value\{[^}]*overflow-wrap:anywhere/);
 assert.match(html,/@media\(max-width:330px\)/);
});
