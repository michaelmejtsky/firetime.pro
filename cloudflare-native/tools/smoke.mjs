// Run the bundled Worker with real local D1/R2 bindings in workerd.
import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {testEnv} from '../tests/helpers.mjs';
const env=testEnv(),vars=Object.fromEntries(Object.entries(env).filter(([k])=>!['DB','FILES'].includes(k)));
const bundle=await build({entryPoints:[new URL('../dist/worker.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:*'],logLevel:'silent'});
const createMiniflare=options=>new Miniflare(convertV4MiniflareOptions(options));
const mf=createMiniflare({modules:[{type:'ESModule',path:'worker.js',contents:bundle.outputFiles[0].text}],compatibilityDate:'2025-11-17',compatibilityFlags:['nodejs_compat'],bindings:vars,d1Databases:['DB'],r2Buckets:['FILES']});
try{
 const db=await mf.getD1Database('DB');await db.exec(fs.readFileSync(new URL('../migrations/0001_native.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'').replace(/\n/g,' '));
 const rows=env.DB.sqlite.prepare('SELECT * FROM records').all();await db.batch(rows.map(r=>db.prepare('INSERT INTO records(table_name,record_id,ordinal,data) VALUES(?,?,?,?)').bind(r.table_name,r.record_id,r.ordinal,r.data)));
 const request=async input=>{const response=await mf.dispatchFetch('https://preview.test/api',{method:'POST',headers:{'Content-Type':'application/json','X-FireTime-Staging-Key':env.STAGING_ACCESS_KEY,'X-Request-Id':crypto.randomUUID()},body:JSON.stringify(input)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
 const login=await request({type:'login',email:'u1@example.test',password:'long-test-password',remember:true});assert.match(login.data.token,/^[a-f0-9]{64}$/);
 const home=await request({type:'api',token:login.data.token,action:'home',data:{month:'2026-11',view:'shell',reportsMode:'none'}});assert.equal(home.data.me.id,'u1');
 await request({type:'api',token:login.data.token,action:'activitySave',data:{start:'2026-11-02T08:00',end:'2026-11-02T09:00',type:'OBJECT',breakMinutes:0}});
 const pdf=Buffer.from('%PDF-1.4\n'+'synthetic '.repeat(20)).toString('base64');
 const saved=await request({type:'api',token:login.data.token,action:'pdfStore',data:{month:'2026-11',requestId:'workerd-smoke-pdf-request',base64:pdf}});
 const downloaded=await request({type:'api',token:login.data.token,action:'pdfChunk',data:{month:'2026-11',id:saved.data.id,index:0}});assert.equal(downloaded.data.base64,pdf);
 const health=await mf.dispatchFetch('https://preview.test/health');assert.equal((await health.json()).mode,'staging');
 console.log('PASS: real workerd + D1 + R2: login, shell, activity, PDF upload/download, health. No remote deployment.');
}finally{await mf.dispose();env.DB.sqlite.close();}

const firstStartKey='synthetic-first-start-key-not-for-production';
const fresh=createMiniflare({modules:[{type:'ESModule',path:'worker.js',contents:bundle.outputFiles[0].text}],compatibilityDate:'2025-11-17',compatibilityFlags:['nodejs_compat'],bindings:{...vars,FT_PEPPER:'synthetic-new-pepper-not-for-production',FIRST_START_ENABLED:'true',FIRST_START_KEY:firstStartKey},d1Databases:['DB'],r2Buckets:['FILES']});
try{
 const response=await fresh.dispatchFetch('https://fresh.test/first-start',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://fresh.test'},body:JSON.stringify({key:firstStartKey,email:'admin@example.test',password:'new-synthetic-password',confirm:'new-synthetic-password'})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
 const login=await fresh.dispatchFetch('https://fresh.test/api',{method:'POST',headers:{'Content-Type':'application/json','X-FireTime-Staging-Key':vars.STAGING_ACCESS_KEY},body:JSON.stringify({type:'login',email:'admin@example.test',password:'new-synthetic-password'})});assert.equal(login.status,200,await login.text());
 console.log('PASS: real workerd + initially empty D1: private first start, schema creation, BSB3100 and fresh system-admin login.');
}finally{await fresh.dispose();}
const driveOnly=createMiniflare({modules:[{type:'ESModule',path:'worker.js',contents:bundle.outputFiles[0].text}],compatibilityDate:'2025-11-17',compatibilityFlags:['nodejs_compat'],bindings:{...vars,FILE_STORAGE:'drive',FT_PEPPER:'synthetic-new-pepper-not-for-production',FIRST_START_ENABLED:'true',FIRST_START_KEY:firstStartKey},d1Databases:['DB']});
try{
 const initialized=await driveOnly.dispatchFetch('https://drive.test/first-start',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://drive.test'},body:JSON.stringify({key:firstStartKey,email:'admin@example.test',password:'new-synthetic-password',confirm:'new-synthetic-password'})});assert.equal(initialized.status,200,await initialized.text());
 const login=await driveOnly.dispatchFetch('https://drive.test/api',{method:'POST',headers:{'Content-Type':'application/json','X-FireTime-Staging-Key':vars.STAGING_ACCESS_KEY},body:JSON.stringify({type:'login',email:'admin@example.test',password:'new-synthetic-password'})});assert.equal(login.status,200);const result=await login.json();
 const status=await driveOnly.dispatchFetch('https://drive.test/api',{method:'POST',headers:{'Content-Type':'application/json','X-FireTime-Staging-Key':vars.STAGING_ACCESS_KEY},body:JSON.stringify({type:'api',token:result.data.token,action:'storageStatus',data:{}})});assert.equal(status.status,200);const storage=(await status.json()).data;assert.equal(storage.provider,'drive');assert.equal(storage.connected,false);assert.equal(storage.callbackUrl,'https://drive.test/drive-callback');
 console.log('PASS: real workerd + D1, no R2: fresh start, system-admin login, Drive status before Google connection.');
}finally{await driveOnly.dispose();}
