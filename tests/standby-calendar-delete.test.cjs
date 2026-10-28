'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const gs=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
const ui=fs.readFileSync(path.join(root,'index.html'),'utf8');
function source(a,b){
 const i=gs.indexOf(a),j=gs.indexOf(b,i+a.length);
 assert.ok(i>=0&&j>i,'Missing source '+a);
 return gs.slice(i,j);
}
function env(){
 const actor={id:'admin',companyId:'firm',role:'ADMIN'};
 const c={id:'firm',calendarOn:true,calendarId:'calendar'};
 const shift={id:'shift-1',companyId:'firm',day:'2026-11-11',userId:'user-1',
  start:'2026-11-11T06:00:00Z',end:'2026-11-12T06:00:00Z',
  status:'PUBLISHED',actualStatus:'PLANNED',confirmedAt:'',eventId:'event-main',__row:3};
 const parts=[],changes=[],deleted=[],audits=[],invalid=[],events=new Map();
 events.set('event-main',{deleteEvent(){deleted.push('event-main');events.delete('event-main')}});
 let blocked=false;
 const ctx={
  String,Date,Set,Error,
  ft_planCheck_:(a,p)=>{
   if(a.role==='STAFF'||a.companyId!==p.companyId)throw Error('Keine Berechtigung');
   return {c,m:p.month};
  },
  ft_one_:(name,id)=>name==='Shifts'&&id===shift.id?shift:null,
  ft_segmentRows_:()=>parts,
  ft_get_:name=>name==='ShiftChanges'?changes:[],
  ft_monthEditableRange_:()=>{if(blocked)throw Error('Monat bereits abgeschlossen')},
  ft_calendar_:()=>({getEventById:id=>events.get(id)||null}),
  ft_publicRow_:row=>({...row}),ft_invalidate_:name=>invalid.push(name),
  ft_audit_:(...args)=>audits.push(args),
  ft_sheet_:name=>({deleteRow:row=>deleted.push(name+':'+row)})
 };
 const action=vm.runInNewContext(source('function ft_planDelete_(', 'function ft_planPublish_(')+';ft_planDelete_',ctx);
 const payload={companyId:'firm',month:'2026-11',day:'2026-11-11',shiftId:shift.id};
 return {action,actor,c,shift,parts,changes,deleted,audits,invalid,payload,
  lockMonth:()=>{blocked=true;},events};
}
test('admin can delete a published standby and its Google event; result is audited',()=>{
 const e=env();
 const r=e.action(e.actor,e.payload);
 assert.equal(r.deleted,true);
 assert.deepEqual(e.deleted,['event-main','Shifts:3']);
 assert.ok(e.audits.some(x=>x[1]==='DELETE'&&x[2]==='Shifts'));
});
test('split shift removes every segment invitation before deleting its records',()=>{
 const e=env();
 const p1={id:'s1',__row:7,calendarEventId:'p1',userId:'user-1',
  start:e.shift.start,end:'2026-11-11T12:00:00Z'},
  p2={id:'s2',__row:8,calendarEventId:'p2',userId:'user-2',
  start:'2026-11-11T12:00:00Z',end:e.shift.end};
 e.parts.push(p1,p2);
 for(const id of ['p1','p2'])e.events.set(id,{deleteEvent(){e.deleted.push(id);e.events.delete(id)}});
 e.action(e.actor,e.payload);
 assert.deepEqual(e.deleted.slice(0,3),['event-main','p1','p2']);
 assert.deepEqual(e.deleted.slice(3),['ShiftSegments:8','ShiftSegments:7','Shifts:3']);
});
test('deletion cannot bypass tenant, confirmation, unresolved handover or closed month',()=>{
 for(const kind of ['foreign','done','split-done','pending','closed']){
  const e=env();
  if(kind==='foreign')e.payload.companyId='other';
  if(kind==='done')e.shift.actualStatus='DONE';
  if(kind==='split-done')e.parts.push({id:'p',userId:'user-1',actualStatus:'DONE'});
  if(kind==='pending')e.changes.push({shiftId:e.shift.id,status:'PENDING'});
  if(kind==='closed')e.lockMonth();
  assert.throws(()=>e.action(e.actor,e.payload));
  assert.equal(e.deleted.length,0,kind+' must leave Calendar and Sheets untouched');
 }
});
test('failed Google event cancellation never deletes the underlying duty',()=>{
 const e=env();
 e.events.set('event-main',{deleteEvent(){throw Error('Google Kalender unavailable')}});
 assert.throws(()=>e.action(e.actor,e.payload),/Google Kalender unavailable/);
 assert.equal(e.deleted.length,0);
});
test('calendar title is only Bereitschaft and the staff member name',()=>{
 const title=vm.runInNewContext(
  source('function ft_standbyCalendarTitle_(', 'function ft_syncShift_(')+';ft_standbyCalendarTitle_',
  {});
 assert.equal(title({name:'Max Mustermann'}),'Bereitschaft – Max Mustermann');
 assert.match(gs,/const name=ft_standbyCalendarTitle_\(u\)/);
 assert.match(gs,/const title=ft_standbyCalendarTitle_\(u\)/);
});
test('accepted handover updates calendar automatically and keeps both split periods',()=>{
 const handover=source('function ft_handoverRespond_(', 'function ft_segmentConfirm_(');
 assert.match(handover,/ft_syncShiftParts_\(c,s\)/);
 assert.match(handover,/calendarWasShared/);
 assert.match(handover,/ft_standbyCalendarAssignments_\(/);
 assert.match(gs,/function ft_standbyCalendarMatches_\(/);
 assert.match(gs,/function ft_planCalendarShare_\(/);
});
test('published split duty creates distinct calendar invitations with each correct period',()=>{
 const c={id:'firm',calendarOn:true},calls=[],removed=[],saved=[];
 const shift={id:'parent',eventId:'parent-event'};
 const parts=[
  {id:'part-a',userId:'one',start:'2026-11-11T06:00:00Z',end:'2026-11-11T14:00:00Z',calendarEventId:''},
  {id:'part-b',userId:'two',start:'2026-11-11T14:00:00Z',end:'2026-11-12T06:00:00Z',calendarEventId:''}
 ];
 let serial=0;
 const users={one:{id:'one',name:'Anna Beispiel',email:'anna@example.test'},
  two:{id:'two',name:'Bernd Muster',email:'bernd@example.test'}};
 const cal={
  getEventById:id=>id==='parent-event'?{deleteEvent:()=>removed.push(id)}:null,
  createEvent:(name,start,end,options)=>{
   const id='created-'+(++serial);
   calls.push({id,name,start:start.toISOString(),end:end.toISOString(),options});
   return {getId:()=>id,addPopupReminder:()=>{}};
  }
 };
 const context={
  Date,Boolean,String,Error,
  ft_enabled_:()=>true,ft_bool_:v=>v===true,
  ft_calendar_:()=>cal,ft_segmentRows_:()=>parts,
  ft_one_:(name,id)=>name==='Users'?users[id]:null,
  ft_sickOverlap_:()=>false,
  ft_standbyCalendarTitle_:u=>'Bereitschaft – '+u.name,
  ft_save_:(name,row)=>saved.push({name,id:row.id}),
  Utilities:{formatDate:value=>new Date(value).toISOString()},
  FT_TZ:'Europe/Vienna'
 };
 const fn=vm.runInNewContext(
  source('function ft_syncShiftParts_(', 'function doPost(')+';ft_syncShiftParts_',context);
 fn(c,shift);
 assert.deepEqual(removed,['parent-event']);
 assert.equal(shift.eventId,'');
 assert.deepEqual(calls.map(x=>x.name),[
  'Bereitschaft – Anna Beispiel','Bereitschaft – Bernd Muster']);
 assert.equal(calls[0].start,parts[0].start);
 assert.equal(calls[0].end,parts[0].end);
 assert.equal(calls[1].start,parts[1].start);
 assert.equal(calls[1].end,parts[1].end);
 assert.deepEqual(calls.map(x=>x.options.guests),['anna@example.test','bernd@example.test']);
 assert.ok(calls.every(x=>x.options.sendInvites===true));
 assert.ok(parts.every(x=>x.calendarEventId.startsWith('created-')));
 assert.equal(saved.filter(x=>x.name==='ShiftSegments').length,2);
});
test('accepted partial standby transfer updates calendar automatically and remains accepted if Google is down',()=>{
 function fixture(failSync=false){
  const s={id:'shift',companyId:'firm',day:'2026-11-11',userId:'one',status:'PUBLISHED',
   eventId:'existing',start:'2026-11-11T06:00:00Z',end:'2026-11-12T06:00:00Z',
   actualStatus:'PLANNED',confirmedAt:''};
  const req={id:'request',companyId:'firm',shiftId:'shift',fromUserId:'one',toUserId:'two',
   start:'2026-11-11T14:00:00Z',end:'2026-11-12T06:00:00Z',
   status:'PENDING',respondedAt:''};
  const state={companyId:'firm',month:'2026-11',sharedHash:'sig',shareStatus:'SENT'};
  const c={id:'firm',calendarOn:true};
  const segs=[],calls=[],updates=[],audits=[];
  let sequence=0;
  const context={
   String,Date,Boolean,Number,Error,
   ft_featureReady_:()=>{},ft_one_:(name,id)=>name==='ShiftChanges'?req:
    name==='Shifts'?s:name==='Users'?{id,name:'One'}:null,
   ft_company_:()=>c,ft_need_:()=>{},
   ft_sickOverlap_:()=>false,ft_monthEditableRange_:()=>{},
   ft_segmentEnsure_:()=>{if(!segs.length)segs.push({id:'original',shiftId:s.id,userId:'one',
    start:s.start,end:s.end,actualStatus:'PLANNED',confirmedAt:'',calendarEventId:''});return segs;},
   ft_segmentRows_:()=>segs,ft_publicRow_:o=>({...o}),
   ft_save_:(name,row)=>updates.push({name,status:row.status}),
   ft_add_:(name,row)=>{if(name==='ShiftSegments')segs.push(row);},
   ft_uuid_:()=> 'new-'+(++sequence),ft_now_:()=>new Date().toISOString(),
   ft_audit_:(...args)=>audits.push(args),
   ft_enabled_:()=>true,ft_bool_:x=>x===true,
   ft_syncShiftParts_:()=>{
    calls.push('sync');
    if(failSync)throw Error('Google timed out');
    s.eventId='';segs.forEach((p,i)=>p.calendarEventId='ev-'+i);
   },
   ft_planSheetRows_:()=>[state],ft_planSchedule_:()=>({signature:'sig',rows:[s]}),
   ft_standbyCalendarAssignments_:()=>({current:Object.fromEntries(segs.map(
    p=>[p.id,p.userId+'|'+p.start+'|'+p.end]))}),
   ft_standbyCalendarMatches_:()=>true,
   ft_notification_:()=>{},ft_publicGithubUrl_:()=> 'https://example.test'
  };
  const fn=vm.runInNewContext(
   source('function ft_handoverRespond_(', 'function ft_segmentConfirm_(')+';ft_handoverRespond_',context);
  const res=fn({id:'two',companyId:'firm',role:'STAFF'},{id:req.id,status:'ACCEPTED'});
  return {s,req,state,segs,calls,updates,audits,res};
 }
 const ok=fixture();
 assert.equal(ok.req.status,'ACCEPTED');
 assert.deepEqual(ok.calls,['sync']);
 assert.equal(ok.segs.length,2);
 assert.deepEqual(ok.segs.map(x=>x.userId),['one','two']);
 assert.equal(ok.state.shareStatus,'SENT');
 assert.ok(ok.state.sharedAssignments.includes('two'));
 const failed=fixture(true);
 assert.equal(failed.req.status,'ACCEPTED');
 assert.equal(failed.state.shareStatus,'PARTIAL');
 assert.match(failed.res.warning,/Google-Kalender/);
});
test('calendar share state recognizes time changes and missing event ids',()=>{
 const c={id:'firm',calendarOn:true};
 const sh={id:'sh',userId:'one',start:'2026-11-11T06:00:00Z',end:'2026-11-12T06:00:00Z',eventId:'ev'};
 const schedule={rows:[sh],signature:'sig'};
 const ctx={
  String,Set,Map,JSON,
  ft_get_:()=>[],
 };
 const src=source('function ft_standbyCalendarAssignments_(', 'function ft_planWorkflow_(');
 const api=vm.runInNewContext(src+';({ft_standbyCalendarAssignments_,ft_standbyCalendarMatches_})',ctx);
 const assignments=api.ft_standbyCalendarAssignments_(schedule);
 const state={shareStatus:'SENT',sharedHash:'sig',sharedAssignments:JSON.stringify(assignments.current)};
 assert.equal(api.ft_standbyCalendarMatches_(schedule,state),true);
 sh.start='2026-11-11T07:00:00Z';
 assert.equal(api.ft_standbyCalendarMatches_(schedule,state),false);
 sh.start='2026-11-11T06:00:00Z';sh.eventId='';
 assert.equal(api.ft_standbyCalendarMatches_(schedule,state),false);
});
test('admin-only delete action exists and explicitly confirms cancellation',()=>{
 assert.match(ui,/data-act="planDelete"/);
 assert.match(ui,/api\('planDelete'/);
 assert.match(ui,/Google-Kalendertermin wird ebenfalls entfernt/);
 assert.match(gs,/case 'planDelete':return ft_lock_\(\(\)=>ft_planDelete_\(u,p\)\)/);
});
