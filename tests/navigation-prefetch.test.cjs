'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const backend=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
const part=(a,b,source=html)=>{
 const i=source.indexOf(a),j=source.indexOf(b,i+a.length);
 assert.ok(i>=0&&j>i,'Required source section: '+a);return source.slice(i,j);
};
function env(){
 const requests=[];
 const ST={token:'session-one',cid:'a',h:{me:{id:'u1',role:'STAFF'},company:{id:'a'}},
  tab:'dashboard',month:'2026-10',selected:'',edit:'',commCompose:false};
 const ctx={ST,Map,Set,Date,Number,String,Promise,console,
  FT_VIEWS_LOADED:new Set(),firm:()=>ST.h.company,me:()=>ST.h.me,isAdmin:()=>false,
  api:async(action,p)=>{
   requests.push({action,...p});return {me:{id:'u1'},company:{id:p.companyId},view:p.view};
  }
 };
 const fns=vm.runInNewContext(part('const FT_WARM_CACHE=new Map();','function ftViennaParts(')
  +';({ftWarmSchedule_,ftWarmTake_,ftWarmPayload_,ftWarmKey_,FT_WARM_CACHE})',ctx);
 return {fns,requests,ST};
}
test('dashboard no longer queues three expensive backend prefetch requests',async()=>{
 const {fns,requests}=env();
 fns.ftWarmSchedule_();
 assert.equal(requests.length,0);
 const view=await fns.ftWarmTake_('standby','2026-10','a',fns.ftWarmPayload_('standby'));
 assert.equal(view.view,'standby');
 assert.equal(requests.length,1,'selected view alone makes a backend call');
});
test('warm result can only be consumed for the same authenticated tenant and account',async()=>{
 const {fns,requests,ST}=env();
 const key=fns.ftWarmKey_('standby','2026-10','a');
 fns.FT_WARM_CACHE.set(key,{generation:0,started:Date.now(),
   data:{me:{id:'u1'},company:{id:'a'},view:'standby'}});
 const cached=await fns.ftWarmTake_('standby','2026-10','a',fns.ftWarmPayload_('standby'));
 assert.equal(cached.view,'standby');assert.equal(requests.length,0);
 // Different token/company creates a distinct key, so cached user data is not exposed.
 ST.token='session-two';ST.cid='b';ST.h={me:{id:'u2'},company:{id:'b'}};
 const different=await fns.ftWarmTake_('standby','2026-10','b',fns.ftWarmPayload_('standby','2026-10','b'));
 assert.equal(different.company.id,'b');assert.equal(requests.length,1);
});
test('writes invalidate RAM caches and views are fetched for authorized company only',()=>{
 const api=part('function api(action,p={})','async function run(');
 assert.match(api,/FT_WARM_CACHE\.clear\(\);FT_WARM_GENERATION\+\+/);
 assert.match(api,/if\(readOnly\.has\(action\)\)return result/);
 const loading=part('async function load(options={})','function nav(){');
 assert.match(loading,/FT_WARM_CACHE\.clear\(\);FT_WARM_GENERATION\+\+/);
 assert.match(loading,/await ftWarmTake_/);
});
test('unrelated home views skip expensive message unread scans',()=>{
 const home=part('function ft_home_(u,p){','function ft_auditApi_',backend);
 assert.match(home,/commUnread:c&&need\('messages'\)\?ft_commUnread_\(u,c\):null/);
 assert.match(home,/const need=\(\.\.\.names\)=>requested==='all'\|\|names.includes\(requested\)/);
});
test('backend and frontend scripts parse successfully',()=>{
 const script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
 assert.ok(script.length>1000);
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.doesNotThrow(()=>new vm.Script(backend));
});