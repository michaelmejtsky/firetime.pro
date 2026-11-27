import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testEnv,call} from './helpers.mjs';
import worker,{execute} from '../dist/worker.js';
import {finishGmailConnect} from '../dist/gmail.mjs';
import {drainOutbox} from '../dist/effects.mjs';
import {productionSettings} from '../dist/production.mjs';

function setup(mode='ok'){
 const env={...testEnv(),FT_PEPPER:'synthetic-mail-pepper-at-least-32-characters',MAIL_ENABLED:'true',MAIL_PROVIDER:'gmail',GOOGLE_DRIVE_CLIENT_ID:randomUUID(),GOOGLE_DRIVE_CLIENT_SECRET:'synthetic-secret',GOOGLE_DRIVE_ACCOUNT:'owner@example.test'};
 const original=globalThis.fetch;let sends=0,refreshes=0;
 globalThis.fetch=async(url,options={})=>{
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
  if(String(url).includes('/token')){const auth=options.body.get('grant_type')==='authorization_code';if(!auth)refreshes++;return json({access_token:'access-'+refreshes,refresh_token:'synthetic-refresh',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/gmail.send'});}
  if(String(url).includes('userinfo'))return json({sub:'owner',email:'owner@example.test',email_verified:true});
  if(String(url).includes('/messages/send')){
   sends++;
   assert.ok(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='Invites'").get().n>0,'Invitation must be committed before provider delivery');
   if(mode==='uncertain')throw Error('lost network response');
   if(mode==='disabled')return json({error:{errors:[{reason:'accessNotConfigured'}]}},403);
   if(mode==='expired'&&sends===1)return json({error:{errors:[{reason:'authError'}]}},401);
   return json({id:'gmail-confirmation'});
  }
  throw Error('Unexpected URL');
 };
 const connect=async()=>{const started=await execute(env,call('b','gmailConnect'),'', 'https://mail.test');await finishGmailConnect(env,new URL('https://mail.test/gmail-callback?code=test&state='+new URL(started.data.url).searchParams.get('state')));};
 const request=async()=>{const pending=[];const r=await worker.fetch(new Request('https://mail.test/api',{method:'POST',headers:{'Content-Type':'application/json','X-Request-Id':randomUUID()},body:JSON.stringify(call('a','userInvite',{id:'u1'}))}),env,{waitUntil:p=>pending.push(p)});const data=await r.json();return {response:r,data,pending};};
 return {env,connect,request,get sends(){return sends;},get refreshes(){return refreshes;},close(){globalThis.fetch=original;env.DB.sqlite.close();}};
}
test('invitation HTTP response confirms actual Gmail acceptance without relying on the cron',async()=>{
 const s=setup();try{await s.connect();Object.assign(s.env,{MIGRATION_MODE:'production',CUTOVER_CONFIRMED:'true',AUTOMATION_ENABLED:'false'});
  const r=await s.request();assert.equal(r.response.status,200);assert.equal(r.data.data.status,'SENT');assert.equal(r.data.data.confirmed,true);assert.equal(s.sends,1);
  assert.match(r.data.data.message,/Gmail hat/);assert.ok(!JSON.stringify(r.data).includes('invite='));
 }finally{s.close();}
});
test('Gmail rejection is returned as an unconfirmed invitation with the actionable Google error',async()=>{
 const s=setup('disabled');try{await s.connect();Object.assign(s.env,{MIGRATION_MODE:'production',CUTOVER_CONFIRMED:'true'});
  const r=await s.request();assert.equal(r.data.data.confirmed,false);assert.equal(r.data.data.status,'RETRY');assert.match(r.data.data.error,/Gmail API.*aktivieren/);
  const status=await execute(s.env,call('a','invitationStatus',{id:'u1'}));assert.equal(status.data.status,'RETRY');assert.ok(!JSON.stringify(status).includes('invite='));
  await assert.rejects(()=>execute(s.env,call('1','invitationStatus',{id:'u1'})),/Administratoren/);
  await assert.rejects(()=>execute(s.env,call('a','invitationStatus',{id:'x1'})),/Zugriff/);
 }finally{s.close();}
});
test('a Gmail 401 refreshes its rejected cached access token once and succeeds safely',async()=>{
 const s=setup('expired');try{await s.connect();Object.assign(s.env,{MIGRATION_MODE:'production',CUTOVER_CONFIRMED:'true'});
  const r=await s.request();assert.equal(r.data.data.status,'SENT');assert.equal(s.sends,2);assert.equal(s.refreshes,2);
 }finally{s.close();}
});
test('uncertain Gmail delivery never becomes a successful UI response or an automatic duplicate send',async()=>{
 const s=setup('uncertain');try{await s.connect();Object.assign(s.env,{MIGRATION_MODE:'production',CUTOVER_CONFIRMED:'true'});
  const r=await s.request();assert.equal(r.data.data.status,'ERROR');assert.equal(r.data.data.confirmed,false);assert.match(r.data.data.message,/unklar/);
  await s.connect();await drainOutbox(await productionSettings(s.env));assert.equal(s.sends,1);
 }finally{s.close();}
});
test('a targeted explicit invitation is not delayed behind unrelated queued mail',async()=>{
 const s=setup();try{await s.connect();Object.assign(s.env,{MIGRATION_MODE:'production',CUTOVER_CONFIRMED:'true'});
  const old=await execute(s.env,call('a','userInvite',{id:'u2'})),current=await execute(s.env,call('a','userInvite',{id:'u1'}));
  await drainOutbox(await productionSettings(s.env),{jobIds:[current.data.jobId]});
  const status=id=>s.env.DB.sqlite.prepare('SELECT status FROM outbox WHERE id=?').get(id).status;
  assert.equal(status(current.data.jobId),'SENT');assert.equal(status(old.data.jobId),'QUEUED');assert.equal(s.sends,1);
 }finally{s.close();}
});
test('explicit Gmail reconnection retries only recent invitations definitely not sent',async()=>{
 const s=setup();try{await s.connect();const base={message:{to:'u1@example.test',subject:'Dein Zugang zu FireTime Pro',body:'synthetic'},gmailAttempted:false};
  for(const [id,attempted,age,subject] of [['recent',false,0,'Dein Zugang zu FireTime Pro'],['uncertain',true,0,'Dein Zugang zu FireTime Pro'],['expired',false,8,'Dein Zugang zu FireTime Pro'],['reset',false,0,'Passwort zurücksetzen']])s.env.DB.sqlite.prepare("INSERT INTO outbox(id,kind,payload,status,attempts,created_at) VALUES(?,'mail',?,'ERROR',8,?)").run(id,JSON.stringify({...base,gmailAttempted:attempted,message:{...base.message,subject}}),new Date(Date.now()-age*86400000).toISOString());
  await s.connect();const statuses=Object.fromEntries(s.env.DB.sqlite.prepare('SELECT id,status FROM outbox').all().map(r=>[r.id,r.status]));
  assert.equal(statuses.recent,'QUEUED');for(const id of ['uncertain','expired','reset'])assert.equal(statuses[id],'ERROR');
 }finally{s.close();}
});
