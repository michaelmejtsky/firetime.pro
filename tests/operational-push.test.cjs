'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const backend=fs.readFileSync(path.join(root,'apps-script','Code.gs'),'utf8');
const worker=fs.readFileSync(path.join(root,'cloudflare','worker.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');

function dateString(date,zone,format){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 if(format==='d')return String(Number(p.day));
 if(format==='H')return String(Number(p.hour));
 if(format==='yyyyMMdd')return p.year+p.month+p.day;
 if(format==='yyyy-MM')return p.year+'-'+p.month;
 if(format==='yyyy-MM-dd')return p.year+'-'+p.month+'-'+p.day;
 if(format==='HH:mm')return p.hour+':'+p.minute;
 if(format==='dd.MM. HH:mm')return p.day+'.'+p.month+'. '+p.hour+':'+p.minute;
 return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute;
}
const mock={
 Date,Math,Number,String,Set,Map,Error,
 FT_TZ:'Europe/Vienna',ft_bool_:Boolean,
 ft_sha_:str=>'hash:'+str,
 Utilities:{formatDate:dateString},
 ft_get_:name=>name==='Users'?[{id:'admin',companyId:'a',status:'ACTIVE',role:'ADMIN'}]:[],
 ft_one_:(name,id)=>['Shifts','ShiftSegments'].includes(name)?
  {id,companyId:'a',userId:'u1',start:'2026-10-21T07:00:00Z'}:null
};
function extract(start,end,fn){
 const i=backend.indexOf(start),j=backend.indexOf(end,i+1);
 assert.ok(i>0&&j>i,start+' not found');
 return vm.runInNewContext(backend.slice(i,j)+';'+fn,mock);
}
const events=extract('function ft_pushOperationalEvents_','function ft_pushOperationsTick_','ft_pushOperationalEvents_');
const notifications=extract('function ft_pushEventSpecs_','function ft_pushAfterActionSafe_','ft_pushEventSpecs_');
function source(){
 return {companies:[{id:'a',active:true,remindAvailability:true,remindShift:true,remindHours:true,availabilityDay:20}],
  users:[{id:'u1',companyId:'a',status:'ACTIVE',role:'STAFF',startDate:'2025-01-01'}],
  modules:{a:['AVAILABILITY','STANDBY','TIME','REPORTS']},
  submissions:[],months:[],shifts:[],segments:[],sickLeaves:[],timers:[],activities:[]};
}
const kinds=arr=>arr.map(x=>x.kind);

test('missing next-month availability creates one scheduled reminder on configured 20th',()=>{
 const now=new Date('2026-10-20T08:00:00Z'),s=source();
 assert.deepEqual(kinds(events(now,s)),['PUSH_AVAILABILITY']);
 s.submissions=[{companyId:'a',userId:'u1',month:'2026-11'}];
 assert.equal(events(now,s).length,0);
 s.submissions=[];
 s.companies[0].availabilityDay=19;
 assert.equal(events(now,s).length,0);
});
test('standby reminder is within 24 hours and confirmation follows 4 hours after end',()=>{
 const s=source();
 s.shifts=[{id:'sh1',companyId:'a',userId:'u1',status:'PUBLISHED',
  start:'2026-10-21T07:00:00Z',end:'2026-10-22T07:00:00Z',actualStatus:'PLANNED'}];
 assert.ok(kinds(events(new Date('2026-10-20T08:00:00Z'),s)).includes('PUSH_SHIFT_REMINDER'));
 assert.ok(!kinds(events(new Date('2026-10-22T10:59:00Z'),s)).includes('PUSH_SHIFT_CONFIRM'));
 assert.ok(kinds(events(new Date('2026-10-22T11:00:00Z'),s)).includes('PUSH_SHIFT_CONFIRM'));
 s.shifts[0].actualStatus='DONE';
 assert.ok(!kinds(events(new Date('2026-10-22T11:00:00Z'),s)).includes('PUSH_SHIFT_CONFIRM'));
});
test('running clock and automatic 19:00 closure generate separate one-time push types',()=>{
 const s=source();
 s.timers=[{id:'timer1',companyId:'a',userId:'u1',start:'2026-10-20T12:00:00Z'}];
 assert.ok(kinds(events(new Date('2026-10-20T16:45:00Z'),s)).includes('PUSH_TIMER_RUNNING'));
 s.timers=[];
 s.activities=[{id:'act1',companyId:'a',userId:'u1',createdAt:'2026-10-20T17:15:00Z',
  description:'Test [Automatisch um 19:00 Uhr beendet; bitte ggf. korrigieren.]'}];
 assert.ok(kinds(events(new Date('2026-10-20T17:20:00Z'),s)).includes('PUSH_TIMER_AUTO'));
});
test('first of next month sends reminder only if previous month is not submitted',()=>{
 const s=source(),now=new Date('2026-11-01T08:10:00Z');
 assert.ok(kinds(events(now,s)).includes('PUSH_MONTH_OPEN'));
 s.months=[{companyId:'a',userId:'u1',month:'2026-10',status:'SUBMITTED'}];
 assert.ok(!kinds(events(now,s)).includes('PUSH_MONTH_OPEN'));
});
test('handover request and response target actual involved colleagues, not outsiders',()=>{
 const actor={id:'u1',companyId:'a',role:'STAFF'};
 const req={id:'swap',companyId:'a',fromUserId:'u1',toUserId:'u2',
  start:'2026-10-28T07:00:00Z',end:'2026-10-29T07:00:00Z'};
 const asked=notifications(actor,'handoverRequest',req,{});
 assert.deepEqual(asked.map(x=>x.userId),['u2']);
 const answered=notifications({id:'u2',companyId:'a',role:'STAFF'},'handoverRespond',
  {request:{...req,status:'ACCEPTED'}},{});
 assert.deepEqual(answered.map(x=>x.userId),['u1']);
});
test('leave approved, cancellation approved and cancellation denied have distinct push texts',()=>{
 const actor={id:'admin',companyId:'a',role:'ADMIN'};
 const base={id:'lv',companyId:'a',userId:'u1',from:'2026-11-03',to:'2026-11-06'};
 const approved=notifications(actor,'leaveReview',{...base,status:'APPROVED'},{},{previousStatus:'PENDING'});
 const cancelled=notifications(actor,'leaveReview',{...base,status:'CANCELLED'},{},{previousStatus:'CANCEL_PENDING'});
 const denied=notifications(actor,'leaveReview',{...base,status:'APPROVED'},{},{previousStatus:'CANCEL_PENDING'});
 for(const list of [approved,cancelled,denied])assert.deepEqual(list.map(x=>x.userId),['u1']);
 assert.match(approved[0].title,/genehmigt/);
 assert.match(cancelled[0].title,/storniert/);
 assert.match(denied[0].title,/Stornierung abgelehnt/);
});
test('publishing many duties sends one consolidated push per employee',()=>{
 const actor={id:'admin',companyId:'a',role:'ADMIN'};
 const list=Array.from({length:31},(_,i)=>({companyId:'a',userId:'u1',id:'s'+i,
  start:'2026-11-01T07:00:00Z'}));
 const result=notifications(actor,'planPublish',{companyId:'a',shifts:list},{month:'2026-11'});
 assert.equal(result.length,1);assert.match(result[0].body,/31 neue Dienste/);
});
test('approval and confirmation notifications go to actual affected person',()=>{
 const actor={id:'admin',companyId:'a',role:'ADMIN'};
 const confirmed=notifications(actor,'segmentConfirm',{ok:true},{id:'segment1'});
 assert.deepEqual(confirmed.map(x=>x.userId),['u1']);
 const month=notifications(actor,'monthReview',{companyId:'a',userId:'u1',id:'month1',month:'2026-10',status:'APPROVED'},{});
 assert.deepEqual(month.map(x=>x.userId),['u1']);
});
test('push deep links remain within the PWA and only use allowed app tabs',()=>{
 assert.match(worker,/url:'\/firetime\.pro\/\?tab='\+tab/);
 assert.match(worker,/PUSH_LEAVE/);
 assert.match(sw,/function ftPushSafeUrl_/);
 assert.match(sw,/proposed\.origin!==root\.origin/);
 assert.match(sw,/proposed\.pathname!==root\.pathname/);
});