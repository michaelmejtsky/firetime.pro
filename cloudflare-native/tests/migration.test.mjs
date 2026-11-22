import test from 'node:test';
import assert from 'node:assert/strict';
import {testEnv,seed,d1,record} from './helpers.mjs';
import {validateExport,buildSql,verifyDatabase} from '../tools/migrate.mjs';
import {reconcile} from '../tools/reconcile.mjs';
import schemas from '../src/schema.json' with {type:'json'};
import {digest} from '../dist/runtime.mjs';
import {execute} from '../dist/worker.js';
import {drainOutbox} from '../dist/effects.mjs';
import {ViennaDate} from '../dist/time.mjs';
function exported(env){const tables={};for(const [name,headers] of Object.entries(schemas)){const data=env.DB.sqlite.prepare('SELECT data FROM records WHERE table_name=? ORDER BY ordinal').all(name);tables[name]={headers,rows:data.map(r=>{const obj=JSON.parse(r.data);return headers.map(k=>obj[k]??'');})};}return {format:'firetime-native-export-v1',exportedAt:'2026-11-22T10:00:00.000Z',tables,files:[]};}
test('all export cells round-trip losslessly through SQL, including leading signs and JSON snapshots',()=>{
 const env=testEnv();seed(env,'Activities',{id:'act-1',companyId:'c1',userId:'u1',type:'OTHER',start:'2026-11-01T08:00:00.000Z',end:'2026-11-01T09:00:00.000Z',description:"- Prüfung O'Brien + @ = unverändert"});
 const data=exported(env),checked=validateExport(data),target=d1();target.sqlite.exec(buildSql(checked,digest(JSON.stringify(data))));assert.deepEqual(verifyDatabase(target.sqlite,checked),{records:checked.records.length,unchanged:true});
 assert.equal(target.sqlite.prepare("SELECT json_extract(data,'$.description') text FROM records WHERE record_id='act-1'").get().text,"- Prüfung O'Brien + @ = unverändert");
});
test('migration refuses unknown columns, duplicate IDs, missing files and corrupted snapshots',()=>{
 const data=exported(testEnv());
 const duplicate=structuredClone(data);duplicate.tables.Users.rows.push(duplicate.tables.Users.rows[0]);assert.throws(()=>validateExport(duplicate),/Doppelte ID/);
 const unknown=structuredClone(data);unknown.tables.Extra={headers:['id'],rows:[]};assert.throws(()=>validateExport(unknown),/Unbekannte Tabelle/);
 const missing=structuredClone(data);missing.tables.Companies.rows[0][missing.tables.Companies.headers.indexOf('logoId')]='missing';assert.throws(()=>validateExport(missing),/Datei fehlt/);
 const corrupted=structuredClone(data);corrupted.tables.Months.rows.push(schemas.Months.map(k=>({id:'m1',companyId:'c1',userId:'u1',status:'APPROVED',month:'2026-11',snapshot:'{}',snapshotHash:'0'.repeat(64)})[k]??''));assert.throws(()=>validateExport(corrupted),/Snapshot-Prüfsumme/);
});
test('BSB3100 object work stays parallel; incidents alone interrupt standby',async()=>{
 const env=testEnv();seed(env,'Shifts',{id:'shift-1',companyId:'c1',userId:'u1',day:'2026-11-02',start:'2026-11-02T06:00:00.000Z',end:'2026-11-03T06:00:00.000Z',status:'PUBLISHED',actualStatus:'DONE'});
 seed(env,'Activities',{id:'object-1',companyId:'c1',userId:'u1',type:'OBJECT',start:'2026-11-02T07:00:00.000Z',end:'2026-11-02T09:00:00.000Z',breakMinutes:0});
 seed(env,'Activities',{id:'incident-1',companyId:'c1',userId:'u1',type:'INCIDENT',start:'2026-11-02T09:00:00.000Z',end:'2026-11-02T11:00:00.000Z',breakMinutes:0});
 const response=await execute(env,{type:'api',token:'1'.repeat(64),action:'report',data:{month:'2026-11'}});assert.equal(response.data.report.standby,22);assert.equal(response.data.report.object,2);assert.equal(response.data.report.incident,2);assert.equal(response.data.report.worked,4);assert.equal(response.data.report.target,25);
 const data=exported(env),checked=validateExport(data),comparison=reconcile(data,checked);assert.equal(comparison.ok,true,JSON.stringify(comparison.failures));assert.equal(comparison.compared,4);
});
test('outbox delivery is queued separately and marked SENT only after provider confirmation',async()=>{
 const env=testEnv();env.MAIL_ENABLED='true';env.MAIL_API_KEY='synthetic-key';env.MAIL_FROM='FireTime <test@example.test>';
 const response=await execute(env,{type:'resetRequest',email:'u1@example.test'});assert.equal(response.ok,true);assert.equal(env.DB.sqlite.prepare('SELECT status FROM outbox').get().status,'QUEUED');
 let requests=0;const original=globalThis.fetch;globalThis.fetch=async()=>{requests++;return new Response('{"id":"accepted"}',{status:200,headers:{'Content-Type':'application/json'}});};
 try{
  assert.equal((await drainOutbox(env)).processed,0);assert.equal(requests,0,'staging never sends');
  env.MIGRATION_MODE='production';env.AUTOMATION_ENABLED='true';await Promise.all([drainOutbox(env),drainOutbox(env)]);assert.equal(requests,1);assert.equal(env.DB.sqlite.prepare('SELECT status FROM outbox').get().status,'SENT');
 }finally{globalThis.fetch=original;}
});
test('failed external delivery retains reset token and schedules retry without changing password',async()=>{
 const env=testEnv(),old=record(env,'Users','u1').passwordHash;Object.assign(env,{MAIL_ENABLED:'true',MAIL_API_KEY:'synthetic-key',MAIL_FROM:'test@example.test'});
 await execute(env,{type:'resetRequest',email:'u1@example.test'});Object.assign(env,{MIGRATION_MODE:'production',AUTOMATION_ENABLED:'true'});
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('unavailable',{status:503});try{await drainOutbox(env);}finally{globalThis.fetch=original;}
 const out=env.DB.sqlite.prepare('SELECT status,attempts,available_at FROM outbox').get();assert.equal(out.status,'RETRY');assert.equal(out.attempts,1);assert.ok(out.available_at>Date.now());assert.equal(record(env,'Users','u1').passwordHash,old);
});
test('ambiguous and nonexistent local times follow native compatible DST disambiguation',()=>{
 assert.equal(new ViennaDate('2026-10-25T02:30').toISOString(),'2026-10-25T00:30:00.000Z');
 assert.equal(new ViennaDate('2026-03-29T02:30').toISOString(),'2026-03-29T01:30:00.000Z');
});

test('calendar queue preserves event order while an earlier update awaits retry',async()=>{
 const env=testEnv();Object.assign(env,{MIGRATION_MODE:'production',AUTOMATION_ENABLED:'true'});
 const payload=JSON.stringify({calendarId:'test-calendar',eventId:'test-event',data:{},planIds:[]});
 env.DB.sqlite.prepare("INSERT INTO outbox(id,kind,payload,status,available_at,created_at) VALUES(?,?,?,'RETRY',?,?)").run('calendar-first','calendar',payload,Date.now()+3600000,'2026-11-22T10:00:00.000Z');
 env.DB.sqlite.prepare("INSERT INTO outbox(id,kind,payload,created_at) VALUES(?,?,?,?)").run('calendar-second','calendar',payload,'2026-11-22T10:00:01.000Z');
 const result=await drainOutbox(env);assert.equal(result.processed,0);assert.equal(env.DB.sqlite.prepare("SELECT attempts FROM outbox WHERE id='calendar-second'").get().attempts,0);
});
