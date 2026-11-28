import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testEnv,call,record} from './helpers.mjs';
import {execute} from '../dist/worker.js';
import worker from '../dist/worker.js';
import {finishGmailConnect,gmailRaw} from '../dist/gmail.mjs';
import {productionSettings} from '../dist/production.mjs';
import {drainOutbox} from '../dist/effects.mjs';
const origin='https://firetime.example.test';
const envFor=()=>({...testEnv(),FT_PEPPER:'long-synthetic-pilot-pepper-32-characters',MAIL_ENABLED:'true',MAIL_PROVIDER:'gmail',GOOGLE_DRIVE_CLIENT_ID:randomUUID(),GOOGLE_DRIVE_CLIENT_SECRET:'synthetic-client',GOOGLE_DRIVE_ACCOUNT:'owner@example.test'});
function google({wrongAccount=false,uncertain=false}={}){const saved=globalThis.fetch,requests=[];globalThis.fetch=async(url,options={})=>{requests.push({url:String(url),options});const json=x=>new Response(JSON.stringify(x));if(String(url)==='https://oauth2.googleapis.com/token')return json({access_token:'access',refresh_token:'private-refresh',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/gmail.send'});if(String(url).includes('userinfo'))return json({sub:'owner-id',email:wrongAccount?'wrong@example.test':'owner@example.test',email_verified:true});if(String(url).includes('/messages/send')){if(uncertain)throw Error('lost response');return json({id:'sent-message'});}throw Error('Unexpected URL');};return {requests,restore(){globalThis.fetch=saved;}};}
async function connect(env){const start=await execute(env,call('b','gmailConnect'),' ',origin),u=new URL(start.data.url),cb=new URL('/gmail-callback?code=test&state='+u.searchParams.get('state'),origin);await finishGmailConnect(env,cb);return cb;}
test('central Gmail OAuth is system-admin-only, account checked, encrypted and single use',async()=>{
 const env=envFor(),g=google();try{await assert.rejects(()=>execute(env,call('a','gmailConnect'),'',origin),/Systemadmin/);const cb=await connect(env);await assert.rejects(()=>finishGmailConnect(env,cb),/bereits verwendet/);const row=env.DB.sqlite.prepare("SELECT * FROM integrations WHERE key='gmail'").get();assert.ok(!row.encrypted.includes('private-refresh'));const status=await execute(env,call('b','productionStatus'));assert.equal(status.data.mail.connected,true);assert.ok(!JSON.stringify(status).includes('private-refresh'));await assert.rejects(()=>execute(env,call('a','productionStatus')),/Systemadmin/);}finally{g.restore();}
});
test('Gmail refuses a different account and header injection',async()=>{
 const env=envFor(),g=google({wrongAccount:true});try{await assert.rejects(()=>connect(env),/vorgesehene/);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM integrations').get().n,0);assert.throws(()=>gmailRaw('owner@example.test',{to:'ok@example.test\r\nBcc:bad@example.test',subject:'Test',body:'Test'},'job'),/Empfänger/);}finally{g.restore();}
});
test('Gmail sends invitation MIME from the central account, without reading mail',async()=>{
 const env=envFor(),g=google();try{await connect(env);env.MIGRATION_MODE='production';env.CUTOVER_CONFIRMED='true';env.AUTOMATION_ENABLED='true';
 await execute(env,call('a','userInvite',{id:'u1'}));const hydrated=await productionSettings(env);await drainOutbox(hydrated);const sent=g.requests.find(x=>x.url.includes('/messages/send'));assert.ok(sent);const mime=Buffer.from(JSON.parse(sent.options.body).raw,'base64url').toString();assert.match(mime,/From: FireTime Pro <owner@example.test>/);assert.match(mime,/To: u1@example.test/);assert.equal(env.DB.sqlite.prepare("SELECT status FROM outbox WHERE kind='mail'").get().status,'SENT');assert.ok(!g.requests.some(x=>/\/messages\/(list|get)/.test(x.url)));}finally{g.restore();}
});
test('ambiguous Gmail send is marked ERROR without automatic resend',async()=>{
 const env=envFor(),g=google({uncertain:true});try{await connect(env);Object.assign(env,{MIGRATION_MODE:'production',CUTOVER_CONFIRMED:'true',AUTOMATION_ENABLED:'true'});await execute(env,call('a','userInvite',{id:'u1'}));const hydrated=await productionSettings(env);await drainOutbox(hydrated);await drainOutbox(hydrated);assert.equal(g.requests.filter(x=>x.url.includes('/messages/send')).length,1);assert.equal(env.DB.sqlite.prepare("SELECT status FROM outbox WHERE kind='mail'").get().status,'ERROR');}finally{g.restore();}
});
test('production push key is private, stable and safe under parallel initialization',async()=>{
 const env={...envFor(),PUSH_ENABLED:'true',VAPID_SUBJECT:'mailto:owner@example.test'};const [a,b]=await Promise.all([productionSettings(env,{createPush:true}),productionSettings(env,{createPush:true})]);assert.equal(a.VAPID_PUBLIC_KEY,b.VAPID_PUBLIC_KEY);assert.equal(JSON.parse(a.VAPID_PRIVATE_JWK).crv,'P-256');const again=await productionSettings(env);assert.equal(again.VAPID_PUBLIC_KEY,a.VAPID_PUBLIC_KEY);const row=env.DB.sqlite.prepare("SELECT * FROM integrations WHERE key='webpush'").get();assert.ok(!row.encrypted.includes(JSON.parse(a.VAPID_PRIVATE_JWK).d));
});
test('pilot provisioning waits for Gmail, creates only the requested admin and invites once',async()=>{
 const env=envFor(),g=google();try{Object.assign(env,{MIGRATION_MODE:'production',CUTOVER_CONFIRMED:'true',AUTOMATION_ENABLED:'true',PILOT_ADMIN_EMAIL:'office@bsb3100.at',PILOT_ADMIN_NAME:'BSB3100 Büro',PILOT_COMPANY_SLUG:'bsb3100'});const run=async()=>{const pending=[];await worker.scheduled({},env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);};await run();assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='Users' AND email='office@bsb3100.at'").get().n,0);await connect(env);await run();await run();const rows=env.DB.sqlite.prepare("SELECT data FROM records WHERE table_name='Users' AND email='office@bsb3100.at'").all();assert.equal(rows.length,1);const admin=JSON.parse(rows[0].data);assert.equal(admin.role,'ADMIN');assert.equal(admin.companyId,'c1');assert.equal(admin.status,'INVITED');assert.equal(admin.startDate,'2027-01-01');assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='Invites' AND user_id=?").get(admin.id).n,1);assert.equal(g.requests.filter(x=>x.url.includes('/messages/send')).length,1);}finally{g.restore();}
});

test('Gmail does not resend after provider confirmation followed by a database failure',async()=>{
 const env=envFor(),g=google();try{await connect(env);Object.assign(env,{MIGRATION_MODE:'production',CUTOVER_CONFIRMED:'true',AUTOMATION_ENABLED:'true'});await execute(env,call('a','userInvite',{id:'u1'}));const hydrated=await productionSettings(env),batch=env.DB.batch.bind(env.DB);let fail=true;env.DB.batch=async statements=>{if(fail&&statements.some(s=>s.sql.includes("UPDATE outbox SET status='SENT'"))){fail=false;throw Error('Lost database response');}return batch(statements);};await drainOutbox(hydrated);await drainOutbox(hydrated);assert.equal(g.requests.filter(x=>x.url.includes('/messages/send')).length,1);assert.equal(env.DB.sqlite.prepare("SELECT status FROM outbox WHERE kind='mail'").get().status,'ERROR');}finally{g.restore();}
});
