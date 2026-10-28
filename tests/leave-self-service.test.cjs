'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const backend=fs.readFileSync(path.join(__dirname,'..','apps-script','Code.gs'),'utf8');
const company={id:'c1',slug:'qa'};
const staff={id:'u1',companyId:'c1',role:'STAFF',leaveBalance:20,workdays:'1,2,3,4,5',monthlyHours:160,openingHours:0,hoursStartMonth:'2026-10'};
const admin={id:'a1',companyId:'c1',role:'ADMIN'};
const approved={id:'l1',companyId:'c1',userId:'u1',from:'2026-10-05',to:'2026-10-09',days:5,creditHours:40,status:'APPROVED',reason:'Bestand'};
function setup(status='APPROVED',model='FIXED'){
 const db={Users:[structuredClone(staff)],Leaves:[{...approved,status}],Audit:[],LeaveLedger:[],Activities:[],Shifts:[],ShiftSegments:[],SickLeaves:[],Months:[]};
 const ctx=vm.createContext({Date,Math,console,Utilities:{formatDate:(d,tz,format)=>{
  if(format==='u')return String(d.getUTCDay()||7);
  return d.toISOString().slice(0,format==='yyyy-MM'?7:10);
 }}});
 vm.runInContext(backend,ctx);
 Object.assign(ctx,{
  ft_get_:name=>db[name]||[],ft_one_:(name,id)=>(db[name]||[]).find(x=>x.id===id),
  ft_save_:(name,row)=>row,ft_add_:(name,row)=>{(db[name]||=[]).push(row);return row;},
  ft_absenceRows_:name=>db[name]||[],ft_absenceAdd_:(name,cols,row)=>{(db[name]||=[]).push(row);return row;},
  ft_sha_:value=>crypto.createHash('sha256').update(value).digest('hex'),
  ft_now_:()=> '2026-10-28T12:00:00.000Z',ft_uuid_:()=>crypto.randomUUID(),
  ft_holiday_:()=>false,
  ft_leaveFlexFor_:()=>({leaveWorkModel:model,leaveFlexConfigured:true}),
  ft_flexLeaveDaysForMonth_:(leave,from,to)=>ctx.ft_leaveDays_(staff,from,to)/leave.days,
  ft_rulesFor_:()=>({standbyRate:0,nightTypes:[],sundayTypes:[],holidayTypes:[],effectiveMonth:'2026-01'}),
  ft_monthBounds_:m=>{const [y,n]=m.split('-').map(Number);return [new Date(Date.UTC(y,n-1,1)),new Date(Date.UTC(y,n,1))];},
  ft_accountableShifts_:()=>[],ft_rulePremiumTypes_:(_c,k)=>k||[],
  ft_balanceStartMonth_:()=> '2026-10'
 });
 const report=(month='2026-10')=>ctx.ft_report_(company,db.Users[0],month,false,db);
 return {db,ctx,report,leave:db.Leaves[0],user:db.Users[0]};
}
test('pending cancellation retains approved hours and running balance for fixed and flex models',()=>{
 for(const model of ['FIXED','FLEX']){
  const q=setup('APPROVED',model),before=q.report();
  assert.equal(before.leaveCredit,40);
  q.ctx.ft_leaveWithdraw_(staff,{id:'l1'});
  assert.equal(q.leave.status,'CANCEL_PENDING');
  assert.equal(q.user.leaveBalance,20);
  assert.equal(q.leave.creditHours,40);
  assert.equal(q.report().leaveCredit,40);
  assert.equal(q.report().runningBalance,before.runningBalance);
  q.ctx.ft_leaveReview_(admin,{id:'l1',status:'APPROVED'});
  assert.equal(q.report().runningBalance,before.runningBalance);
  assert.equal(q.user.leaveBalance,20);
  assert.equal(q.db.LeaveLedger.length,0);
 }
});
test('confirmed cancellation restores days exactly once and removes credit',()=>{
 const q=setup();q.ctx.ft_leaveWithdraw_(staff,{id:'l1'});
 q.ctx.ft_leaveReview_(admin,{id:'l1',status:'CANCELLED'});
 assert.equal(q.leave.status,'CANCELLED');assert.equal(q.user.leaveBalance,25);
 assert.equal(q.leave.creditHours,0);assert.equal(q.report().leaveCredit,0);
 assert.deepEqual(q.db.LeaveLedger.map(x=>[x.kind,x.days]),[['OPENING',20],['RESTORE',5]]);
 assert.throws(()=>q.ctx.ft_leaveReview_(admin,{id:'l1',status:'CANCELLED'}));
 assert.equal(q.user.leaveBalance,25);assert.equal(q.db.LeaveLedger.length,2);
});
test('pending request edits recalculate days; withdrawal never changes balances',()=>{
 const q=setup('PENDING');q.leave.creditHours=0;
 q.ctx.ft_leaveUpdate_(staff,{id:'l1',from:'2026-10-05',to:'2026-10-06',reason:'Korrektur'});
 assert.equal(q.leave.days,2);assert.equal(q.leave.reason,'Korrektur');
 q.ctx.ft_leaveWithdraw_(staff,{id:'l1'});
 assert.equal(q.leave.status,'WITHDRAWN');assert.equal(q.user.leaveBalance,20);
 assert.equal(q.report().leaveCredit,0);assert.equal(q.db.LeaveLedger.length,0);
});
test('ownership, tenant, review role and invalid transitions are enforced',()=>{
 const q=setup();
 for(const actor of [{...staff,id:'u2'},{...staff,companyId:'c2'}]){
  assert.throws(()=>q.ctx.ft_leaveWithdraw_(actor,{id:'l1'}));
  assert.throws(()=>q.ctx.ft_leaveUpdate_(actor,{id:'l1',from:approved.from,to:approved.to}));
 }
 assert.throws(()=>q.ctx.ft_leaveUpdate_(staff,{id:'l1',from:approved.from,to:approved.to}));
 assert.throws(()=>q.ctx.ft_leaveReview_(staff,{id:'l1',status:'CANCELLED'}));
 q.ctx.ft_leaveWithdraw_(staff,{id:'l1'});
 assert.throws(()=>q.ctx.ft_leaveWithdraw_(staff,{id:'l1'}));
 assert.throws(()=>q.ctx.ft_leaveReview_(admin,{id:'l1',status:'REJECTED'}));
 assert.equal(q.user.leaveBalance,20);assert.equal(q.leave.creditHours,40);
});
test('invalid dates and overlapping edits leave stored requests unchanged',()=>{
 const q=setup('PENDING'),before=structuredClone(q.leave);
 q.db.Leaves.push({...approved,id:'l2',from:'2026-10-12',to:'2026-10-13'});
 for(const dates of [{from:'2026-10-09',to:'2026-10-05'},{from:'2026-02-30',to:'2026-03-02'},{from:'2026-10-12',to:'2026-10-13'}]){
  assert.throws(()=>q.ctx.ft_leaveUpdate_(staff,{id:'l1',...dates}));
  assert.deepEqual(q.leave,before);
 }
});
test('existing approved leave, unrelated balances and approved/final snapshots remain intact',()=>{
 for(const status of ['APPROVED','FINAL']){
  const q=setup(),existing=structuredClone(q.leave),user=structuredClone(q.user);
  const snapshot={month:'2026-09',runningBalance:123.5,leaveCredit:40,saldo:8};
  q.db.Months.push({companyId:'c1',userId:'u1',month:'2026-09',status,snapshot:JSON.stringify(snapshot)});
  assert.equal(q.report().leaveCredit,40);assert.deepEqual(q.leave,existing);assert.deepEqual(q.user,user);
  q.db.Leaves.push({...approved,id:'l2',from:'2026-11-02',to:'2026-11-06'});
  q.ctx.ft_leaveWithdraw_(staff,{id:'l2'});
  q.ctx.ft_leaveReview_(admin,{id:'l2',status:'APPROVED'});
  assert.deepEqual(q.leave,existing);assert.deepEqual(q.user,user);
  assert.deepEqual(JSON.parse(JSON.stringify(q.report('2026-09'))),snapshot);
 }
});
test('month-spanning pending cancellation keeps proportional credit and excludes other tenants/users',()=>{
 const q=setup();Object.assign(q.leave,{from:'2026-10-30',to:'2026-11-02',days:2,creditHours:16});
 q.db.Leaves.push({...q.leave,id:'other-user',userId:'u2'},{...q.leave,id:'other-company',companyId:'c2'});
 assert.equal(q.report().leaveCredit,8);assert.equal(q.report('2026-11').leaveCredit,8);
 q.ctx.ft_leaveWithdraw_(staff,{id:'l1'});
 assert.equal(q.report().leaveCredit,8);assert.equal(q.report('2026-11').leaveCredit,8);
});
