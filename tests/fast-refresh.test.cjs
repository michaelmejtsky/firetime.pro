'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const source=html.slice(html.indexOf('let FT_AUTO_TIMER=null'),html.indexOf('function mobileNav(){'));
assert.ok(source.includes('function ftAutoCheck_'), 'auto refresh source found');
function create(now=100000){
 const clock={now},refreshes=[],map=new Map([['c|2026-10|dashboard',1000]]);
 const content={contains:node=>!!node?.inForm,querySelector:()=>null};
 const document={
  visibilityState:'visible',activeElement:{inForm:false,closest:()=>null},
  querySelector:()=>null,getElementById:()=>content,addEventListener:()=>{}
 };
 const ST={token:'test-token',h:{me:{id:'u1'}},month:'2026-10',tab:'dashboard',edit:'',commCompose:false};
 const ctx={
  document,window:{addEventListener:()=>{}},
  ST,performance:{now:()=>clock.now},Map,
  FT_VIEW_FETCHED_AT:map,
  firm:()=>({id:'c'}),
  load:async args=>{refreshes.push(args);map.set('c|2026-10|dashboard',clock.now)},
  setInterval:()=>1,console
 };
 const {ftAutoCheck_,ftAutoCanRender_}=vm.runInNewContext(source+';({ftAutoCheck_,ftAutoCanRender_})',ctx);
 return {ftAutoCheck_,ftAutoCanRender_,clock,refreshes,document,ST,content};
}
test('all inline app JavaScript remains syntactically valid',()=>{
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  if(match[1].trim())assert.doesNotThrow(()=>new vm.Script(match[1]));
 assert.doesNotThrow(()=>new vm.Script(worker));
});
test('auto-refresh fetches after 60s, not continuously',async()=>{
 const c=create();
 assert.equal(await c.ftAutoCheck_(),true);
 assert.equal(c.refreshes.length,1);
 assert.equal(c.refreshes[0].background,true);
 c.clock.now+=25000;
 assert.equal(await c.ftAutoCheck_(),false);
 c.clock.now+=40000;
 assert.equal(await c.ftAutoCheck_(),true);
 assert.equal(c.refreshes.length,2);
});
test('auto-refresh never interrupts editing, expanded plans or hidden apps',async()=>{
 const c=create();
 c.document.visibilityState='hidden';
 assert.equal(await c.ftAutoCheck_(),false);
 c.document.visibilityState='visible';
 c.document.activeElement={inForm:true,closest:()=>({})};
 assert.equal(await c.ftAutoCheck_(),false);
 c.document.activeElement={inForm:false,closest:()=>null};
 c.content.querySelector=()=>({open:true});
 assert.equal(await c.ftAutoCheck_(),false);
 c.content.querySelector=()=>null;
 c.ST.edit='editing-a-record';
 assert.equal(await c.ftAutoCheck_(),false);
 assert.equal(c.refreshes.length,0);
});
test('fast navigation uses memory for message inbox and personal account',()=>{
 assert.match(html,/const lightweight=ST\.h\?\.me&&\['profile','messages'\]\.includes\(ST\.tab\)/);
 assert.match(html,/if\(lightweight\)\{page\(\);return;\}/);
 assert.match(html,/const before=background&&same\?JSON\.stringify\(ST\.h\):null/);
 assert.match(html,/if\(before!==JSON\.stringify\(ST\.h\)&&ftAutoCanRender_\(\)\)page\(\)/);
});
test('message checks are foreground-only, skip concurrent calls, and run every 30 seconds',()=>{
 assert.match(html,/FT_COMM_POLL_BUSY=true/);
 assert.match(html,/FT_COMM_POLL_TIMER=setInterval\(\(\)=>ftCommPoll_\(\),30000\)/);
 assert.match(html,/document\.visibilityState==='hidden'\|\|ST\.commLoading\|\|FT_COMM_POLL_BUSY/);
 assert.match(html,/const changed=!old\|\|JSON\.stringify\(old\.threads\)/);
 assert.match(html,/ST\.tab==='messages'&&changed&&ftAutoCanRender_\(\)/);
});
test('push instantly sends a non-sensitive event to an already-open FireTime tab',async()=>{
 const calls=[],listeners={},badges=[];
 const client={url:'https://example.test/firetime.pro/?tab=messages',postMessage:m=>calls.push(m)};
 const self={
  registration:{scope:'https://example.test/firetime.pro/',showNotification:async()=>{}},
  navigator:{setAppBadge:async n=>badges.push(n)},
  clients:{matchAll:async()=>[client,{url:'https://bad.example/',postMessage:()=>assert.fail('external client')}]},
  addEventListener:(type,listener)=>{listeners[type]=listener}
 };
 vm.runInNewContext(worker,{self,URL,Set,Promise,Date,Number,String,console});
 let pending=Promise.resolve();
 listeners.push({data:{json:()=>({kind:'COMM',unreadCount:2})},waitUntil:p=>pending=p});
 await pending;
 assert.equal(badges[0],2);
 assert.equal(calls.length,1);
 assert.equal(calls[0].type,'FT_PUSH_RECEIVED');
 assert.equal(calls[0].kind,'COMM');
 assert.equal(Object.keys(calls[0]).length,2);
 assert.match(html,/navigator\.serviceWorker\.addEventListener\('message'/);
});
