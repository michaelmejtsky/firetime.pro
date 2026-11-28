import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {testEnv,d1,call,record,seed} from './helpers.mjs';
import {DriveFiles,sealDrive,startDriveConnect,finishDriveConnect} from '../dist/drive.mjs';
import worker,{execute} from '../dist/worker.js';
import {initializeFresh} from '../dist/first-start.mjs';
import {loadSnapshot,commit,Conflict} from '../dist/store.mjs';
import {Runtime,digest} from '../dist/runtime.mjs';
const md5=b=>createHash('md5').update(b).digest('hex');
const sha=b=>createHash('sha256').update(b).digest('hex');
function envDrive(){return {...testEnv(),FILES:undefined,FILE_STORAGE:'drive',FT_PEPPER:'synthetic-long-lasting-pepper-for-tests',GOOGLE_DRIVE_CLIENT_ID:'client_'+randomUUID(),GOOGLE_DRIVE_CLIENT_SECRET:'synthetic-client-secret',GOOGLE_DRIVE_ACCOUNT:'owner@example.test'};}
async function connected(env){const pub={email:env.GOOGLE_DRIVE_ACCOUNT,ownerId:'owner_permission',folderId:'folder_private',clientId:env.GOOGLE_DRIVE_CLIENT_ID};const refreshToken='synthetic-refresh-'+randomUUID();env.DB.sqlite.prepare('INSERT INTO integrations VALUES(?,?,?,?)').run('drive',await sealDrive(env,{refreshToken}),JSON.stringify(pub),'2026-11-23T18:00:00Z');return refreshToken;}
function mockGoogle(env,{email=env.GOOGLE_DRIVE_ACCOUNT,failUpload=false,folder=true}={}){
 const files=new Map(),requests=[];let count=0;
 if(folder)files.set('folder_private',{id:'folder_private',name:'Private',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true},trashed:false});
 const original=globalThis.fetch;globalThis.fetch=async(url,options={})=>{
  const u=new URL(url),method=options.method||'GET';requests.push({path:u.pathname,query:u.search,method});const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
  if(u.href==='https://oauth2.googleapis.com/token'){const grant=options.body.get('grant_type');return json({access_token:'access_'+env.GOOGLE_DRIVE_CLIENT_ID,expires_in:3600,...(grant==='authorization_code'?{refresh_token:'new-refresh-token',scope:'https://www.googleapis.com/auth/drive.file'}:{})});}
  if(u.pathname==='/drive/v3/about')return json({user:{emailAddress:email,permissionId:'owner_permission'}});
  if(u.pathname==='/drive/v3/files/generateIds')return json({ids:['drive_file_'+randomUUID()]});
  if(u.pathname==='/drive/v3/files'&&method==='POST'){const m=JSON.parse(options.body),id='folder_created_'+(++count);files.set(id,{...m,id,capabilities:{canAddChildren:true},trashed:false});return json({id});}
  if(u.pathname==='/upload/drive/v3/files'){
   if(failUpload)return json({},503);
   const bytes=Buffer.from(await options.body.arrayBuffer()),boundary=options.headers['Content-Type'].split('boundary=')[1],metaStart=bytes.indexOf('\r\n\r\n')+4,next=bytes.indexOf('\r\n--'+boundary+'\r\n',metaStart),meta=JSON.parse(bytes.subarray(metaStart,next).toString()),dataStart=bytes.indexOf('\r\n\r\n',next+4)+4,dataEnd=bytes.lastIndexOf('\r\n--'+boundary+'--\r\n'),data=bytes.subarray(dataStart,dataEnd);
   if(files.has(meta.id))return json({},409);files.set(meta.id,{...meta,bytes:data,size:String(data.length),md5Checksum:md5(data),trashed:false});return json({id:meta.id});
  }
  if(u.pathname.startsWith('/drive/v3/files/')){
   const id=decodeURIComponent(u.pathname.slice('/drive/v3/files/'.length)),file=files.get(id);if(!file)return json({},404);
   if(method==='PATCH'){Object.assign(file,JSON.parse(options.body));return json({id});}
   if(u.searchParams.get('alt')==='media'){if(file.trashed)return json({},404);return new Response(file.bytes);}
   const {bytes,...meta}=file;return json(meta);
  }
  throw Error('Unexpected mocked Google route: '+u.pathname);
 };
 return {files,requests,restore(){globalThis.fetch=original;}};
}
test('Drive stores a PDF privately, returns identical bytes and deduplicates concurrent retries',async()=>{
 const env=envDrive(),refresh=await connected(env),mock=mockGoogle(env),storage=new DriveFiles(env),bytes=Buffer.from('%PDF-1.4\nGrüße '+randomUUID());
 try{await Promise.all([storage.put('native_pdf',bytes,{httpMetadata:{contentType:'application/pdf'},customMetadata:{filename:encodeURIComponent('Stundenübersicht.pdf')}}),storage.put('native_pdf',bytes,{httpMetadata:{contentType:'application/pdf'}})]);
  const dataFiles=[...mock.files.values()].filter(f=>f.bytes);assert.equal(dataFiles.length,1);assert.deepEqual(dataFiles[0].parents,['folder_private']);assert.equal(dataFiles[0].name,'Stundenübersicht.pdf');assert.equal(dataFiles[0].permissions,undefined);
  const got=await storage.get('native_pdf');assert.deepEqual(Buffer.from(await got.arrayBuffer()),bytes);await assert.rejects(()=>storage.put('native_pdf',Buffer.from('different')),/überschrieben/);
  const credentials=env.DB.sqlite.prepare("SELECT encrypted FROM integrations WHERE key='drive'").get().encrypted;assert.ok(!credentials.includes(refresh)&&!credentials.includes('synthetic-client-secret'));
 }finally{mock.restore();}
});
test('Drive protects task photo access across users and tenants before downloading file bytes',async()=>{
 const env=envDrive();await connected(env);const mock=mockGoogle(env),photo={mime:'image/png',name:'test.png',data:Buffer.from([137,80,78,71,13,10,26,10,...Array(40).fill(0)]).toString('base64')};
 try{const created=await execute(env,call('a','tasksCreate',{companyId:'c1',recipientIds:['u1'],title:'Foto prüfen',body:'Nur Teilnehmer',photo}));const t=created.data.threads[0],before=mock.requests.length;
  await assert.rejects(()=>execute(env,call('c','commPhoto',{threadId:t.id,attachmentId:t.attachmentId})),/Berechtigung|gefunden/);assert.equal(mock.requests.length,before);
  const got=await execute(env,call('1','commPhoto',{threadId:t.id,attachmentId:t.attachmentId}));assert.equal(got.data.data,photo.data);
 }finally{mock.restore();}
});
test('Drive-backed PDF archive preserves files and report metadata without R2',async()=>{
 const env=envDrive();await connected(env);const mock=mockGoogle(env),pdf=Buffer.from('%PDF-1.4\n'+'synthetic PDF '.repeat(20)).toString('base64');
 try{const saved=await execute(env,call('1','pdfStore',{month:'2026-11',requestId:'drive-pdf-store-request',base64:pdf}));const chunk=await execute(env,call('1','pdfChunk',{month:'2026-11',id:saved.data.id,index:0}));assert.equal(chunk.data.base64,pdf);assert.equal([...mock.files.values()].filter(f=>f.bytes).length,1);}
 finally{mock.restore();}
});
test('failed Drive upload cannot commit tasks, and tampered file contents are rejected',async()=>{
 const env=envDrive();await connected(env);let mock=mockGoogle(env,{failUpload:true});
 try{await assert.rejects(()=>execute(env,call('a','tasksCreate',{companyId:'c1',recipientIds:['u1'],title:'Foto prüfen',body:'Nicht speichern',photo:{mime:'image/png',name:'x.png',data:Buffer.from([137,80,78,71,13,10,26,10,...Array(32).fill(0)]).toString('base64')}})),/Drive gespeichert/);assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='CommThreads'").get().n,0);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM objects').get().n,0);}finally{mock.restore();}
 mock=mockGoogle(env);try{const store=new DriveFiles(env),bytes=Buffer.from('original');await store.put('tamper_test',bytes);const file=[...mock.files.values()].find(f=>f.bytes);file.bytes=Buffer.from('modified');await assert.rejects(()=>store.get('tamper_test'),/prüfsumme/);}finally{mock.restore();}
});
test('Drive rollback moves only uncommitted uploads into trash, while lost D1 responses preserve committed files',async()=>{
 const env=envDrive();await connected(env);const mock=mockGoogle(env);
 const upload=async()=>{const snap=await loadSnapshot(env,call('1','home')),rt=new Runtime(snap);rt.globals.DriveApp.getFolderById('native').createFile(rt.globals.Utilities.newBlob('synthetic bytes','application/pdf','test.pdf'));return {snap,rt};};
 try{let {snap,rt}=await upload();env.DB.sqlite.prepare("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();await assert.rejects(()=>commit(env,snap,rt),Conflict);assert.equal([...mock.files.values()].filter(f=>f.bytes&&f.trashed).length,1);
  ({snap,rt}=await upload());const batch=env.DB.batch;let once=true;env.DB.batch=async statements=>{const result=await batch(statements);if(once){once=false;throw Error('lost D1 response');}return result;};await assert.rejects(()=>commit(env,snap,rt),/lost D1/);env.DB.batch=batch;
  const live=[...mock.files.values()].filter(f=>f.bytes&&!f.trashed);assert.equal(live.length,1);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM objects WHERE trashed=0').get().n,1);
 }finally{mock.restore();}
});
test('Drive OAuth is system-admin only, validates account and session, seals credentials and consumes state once',async()=>{
 const env=envDrive(),mock=mockGoogle(env,{folder:false});
 try{for(const who of ['a','1'])await assert.rejects(()=>execute(env,call(who,'driveConnect'),'', 'https://app.example.test'),/Systemadmin/);assert.equal(mock.requests.length,0);
  const started=await execute(env,call('b','driveConnect'),'', 'https://app.example.test'),authorization=new URL(started.data.url);assert.equal(authorization.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file');assert.equal(authorization.searchParams.get('access_type'),'offline');
  const callback=new URL('https://app.example.test/drive-callback');callback.searchParams.set('state',authorization.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');await finishDriveConnect(env,callback);
  const status=await execute(env,call('b','storageStatus'),'', 'https://app.example.test');assert.equal(status.data.connected,true);assert.equal(status.data.email,'owner@example.test');assert.ok(status.data.folderUrl.includes('folder_created_'));assert.ok(!JSON.stringify(status).includes('new-refresh-token'));
  await assert.rejects(()=>finishDriveConnect(env,callback),/abgelaufen|verwendet/);
 }finally{mock.restore();}
});
test('Drive OAuth rejects another Google account, unknown state and a revoked system-admin session',async()=>{
 const env=envDrive(),mock=mockGoogle(env,{email:'someone-else@example.test'});
 try{await assert.rejects(()=>finishDriveConnect(env,new URL('https://app.example.test/drive-callback?state='+'0'.repeat(64)+'&code=x')),/abgelaufen|verwendet/);
  const create=async()=>{const started=await startDriveConnect(env,{id:'s1'},digest('b'.repeat(64)),'https://app.example.test');return new URL('https://app.example.test/drive-callback?state='+new URL(started.url).searchParams.get('state')+'&code=synthetic-code');};
  await assert.rejects(async()=>finishDriveConnect(env,await create()),/vorgesehene Google-Konto/);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM integrations').get().n,0);assert.equal([...mock.files.values()].filter(f=>f.mimeType==='application/vnd.google-apps.folder').length,1);
  const callback=await create(),before=mock.requests.length;env.DB.sqlite.prepare("DELETE FROM records WHERE table_name='Sessions' AND record_id=?").run(digest('b'.repeat(64)));await assert.rejects(()=>finishDriveConnect(env,callback),/Sitzung/);assert.equal(mock.requests.length,before);
 }finally{mock.restore();}
});
test('fresh initialization, login and time records work without any Drive request or R2 binding',async()=>{
 const env=envDrive();env.DB=d1();env.FIRST_START_ENABLED='true';env.FIRST_START_KEY='synthetic-first-start-key-at-least-32-characters';let requests=0;const original=globalThis.fetch;globalThis.fetch=async()=>{requests++;throw Error('No Google request expected');};
 try{await initializeFresh(env,{key:env.FIRST_START_KEY,email:'admin@example.test',password:'new-synthetic-password',confirm:'new-synthetic-password'});await execute(env,{type:'login',email:'admin@example.test',password:'new-synthetic-password'});assert.equal(requests,0);}
 finally{globalThis.fetch=original;}
 const seeded=envDrive(),before=record(seeded,'Users','u1');const mock=mockGoogle(seeded);
 try{await execute(seeded,call('1','activitySave',{type:'OTHER',start:'2026-11-02T08:00',end:'2026-11-02T09:00',breakMinutes:0}));assert.equal(mock.requests.length,0);assert.equal(record(seeded,'Users','u1').email,before.email);seeded.DB.sqlite.prepare("UPDATE records SET data=json_set(data,'$.logoId','optional_logo') WHERE table_name='Companies' AND record_id='c1'").run();seeded.DB.sqlite.prepare('INSERT INTO objects VALUES(?,?,?,?,?,0)').run('optional_logo','logo.png','image/png',10,sha('1234567890'));const home=await execute(seeded,call('1','home',{companyId:'c1',month:'2026-11',view:'dashboard',reportsMode:'self'}));assert.equal(home.data.logo,'');assert.equal(mock.requests.length,0);}finally{mock.restore();}
});

test('Drive outage during a background PDF cannot roll back automatic time recording',async()=>{
 const env=envDrive();await execute(env,call('1','pdfPrepare',{month:'2026-11',refresh:true}));
 seed(env,'ActivityTimers',{id:'timer-before-drive-outage',companyId:'c1',userId:'u1',type:'OTHER',start:'2026-11-02T08:00:00Z',createdAt:'2026-11-02T08:00:00Z'});
 Object.assign(env,{MIGRATION_MODE:'production',AUTOMATION_ENABLED:'true',CUTOVER_CONFIRMED:'true'});
 let pending;worker.scheduled({},env,{waitUntil(p){pending=p;}});await pending;
 assert.equal(record(env,'ActivityTimers','timer-before-drive-outage'),null);assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='Activities'").get().n,1);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM objects').get().n,0);
});
