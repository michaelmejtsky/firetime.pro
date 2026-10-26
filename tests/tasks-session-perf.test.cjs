'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const backend=fs.readFileSync(path.join(root,'apps-script','Code.gs'),'utf8');
const frontend=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
function sourcePart(input,start,end){
 const i=input.indexOf(start),j=input.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,'Missing '+start);
 return input.slice(i,j);
}
test('remember login creates a revocable 30-day session and defaults to short login',()=>{
 const code=sourcePart(backend,'function ft_login(','function ft_activate(');
 const created=[];
 const ctx={
  Date,Number,String,Error,
  CacheService:{getScriptCache:()=>({get:()=>null,remove:()=>{},put:()=>{}})},
  ft_email_:x=>x,ft_sha_:x=>'sha:'+x,
  ft_sessionCacheKey_:hash=>'ftsess:'+hash,
  ft_get_:name=>name==='Users'?[{id:'u',email:'employee@example.test',status:'ACTIVE',salt:'salt',
   passwordHash:'hashed'}]:[],
  ft_password_:()=> 'hashed',ft_rand_:()=> 'c'.repeat(64),
  ft_lock_:fn=>fn(),ft_add_:(name,row)=>created.push(row),
  ft_safe_:u=>({id:u.id})
 };
 const fn=vm.runInNewContext(code+';ft_login',ctx);
 const now=Date.now();
 const long=fn('employee@example.test','secret',true);
 assert.equal(long.token,'c'.repeat(64));assert.ok(long.expiresAt);
 assert.ok((Date.parse(long.expiresAt)-now)/(86400000)>29.99);
 const short=fn('employee@example.test','secret',false);
 assert.ok((Date.parse(short.expiresAt)-Date.now())/3600000<12.01);
 assert.equal(created[0].id,'sha:'+'c'.repeat(64));
});
test('device session persists a token only, and logout removes both storage copies',()=>{
 const code=sourcePart(frontend,'const FT_SESSION_STORAGE_KEY=','const ST=');
 const memory=new Map(),browser=new Map();
 const store=map=>({
  getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),
  removeItem:k=>map.delete(k)
 });
 const ctx={localStorage:store(browser),sessionStorage:store(memory),Date,JSON,String};
 const actions=vm.runInNewContext(code+';({ftStoredSession_,ftForgetSession_,ftSaveSession_})',ctx);
 const token='f'.repeat(64);
 actions.ftSaveSession_({token,expiresAt:new Date(Date.now()+86400000).toISOString()},true);
 assert.equal(actions.ftStoredSession_(),token);
 assert.ok(!browser.get('ft_remembered_session_v1').includes('password'));
 actions.ftForgetSession_();
 assert.equal(actions.ftStoredSession_(),'');
 assert.equal(memory.get('ft_token'),undefined);
});
test('admin task summary lists only own authored company tasks, never DMs',()=>{
 assert.match(backend,/taskOverview:actor\.role==='STAFF'\?\[\]:threads\.filter\(x=>x\.kind==='TASK'&&x\.createdBy===actor\.id\)/);
 assert.match(backend,/ft_commAccessible_\(actor,thread\)/);
 assert.match(backend,/next==='ACCEPTED'/);
 assert.match(backend,/next==='DONE'/);
 assert.match(backend,/if\(!p\.photo\)throw Error\('Zum Abschließen der Aufgabe ist ein Foto/);
 assert.match(backend,/ft_commPhotoSave_\(actor,c,p\.photo\)/);
 assert.match(frontend,/ft-task-overview/);
 assert.match(frontend,/id="ftCommCompleteForm"/);
 assert.match(frontend,/data-act="commAccept"/);
 assert.match(frontend,/data-act="taskFilter"/);
});
test('fresh app shell is network-first and configuration remains network-only',()=>{
 const version=frontend.match(/const FT_VISIBLE_VERSION='(\d+\.\d+\.\d+)'/);
 assert.ok(version,'the UI publishes a semantic version');
 const cache=sw.match(/const FT_SHELL_CACHE='firetime-shell-\d+-v(\d+)'/);
 assert.ok(cache,'the PWA publishes a versioned shell cache');
 assert.equal(cache[1],version[1].replace(/\./g,''),'cache must match the UI release');
 assert.match(sw,/if\(req\.method!=='GET'\)return/);
 assert.match(sw,/if\(url\.origin!==self\.location\.origin\)return/);
 assert.match(sw,/if\(\/\\\/config\\\.js\$\/.test\(url\.pathname\)\)return/);
 assert.match(sw,/const saved=await caches\.match/);
 assert.match(sw,/if\(saved\)\{/);
 assert.match(sw,/if\(isPage&&!isAppPage\)return/);
 assert.match(sw,/if\(isAppPage\)\{/);
 assert.match(sw,/const response=await fetch\(req,\{cache:'no-store'\}\)/);
 assert.match(sw,/event\.waitUntil\(fetch\(req,\{cache:'no-store'\}\)/);
 assert.match(frontend,/updateViaCache:'none'/);
 assert.match(frontend,/api\('commPulse'/);
 assert.match(frontend,/ftCommPoll_\(\),60000/);
 assert.doesNotThrow(()=>new vm.Script(frontend.slice(frontend.indexOf('<script>')+8,frontend.lastIndexOf('</script>'))));
 assert.doesNotThrow(()=>new vm.Script(backend));
 assert.doesNotThrow(()=>new vm.Script(sw));
});
