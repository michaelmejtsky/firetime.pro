'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const {webcrypto,createHmac,createDecipheriv}=require('node:crypto');
const root=path.join(__dirname,'..');
const workerText=fs.readFileSync(path.join(root,'cloudflare/worker.js'),'utf8');
const backend=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
const frontend=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const enc=new TextEncoder();
function runWorker(){
 const context={
  crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,Response,Request,
  AbortSignal,atob,btoa,console,Date,JSON,Promise,Error,Math,String,Number,Set,
  fetch:async()=>{throw Error('unexpected external push request')}
 };
 const code=workerText.replace('export default {','const defaultHandler = {')+
 ';({pushConfigured,pushEncrypt,pushVapid,pushDestination,pushInternal,defaultHandler,pushB64,pushB64ToBytes})';
 return vm.runInNewContext(code,context);
}
function h(key,body){return createHmac('sha256',Buffer.from(key)).update(Buffer.from(body)).digest();}
function expand(prk,info,size){return h(prk,Buffer.concat([Buffer.from(info),Buffer.from([1])])).subarray(0,size);}
test('worker VAPID auth and message payload use native WebCrypto in verified format',async()=>{
 const api=runWorker();
 const vapid=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await webcrypto.subtle.exportKey('jwk',vapid.privateKey);
 const rawPub=new Uint8Array(await webcrypto.subtle.exportKey('raw',vapid.publicKey));
 const env={VAPID_PRIVATE_JWK:JSON.stringify(jwk),VAPID_PUBLIC_KEY:Buffer.from(rawPub).toString('base64url'),
  VAPID_SUBJECT:'mailto:test@example.org',GAS_SHARED_KEY:'x'.repeat(64)};
 assert.equal(api.pushConfigured(env),true);
 const aud='https://fcm.googleapis.com';
 const token=await api.pushVapid(env,aud);
 const parts=token.split('.');
 assert.equal(parts.length,3);
 const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString());
 assert.equal(payload.aud,aud);
 assert.ok(payload.exp>Math.floor(Date.now()/1000));
 assert.equal(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},
  vapid.publicKey,Buffer.from(parts[2],'base64url'),enc.encode(parts.slice(0,2).join('.'))),true);
 const receiver=await webcrypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const receiverRaw=new Uint8Array(await webcrypto.subtle.exportKey('raw',receiver.publicKey));
 const auth=webcrypto.getRandomValues(new Uint8Array(16));
 const subscription={p256dh:Buffer.from(receiverRaw).toString('base64url'),
  auth:Buffer.from(auth).toString('base64url'),
  endpoint:'https://fcm.googleapis.com/fcm/send/fake'};
 const plain=JSON.stringify({title:'FireTime Pro',body:'Nachricht',url:'/firetime.pro/?tab=messages'});
 const encrypted=Buffer.from(await api.pushEncrypt(plain,subscription));
 assert.equal(encrypted.length>100,true);
 assert.equal(encrypted.subarray(16,20).readUInt32BE(),4096);
 assert.equal(encrypted[20],65);
 const salt=encrypted.subarray(0,16),serverPub=encrypted.subarray(21,86);
 const peer=await webcrypto.subtle.importKey('raw',serverPub,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=Buffer.from(await webcrypto.subtle.deriveBits({name:'ECDH',public:peer},receiver.privateKey,256));
 const prk=h(auth,shared);
 const ikm=expand(prk,Buffer.concat([Buffer.from('WebPush: info\0','binary'),receiverRaw,serverPub]),32);
 const keyMaterial=h(salt,ikm);
 const cek=expand(keyMaterial,Buffer.from('Content-Encoding: aes128gcm\0','binary'),16);
 const nonce=expand(keyMaterial,Buffer.from('Content-Encoding: nonce\0','binary'),12);
 const ciphertext=encrypted.subarray(86),cipher=createDecipheriv('aes-128-gcm',cek,nonce);
 cipher.setAuthTag(ciphertext.subarray(-16));
 const result=Buffer.concat([cipher.update(ciphertext.subarray(0,-16)),cipher.final()]);
 assert.equal(result.at(-1),2); // RFC 8291 delimiter
 assert.equal(result.subarray(0,-1).toString(),plain);
});
test('internal push rejects missing or invalid signed requests and arbitrary destinations',async()=>{
 const api=runWorker();
 assert.equal(api.pushDestination('http://127.0.0.1/'),null);
 assert.equal(api.pushDestination('https://example.org/'),null);
 assert.equal(api.pushDestination('https://fcm.googleapis.com/endpoint')?.hostname,'fcm.googleapis.com');
 const env={GAS_SHARED_KEY:'z'.repeat(64)};
 const payload=JSON.stringify({devices:[],notification:{title:'Test'}});
 const ts=Math.floor(Date.now()/1000),nonce='0'.repeat(32);
 const good=h(enc.encode(env.GAS_SHARED_KEY),enc.encode(ts+'.'+nonce+'.'+payload)).toString('hex');
 const request=(signature,time=ts)=>new Request('https://worker.example/internal/push',{
  method:'POST',body:JSON.stringify({ts:time,nonce,payload,signature})});
 const invalid=await api.pushInternal(request('f'.repeat(64)),env);
 assert.equal(invalid.status,403);
 const stale=await api.pushInternal(request(good,ts-900),env);
 assert.equal(stale.status,401);
 const missing=await api.pushInternal(request(good),env);
 assert.equal(missing.status,503); // VAPID missing, no accidental delivery
});
test('client UI exposes real opt-in, device status and test; worker shows incoming push',()=>{
 assert.match(frontend,/async function ftPushEnable_\(/);
 assert.match(frontend,/await navigator\.serviceWorker\.ready/);
 assert.match(frontend,/pushManager\.subscribe/);
 assert.match(frontend,/pushRegister/);
 assert.match(frontend,/pushUnregister/);
 assert.match(frontend,/pushTest/);
 assert.match(frontend,/Push aktiv/);
 assert.match(frontend,/FT_VISIBLE_VERSION='1\.8\.8'/);
 assert.match(sw,/addEventListener\('push'/);
 assert.match(sw,/registration\.showNotification/);
 assert.match(sw,/addEventListener\('notificationclick'/);
 assert.match(sw,/clients\.openWindow/);
 assert.match(backend,/const FT_PUSH_COLS_/);
 assert.match(backend,/case 'pushRegister'/);
 assert.match(backend,/case 'pushUnregister'/);
 assert.match(backend,/ft_pushNotice_/);
});
test('local key generator is implemented and never stores secrets in source',()=>{
 const generator=fs.readFileSync(path.join(root,'tools/generate-vapid.mjs'),'utf8');
 assert.match(generator,/subtle\.generateKey/);
 assert.match(generator,/VAPID_PRIVATE_JWK/);
 assert.doesNotMatch(workerText,/BEGIN PRIVATE KEY/);
});

test('push device registration stays private, validates endpoints and unregisters own device only',()=>{
 const start=backend.indexOf('const FT_PUSH_COLS_'),end=backend.indexOf('/** Nachrichten und Aufgaben:',start);
 assert.ok(start>0&&end>start,'push module must be available');
 const js=backend.slice(start,end);
 const rows=[],users=[
  {id:'u-a',companyId:'a',role:'STAFF',status:'ACTIVE'},
  {id:'u-b',companyId:'b',role:'STAFF',status:'ACTIVE'}
 ];
 let next=0,saveCount=0,deleted=[],audits=[];
 const props={FT_PUSH_WORKER_URL:'https://firetime-pro-api.firetime-pro.workers.dev',FT_GATEWAY_KEY:'a'.repeat(64)};
 const sheet={deleteRow:i=>{deleted.push(i);const idx=rows.findIndex(x=>x.__row===i);
  if(idx>=0)rows.splice(idx,1);rows.forEach((r,j)=>r.__row=j+2);}};
 const ctx={
  Date,JSON,Math,String,Number,Error,Utilities:{base64DecodeWebSafe:v=>Array.from(Buffer.from(v,'base64url'))},
  ft_absenceRows_:()=>rows,ft_absenceSheet_:()=>sheet,
  ft_absenceSave_:()=>{saveCount++},
  ft_absenceAdd_:(_name,_cols,row)=>{row.__row=rows.length+2;rows.push(row)},
  ft_now_:()=>new Date().toISOString(),ft_uuid_:()=>String(++next),
  ft_company_:(actor,c)=>{if(actor.companyId!==(c||actor.companyId))throw Error('fremde Firma');
   return {id:actor.companyId};},
  ft_str_:(v,n)=>String(v).slice(0,n),ft_prop_:name=>props[name]||'',
  ft_sha_:v=>require('node:crypto').createHash('sha256').update(v).digest('hex'),
  ft_audit_:(...a)=>audits.push(a),
  ft_hex_:bytes=>Buffer.from(bytes).toString('hex'),
  ft_one_:()=>null,
  ft_pushRows_:()=>rows
 };
 const mod=vm.runInNewContext(js+';({ft_pushRegister_,ft_pushStatus_,ft_pushUnregister_})',ctx);
 const u=users[0],other=users[1];
 const device={endpoint:'https://fcm.googleapis.com/fcm/send/abc',
  keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),
   auth:Buffer.alloc(16,2).toString('base64url')}};
 assert.equal(mod.ft_pushStatus_(u).enabled,false);
 const first=mod.ft_pushRegister_(u,{companyId:'a',subscription:device,deviceName:'iPhone'});
 assert.equal(first.deviceCount,1);
 assert.equal(mod.ft_pushStatus_(u).deviceCount,1);
 assert.equal(mod.ft_pushStatus_(other).deviceCount,0);
 assert.throws(()=>mod.ft_pushRegister_(other,{companyId:'b',subscription:device}),/anderes Konto/);
 assert.throws(()=>mod.ft_pushRegister_(u,{companyId:'a',subscription:{
  ...device,endpoint:'https://example.com/evil'}}),/unterstützt/);
 assert.equal(mod.ft_pushUnregister_(other,{deviceId:first.deviceId}).removed,false);
 assert.equal(mod.ft_pushStatus_(u).deviceCount,1);
 assert.equal(mod.ft_pushUnregister_(u,{deviceId:first.deviceId}).removed,true);
 assert.equal(mod.ft_pushStatus_(u).deviceCount,0);
 assert.ok(audits.length>=2);
});
