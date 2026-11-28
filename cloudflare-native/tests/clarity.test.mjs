import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {drainOutbox} from '../dist/effects.mjs';
import {testEnv,seed,record,call} from './helpers.mjs';
import {execute} from '../dist/worker.js';
import {createCore} from '../dist/core.mjs';
import {Runtime} from '../dist/runtime.mjs';
import {ViennaDate} from '../dist/time.mjs';
import {loadSnapshot,commit} from '../dist/store.mjs';
const png={mime:'image/png',name:'test.png',data:Buffer.from([137,80,78,71,13,10,26,10,...Array(32).fill(0)]).toString('base64')};
function personal(env,id,calendarId){env.DB.sqlite.prepare("UPDATE records SET data=json_set(data,'$.calendarOn',json('true')) WHERE table_name='Companies' AND record_id='c1'").run();return seed(env,'EmployeePreferences',{id:'pref-'+id,companyId:'c1',userId:id,calendarId,leaveHoursPerDay:5});}
test('only tasks are visible; old messages are preserved but inaccessible through task APIs',async()=>{
 const env=testEnv();seed(env,'CommThreads',{id:'old-message',companyId:'c1',kind:'MESSAGE',createdBy:'a1',recipientId:'u1',titleEncoded:'eA',bodyEncoded:'eA',status:'MESSAGE'});
 const list=await execute(env,call('1','commList',{companyId:'c1'}));assert.equal(list.data.threads.length,0);assert.ok(record(env,'CommThreads','old-message'));
 await assert.rejects(()=>execute(env,call('a','commCreate',{companyId:'c1',kind:'MESSAGE',recipientId:'u1',title:'Test',body:'Test'})),/nur Aufgaben/);
 await assert.rejects(()=>execute(env,call('1','commReply',{threadId:'old-message',body:'Test'})),/Berechtigung/);
});
test('task assignment to multiple employees is atomic and each employee has independent status',async()=>{
 const env=testEnv(),data={companyId:'c1',recipientIds:['u1','u2'],title:'RWA warten',body:'Wartung dokumentieren',dueDate:'2026-12-15',photo:png};
 const result=await execute(env,call('a','tasksCreate',data),'multiple-task-request');assert.equal(result.data.created,2);
 const [a,b]=result.data.threads;assert.notEqual(a.id,b.id);assert.equal(a.status,'OPEN');assert.equal(a.attachmentId,b.attachmentId);assert.equal(env.FILES.objects.size,1);
 const attachment=await execute(env,call('2','commPhoto',{threadId:b.id,attachmentId:b.attachmentId}));assert.equal(attachment.data.data,png.data);
 await execute(env,call('1','commTaskStatus',{threadId:a.id,status:'ACCEPTED'}));assert.equal(record(env,'CommThreads',a.id).status,'ACCEPTED');assert.equal(record(env,'CommThreads',b.id).status,'OPEN');
 await assert.rejects(()=>execute(env,call('1','commTaskStatus',{threadId:b.id,status:'ACCEPTED'})),/Berechtigung/);
 await assert.rejects(()=>execute(env,call('a','tasksCreate',{...data,recipientIds:['u1','x1']}),'invalid-multiple-task'));
 assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='CommThreads'").get().n,2);
});
test('returned tasks have an explicit state and can be accepted and completed again',async()=>{
 const env=testEnv(),created=await execute(env,call('a','tasksCreate',{companyId:'c1',recipientIds:['u1'],title:'Testaufgabe',body:'Bitte prüfen'}));const id=created.data.threads[0].id;
 await execute(env,call('1','commTaskStatus',{threadId:id,status:'ACCEPTED'}));await execute(env,call('1','commTaskStatus',{threadId:id,status:'DONE',photo:png}));
 await execute(env,call('a','commTaskStatus',{threadId:id,status:'OPEN',note:'Bitte nochmals prüfen'}));assert.equal(record(env,'CommThreads',id).status,'RETURNED');
 await execute(env,call('1','commTaskStatus',{threadId:id,status:'ACCEPTED'}));await execute(env,call('1','commTaskStatus',{threadId:id,status:'DONE',photo:png}));await execute(env,call('a','commTaskStatus',{threadId:id,status:'CLOSED'}));assert.equal(record(env,'CommThreads',id).status,'CLOSED');
});
test('automatic pause requires confirmation, starts strictly after six hours and never double deducts',async()=>{
 const env=testEnv();const base={companyId:'c1',type:'OTHER',start:'2026-11-03T08:00',end:'2026-11-03T15:00',breakMode:'AUTO',breakMinutes:0};
 await assert.rejects(()=>execute(env,call('1','activitySave',base)),/bestätigen/);
 const a=await execute(env,call('1','activitySave',{...base,breakConfirmed:true}));assert.equal(a.data.breakMinutes,30);
 const b=await execute(env,call('1','activitySave',{...base,start:'2026-11-04T08:00',end:'2026-11-04T14:00',breakConfirmed:true}));assert.equal(b.data.breakMinutes,0);
 const c=await execute(env,call('1','activitySave',{...base,start:'2026-11-05T08:00',end:'2026-11-05T16:00',breakMinutes:45,breakConfirmed:true}));assert.equal(c.data.breakMinutes,45);
});
test('actual missing pauses stay undeducted and only administration can acknowledge the exception',async()=>{
 const env=testEnv(),a=await execute(env,call('1','activitySave',{type:'OBJECT',start:'2026-11-03T08:00',end:'2026-11-03T15:00',breakMode:'NONE',breakConfirmed:true,breakMinutes:0}));assert.equal(a.data.breakMinutes,0);
 await assert.rejects(()=>execute(env,call('1','breakReview',{activityId:a.data.id,note:'Tatsächlich ohne Pause gearbeitet'})),/Berechtigung/);
 const review=await execute(env,call('a','breakReview',{activityId:a.data.id,note:'Abweichung geprüft, tatsächlich ohne Pause gearbeitet'}));assert.equal(review.data.minutesUnchanged,0);assert.equal(record(env,'Activities',a.data.id).breakMinutes,0);
});
test('yearly totals and leave overview are tenant scoped, keep standby separate, and do not invent leave hours',async()=>{
 const env=testEnv();seed(env,'Activities',{id:'work',companyId:'c1',userId:'u1',type:'OBJECT',start:'2026-11-02T07:00:00.000Z',end:'2026-11-02T09:00:00.000Z',breakMinutes:0});
 const a=await execute(env,call('1','yearOverview',{companyId:'c1',year:2026,month:'2026-11'}));assert.equal(a.data.employees.length,1);assert.equal(a.data.employees[0].throughMonth.worked,2);assert.equal(a.data.employees[0].throughMonth.standby,0);assert.equal(a.data.employees[0].leave.balanceHours,null);
 personal(env,'u1','anna@example.test');const b=await execute(env,call('a','yearOverview',{companyId:'c1',year:2026,month:'2026-11'}));assert.equal(b.data.employees.find(x=>x.user.id==='u1').leave.balanceHours,100);
 await assert.rejects(()=>execute(env,call('a','yearOverview',{companyId:'c2',year:2026})),/Zugriff/);
 seed(env,'LeaveFlexRules',{id:'flex',companyId:'c1',userId:'u1',mode:'FLEX',referenceDays:5,basis:'Dokumentierte flexible Urlaubsbewertung',balanceReviewed:true});seed(env,'Leaves',{id:'cross-month',companyId:'c1',userId:'u1',from:'2026-11-30',to:'2026-12-04',days:3,status:'APPROVED'});
 const partial=await execute(env,call('1','yearOverview',{companyId:'c1',year:2026,month:'2026-11'}));assert.equal(partial.data.employees[0].leave.approvedMonthDays,null);assert.equal(partial.data.employees[0].leave.approvedYearDays,3);assert.equal(partial.data.employees[0].leave.approvedMonthHours,null);
});
test('recent monthly submissions cross a year boundary and are admin-only',async()=>{
 const env=testEnv();seed(env,'Months',{id:'old',companyId:'c1',userId:'u1',month:'2026-12',status:'SUBMITTED'});
 const r=await execute(env,call('a','reportSubmissions',{companyId:'c1',month:'2027-01'}));assert.deepEqual(r.data.months,['2027-01','2026-12','2026-11']);assert.equal(r.data.employees.find(x=>x.id==='u1').months[1].status,'SUBMITTED');await assert.rejects(()=>execute(env,call('1','reportSubmissions',{companyId:'c1',month:'2027-01'})),/Berechtigung/);
});
test('availability history distinguishes saved drafts and submitted months per employee',async()=>{
 const env=testEnv();seed(env,'Availability',{id:'v1',companyId:'c1',userId:'u1',month:'2026-11',day:1,answer:'YES'});seed(env,'AvailabilitySubmissions',{id:'sub',companyId:'c1',userId:'u1',month:'2026-10',submittedAt:'2026-09-20T08:00:00Z'});
 const r=await execute(env,call('1','availabilityOverview',{companyId:'c1',month:'2026-11'}));assert.equal(r.data.employees.length,1);assert.equal(r.data.employees[0].months.find(x=>x.month==='2026-10').submitted,true);assert.equal(r.data.employees[0].months.find(x=>x.month==='2026-11').answered,1);
});
test('personal task calendar uses stable event IDs, updates deadlines and cancels completed task events',async()=>{
 const env=testEnv();personal(env,'u1','anna@example.test');env.CALENDAR_ENABLED='true';
 const created=await execute(env,call('a','tasksCreate',{companyId:'c1',recipientIds:['u1'],title:'RWA Wartung',body:'Bitte dokumentieren',dueDate:'2026-12-15'}));const id=created.data.threads[0].id;
 const queued=()=>env.DB.sqlite.prepare("SELECT payload FROM outbox WHERE kind='calendar' ORDER BY rowid").all().map(r=>JSON.parse(r.payload));
 assert.equal(queued().length,1);const event=queued()[0];assert.equal(event.calendarId,'anna@example.test');assert.deepEqual(event.data.start,{date:'2026-12-15'});assert.deepEqual(event.data.end,{date:'2026-12-16'});
 await execute(env,call('a','taskUpdate',{companyId:'c1',threadId:id,dueDate:'2026-12-20'}));assert.equal(queued()[1].eventId,event.eventId);assert.deepEqual(queued()[1].data.start,{date:'2026-12-20'});
 await execute(env,call('1','commTaskStatus',{threadId:id,status:'ACCEPTED'}));await execute(env,call('1','commTaskStatus',{threadId:id,status:'DONE',photo:png}));await execute(env,call('a','commTaskStatus',{threadId:id,status:'CLOSED'}));assert.equal(queued().at(-1).delete,true);assert.equal(queued().at(-1).eventId,event.eventId);
 await execute(env,call('a','commTaskStatus',{threadId:id,status:'RETURNED',note:'Bitte nacharbeiten'}));assert.equal(queued().at(-1).create,true);assert.notEqual(queued().at(-1).eventId,event.eventId);
});
test('published standby is mirrored to personal calendar after main calendar sharing, without duplicates',async()=>{
 const env=testEnv();personal(env,'u1','anna@example.test');env.CALENDAR_ENABLED='true';
 seed(env,'Shifts',{id:'shift',companyId:'c1',userId:'u1',day:'2026-12-15',start:'2026-12-15T06:00:00Z',end:'2026-12-16T06:00:00Z',status:'PUBLISHED',eventId:'main-event'});
 const snapshot=await loadSnapshot(env,{},{system:true}),runtime=new Runtime(snapshot),core=createCore(runtime);core.ft_tick();await commit(env,snapshot,runtime);
 let jobs=env.DB.sqlite.prepare("SELECT payload FROM outbox WHERE kind='calendar'").all().map(r=>JSON.parse(r.payload));assert.equal(jobs.length,1);assert.equal(jobs[0].calendarId,'anna@example.test');assert.equal(jobs[0].data.start.dateTime,'2026-12-15T06:00:00.000Z');assert.equal(record(env,'Shifts','shift').eventId,'main-event');
 const again=await loadSnapshot(env,{},{system:true}),rt=new Runtime(again);createCore(rt).ft_tick();await commit(env,again,rt);assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM outbox WHERE kind='calendar'").get().n,1);
});
test('vector PDF separates work and standby on separate pages and contains selectable text',async()=>{
 const env=testEnv();const r=await execute(env,call('1','pdfVector',{companyId:'c1',month:'2026-11'}));const pdf=Buffer.from(r.data.base64,'base64').toString('latin1');assert.match(pdf,/ARBEITSZEIT/);assert.match(pdf,/BEREITSCHAFT/);assert.ok(r.data.pages>=2);assert.ok(!pdf.includes('/DCTDecode'));
});

