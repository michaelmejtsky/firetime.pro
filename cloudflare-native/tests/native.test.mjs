import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testEnv,seed,record,call} from './helpers.mjs';
import worker,{execute} from '../dist/worker.js';
import {createCore} from '../dist/core.mjs';
import {Runtime,digest} from '../dist/runtime.mjs';
import {loadSnapshot,commit,Conflict} from '../dist/store.mjs';
import {ViennaDate,formatDate} from '../dist/time.mjs';
import contract from '../src/contract.json' with {type:'json'};

test('all 83 existing actions and all 37 tables are included',()=>{assert.equal(contract.actions.length,83);assert.equal(contract.tables.length,37);for(const name of ['TimeBalanceStarts','TimerPauseEvents','LeaveFlexApprovals','PdfArchive','CommReads'])assert.ok(contract.tables.includes(name));});
test('passwords match the original 1500-round SHA256 algorithm, including unicode',()=>{
 const env=testEnv(),core=createCore(new Runtime({env}));for(const password of ['long-test-password','Grüße 🐻 €']){let v='salt|'+password+'|'+env.FT_PEPPER;for(let i=0;i<1500;i++)v=createHash('sha256').update(v+'salt').digest('hex');assert.equal(core.ft_password_(password,'salt'),v);}
});
test('fresh login, remembered session and shell work without any Google service',async()=>{
 const env=testEnv(),login=await execute(env,{type:'login',email:'U1@example.test',password:'long-test-password',remember:true});
 assert.match(login.data.token,/^[a-f0-9]{64}$/);assert.ok(Date.parse(login.data.expiresAt)>Date.now()+29*86400000);
 const result=await execute(env,{type:'api',token:login.data.token,action:'home',data:{view:'shell',reportsMode:'none',month:'2026-11'}});
 assert.equal(result.data.me.id,'u1');assert.equal(result.data.company.id,'c1');assert.ok(!JSON.stringify(result).includes('passwordHash'));
 await execute(env,{type:'logout',token:login.data.token});await assert.rejects(()=>execute(env,{type:'api',token:login.data.token,action:'home',data:{}}),/Sitzung/);
});
test('failed login rate limit is durable and cannot create sessions',async()=>{
 const env=testEnv();for(let i=0;i<7;i++)await assert.rejects(()=>execute(env,{type:'login',email:'u1@example.test',password:'wrong'}),/Passwort ungültig/);
 await assert.rejects(()=>execute(env,{type:'login',email:'u1@example.test',password:'long-test-password'}),/Zu viele Fehlversuche/);
 assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='Sessions'").get().n,5);
});
test('tenant boundaries and employee ownership hold for reads and writes',async()=>{
 const env=testEnv();await assert.rejects(()=>execute(env,call('1','profileGet',{companyId:'c2'})),/Kein Zugriff/);
 await assert.rejects(()=>execute(env,call('1','userUpdate',{id:'x1',name:'bad'})),/Berechtigung|gefunden|Zugriff/);
 await assert.rejects(()=>execute(env,call('a','licenseSave',{companyId:'c1',modules:['SICK']})),/Berechtigung/);
 const home=await execute(env,call('1','home',{month:'2026-11',view:'all',reportsMode:'none'}));assert.ok(home.data.users.every(x=>x.id==='u1'));assert.ok(!JSON.stringify(home).includes('Andere Firma'));
});
test('activity save is atomic with audit and idempotent on repeated request id',async()=>{
 const env=testEnv(),input=call('1','activitySave',{type:'OBJECT',start:'2026-11-02T08:00',end:'2026-11-02T09:00',breakMinutes:0,object:'Test',description:'Kontrolle'});
 const id='synthetic-request-001';const a=await execute(env,input,id),b=await execute(env,input,id);assert.deepEqual(a,b);
 const activities=env.DB.sqlite.prepare("SELECT data FROM records WHERE table_name='Activities'").all();assert.equal(activities.length,1);assert.equal(JSON.parse(activities[0].data).start,'2026-11-02T07:00:00.000Z');
 assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='Audit' AND json_extract(data,'$.entity')='Activities'").get().n,1);
 await assert.rejects(()=>execute(env,{...input,data:{...input.data,object:'changed'}},id),/Anfragekennung/);
});
test('optimistic revision guard rolls back a stale multi-table mutation',async()=>{
 const env=testEnv(),a=await loadSnapshot(env,call('1','home')),b=await loadSnapshot(env,call('1','home'));
 const ar=new Runtime(a),br=new Runtime(b);ar.tables.get('Users').rows.find(x=>x.id==='u1').leaveBalance=15;br.tables.get('Users').rows.find(x=>x.id==='u1').leaveBalance=10;
 await commit(env,a,ar);await assert.rejects(()=>commit(env,b,br),Conflict);assert.equal(record(env,'Users','u1').leaveBalance,15);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM commit_guards').get().n,0);
});
test('approved leave cancellation retains credit until approved, then restores exactly once',async()=>{
 const env=testEnv();seed(env,'Leaves',{id:'l1',companyId:'c1',userId:'u1',from:'2026-11-02',to:'2026-11-06',days:5,creditHours:5,status:'APPROVED'});
 await execute(env,call('1','leaveWithdraw',{id:'l1'}),'leave-withdraw-001');assert.equal(record(env,'Leaves','l1').status,'CANCEL_PENDING');assert.equal(record(env,'Users','u1').leaveBalance,20);assert.equal(record(env,'Leaves','l1').creditHours,5);
 await execute(env,call('a','leaveReview',{id:'l1',status:'CANCELLED'}),'leave-review-001');assert.equal(record(env,'Users','u1').leaveBalance,25);assert.equal(record(env,'Leaves','l1').creditHours,0);
 await assert.rejects(()=>execute(env,call('a','leaveReview',{id:'l1',status:'CANCELLED'}),'leave-review-002'));assert.equal(record(env,'Users','u1').leaveBalance,25);
});
test('approved monthly snapshots are returned unchanged and block new edits',async()=>{
 const env=testEnv(),snapshot={month:'2026-11',target:25,worked:27,saldo:2,runningBalance:19,standby:24};
 seed(env,'Months',{id:'m1',companyId:'c1',userId:'u1',month:'2026-11',status:'APPROVED',snapshot:JSON.stringify(snapshot),snapshotHash:digest(JSON.stringify(snapshot)),reviewedAt:'2026-11-21T10:00:00.000Z'});
 const report=await execute(env,call('1','report',{month:'2026-11'}));assert.equal(report.data.report.worked,27);assert.equal(report.data.report.runningBalance,19);
 await assert.rejects(()=>execute(env,call('1','activitySave',{start:'2026-11-02T08:00',end:'2026-11-02T09:00'}),'closed-month-edit-01'),/eingereicht|freigegeben/);assert.equal(record(env,'Months','m1').snapshot,JSON.stringify(snapshot));
});
test('Europe/Vienna local inputs, month boundaries, and DST produce real 23/25h intervals',()=>{
 const d=new ViennaDate('2026-11-02T08:00');assert.equal(d.toISOString(),'2026-11-02T07:00:00.000Z');assert.equal(d.getHours(),8);
 assert.equal((new ViennaDate(2026,2,29,7)-new ViennaDate(2026,2,28,7))/3600000,23);
 assert.equal((new ViennaDate(2026,9,25,7)-new ViennaDate(2026,9,24,7))/3600000,25);
 const last=new ViennaDate(2026,11,0,12);assert.equal(formatDate(last,'Europe/Vienna','yyyy-MM-dd'),'2026-11-30');
 const next=new ViennaDate('2026-03-28T07:00');next.setDate(next.getDate()+1);assert.equal(next.toISOString(),'2026-03-29T05:00:00.000Z');
});
test('private PDF attachments remain scoped to participants and return byte-identical content',async()=>{
 const env=testEnv(),bytes=Buffer.from('%PDF-1.4\n'+('synthetic '.repeat(20))),id='private-file';await env.FILES.put(id,bytes);env.DB.sqlite.prepare('INSERT INTO objects VALUES(?,?,?,?,?,0)').run(id,'Beleg.pdf','application/pdf',bytes.length,digest(bytes));
 seed(env,'CommThreads',{id:'t1',companyId:'c1',kind:'MESSAGE',titleEncoded:Buffer.from('Test').toString('base64url'),bodyEncoded:Buffer.from('Privat').toString('base64url'),createdBy:'u1',recipientId:'u2',attachmentId:id,status:'OPEN',createdAt:'2026-11-01T12:00:00.000Z',updatedAt:'2026-11-01T12:00:00.000Z'});
 const result=await execute(env,call('1','commPhoto',{threadId:'t1',attachmentId:id}));assert.equal(result.data.data,bytes.toString('base64'));
 await assert.rejects(()=>execute(env,call('a','commPhoto',{threadId:'t1',attachmentId:id})),/Berechtigung/);await assert.rejects(()=>execute(env,call('c','commPhoto',{threadId:'t1',attachmentId:id})),/Berechtigung/);
});
test('PDF archive upload retries do not create duplicate files or versions',async()=>{
 const env=testEnv(),pdf=Buffer.from('%PDF-1.4\n'+'x'.repeat(150)).toString('base64'),p={month:'2026-11',requestId:'synthetic-pdf-request-0001',base64:pdf};
 const a=await execute(env,call('1','pdfStore',p),'pdf-store-request-001');const b=await execute(env,call('1','pdfStore',p),'pdf-store-request-002');assert.equal(a.data.id,b.data.id);assert.equal(env.FILES.objects.size,1);
 const chunk=await execute(env,call('1','pdfChunk',{month:'2026-11',id:a.data.id,index:0}));assert.equal(chunk.data.base64,pdf);
});
test('preview gate, CORS and read-only mode fail closed',async()=>{
 const env=testEnv(),ctx={waitUntil:()=>{}};
 const blocked=await worker.fetch(new Request('https://preview.test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"type":"brand"}'}),env,ctx);assert.equal(blocked.status,403);
 const cors=await worker.fetch(new Request('https://preview.test/api',{method:'OPTIONS',headers:{Origin:'https://untrusted.example'}}),env,ctx);assert.equal(cors.status,403);
 env.WRITE_ENABLED='false';await assert.rejects(()=>execute(env,{type:'login',email:'u1@example.test',password:'long-test-password'}),/schreibgeschützt/);
 const brand=await execute(env,{type:'brand',slug:'bsb3100'});assert.equal(brand.data.name,'BSB3100 Test');
});
test('new server PDF generation does not require Google Docs or Drive',async()=>{
 const env=testEnv();const result=await execute(env,call('1','absencePdfCreate',{fromYear:2026,toYear:2026,requestId:'absence-test-request-0001'}),'absence-pdf-request-001');assert.ok(result.data.id);
 const chunk=await execute(env,call('1','absencePdfChunk',{id:result.data.id,index:0}));const bytes=Buffer.from(chunk.data.base64,'base64');assert.ok(bytes.subarray(0,8).toString().startsWith('%PDF-1.4'));assert.ok(bytes.toString('latin1').includes('xref'));
});

