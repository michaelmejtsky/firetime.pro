import test from 'node:test';
import assert from 'node:assert/strict';
import {testEnv,d1,r2} from './helpers.mjs';
import {initializeFresh} from '../dist/first-start.mjs';
import worker,{execute} from '../dist/worker.js';
const key='synthetic-first-start-key-not-for-production';
const input={key,email:'admin@example.test',password:'a-new-synthetic-password',confirm:'a-new-synthetic-password'};
function fresh(){return {...testEnv(),DB:d1(),FILES:r2(),FT_PEPPER:'synthetic-new-pepper-not-for-production',FIRST_START_KEY:key,FIRST_START_ENABLED:'true'};}
test('fresh start builds the schema, one system admin and BSB3100 without test records or external effects',async()=>{
 const env=fresh();for(const r of env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())env.DB.sqlite.exec('DROP TABLE '+r.name);
 const result=await initializeFresh(env,input);assert.equal(result.initialized,true);
 const records=env.DB.sqlite.prepare('SELECT table_name,data FROM records').all();const users=records.filter(r=>r.table_name==='Users').map(r=>JSON.parse(r.data));assert.equal(users.length,1);assert.equal(users[0].role,'SYSADMIN');assert.equal(users[0].email,input.email);assert.notEqual(users[0].passwordHash,input.password);
 assert.equal(records.filter(r=>r.table_name==='Companies').length,1);assert.equal(records.filter(r=>['Activities','Leaves','Shifts','Sessions'].includes(r.table_name)).length,0);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM outbox').get().n,0);assert.equal(env.FILES.objects.size,0);
 const login=await execute(env,{type:'login',email:input.email,password:input.password,remember:true});assert.ok(login.data.token);const home=await execute(env,{type:'api',token:login.data.token,action:'home',data:{companyId:result.companyId,month:'2026-11',view:'shell',reportsMode:'none'}});assert.equal(home.data.company.slug,'bsb3100');assert.equal(home.data.profile.standbyHours,24);assert.equal(home.data.workflowReady,true);assert.ok(home.data.modules.includes('CALENDAR'));
 await assert.rejects(()=>initializeFresh(env,{...input,password:'another-password-here',confirm:'another-password-here'}),/bereits Daten/);
});
test('fresh start refuses disabled mode, wrong key, weak passwords and any existing records',async()=>{
 const env=fresh();await assert.rejects(()=>initializeFresh({...env,FIRST_START_ENABLED:'false'},input),/deaktiviert/);await assert.rejects(()=>initializeFresh(env,{...input,key:'wrong'}),/ungültig/);await assert.rejects(()=>initializeFresh(env,{...input,password:'short',confirm:'short'}),/14 bis 200/);await assert.rejects(()=>initializeFresh({...env,WRITE_ENABLED:'false'},input),/Schreibzugriff/);
 const existing=testEnv();await assert.rejects(()=>initializeFresh({...existing,FIRST_START_ENABLED:'true',FIRST_START_KEY:key,FT_PEPPER:env.FT_PEPPER},input),/bereits Daten/);assert.equal(existing.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='Users'").get().n,5);
});
test('concurrent first-start submissions create exactly one system admin',async()=>{
 const env=fresh();const results=await Promise.allSettled([initializeFresh(env,input),initializeFresh(env,input)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='Users'").get().n,1);
});
test('first-start HTTP route requires same-origin JSON and exposes no password or secret in responses',async()=>{
 const env=fresh(),ctx={waitUntil(){}};const page=await worker.fetch(new Request('https://fresh.test/first-start'),env,ctx);assert.equal(page.status,200);assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.ok(!(await page.text()).includes(key));
 const post=origin=>new Request('https://fresh.test/first-start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await worker.fetch(post('https://other.test'),env,ctx)).status,403);
 const ok=await worker.fetch(post('https://fresh.test'),env,ctx);assert.equal(ok.status,200);const text=await ok.text();assert.ok(!text.includes(input.password)&&!text.includes(key));assert.equal((await worker.fetch(post('https://fresh.test'),env,ctx)).status,409);
 assert.equal((await worker.fetch(new Request('https://fresh.test/first-start'),{...env,FIRST_START_ENABLED:'false'},ctx)).status,404);
});