test('changing personal calendar destination removes old events; restoring an ID never reuses a deleted event',async()=>{
 const env=testEnv();personal(env,'u1','first@example.test');env.CALENDAR_ENABLED='true';
 await execute(env,call('a','tasksCreate',{companyId:'c1',recipientIds:['u1'],title:'Testaufgabe',body:'Bitte prüfen',dueDate:'2026-12-31'}));
 const jobs=()=>env.DB.sqlite.prepare("SELECT payload FROM outbox WHERE kind='calendar' ORDER BY rowid").all().map(r=>JSON.parse(r.payload));
 const original=jobs()[0];assert.equal(original.data.end.date,'2027-01-01');
 await execute(env,call('a','userUpdate',{id:'u1',calendarId:'second@example.test'}));
 assert.equal(jobs()[1].delete,true);assert.equal(jobs()[1].calendarId,'first@example.test');assert.equal(jobs()[2].calendarId,'second@example.test');
 await execute(env,call('a','userUpdate',{id:'u1',calendarId:'first@example.test'}));assert.equal(jobs()[3].delete,true);assert.notEqual(jobs()[4].eventId,original.eventId);
 await assert.rejects(()=>execute(env,call('1','userUpdate',{id:'u1',calendarId:'other@example.test'})),/Berechtigung/);
 await execute(env,call('a','userUpdate',{id:'u1',calendarId:''}));assert.equal(jobs().at(-1).delete,true);assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='CalendarMirrors'").get().n,0);
});
test('main standby calendar and personal mirror are queued in the same transaction without duplicate invitations',async()=>{
 const env=testEnv();personal(env,'u1','anna@example.test');env.CALENDAR_ENABLED='true';
 env.DB.sqlite.prepare("UPDATE records SET data=json_set(data,'$.calendarId','main@example.test') WHERE table_name='Companies' AND record_id='c1'").run();
 for(let d=1;d<=30;d++){const day='2026-11-'+String(d).padStart(2,'0');seed(env,'Shifts',{id:'shift-'+d,companyId:'c1',userId:'u1',day,start:day+'T06:00:00Z',end:day+'T18:00:00Z',status:'DRAFT'});}
 await execute(env,call('a','planFinalize',{companyId:'c1',month:'2026-11'}));await execute(env,call('a','planPublish',{companyId:'c1',month:'2026-11'}));
 const snapshot=await loadSnapshot(env,call('a','planCalendarShare',{companyId:'c1',month:'2026-11'}));
 snapshot.calendars=new Map([['main@example.test',{verified:true,name:'Main',events:new Map()}]]);
 const rt=new Runtime(snapshot),result=createCore(rt).ft_api('a'.repeat(64),'planCalendarShare',{companyId:'c1',month:'2026-11'});assert.deepEqual(result.warnings,[]);await commit(env,snapshot,rt);
 const jobs=env.DB.sqlite.prepare("SELECT payload FROM outbox WHERE kind='calendar'").all().map(r=>JSON.parse(r.payload));assert.equal(jobs.length,60);
 assert.equal(jobs.filter(j=>j.calendarId==='main@example.test').length,30);assert.equal(jobs.filter(j=>j.calendarId==='anna@example.test').length,30);
 assert.ok(jobs.filter(j=>j.calendarId==='main@example.test').every(j=>!j.data.attendees.length));
 const again=await loadSnapshot(env,{},{system:true}),runtime=new Runtime(again);createCore(runtime).ft_tick();await commit(env,again,runtime);assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM outbox WHERE kind='calendar'").get().n,60);
});