test('timer automatic close preserves actual pauses and closes at Vienna 19:00',async()=>{
 const env=testEnv();seed(env,'ActivityTimers',{id:'timer-old',companyId:'c1',userId:'u1',type:'OBJECT',start:'2026-11-02T08:00:00.000Z',object:'Kontrolle',createdAt:'2026-11-02T08:00:00.000Z'});
 seed(env,'TimerPauseEvents',{id:'pause-old',companyId:'c1',userId:'u1',timerId:'timer-old',start:'2026-11-02T11:00:00.000Z',end:'2026-11-02T11:30:00.000Z'});
 const snapshot=await loadSnapshot(env,{},{system:true}),runtime=new Runtime(snapshot);
 const fixed=Date.parse('2026-11-02T18:05:00.000Z');runtime.globals.Date=class extends ViennaDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
 const core=createCore(runtime);core.ft_timerTick_();await commit(env,snapshot,runtime);
 assert.equal(record(env,'ActivityTimers','timer-old'),null);
 const acts=env.DB.sqlite.prepare("SELECT data FROM records WHERE table_name='Activities'").all().map(r=>JSON.parse(r.data));assert.equal(acts.length,1);assert.equal(acts[0].end,'2026-11-02T18:00:00.000Z');assert.equal(acts[0].breakMinutes,30);
});
test('background monthly PDF job completes and stores a readable R2-backed archive',async()=>{
 const env=testEnv();await execute(env,call('1','pdfPrepare',{month:'2026-11',refresh:true}),'background-pdf-prepare-001');
 const snapshot=await loadSnapshot(env,{},{system:true}),runtime=new Runtime(snapshot),core=createCore(runtime);core.ft_pdfWorker_();await commit(env,snapshot,runtime);
 const jobs=env.DB.sqlite.prepare("SELECT data FROM records WHERE table_name='PdfJobs'").all().map(x=>JSON.parse(x.data));assert.equal(jobs[0].status,'READY',jobs[0].error);
 const archive=await execute(env,call('1','pdfArchive',{month:'2026-11'}));assert.equal(archive.data.length,1);const chunk=await execute(env,call('1','pdfChunk',{month:'2026-11',id:archive.data[0].id,index:0}));assert.match(Buffer.from(chunk.data.base64,'base64').toString('latin1'),/^%PDF-1.4/);
});
