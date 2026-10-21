'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const backend=fs.readFileSync(path.join(root,'apps-script','Code.gs'),'utf8');
const part=(a,b,source=html)=>{
 const i=source.indexOf(a),j=source.indexOf(b,i+a.length);
 assert.ok(i>=0&&j>i,'Required source section: '+a);
 return source.slice(i,j);
};
function env(){
 const events=[],requests=[];
 const ST={token:'session-one',cid:'a',h:{me:{id:'u1',role:'STAFF'},company:{id:'a'},
  modules:['TIME','STANDBY','REPORTS']},tab:'dashboard',month:'2026-10',selected:'',edit:'',commCompose:false};
 const ctx={ST,Map,Set,Date,Number,String,Promise,console,
  FT_VIEWS_LOADED:new Set(),
  nav:()=>['dashboard','standby','time','reports'],
  isAdmin:()=>false,firm:()=>ST.h.company,me:()=>ST.h.me,
  document:{visibilityState:'visible'},
  setTimeout:(fn)=>{events.push(fn);return events.length},
  api:async(action,p)=>{
   requests.push({action,...p});
   return {me:{id:'u1'},company:{id:p.companyId||'a'},month:p.month,view:p.view};
  }
 };
 const functions=vm.runInNewContext(part('const FT_WARM_CACHE=new Map();','const LABELS=')
  +';({ftWarmSchedule_,ftWarmTake_,ftWarmPayload_,ftWarmKey_,FT_WARM_CACHE})',ctx);
 return {functions,requests,events,ST};
}
test('prewarm runs sequential targeted reads and instantly reuses one on navigation',async()=>{
 const {functions,requests,events,ST}=env();
 functions.ftWarmSchedule_();
 assert.equal(events.length,1);
 await events[0]();
 assert.deepEqual(requests.map(x=>x.view),['standby','time','reports']);
 const initial=requests.length;
 const cached=await functions.ftWarmTake_('standby','2026-10','a',functions.ftWarmPayload_('standby'));
 assert.equal(cached.view,'standby');
 assert.equal(requests.length,initial,'cached navigation must not issue a second backend home request');
 assert.equal(functions.FT_WARM_CACHE.has(functions.ftWarmKey_('standby')),false);
});
test('another tenant, user or session cannot receive a prefetched response',async()=>{
 const {functions,requests,events,ST}=env();
 functions.ftWarmSchedule_();await events[0]();
 const before=requests.length;
 ST.token='another-session';ST.h={me:{id:'u2'},company:{id:'b'}};
 const result=await functions.ftWarmTake_('standby','2026-10','b',functions.ftWarmPayload_('standby','2026-10','b'));
 assert.equal(requests.length,before+1);
 assert.equal(result.company.id,'b');
});
test('written changes invalidate every prefetched view for safe fresh reads',()=>{
 const api=part('function api(action,p={})','async function run(');
 assert.match(api,/FT_WARM_CACHE\.clear\(\);FT_WARM_GENERATION\+\+/);
 assert.match(api,/if\(readOnly\.has\(action\)\)return result/);
 const loading=part('async function load(options={})','function nav(){');
 assert.match(loading,/FT_WARM_CACHE\.clear\(\);FT_WARM_GENERATION\+\+/);
 assert.match(loading,/await ftWarmTake_/);
});
test('unrelated views no longer fetch communication unread spreadsheets',()=>{
 const home=part('function ft_home_(u,p){','function ft_auditApi_',backend);
 assert.match(home,/commUnread:c&&need\('dashboard','messages'\)\?ft_commUnread_\(u,c\):null/);
 assert.match(home,/if\(c&&access\('REPORTS'\)&&reportsMode!=='none'\)/);
 assert.match(home,/const need=\(\.\.\.names\)=>requested==='all'\|\|names.includes\(requested\)/);
});
test('backend/frontend scripts retain valid syntax',()=>{
 const script=part('<script>','</script>',html);
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.doesNotThrow(()=>new vm.Script(backend));
});
