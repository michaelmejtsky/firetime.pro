'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const backend=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
const frontend=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('one-time Apps Script permission helper never modifies employee data',()=>{
 const a=backend.indexOf('function ft_pushBerechtigung_EINMAL()');
 const b=backend.indexOf('function ft_pushWorkerUrl_()',a);
 assert.ok(a>0&&b>a);
 const scope=backend.slice(a,b);
 assert.match(scope,/UrlFetchApp\.fetch/);
 assert.match(scope,/FT_PUSH_WORKER_URL/);
 assert.doesNotMatch(scope,/ft_setup|ft_workflowUpgrade|ft_add_|ft_sheet_|ft_db_/);
 let saved='',fetchUrl='',calls=0;
 const context={
  String,Error,
  PropertiesService:{getScriptProperties:()=>({
   getProperty:key=>key==='FT_PUSH_WORKER_URL'?saved:'',
   setProperty:(_,val)=>{saved=val;}
  })},
  UrlFetchApp:{fetch:(url)=>{fetchUrl=url;calls++;return {getResponseCode:()=>403};}},
  Logger:{log:()=>{}}
 };
 const fn=vm.runInNewContext(scope+';ft_pushBerechtigung_EINMAL',context);
 const out=fn();
 assert.equal(out.ok,true);
 assert.equal(out.cloudflareHttpStatus,403);
 assert.equal(saved,'https://firetime-pro-api.firetime-pro.workers.dev');
 assert.equal(fetchUrl,'https://firetime-pro-api.firetime-pro.workers.dev/api');
 assert.equal(calls,1);
});
test('viewport positioning on mobile uses measured fixed popover dimensions',()=>{
 assert.match(frontend,/function ftPositionHelpPopup_\(/);
 assert.match(frontend,/position:fixed;left:12px/);
 assert.match(frontend,/overflow-y:auto/);
 assert.match(frontend,/Math\.min\(r\.left-10,vw-width-12\)/);
});
test('safe local VAPID generator never transmits secret',()=>{
 const html=fs.readFileSync(path.join(root,'tools/push-schluessel.html'),'utf8');
 assert.match(html,/crypto\.subtle\.generateKey/);
 assert.match(html,/VAPID_PRIVATE_JWK/);
 assert.doesNotMatch(html,/\bfetch\(/);
 assert.doesNotMatch(html,/\bXMLHttpRequest\b/);
});
