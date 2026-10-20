'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const backend = fs.readFileSync(path.join(__dirname,'..','apps-script','Code.gs'),'utf8');
const frontend = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const between = (a,b) => {
 const i=backend.indexOf(a),j=backend.indexOf(b,i+1);
 assert.ok(i>=0&&j>i,'Missing expected backend function boundary '+a);
 return backend.slice(i,j);
};
const helper=between('const FT_BALANCE_START_COLS_','// -----------------------------------------------------------------\n// 04_Mitarbeiter');
const report=between('function ft_report_(','function ft_monthSubmit_(');
const baseData={Activities:[],Shifts:[],ShiftSegments:[],SickLeaves:[],Leaves:[],Months:[]};
let storedRows=[];
function setup(){
 const ctx={
  FT_REQUEST_CACHE:null,FT_TZ:'Europe/Vienna',Date,Math,
  ft_absenceRows_:()=>storedRows,
  ft_localMonth_:d=>new Date(d).toISOString().slice(0,7),
  ft_month_:m=>m,
  ft_rulesFor_:()=>({standbyRate:0,nightTypes:[],sundayTypes:[],holidayTypes:[],effectiveMonth:'2026-01'}),
  ft_monthBounds_:m=>{
   const [y,mon]=m.split('-').map(Number);
   return [new Date(Date.UTC(y,mon-1,1)),new Date(Date.UTC(y,mon,1))];
  },
  ft_overlap_:(a,b,c,d)=>Math.max(0,(Math.min(new Date(b),new Date(d))-Math.max(new Date(a),new Date(c)))/3600000),
  ft_hours_:(a,b)=>Math.max(0,(new Date(b)-new Date(a))/3600000),
  ft_2_:v=>Math.round(Number(v)*100)/100,
  ft_hourRound_:v=>Math.round(Number(v)*1e8)/1e8,
  ft_ruleBuckets_:()=>({night:0,sunday:0,holiday:0}),
  ft_accountableShifts_:()=>[],
  ft_ruleSegments_:()=>[],
  ft_rulePremiumTypes_:(_c,k)=>k||[],
  ft_leaveFlexFor_:()=>({leaveWorkModel:'FIXED'}),
  ft_leaveDays_:()=>0,
  ft_flexLeaveDaysForMonth_:()=>0,
  ft_localDate_:d=>new Date(d).toISOString().slice(0,10),
  Utilities:{formatDate:(d,_tz,_format)=>new Date(d).toISOString().slice(0,7)}
 };
 const sandbox=vm.createContext(ctx);
 return vm.runInContext(helper+'\n'+report+'\n({ft_report_,ft_balanceStartMonth_})',sandbox);
}
const c={id:'company-a',slug:'bsb3100'};
const u={id:'employee-a',companyId:'company-a',name:'Testperson',
 startDate:'2026-02-01',createdAt:'2026-10-20T12:00:00.000Z',
 openingHours:-54.75,monthlyHours:103,hourlyRate:0};

test('backend and frontend JavaScript are valid',()=>{
 assert.doesNotThrow(()=>new vm.Script(backend));
 const i=frontend.indexOf('<script>'),j=frontend.lastIndexOf('</script>');
 assert.ok(i>=0&&j>i);
 assert.doesNotThrow(()=>new vm.Script(frontend.slice(i+8,j)));
});
test('old hire date does not cause pre-accounting debit',()=>{
 storedRows=[];
 const r=setup().ft_report_(c,u,'2026-10',false,baseData);
 assert.equal(r.balanceStartMonth,'2026-10');
 assert.equal(r.runningBalance,-157.75); // -54.75 imported minus current month's 103 target
 assert.equal(r.balanceBreakdown.length,1);
});
test('closing balance at end of October remains -54.75 before November cutover',()=>{
 storedRows=[];
 const r=setup().ft_report_(c,{...u,hoursStartMonth:'2026-11'},'2026-10',false,baseData);
 assert.equal(r.runningBalance,-54.75);
 assert.equal(r.balanceBeforeStart,true);
 assert.equal(r.balanceBreakdown.length,0);
});
test('once tracking begins, worked monthly deltas are counted once',()=>{
 storedRows=[];
 const r=setup().ft_report_(c,{...u,hoursStartMonth:'2026-11'},'2026-12',false,baseData);
 assert.equal(r.runningBalance,-260.75);
 assert.equal(r.balanceBreakdown.length,2);
});
test('stored firm- and user-specific cutover wins over account creation date',()=>{
 storedRows=[{id:'entry-1',companyId:'company-a',userId:'employee-a',startMonth:'2026-11'}];
 assert.equal(setup().ft_balanceStartMonth_(u),'2026-11');
 assert.equal(setup().ft_balanceStartMonth_({...u,id:'employee-b'}),'2026-10');
 assert.equal(setup().ft_balanceStartMonth_({...u,companyId:'company-b'}),'2026-10');
 storedRows=[];
});
test('hire date after account creation is respected',()=>{
 storedRows=[];
 assert.equal(setup().ft_balanceStartMonth_({...u,startDate:'2026-12-01'}),'2026-12');
});
test('historical approved monthly snapshots stay immutable',()=>{
 storedRows=[];
 const snapshot={month:'2026-10',runningBalance:-981.75,worked:0};
 const prior={...baseData,Months:[{companyId:c.id,userId:u.id,month:'2026-10',status:'APPROVED',
  snapshot:JSON.stringify(snapshot)}]};
 const result=setup().ft_report_(c,u,'2026-10',false,prior);
 assert.equal(result.runningBalance,-981.75);
 assert.equal(result.balanceStartMonth,undefined);
});
test('no migration is required to read an existing employee',()=>{
 assert.match(backend,/ft_absenceRows_\('TimeBalanceStarts',FT_BALANCE_START_COLS_,false\)/);
 assert.match(backend,/balanceCutoverSupported:true/);
 assert.match(frontend,/ST\.h\?\.balanceCutoverSupported/);
});
