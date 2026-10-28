'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),gs=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){
 const i=gs.indexOf(a),j=gs.indexOf(b,i+a.length);
 assert.ok(i>=0&&j>i,'missing source section '+a);
 return gs.slice(i,j);
}
function fixture({shared=true,approved=true,calendarOn=true,failCreate=false,closed=false,confirmed=false}={}){
 const c={id:'firm',calendarOn,calendarId:'calendar-1'};
 const users=[{id:'u1',name:'Max Muster',email:'max@example.test',companyId:c.id},
  {id:'u2',name:'Anna Beispiel',email:'anna@example.test',companyId:c.id},
  {id:'u3',name:'Bernd Beispiel',email:'bernd@example.test',companyId:c.id}];
 const oldStart='2026-11-11T06:00:00.000Z',oldEnd='2026-11-12T06:00:00.000Z';
 const shifts=[
  {id:'first',companyId:c.id,day:'2026-11-11',userId:'u1',start:oldStart,end:oldEnd,
   status:'PUBLISHED',eventId:shared?'event-first':'',actualStatus:confirmed?'DONE':'PLANNED',
   confirmedAt:confirmed?'2026-11-12T08:00:00Z':'',__row:3},
  {id:'second',companyId:c.id,day:'2026-11-12',userId:'u3',
   start:'2026-11-12T06:00:00.000Z',end:'2026-11-13T06:00:00.000Z',
   status:'PUBLISHED',eventId:shared?'event-second':'',actualStatus:'PLANNED',confirmedAt:'',__row:4}
 ];
 const events=new Map(),history=[],saves=[],audits=[],calls={sync:[],calendar:[],monthChecks:[]};
 let created=0;
 for(const [idx,id] of ['event-first','event-second'].entries())events.set(id,{
  deleteEvent(){history.push('delete:'+id);events.delete(id)},
  setTitle(){history.push('title:'+id);return this;},
  setTime(){history.push('time:'+id);return this;},
  setDescription(){history.push('details:'+id);return this;},
  removeAllReminders(){},addPopupReminder(){}
 });
 const cal={
  getEventById:id=>{history.push('lookup:'+id);return events.get(id)||null;},
  createEvent:(title,start,end,options)=>{
   history.push('create:'+title);
   if(failCreate)throw Error('Google calendar unavailable');
   const id='new-event-'+(++created);
   calls.calendar.push({title,start:start.toISOString(),end:end.toISOString(),options});
   const event={getId:()=>id,removeAllReminders(){},addPopupReminder(){},
    deleteEvent(){history.push('delete:'+id);events.delete(id)}};
   events.set(id,event);return event;
  }
 };
 const ctx={
  Date,String,Number,Boolean,Set,Map,JSON,Math,Error,
  ft_planCheck_:(actor,p)=>{
   if(!['SYSADMIN','ADMIN'].includes(actor.role)||p.companyId!==c.id)
    throw Error('Nicht berechtigt');
   return {c,m:p.month};
  },
  ft_str_:(x,len)=>String(x||'').slice(0,len),
  ft_localDate_:(d)=>d.toISOString().slice(0,10),
  ft_date_:d=>new Date(d+'T12:00:00.000Z'),
  ft_user_:(a,id)=>users.find(u=>u.id===id),
  ft_shiftRange_:()=>[new Date(oldStart),new Date(oldEnd)],
  ft_sickOverlap_:()=>false,
  ft_get_:name=>{
   if(name==='Shifts')return shifts;
   if(name==='ShiftSegments')return [];
   if(name==='Availability')return [{companyId:c.id,userId:'u2',month:'2026-11',day:11,answer:'YES'}];
   if(name==='AvailabilitySubmissions')return [{companyId:c.id,userId:'u2',month:'2026-11'}];
   throw Error('Unexpected ft_get: '+name);
  },
  ft_days_:()=>30,ft_sha_:x=>'SHA:'+x,
  ft_planSheetRows_:()=>[state],
  ft_monthEditableRange_:(cid,uid,start,end)=>{
   calls.monthChecks.push(uid);
   if(closed)throw Error('Monat bereits abgerechnet');
  },
  ft_publicRow_:row=>({...row}),
  ft_now_:()=>new Date().toISOString(),
  ft_save_:(name,row)=>{saves.push({name,id:row.id});return row;},
  ft_add_:()=>{throw Error('No new shift should be created')},
  ft_audit_:(...args)=>audits.push(args),
  ft_enabled_:()=>true,ft_bool_:value=>value===true,
  ft_one_:(name,id)=>name==='Users'?users.find(x=>x.id===id):null,
  ft_calendar_:()=>cal,
  ft_standbyCalendarTitle_:u=>'Bereitschaft – '+u.name
 };
 const src=part('function ft_planSchedule_(', 'function ft_planWorkflow_(')+
  part('function ft_planAssign_(', 'function ft_planDelete_(')+
  part('function ft_syncShift_(', '// -----------------------------------------------------------------\n// 09_Automation');
 const api=vm.runInNewContext(src+
  ';({ft_planAssign_,ft_planSchedule_,ft_standbyCalendarAssignments_,ft_standbyCalendarMatches_})',ctx);
 const initial=api.ft_planSchedule_(c,'2026-11');
 const state={id:'plan',companyId:c.id,month:'2026-11',fixedHash:approved?initial.signature:'',
  publishedHash:approved?initial.signature:'',sharedHash:shared&&approved?initial.signature:'',
  shareStatus:shared&&approved?'SENT':'NONE',
  sharedAssignments:shared&&approved?JSON.stringify(api.ft_standbyCalendarAssignments_(initial).current):'{}',
  warnings:'',calendarEvents:shared?2:0};
 const actor={id:'admin',role:'ADMIN',companyId:c.id};
 return {c,actor,users,shifts,history,saves,audits,calls,cal,events,state,api,
  change:()=>api.ft_planAssign_(actor,{companyId:c.id,month:'2026-11',day:'2026-11-11',
   userId:'u2',confirmChange:true})};
}
test('one approved published replacement syncs only its Google Calendar event',()=>{
 const f=fixture();
 const beforeOther=f.events.get('event-second');
 const result=f.change();
 assert.equal(result.calendarUpdated,true);
 assert.equal(result.calendarNeedsShare,false);
 assert.equal(result.row.userId,'u2');
 assert.deepEqual(f.calls.calendar.map(x=>x.options.guests),['anna@example.test']);
 assert.equal(f.calls.calendar[0].title,'Bereitschaft – Anna Beispiel');
 assert.equal(f.calls.calendar[0].start,'2026-11-11T06:00:00.000Z');
 assert.equal(f.calls.calendar[0].end,'2026-11-12T06:00:00.000Z');
 assert.ok(f.history.includes('delete:event-first'),'Old invitation must be cancelled');
 assert.strictEqual(f.events.get('event-second'),beforeOther);
 assert.ok(!f.history.some(x=>x.includes('event-second')),'Unchanged event must not be touched');
 const after=f.api.ft_planSchedule_(f.c,'2026-11');
 assert.equal(f.state.fixedHash,after.signature,'Month remains approved');
 assert.equal(f.state.publishedHash,after.signature,'Month remains published');
 assert.equal(f.state.sharedHash,after.signature,'Month remains calendar shared');
 assert.equal(f.api.ft_standbyCalendarMatches_(after,f.state),true);
 assert.deepEqual([...f.calls.monthChecks].sort(),['u1','u2']);
 assert.ok(f.audits.some(a=>a[1]==='PLAN_SINGLE_SHIFT_CORRECTION'));
});
test('reselecting unchanged user never creates or deletes invitations',()=>{
 const f=fixture();const result=f.api.ft_planAssign_(f.actor,{
  companyId:'firm',month:'2026-11',day:'2026-11-11',userId:'u1',
  confirmChange:true,confirmAvailability:true});
 assert.equal(result.unchanged,true);
 assert.equal(f.history.length,0);
 assert.equal(f.saves.length,0);
});
test('published but not calendar-shared month stays without new invites',()=>{
 const f=fixture({shared:false});
 const result=f.change();
 assert.equal(result.calendarUpdated,false);
 assert.equal(f.history.length,0);
 assert.equal(f.calls.calendar.length,0);
 const plan=f.api.ft_planSchedule_(f.c,'2026-11');
 assert.equal(f.state.publishedHash,plan.signature);
 assert.equal(f.state.shareStatus,'NONE');
});
test('Google Calendar outage leaves duty saved but reports pending sync without lying',()=>{
 const f=fixture({failCreate:true});
 const result=f.change();
 assert.equal(result.row.userId,'u2');
 assert.equal(result.calendarUpdated,false);
 assert.equal(result.calendarNeedsShare,true);
 assert.match(result.warning,/Google-Kalender noch nicht aktualisiert/);
 assert.equal(f.state.shareStatus,'PARTIAL');
 assert.equal(f.state.publishedHash,f.api.ft_planSchedule_(f.c,'2026-11').signature);
 assert.ok(f.events.get('event-second'),'Other event survives');
});
test('completed duty, closed month, missing confirmation and unlicensed admins cannot change it',()=>{
 for(const [opt,params] of [
  [{confirmed:true},{}],
  [{closed:true},{}],
  [{},{confirmChange:false}],
  [{},{role:'STAFF'}]
 ]){
  const f=fixture(opt);
  assert.throws(()=>f.api.ft_planAssign_({...f.actor,...(params.role?{role:params.role}:{})},{
   companyId:'firm',month:'2026-11',day:'2026-11-11',userId:'u2',
   confirmChange:params.confirmChange!==false
  }));
  assert.equal(f.shifts[0].userId,'u1');
  assert.equal(f.history.length,0);
 }
});
test('UI distinguishes successful single sync from a pending calendar error',()=>{
 assert.match(html,/result\.calendarUpdated\?'Bereitschaft geändert/);
 assert.match(html,/result\.calendarNeedsShare\?'Bereitschaft geändert/);
});
