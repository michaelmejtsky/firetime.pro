'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function block(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing section: '+start);
 return html.slice(a,b);
}

test('push settings are exclusively inside My Account, not inbox',()=>{
 const messages=block('function ftMessages_(){','/** Repositioniert die Kontext-Hilfe');
 const account=block('function profile(){','async function ftCommPhotoData_');
 assert.doesNotMatch(messages,/ftCommNotificationUI_\(\)/);
 assert.match(account,/ftCommNotificationUI_\(\)/);
 assert.match(account,/backgroundPushSupported/);
 const ctx={
  ST:{h:{backgroundPushSupported:true}},E:v=>String(v),me:()=>({name:'Test',email:'test@example.at'}),
  input:()=>'<input>',FT_TEMPO_SAMPLES:[],
  ftCommNotificationUI_:()=>'<div id="notification-settings">Push aktivieren</div>'
 };
 const rendered=vm.runInNewContext(account+';profile()',ctx);
 assert.match(rendered,/id="notification-settings"/);
 assert.match(rendered,/Mein Konto/);
 assert.match(rendered,/Passwort ändern/);
 assert.match(rendered,/passwordForm/);
});
test('push status refresh and controls rerender account screen',()=>{
 const fn=block('async function ftPushRefresh_(force=false){','async function ftPushEnable_(){');
 const page=block('function page(){','function ftHomeDate_');
 const actions=block('async function action(btn){','if(a===\'commNew\')');
 assert.match(fn,/ST\.tab==='profile'/);
 assert.match(page,/ST\.tab==='profile'&&ST\.h\?\.backgroundPushSupported/);
 assert.match(actions,/if\(ST\.tab==='profile'\)page\(\)/);
});
test('opaque status bar overlay has been removed',()=>{
 assert.doesNotMatch(html,/body::before\s*\{/);
});