test('calendar REST retries update a duplicate create and late delivery cannot mark a new destination as sent',async()=>{
 const env=testEnv(),key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
 Object.assign(env,{MIGRATION_MODE:'production',AUTOMATION_ENABLED:'true',CALENDAR_ENABLED:'true',GOOGLE_CALENDAR_SERVICE_ACCOUNT:JSON.stringify({client_email:'synthetic@example.test',private_key:key})});
 seed(env,'CalendarMirrors',{id:'mirror',companyId:'c1',userId:'u1',calendarId:'new@example.test',eventId:'new-event',sourceHash:'same-hash',status:'QUEUED'});
 const payload={calendarId:'old@example.test',eventId:'old-event',create:true,data:{summary:'Test'},mirrorId:'mirror',mirrorHash:'same-hash'};
 env.DB.sqlite.prepare("INSERT INTO outbox(id,kind,payload,created_at) VALUES(?,?,?,?)").run('calendar-old','calendar',JSON.stringify(payload),'2026-11-22T10:00:00Z');
 const requests=[],original=globalThis.fetch;globalThis.fetch=async(url,options={})=>{requests.push({url,method:options.method});if(String(url).includes('oauth2'))return new Response(JSON.stringify({access_token:'synthetic',expires_in:3600}));return new Response('{}',{status:options.method==='POST'?409:200});};
 try{assert.equal((await drainOutbox(env)).processed,1);assert.equal(record(env,'CalendarMirrors','mirror').status,'QUEUED');
  env.DB.sqlite.prepare("INSERT INTO outbox(id,kind,payload,created_at) VALUES(?,?,?,?)").run('calendar-new','calendar',JSON.stringify({...payload,calendarId:'new@example.test',eventId:'new-event'}),'2026-11-22T10:00:01Z');
  assert.equal((await drainOutbox(env)).processed,1);assert.equal(record(env,'CalendarMirrors','mirror').status,'SENT');assert.equal(requests.filter(r=>r.method==='PATCH').length,2);
 }finally{globalThis.fetch=original;}
});

