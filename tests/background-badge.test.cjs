'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const backend=fs.readFileSync(path.join(root,'apps-script','Code.gs'),'utf8');
const worker=fs.readFileSync(path.join(root,'cloudflare','worker.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');

function dispatchFor_(value){
 const i=backend.indexOf('function ft_pushDispatch_('),j=backend.indexOf('function ft_pushDueTick_(',i);
 assert.ok(i>0&&j>i,'server push function exists');
 let request=null;
 const ctx={
  ft_pushWorkerUrl_:()=> 'https://push.example.test',
  ft_prop_:()=> 'x'.repeat(60),
  ft_pushRows_:()=>[{id:'device1',companyId:'company1',userId:'employee1',
   endpoint:'https://web.push.apple.com/test',p256dh:'fake',auth:'fake'}],
  ft_commUnread_:(actor,company)=>{
   assert.equal(actor.id,'employee1');
   assert.equal(company.id,'company1');
   return value;
  },
  ft_uuid_:()=> '01234567-89ab-cdef-0123-456789abcdef',
  ft_hex_:()=> 'a'.repeat(64),
  Utilities:{Charset:{UTF_8:'UTF-8'},computeHmacSha256Signature:()=> []},
  UrlFetchApp:{fetch:(_url,options)=>{
   request=JSON.parse(options.payload);
   return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
    ok:true,results:[{id:'device1',ok:true}]})};
  }},
  console,
  Date,Number,String,JSON
 };
 const fn=vm.runInNewContext(backend.slice(i,j)+';ft_pushDispatch_',ctx);
 assert.equal(fn({id:'employee1',companyId:'company1'},'COMM','evt1','Neu','Text').sent,1);
 return JSON.parse(request.payload).notification;
}

function serviceWorker_(){
 const listeners={},calls=[],notifications=[];
 const self={
  registration:{
   scope:'https://example.test/firetime.pro/',
   showNotification:async(t,o)=>{notifications.push({title:t,options:o})}
  },
  navigator:{
   setAppBadge:async n=>calls.push(['set',n]),
   clearAppBadge:async()=>calls.push(['clear'])
  },
  addEventListener:(name,cb)=>{listeners[name]=cb}
 };
 vm.runInNewContext(sw,{self,URL,Date,Promise,Set,Number,String,console});
 async function send(payload){
  let waiting=Promise.resolve();
  listeners.push({data:{json:()=>payload},waitUntil:p=>{waiting=p}});
  await waiting;
 }
 return {send,calls,notifications};
}
test('backend signs exact per-user unread count even when the app is closed',()=>{
 const notice=dispatchFor_(3);
 assert.equal(notice.unreadCount,3);
 assert.equal(notice.kind,'COMM');
 assert.equal(dispatchFor_(0).unreadCount,0);
 assert.equal(dispatchFor_(1001).unreadCount,999);
});
test('the iOS service worker sets a numbered app badge for an incoming push',async()=>{
 const worker=serviceWorker_();
 await worker.send({title:'Neue Nachricht',kind:'COMM',unreadCount:3});
 assert.deepEqual(worker.calls,[['set',3]]);
 assert.equal(worker.notifications.length,1);
 assert.equal(worker.notifications[0].title,'Neue Nachricht');
});
test('a push with zero unread messages clears badge without opening FireTime',async()=>{
 const worker=serviceWorker_();
 await worker.send({title:'Dienstinfo',unreadCount:2});
 await worker.send({title:'Dienstinfo',unreadCount:0});
 assert.deepEqual(worker.calls,[['set',2],['clear']]);
 assert.equal(worker.notifications.length,2);
});
test('legacy and malformed pushes do not reset an already correct badge',async()=>{
 const worker=serviceWorker_();
 await worker.send({title:'Legacy notification'});
 await worker.send({title:'Invalid notification',unreadCount:-1});
 await worker.send({title:'Invalid notification',unreadCount:'4'});
 assert.deepEqual(worker.calls,[]);
 assert.equal(worker.notifications.length,3);
});
test('worker enforces signed bounded badge counts and keeps safe notification deep link',()=>{
 assert.match(worker,/Number\.isSafeInteger\(count\)&&count>=0&&count<=999/);
 assert.match(worker,/\.\.\.\(unreadCount===null\?\{\}:\{unreadCount\}\)/);
 assert.match(worker,/url:'\/firetime\.pro\/\?tab='\+tab/);
 assert.doesNotMatch(sw,/self\.registration\.setAppBadge\(/);
 assert.match(sw,/self\.navigator\?\.setAppBadge/);
});
