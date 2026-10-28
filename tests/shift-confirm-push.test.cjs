'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','apps-script','Code.gs'),'utf8');
function isolate(start,end,ctx){
 const a=code.indexOf(start),b=code.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'missing '+start);
 return vm.runInNewContext(code.slice(a,b)+';('+start.replace('function ','').split('(')[0]+')',ctx);
}
function eventsAt({hoursAfterEnd=5,done=false,sick=false,remindShift=false,split=false}={}){
 const now=new Date('2026-10-28T12:15:00.000Z');
 const end=new Date(now.getTime()-hoursAfterEnd*3600000).toISOString();
 const start=new Date(Date.parse(end)-24*3600000).toISOString();
 const source={
  companies:[{id:'c1',active:true,remindShift,availabilityDay:20,remindHours:true}],
  modules:{c1:['STANDBY']},
  users:[{id:'staff1',status:'ACTIVE',role:'STAFF',companyId:'c1',
   startDate:'2026-01-01'}],
  submissions:[],months:[],
  shifts:[{id:'sh1',companyId:'c1',userId:'staff1',status:'PUBLISHED',
   start,end,actualStatus:done?'DONE':'PLANNED'}],
  segments:split?[{id:'seg1',shiftId:'sh1',companyId:'c1',userId:'staff1',start,end,
   actualStatus:done?'DONE':'PLANNED'}]:[],
  sickLeaves:sick?[{companyId:'c1',userId:'staff1',status:'PENDING',
   from:start,to:end}]:[],activities:[]
 };
 const dateStrings={ 'HH:mm':'14:15','yyyy-MM':'2026-10','d':'28',
  'dd.MM. HH:mm':'28.10. 08:15'};
 const ctx={
  Date,Number,String,Map,Set,Boolean,Math,
  Utilities:{formatDate:(d,t,format)=>dateStrings[format]||'2026-10'},
  FT_TZ:'Europe/Vienna',ft_bool_:v=>v===true,
  ft_timerConfirmedAutoClose_:()=>false
 };
 const fn=isolate('function ft_pushOperationalEvents_(', 'function ft_pushOperationsTick_(',ctx);
 return {events:fn(now,source),now,source,fn};
}
test('unconfirmed published standby generates a push after four hours even with 24h reminders disabled',()=>{
 const r=eventsAt({hoursAfterEnd:5,remindShift:false});
 assert.equal(r.events.filter(x=>x.kind==='PUSH_SHIFT_CONFIRM').length,1);
 assert.equal(r.events[0].user.id,'staff1');
 assert.match(r.events[0].title,/Bereitschaft bestätigen/);
 assert.ok(!r.events.some(x=>x.kind==='PUSH_SHIFT_REMINDER'));
});
test('no premature push, no duplicates for confirmed and sick shifts',()=>{
 for(const options of [{hoursAfterEnd:3},{done:true},{sick:true}]){
  const r=eventsAt(options);
  assert.equal(r.events.filter(x=>x.kind==='PUSH_SHIFT_CONFIRM').length,0);
 }
});
test('split standby only reminds current unconfirmed segment',()=>{
 const r=eventsAt({split:true});
 const e=r.events.filter(x=>x.kind==='PUSH_SHIFT_CONFIRM');
 assert.equal(e.length,1);
 assert.equal(e[0].reference,'seg1|'+r.source.segments[0].end);
});
test('pre-duty push respects reminder setting but confirmation does not',()=>{
 const {source,now,fn}=eventsAt();
 source.shifts[0].start=new Date(now.getTime()+20*3600000).toISOString();
 source.shifts[0].end=new Date(now.getTime()+44*3600000).toISOString();
 assert.ok(!fn(now,source).some(x=>x.kind==='PUSH_SHIFT_REMINDER'));
 source.companies[0].remindShift=true;
 assert.equal(fn(now,source).filter(x=>x.kind==='PUSH_SHIFT_REMINDER').length,1);
});
test('scheduled push check is ahead of longer PDF processing and safe diagnostics are available',()=>{
 const a=code.indexOf('function ft_tick()'),b=code.indexOf('function ft_remindOne_(',a);
 const src=code.slice(a,b);
 assert.ok(src.indexOf('try{ft_pushOperationsTick_();}')>=0);
 assert.ok(src.indexOf('try{ft_pdfRecoverApproved_();}')>=0);
 assert.ok(src.indexOf('try{ft_pushOperationsTick_();}')<src.indexOf('try{ft_pdfRecoverApproved_();}'));
 assert.match(code,/function ft_pushDiagnose_EINMAL\(/);
 assert.match(code,/function ft_pushTriggerRepair_EINMAL\(/);
 assert.match(code,/FT_PUSH_LAST_CHECK_AT/);
});
test('trigger repair leaves an existing ft_tick schedule unchanged or creates one if missing',()=>{
 const src=code.slice(code.indexOf('function ft_pushTriggerRepair_EINMAL('),
  code.indexOf('/** Nur Kontrolle, keine Neuanlage',code.indexOf('function ft_pushTriggerRepair_EINMAL(')));
 // The repair function ends before the standard non-mutating upgrade check.
 const triggers=[],created=[];
 const ctx={ScriptApp:{
  getProjectTriggers:()=>triggers,
  newTrigger:name=>({timeBased:()=>({everyMinutes:n=>({create:()=>{
   triggers.push({getHandlerFunction:()=>name});created.push(n);
  }})})})
 }};
 const fn=vm.runInNewContext(src+';ft_pushTriggerRepair_EINMAL',ctx);
 const first=fn(),second=fn();
 assert.equal(first.created,true);
 assert.equal(second.created,false);
 assert.deepEqual(created,[15]);
});
