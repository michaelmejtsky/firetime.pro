import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testEnv,call,record,seed} from './helpers.mjs';
import {execute} from '../dist/worker.js';
import worker from '../dist/worker.js';
import {finishCalendarConnect,calendarOAuthFetch,validateCalendarJobKey} from '../dist/calendar-oauth.mjs';
import {drainOutbox} from '../dist/effects.mjs';
const origin='https://firetime.example.test';
const granted='openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';
const envFor=()=>({...testEnv(),FT_PEPPER:'synthetic-calendar-pepper-with-at-least-32-characters',GOOGLE_DRIVE_CLIENT_ID:'client-'+randomUUID(),GOOGLE_DRIVE_CLIENT_SECRET:'synthetic-secret',CALENDAR_ENABLED:'true',CALENDAR_AUTH:'oauth'});
function google({role='owner',scope=granted,sub='owner',email='calendar@example.test'}={}){
 const saved=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,opts={})=>{const u=new URL(url);requests.push({url:u,options:opts});const json=x=>new Response(JSON.stringify(x));
  if(u.origin==='https://oauth2.googleapis.com')return json({access_token:'access',expires_in:3600,...(opts.body.get('grant_type')==='authorization_code'?{refresh_token:'private-refresh',scope}:{})});
  if(u.origin==='https://openidconnect.googleapis.com')return json({sub,email,email_verified:true});
  if(u.pathname==='/calendar/v3/users/me/calendarList')return json({items:[{id:'existing@example.test',summary:'Bestehender Kalender',accessRole:role}]});
  if(u.pathname.startsWith('/calendar/v3/users/me/calendarList/'))return json({id:decodeURIComponent(u.pathname.split('/').at(-1)),summary:'Kalender',accessRole:role});
  if(u.pathname.includes('/events'))return json({id:'event'});
  throw Error('Unexpected Google request '+u.pathname);
 };
 return {requests,restore(){globalThis.fetch=saved;}};
}
async function connect(env,token='a',kind='company',cid='c1'){
 const started=await execute(env,call(token,'calendarConnect',{companyId:cid,kind}),'',origin),u=new URL(started.data.url);
 const callback=new URL('/calendar-callback',origin);callback.search=new URLSearchParams({state:u.searchParams.get('state'),code:'test-code'});
 await finishCalendarConnect(env,callback);return callback;
}
test('explicit calendar reconnection resumes failed calendar jobs only for that connection and tenant',async()=>{
 const env=envFor(),g=google();try{
  await connect(env);env.MIGRATION_MODE='production';env.CUTOVER_CONFIRMED='true';
  const data={companyId:'c1',connectionKey:'calendar:c1',calendarId:'existing@example.test',eventId:'recovery-event',create:true,data:{summary:'Prüftermin'}};
  for(const [id,kind,payload] of [
   ['recover','calendar',data],
   ['other-company','calendar',{...data,companyId:'c2',connectionKey:'calendar:c2'}],
   ['personal','calendar',{...data,userId:'u1',connectionKey:'calendar-user:c1:u1'}],
   ['uncertain-mail','mail',{gmailAttempted:true,message:{to:'never@example.test'}}]
  ])env.DB.sqlite.prepare("INSERT INTO outbox(id,kind,payload,status,attempts,available_at,created_at) VALUES(?,?,?,'ERROR',8,0,?)").run(id,kind,JSON.stringify(payload),new Date().toISOString());
  await connect(env);
  const status=id=>env.DB.sqlite.prepare('SELECT * FROM outbox WHERE id=?').get(id);
  assert.equal(status('recover').status,'QUEUED');assert.equal(status('recover').attempts,0);
  for(const id of ['other-company','personal','uncertain-mail'])assert.equal(status(id).status,'ERROR');
  await drainOutbox(env);assert.equal(status('recover').status,'SENT');
 }finally{g.restore();env.DB.sqlite.close();}
});
test('company OAuth binds session and tenant, encrypts tokens and consumes callback once',async()=>{
 const env=envFor(),g=google();try{
  await assert.rejects(()=>execute(env,call('1','calendarConnect',{companyId:'c1',kind:'company'}),'',origin),/Firmenadministratoren/);
  await assert.rejects(()=>execute(env,call('a','calendarConnect',{companyId:'c2'}),'',origin),/Kein Zugriff/);
  const callback=await connect(env);await assert.rejects(()=>finishCalendarConnect(env,callback),/bereits verwendet/);
  const row=env.DB.sqlite.prepare("SELECT * FROM integrations WHERE key='calendar:c1'").get();assert.ok(row);assert.ok(!row.encrypted.includes('private-refresh'));
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM integrations WHERE key='drive'").get().n,0);
  const status=await execute(env,call('a','calendarAccountStatus',{companyId:'c1'}),'',origin);assert.equal(status.data.email,'calendar@example.test');assert.ok(!JSON.stringify(status).includes('private-refresh'));
  const list=await execute(env,call('a','calendarList',{companyId:'c1'}));assert.equal(list.data.calendars[0].id,'existing@example.test');
 }finally{g.restore();}
});
test('existing writable main and staff calendar selections persist with company credential routing',async()=>{
 const env=envFor(),g=google();try{
  await connect(env);
  await execute(env,call('a','calendarSave',{companyId:'c1',kind:'company',calendarId:'existing@example.test'}));
  assert.equal(record(env,'Companies','c1').calendarOn,true);
  await execute(env,call('a','calendarSave',{companyId:'c1',kind:'company',userId:'u1',calendarId:'staff@example.test'}));
  const pref=JSON.parse(env.DB.sqlite.prepare("SELECT data FROM records WHERE table_name='EmployeePreferences' AND user_id='u1'").get().data);assert.equal(pref.calendarConnectionKey,'calendar:c1');
  await assert.rejects(()=>execute(env,call('a','calendarSave',{companyId:'c1',userId:'x1',calendarId:'x@example.test'})),/nicht zur Firma/);
  await assert.rejects(()=>execute(env,call('1','calendarSave',{companyId:'c1',kind:'personal',userId:'u2',calendarId:'x@example.test'})),/eigene/);
 }finally{g.restore();}
});
test('employee connects their own Google account and only their own calendar',async()=>{
 const env=envFor(),g=google();try{
  await connect(env,'1','personal');
  await execute(env,call('1','calendarSave',{companyId:'c1',kind:'personal',userId:'u1',calendarId:'personal@example.test'}));
  const pref=JSON.parse(env.DB.sqlite.prepare("SELECT data FROM records WHERE table_name='EmployeePreferences' AND user_id='u1'").get().data);assert.equal(pref.calendarConnectionKey,'calendar-user:c1:u1');
  await assert.rejects(()=>execute(env,call('1','calendarList',{companyId:'c1',kind:'company'})),/Firmenadministratoren/);
 }finally{g.restore();}
});
test('read-only calendar selection is rejected without storing a calendar ID',async()=>{
 const env=envFor(),g=google({role:'reader'});try{
  await connect(env);await assert.rejects(()=>execute(env,call('a','calendarSave',{companyId:'c1',calendarId:'read@example.test'})),/Schreibrechte/);assert.equal(record(env,'Companies','c1').calendarId,'');
  assert.equal((await execute(env,call('a','calendarList',{companyId:'c1'}))).data.calendars.length,0);
 }finally{g.restore();}
});
test('OAuth refuses incomplete scopes and revoked session callbacks',async()=>{
 const env=envFor(),g=google({scope:'openid email'});try{await assert.rejects(()=>connect(env),/vollständig bestätigen/);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM integrations').get().n,0);
 const started=await execute(env,call('a','calendarConnect',{companyId:'c1'}),'',origin),u=new URL(started.data.url);env.DB.sqlite.prepare("DELETE FROM records WHERE table_name='Sessions' AND user_id='a1'").run();
 const cb=new URL('/calendar-callback?code=x&state='+u.searchParams.get('state'),origin);await assert.rejects(()=>finishCalendarConnect(env,cb),/Sitzung/);
 }finally{g.restore();}
});
test('calendar outbox can run alone without enabling mail or other automations',async()=>{
 const env=envFor(),g=google();try{
  await connect(env);env.MIGRATION_MODE='production';env.CUTOVER_CONFIRMED='true';
  const now=Date.now(),job={companyId:'c1',connectionKey:'calendar:c1',calendarId:'existing@example.test',eventId:'event123',create:true,data:{summary:'Test'}};
  for(const [id,kind,payload] of [['calendar-test','calendar',job],['mail-test','mail',{message:{to:'never@example.test'}}]])env.DB.sqlite.prepare('INSERT INTO outbox(id,kind,payload,status,attempts,available_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id,kind,JSON.stringify(payload),'QUEUED',0,now,new Date().toISOString());
  await drainOutbox(env);assert.equal(env.DB.sqlite.prepare("SELECT status FROM outbox WHERE id='calendar-test'").get().status,'SENT');assert.equal(env.DB.sqlite.prepare("SELECT status FROM outbox WHERE id='mail-test'").get().status,'QUEUED');
  assert.throws(()=>validateCalendarJobKey({...job,connectionKey:'calendar:c2'}),/gehört nicht/);
 }finally{g.restore();}
});

test('OAuth routes main standby events and personal task deadlines using their own credentials',async()=>{
 const env=envFor(),g=google();try{
  await connect(env);await connect(env,'1','personal');
  await execute(env,call('a','calendarSave',{companyId:'c1',calendarId:'main@example.test'}));
  await execute(env,call('1','calendarSave',{companyId:'c1',kind:'personal',userId:'u1',calendarId:'personal@example.test'}));
  const created=await execute(env,call('a','tasksCreate',{companyId:'c1',recipientIds:['u1'],title:'Kalenderaufgabe',body:'Bitte prüfen',dueDate:'2026-12-15'}));
  let jobs=env.DB.sqlite.prepare("SELECT payload FROM outbox WHERE kind='calendar'").all().map(x=>JSON.parse(x.payload));assert.equal(jobs.length,1);assert.equal(jobs[0].connectionKey,'calendar-user:c1:u1');assert.equal(jobs[0].companyId,'c1');
  // A normal main-calendar operation uses the firm's connection, not the employee's token.
  for(let d=1;d<=30;d++){const day='2026-11-'+String(d).padStart(2,'0');seed(env,'Shifts',{id:'shift-'+d,companyId:'c1',userId:'u1',day,start:day+'T06:00:00Z',end:day+'T18:00:00Z',status:'DRAFT'});}
  await execute(env,call('a','planFinalize',{companyId:'c1',month:'2026-11'}));await execute(env,call('a','planPublish',{companyId:'c1',month:'2026-11'}));
  await execute(env,call('a','planCalendarShare',{companyId:'c1',month:'2026-11'}));
  jobs=env.DB.sqlite.prepare("SELECT payload FROM outbox WHERE kind='calendar'").all().map(x=>JSON.parse(x.payload));
  assert.equal(jobs.filter(x=>x.calendarId==='main@example.test').length,30);assert.ok(jobs.filter(x=>x.calendarId==='main@example.test').every(x=>x.companyId==='c1'&&x.connectionKey==='calendar:c1'));
  assert.equal(jobs.filter(x=>x.calendarId==='personal@example.test').length,31);
  await execute(env,call('1','calendarSave',{companyId:'c1',kind:'personal',userId:'u1',calendarId:''}));
  jobs=env.DB.sqlite.prepare("SELECT payload FROM outbox WHERE kind='calendar'").all().map(x=>JSON.parse(x.payload));assert.ok(jobs.filter(x=>x.delete).every(x=>x.connectionKey==='calendar-user:c1:u1'));
 }finally{g.restore();}
});