test('stopping the clock with automatic break tops up recorded fifteen minutes once',async()=>{
 const env=testEnv();seed(env,'ActivityTimers',{id:'timer',companyId:'c1',userId:'u1',type:'OTHER',start:'2026-11-02T07:00:00Z',createdAt:'2026-11-02T07:00:00Z'});
 seed(env,'TimerPauseEvents',{id:'pause',companyId:'c1',userId:'u1',timerId:'timer',start:'2026-11-02T11:00:00Z',end:'2026-11-02T11:15:00Z'});
 const snapshot=await loadSnapshot(env,call('1','timerStop')),runtime=new Runtime(snapshot),fixed=Date.parse('2026-11-02T14:00:00Z');
 runtime.globals.Date=class extends ViennaDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
 const result=createCore(runtime).ft_api('1'.repeat(64),'timerStop',{companyId:'c1',autoBreak:true,breakConfirmed:true});await commit(env,snapshot,runtime);
 assert.equal(result.activity.breakMinutes,30);assert.equal(record(env,'ActivityTimers','timer'),null);
 const activities=env.DB.sqlite.prepare("SELECT data FROM records WHERE table_name='Activities'").all();assert.equal(activities.length,1);assert.equal(JSON.parse(activities[0].data).breakMinutes,30);
});
