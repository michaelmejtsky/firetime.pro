'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),backend=fs.readFileSync(path.join(root,'apps-script','Code.gs'),'utf8'),
 frontend=fs.readFileSync(path.join(root,'index.html'),'utf8');
function section(text,start,end){
 const i=text.indexOf(start),j=text.indexOf(end,i+1);
 assert.ok(i>=0&&j>i,'Expected '+start);return text.slice(i,j);
}
test('complete backend and frontend JavaScript syntax is valid',()=>{
 assert.doesNotThrow(()=>new vm.Script(backend));
 const i=frontend.indexOf('<script>'),j=frontend.lastIndexOf('</script>');
 assert.doesNotThrow(()=>new vm.Script(frontend.slice(i+8,j)));
});
test('new pause start/end are persisted separately and no pause is invented',()=>{
 const source=section(backend,'const FT_TIMER_PAUSE_COLS_','function ft_timerActive_');
 const state={rows:[],seq:0,timer:{id:'timer1',userId:'staff1',companyId:'a',
  start:new Date(Date.now()-3600000).toISOString()}};
 const ctx={
  Date,Math,Number,String,Error,
  ft_absenceRows_:()=>state.rows,
  ft_get_:name=>name==='ActivityTimers'?[state.timer]:[],
  ft_user_:()=>({id:'staff1',companyId:'a'}),ft_company_:()=>({id:'a'}),
  ft_need_:()=>true,ft_uuid_:()=>String(++state.seq),ft_now_:()=>new Date().toISOString(),
  ft_viennaWallDate_:()=>new Date(Date.now()+7200000),
  ft_localDate_:()=> '2026-10-21',
  ft_absenceAdd_:(_,__,record)=>{record.__row=state.rows.length+2;state.rows.push(record);},
  ft_absenceSave_:()=>true,ft_audit_:()=>true,
  ft_timerActive_:()=>({active:true})
 };
 const api=vm.runInNewContext(source+';({ft_timerPauseAction_,ft_timerPauseData_})',ctx);
 const user={id:'staff1',companyId:'a',role:'STAFF'};
 assert.equal(api.ft_timerPauseData_(state.timer).completedMinutes,0);
 api.ft_timerPauseAction_(user,'start');
 assert.equal(api.ft_timerPauseData_(state.timer).paused,true);
 assert.throws(()=>api.ft_timerPauseAction_(user,'start'),/bereits/);
 api.ft_timerPauseAction_(user,'stop');
 assert.equal(api.ft_timerPauseData_(state.timer).paused,false);
 assert.throws(()=>api.ft_timerPauseAction_(user,'stop'),/keine Pause/);
});
function communications(){
 const rows={CommThreads:[],CommReplies:[],CommReads:[]},allUsers=[
  {id:'admin-a',name:'Admin A',role:'ADMIN',companyId:'a',status:'ACTIVE',email:'aa@example.test'},
  {id:'staff-a',name:'Staff A',role:'STAFF',companyId:'a',status:'ACTIVE',email:'sa@example.test'},
  {id:'staff-a2',name:'Staff A2',role:'STAFF',companyId:'a',status:'ACTIVE',email:'sa2@example.test'},
  {id:'admin-b',name:'Admin B',role:'ADMIN',companyId:'b',status:'ACTIVE',email:'bb@example.test'}];
 let id=0;
 const ctx={
  Date,Math,Number,String,Error,Set,Buffer,
  ft_absenceRows_:(name)=>rows[name]||[],
  ft_absenceAdd_:(name,_cols,r)=>{r.__row=rows[name].length+2;rows[name].push(r);},
  ft_absenceSave_:()=>true,
  ft_uuid_:()=>String(++id),ft_now_:()=>new Date().toISOString(),ft_audit_:()=>true,
  ft_company_:(actor,companyId)=>{const cid=companyId||actor.companyId;
   if(actor.role!=='SYSADMIN'&&cid!==actor.companyId)throw Error('Falsche Firma');
   return {id:cid,name:'Firma '+cid,slug:cid};
  },
  ft_user_:(actor,uid)=>{const u=allUsers.find(x=>x.id===uid);if(!u)throw Error('Unbekannt');
   if(actor.role!=='SYSADMIN'&&u.companyId!==actor.companyId)throw Error('Falsche Firma');return u;
  },
  ft_one_:(name,id)=>name==='Users'?allUsers.find(x=>x.id===id):null,
  ft_get_:name=>name==='Users'?allUsers:[],
  ft_scope_:(actor,cid)=>{if(actor.role!=='SYSADMIN'&&actor.companyId!==cid)throw Error('Scope');},
  ft_str_:(v,max)=>String(v||'').slice(0,max),
  ft_date_:s=>{if(!/^\d{4}-\d\d-\d\d$/.test(s))throw Error('Datum');return s;},
  ft_clientUrl_:()=> 'https://firetime.example.test/',
  ft_notification_:()=>true,
  Utilities:{
   Charset:{UTF_8:'UTF-8'},
   base64EncodeWebSafe:t=>Buffer.from(String(t),'utf8').toString('base64url'),
   base64DecodeWebSafe:t=>Buffer.from(String(t),'base64url'),
   newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString('utf8')})
  }
 };
 const src=section(backend,'const FT_COMM_THREAD_COLS_','// -----------------------------------------------------------------\n// 10_API');
 const api=vm.runInNewContext(src+';({ft_commCreate_,ft_commReply_,ft_commList_,ft_commMark_,ft_commTaskStatus_,ft_commThread_})',ctx);
 return {api,rows,users:allUsers};
}
test('private tasks and messages are isolated per company and sender/recipient',()=>{
 const {api,rows,users}=communications();
 const a=users[0],staff=users[1],other=users[2],adminB=users[3];
 const created=api.ft_commCreate_(a,{companyId:'a',recipientId:staff.id,kind:'TASK',
  title:'Wartung',body:'Bitte kontrollieren',dueDate:'2026-10-25'});
 assert.equal(created.thread.kind,'TASK');
 assert.equal(api.ft_commList_(staff,{companyId:'a'}).unread,1);
 assert.equal(api.ft_commList_(adminB,{companyId:'b'}).threads.length,0);
 assert.throws(()=>api.ft_commThread_(other,created.thread.id),/keine Berechtigung/);
 assert.throws(()=>api.ft_commCreate_(staff,{companyId:'a',recipientId:a.id,kind:'TASK',
  title:'Test',body:'Nicht erlaubt'}),/Aufgaben/);
 api.ft_commReply_(staff,{threadId:created.thread.id,body:'Erledige ich.'});
 assert.equal(rows.CommReplies.length,1);
 api.ft_commTaskStatus_(staff,{threadId:created.thread.id,status:'DONE'});
 assert.equal(rows.CommThreads[0].status,'DONE');
 assert.equal(api.ft_commList_(staff,{companyId:'a'}).threads[0].status,'DONE');
 assert.throws(()=>api.ft_commTaskStatus_(other,{threadId:created.thread.id,status:'DONE'}),/keine Berechtigung/);
});
test('staff can create a message addressed to company admin',()=>{
 const {api,users}=communications(),a=users[0],staff=users[1];
 const msg=api.ft_commCreate_(staff,{companyId:'a',recipientId:a.id,kind:'MESSAGE',
  title:'Kurze Rückfrage',body:'Bitte um Rückmeldung'});
 assert.equal(msg.thread.title,'Kurze Rückfrage');
 assert.equal(api.ft_commList_(a,{companyId:'a'}).unread,1);
});
test('UI exposes messages, photo capture, badge API, and both pause buttons',()=>{
 assert.match(frontend,/function ftMessages_\(/);
 assert.match(frontend,/data-act="timerPauseStart"/);
 assert.match(frontend,/timerPauseStop/);
 assert.match(frontend,/data-act="commPhoto"/);
 assert.match(frontend,/function ftCommPhotoData_\(/);
 assert.match(frontend,/navigator\.setAppBadge/);
 assert.match(frontend,/commCreate/);
 assert.match(frontend,/commReply/);
});
