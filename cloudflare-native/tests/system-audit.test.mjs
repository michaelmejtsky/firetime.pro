import test from 'node:test';
import assert from 'node:assert/strict';
import {testEnv,seed,record,call} from './helpers.mjs';
import worker,{execute} from '../dist/worker.js';
import contract from '../src/contract.json' with {type:'json'};

const rows=(env,table)=>env.DB.sqlite.prepare('SELECT data FROM records WHERE table_name=? ORDER BY record_id').all(table).map(r=>JSON.parse(r.data));
const state=env=>JSON.stringify(env.DB.sqlite.prepare('SELECT * FROM records ORDER BY table_name,record_id').all());

test('all advertised API actions reject missing authentication before any mutation',async()=>{
 const env=testEnv();try{
  const before=state(env);
  for(const action of contract.actions)await assert.rejects(()=>execute(env,{type:'api',token:'',action,data:{companyId:'c1'}}),/anmelden/,action);
  assert.equal(state(env),before);
 }finally{env.DB.sqlite.close();}
});
test('staff cannot invoke administrative operations or read another company through reporting APIs',async()=>{
 const env=testEnv();try{
  const before=state(env);
  for(const action of ['userCreate','userUpdate','companyCreate','companyUpdate','licenseSave','rulesSave','profileSave','planFinalize','planPublish','planSuggest','planAssign','planDelete','workSave','workDelete','workPublish','leavePolicySave','monthReview','sickReview','tasksCreate','taskUpdate','breakReview','reportSubmissions','storageStatus','driveStorageTest','driveConnect','productionStatus','gmailConnect']){
   await assert.rejects(()=>execute(env,call('1',action,{companyId:'c1',id:'a1',userId:'a1',threadId:'none'})),undefined,action);
  }
  const own=await execute(env,call('a','home',{companyId:'c2',month:'2026-11',view:'shell',reportsMode:'none'}));
  assert.equal(own.data.company.id,'c1');assert.ok(!JSON.stringify(own).includes('Andere Firma'));
  for(const action of ['profileGet','rulesGet','yearOverview','availabilityOverview','calendarAccountStatus','calendarList'])await assert.rejects(()=>execute(env,call('a',action,{companyId:'c2',month:'2026-11',year:2026})),undefined,action);
  assert.equal(state(env),before);
 }finally{env.DB.sqlite.close();}
});
test('monthly correction and re-submission preserve the final snapshot and reject later edits',async()=>{
 const env=testEnv();try{
  const a=await execute(env,call('1','activitySave',{type:'OBJECT',start:'2026-11-02T08:00',end:'2026-11-02T10:00',breakMode:'NONE',breakConfirmed:true}),'audit-month-activity');
  const submitted=await execute(env,call('1','monthSubmit',{month:'2026-11'}));assert.equal(submitted.data.status,'SUBMITTED');
  await assert.rejects(()=>execute(env,call('1','activityDelete',{id:a.data.id})),/eingereicht|freigegeben/);
  await execute(env,call('a','monthReview',{id:submitted.data.id,status:'RETURNED',note:'Endzeit prüfen'}));
  await execute(env,call('1','activitySave',{id:a.data.id,type:'OBJECT',start:'2026-11-02T08:00',end:'2026-11-02T11:00',breakMode:'NONE',breakConfirmed:true}));
  await execute(env,call('1','monthSubmit',{month:'2026-11'}));
  await execute(env,call('a','monthReview',{id:submitted.data.id,status:'APPROVED'}));
  const locked=record(env,'Months',submitted.data.id),report=await execute(env,call('1','report',{month:'2026-11'}));assert.equal(report.data.report.worked,3);assert.equal(JSON.parse(locked.snapshot).worked,3);
  await assert.rejects(()=>execute(env,call('a','activitySave',{userId:'u1',type:'OBJECT',start:'2026-11-05T08:00',end:'2026-11-05T09:00'})),/eingereicht|freigegeben/);
  assert.equal(record(env,'Months',submitted.data.id).snapshot,locked.snapshot);
 }finally{env.DB.sqlite.close();}
});
test('availability validates leap-year days, rejects partial submission, and freezes a submitted employee response',async()=>{
 const env=testEnv();try{
  await execute(env,call('1','availabilitySave',{month:'2028-02',days:[{day:29,answer:'YES'}]}));
  await assert.rejects(()=>execute(env,call('1','availabilitySubmit',{month:'2028-02'})),/jeden Tag/);
  await assert.rejects(()=>execute(env,call('1','availabilitySave',{month:'2027-02',days:[{day:29,answer:'YES'}]})),/Ungültige/);
  await execute(env,call('1','availabilitySave',{month:'2028-02',days:Array.from({length:29},(_,i)=>({day:i+1,answer:'NO'}))}));
  await execute(env,call('1','availabilitySubmit',{month:'2028-02'}));assert.equal(rows(env,'AvailabilitySubmissions').length,1);
  await assert.rejects(()=>execute(env,call('1','availabilitySave',{month:'2028-02',days:[{day:1,answer:'YES'}]})),/bereits abgegeben/);
  assert.equal(rows(env,'Availability').find(a=>a.day===1).answer,'NO');
 }finally{env.DB.sqlite.close();}
});
test('parallel writes are atomic and conflicts remain retryable without duplicate records',async()=>{
 const env=testEnv();try{
  const requests=Array.from({length:12},(_,i)=>({key:'audit-concurrent-'+i,input:call(i%2?'2':'1','activitySave',{type:'OBJECT',start:'2026-11-'+String(i+1).padStart(2,'0')+'T08:00',end:'2026-11-'+String(i+1).padStart(2,'0')+'T09:00'})}));
  const result=await Promise.allSettled(requests.map(r=>execute(env,r.input,r.key)));
  for(let i=0;i<result.length;i++)if(result[i].status==='rejected'){assert.match(result[i].reason.message,/gleichzeitig|gleichzeitige/i);await execute(env,requests[i].input,requests[i].key);}
  assert.equal(rows(env,'Activities').length,12);assert.equal(rows(env,'Audit').filter(a=>a.entity==='Activities').length,12);
  for(const r of requests)await execute(env,r.input,r.key);
  assert.equal(rows(env,'Activities').length,12);
 }finally{env.DB.sqlite.close();}
});
test('HTTP endpoints reject cross-origin writes, malformed JSON and unsupported methods without side effects',async()=>{
 const env=testEnv();env.MIGRATION_MODE='production';env.CUTOVER_CONFIRMED='true';const ctx={waitUntil(){}};
 try{
  const before=state(env),cases=[
   [new Request('https://audit.test/api',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:'{}'}),403],
   [new Request('https://audit.test/api',{method:'GET'}),405],
   [new Request('https://audit.test/api',{method:'POST',body:'{}'}),415],
   [new Request('https://audit.test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}),400],
   [new Request('https://audit.test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"type":"unknown"}'}),400],
   [new Request('https://audit.test/first-start'),404]
  ];
  for(const [req,status] of cases)assert.equal((await worker.fetch(req,env,ctx)).status,status);
  assert.equal(state(env),before);
 }finally{env.DB.sqlite.close();}
});
