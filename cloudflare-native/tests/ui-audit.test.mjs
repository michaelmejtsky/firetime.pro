import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {webcrypto,randomUUID} from 'node:crypto';
import {testEnv,seed,record} from './helpers.mjs';
import {execute} from '../dist/worker.js';

// Execute the shipped HTML and event handlers against an isolated real backend.
// No network, user account, Google service or real recipient is involved.
async function ui(role='1',{storedInstalled=false}={}){
 const env=testEnv();env.CALENDAR_AUTH='oauth';
 for(const [id,status] of [['open','OPEN'],['accepted','ACCEPTED'],['done','DONE'],['returned','RETURNED'],['closed','CLOSED']])seed(env,'CommThreads',{id,companyId:'c1',kind:'TASK',createdBy:'a1',recipientId:'u1',titleEncoded:Buffer.from('Prüfauftrag '+status).toString('base64url'),bodyEncoded:Buffer.from('Durchführung dokumentieren').toString('base64url'),status,dueDate:'2026-12-15',createdAt:'2026-11-01T09:00:00Z',updatedAt:'2026-11-01T09:00:00Z'});
 const html=fs.readFileSync(new URL('../dist/public/index.html',import.meta.url),'utf8').replace('<script src="./config.js"></script>','<script>window.FT_API_URL="https://isolated.test/api";</script>');
 const errors=[],pending=new Set(),vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://isolated.test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  w.confirm=()=>true;w.prompt=()=> 'Bitte Foto ergänzen';w.alert=()=>{};
  w.crypto.randomUUID=randomUUID;Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
  w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.Response=Response;w.AbortController=AbortController;
  w.fetch=async(url,opts={})=>{
   assert.ok(String(url).endsWith('/api'),'External network is disabled: '+url);
   const input=JSON.parse(opts.body),p=(async()=>{try{
    const out=input.type==='pushInfo'?{ok:true,data:{configured:false,publicKey:''}}:await execute(env,input,opts.headers?.['X-Request-Id']||'','https://isolated.test');
    return new Response(JSON.stringify(out));
   }catch(err){return new Response(JSON.stringify({ok:false,error:err.message}),{status:err.status||400});}})();
   pending.add(p);try{return await p;}finally{pending.delete(p);}
  };
  w.sessionStorage.setItem('ft_token',role.repeat(64));w.localStorage.setItem('ft_pwa_offer_seen_v1','yes');
  if(storedInstalled)w.localStorage.setItem('ft_pwa_installed_v1','yes');
 }});
 const w=dom.window;
 const settle=async()=>{for(let i=0;i<8;i++){await Promise.all([...pending]);await new Promise(r=>setTimeout(r,5));}};
 const view=async tab=>{w.eval(`ST.tab=${JSON.stringify(tab)};`);await w.eval('load({force:true})');await settle();};
 const click=async selector=>{const el=w.document.querySelector(selector);assert.ok(el,'Missing control '+selector);el.click();await settle();};
 await settle();
 return {env,w,errors,settle,view,click,close(){w.close();env.DB.sqlite.close();}};
}

test('shipped interface renders every available staff, admin and system-admin view without JavaScript errors',async()=>{
 for(const role of ['1','a','b']){
  const x=await ui(role);try{
   for(const tab of x.w.eval('nav()')){await x.view(tab);assert.ok(x.w.document.querySelector('#content')?.textContent.trim(),role+' '+tab+' is empty');}
   assert.deepEqual(x.errors,[]);
  }finally{x.close();}
 }
});
test('employee task tabs expose acceptance, required completion photo, returned tasks and the completed archive',async()=>{
 const x=await ui();try{
  await x.view('messages');assert.match(x.w.document.querySelector('#content').textContent,/Meine Aufgaben/);
  assert.ok(!x.w.document.querySelector('[data-act="ui:taskNew"]'));
  await x.click('[data-act="commAccept"][data-id="open"]');assert.equal(record(x.env,'CommThreads','open').status,'ACCEPTED');
  await x.click('[data-key="uiTaskFilter"][data-id="ACCEPTED"]');
  assert.ok(x.w.document.querySelector('#ftCommCompleteForm input[name="photo"][required]'));
  await x.click('[data-key="uiTaskFilter"][data-id="RETURNED"]');assert.match(x.w.document.querySelector('#content').textContent,/Prüfauftrag RETURNED/);
  await x.click('[data-act="commAccept"][data-id="returned"]');assert.equal(record(x.env,'CommThreads','returned').status,'ACCEPTED');
  assert.match(x.w.document.querySelector('#content').textContent,/Abgeschlossene Aufgaben/);
  assert.ok(x.w.document.querySelector('details[data-task="closed"]'));
  assert.deepEqual(x.errors,[]);
 }finally{x.close();}
});
test('admin task composer assigns independently to selected employees and return uses the explicit returned state',async()=>{
 const x=await ui('a');try{
  await x.view('messages');await x.click('[data-act="ui:taskNew"]');
  const f=x.w.document.querySelector('#uiTaskCreateForm');f.elements.title.value='Neue Prüfaufgabe';f.elements.body.value='Dokumentation prüfen';
  for(const id of ['u1','u2'])f.querySelector('[name="recipientIds"][value="'+id+'"]').checked=true;
  f.dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true}));await x.settle();
  const threads=x.env.DB.sqlite.prepare("SELECT data FROM records WHERE table_name='CommThreads'").all().map(r=>JSON.parse(r.data)).filter(t=>Buffer.from(t.titleEncoded,'base64url').toString()==='Neue Prüfaufgabe');
  assert.equal(threads.length,2);assert.deepEqual(new Set(threads.map(t=>t.recipientId)),new Set(['u1','u2']));
  await x.click('[data-key="uiTaskFilter"][data-id="DONE"]');await x.click('[data-act="commReopen"][data-id="done"]');
  assert.equal(record(x.env,'CommThreads','done').status,'RETURNED');assert.deepEqual(x.errors,[]);
 }finally{x.close();}
});
test('manual time form submits the selected activity and one confirmed automatic pause to the real backend',async()=>{
 const x=await ui();try{
  await x.view('time');const f=x.w.document.querySelector('#uiTimeForm');
  f.elements.start.value='2026-11-04T08:00';f.elements.end.value='2026-11-04T15:00';
  f.dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true}));await x.settle();
  const rows=x.env.DB.sqlite.prepare("SELECT data FROM records WHERE table_name='Activities'").all().map(r=>JSON.parse(r.data));
  assert.equal(rows.length,1);assert.equal(rows[0].userId,'u1');assert.equal(rows[0].breakMinutes,30);assert.equal(rows[0].type,'OBJECT');assert.deepEqual(x.errors,[]);
 }finally{x.close();}
});
test('native install entry remains available after a previous installation was removed',async()=>{
 const x=await ui('1',{storedInstalled:true});try{
  assert.ok(x.w.document.querySelector('#ft-install-open').classList.contains('is-visible'));
  await x.click('#ft-install-open');assert.equal(x.w.document.querySelector('#ft-install-mask').getAttribute('aria-hidden'),'false');
 }finally{x.close();}
});
