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
 state.rows[0].start=new Date(Date.now()-120000).toISOString();
 api.ft_timerPauseAction_(user,'stop');
 assert.equal(api.ft_timerPauseData_(state.timer).paused,false);
 assert.throws(()=>api.ft_timerPauseAction_(user,'stop'),/keine Pause/);
});
function communications(){
 const rows={CommThreads:[],CommReplies:[],CommReads:[]},allUsers=[
  {id:'admin-a',name:'Admin A',role:'ADMIN',companyId:'a',status:'ACTIVE',email:'aa@example.test'},
  {id:'staff-a',name:'Staff A',role:'STAFF',companyId:'a',status:'ACTIVE',email:'sa@example.test'},
  {id:'staff-a2',name:'Staff A2',role:'STAFF',companyId:'a',status:'ACTIVE',email:'sa2@example.test'},
  {id:'staff-a3',name:'Staff A3',role:'STAFF',companyId:'a',status:'ACTIVE',email:'sa3@example.test'},
  {id:'admin-b',name:'Admin B',role:'ADMIN',companyId:'b',status:'ACTIVE',email:'bb@example.test'}];
 let id=0,mailEvents=[];
 const ctx={
  Date,Math,Number,String,Error,Set,Buffer,
  ft_absenceRows_:(name)=>rows[name]||[],
  ft_absenceSheet_:()=>({getRange:()=>({setNumberFormat:()=>{}})}),
  ft_absenceAdd_:(name,_cols,r)=>{r.__row=rows[name].length+2;rows[name].push(r);},
  ft_absenceSave_:()=>true,
  ft_absenceSheet_:()=>({getRange:()=>({setNumberFormat:()=>true})}),
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
  ft_prop_:()=> 'root-folder',
  DriveApp:{getFolderById:()=>({getFoldersByName:()=>({
   hasNext:()=>true,next:()=>({createFile:()=>({getId:()=> 'photo-evidence'})})
  })})},
  ft_notification_:(company,recipient,kind,reference)=>{
   mailEvents.push({companyId:company.id,recipientId:recipient.id,kind,reference});return true;
  },
  Utilities:{
   Charset:{UTF_8:'UTF-8'},
   base64EncodeWebSafe:t=>Buffer.from(String(t),'utf8').toString('base64url'),
   base64DecodeWebSafe:t=>Buffer.from(String(t),'base64url'),
   base64Decode:t=>Array.from(Buffer.from(t,'base64')),
   newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString('utf8')})
  }
 };
 const src=section(backend,'const FT_COMM_THREAD_COLS_','// -----------------------------------------------------------------\n// 10_API');
 const api=vm.runInNewContext(src+';({ft_commCreate_,ft_commReply_,ft_commList_,ft_commMark_,ft_commTaskStatus_,ft_commThread_})',ctx);
 return {api,rows,users:allUsers,mailEvents};
}
test('private tasks and messages are isolated per company and sender/recipient',()=>{
 const {api,rows,users}=communications();
 const a=users.find(x=>x.id==='admin-a'),staff=users.find(x=>x.id==='staff-a'),
  other=users.find(x=>x.id==='staff-a2'),adminB=users.find(x=>x.id==='admin-b');
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
 assert.throws(()=>api.ft_commTaskStatus_(staff,{threadId:created.thread.id,status:'DONE'}),/zuerst annehmen/);
 api.ft_commTaskStatus_(staff,{threadId:created.thread.id,status:'ACCEPTED'});
 assert.equal(rows.CommThreads[0].status,'ACCEPTED');
 assert.throws(()=>api.ft_commTaskStatus_(staff,{threadId:created.thread.id,status:'DONE'}),/Foto/);
 const photo={mime:'image/jpeg',data:Buffer.from([255,216,255,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]).toString('base64')};
 api.ft_commTaskStatus_(staff,{threadId:created.thread.id,status:'DONE',photo,note:'Fertig geprüft'});
 assert.equal(rows.CommThreads[0].status,'DONE');
 assert.equal(rows.CommReplies.length,2);
 assert.equal(rows.CommReplies[1].attachmentId,'photo-evidence');
 assert.equal(api.ft_commList_(a,{companyId:'a'}).taskOverview[0].status,'DONE');
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
test('coworkers can privately message and reply, notifying only recipient',()=>{
 const {api,users,mailEvents}=communications();
 const admin=users.find(x=>x.id==='admin-a');
 const sender=users.find(x=>x.id==='staff-a');
 const colleague=users.find(x=>x.id==='staff-a2');
 const outsider=users.find(x=>x.id==='staff-a3');
 const otherCompanyAdmin=users.find(x=>x.id==='admin-b');
 const options=api.ft_commList_(sender,{companyId:'a'}).recipients;
 assert.ok(options.some(x=>x.id===admin.id&&x.role==='ADMIN'));
 assert.ok(options.some(x=>x.id===colleague.id&&x.role==='STAFF'));
 assert.ok(!options.some(x=>x.id===sender.id));
 assert.ok(!options.some(x=>x.id===otherCompanyAdmin.id));
 const sent=api.ft_commCreate_(sender,{companyId:'a',recipientId:colleague.id,
  kind:'MESSAGE',title:'Kollegenaustausch',body:'Bitte melde dich.'});
 assert.equal(sent.thread.kind,'MESSAGE');
 assert.equal(sent.mailSent,true);
 assert.deepEqual(mailEvents.map(x=>x.recipientId),[colleague.id]);
 assert.equal(api.ft_commList_(colleague,{companyId:'a'}).unread,1);
 assert.equal(api.ft_commList_(sender,{companyId:'a'}).unread,0);
 assert.equal(api.ft_commList_(admin,{companyId:'a'}).threads.length,0);
 assert.equal(api.ft_commList_(outsider,{companyId:'a'}).threads.length,0);
 assert.equal(api.ft_commList_(otherCompanyAdmin,{companyId:'b'}).threads.length,0);
 assert.throws(()=>api.ft_commThread_(admin,sent.thread.id),/keine Berechtigung/);
 assert.throws(()=>api.ft_commThread_(outsider,sent.thread.id),/keine Berechtigung/);
 assert.throws(()=>api.ft_commThread_(otherCompanyAdmin,sent.thread.id),/keine Berechtigung/);
 assert.throws(()=>api.ft_commCreate_(sender,{companyId:'a',recipientId:sender.id,
  title:'An mich',body:'Unerlaubt'}),/Empfänger/);
 assert.throws(()=>api.ft_commCreate_(sender,{companyId:'a',recipientId:otherCompanyAdmin.id,
  title:'Fremde Firma',body:'Unerlaubt'}),/Falsche Firma/);
 api.ft_commReply_(colleague,{threadId:sent.thread.id,body:'Ich melde mich.'});
 assert.equal(api.ft_commList_(sender,{companyId:'a'}).unread,1);
 assert.equal(api.ft_commList_(colleague,{companyId:'a'}).unread,0);
 assert.deepEqual(mailEvents.map(x=>x.recipientId),[colleague.id,sender.id]);
 assert.equal(api.ft_commList_(admin,{companyId:'a'}).threads.length,0);
});
test('employees cannot assign tasks to each other',()=>{
 const {api,users}=communications(),staff=users.find(x=>x.id==='staff-a'),
  peer=users.find(x=>x.id==='staff-a2');
 assert.throws(()=>api.ft_commCreate_(staff,{companyId:'a',recipientId:peer.id,
  kind:'TASK',title:'Unzulässig',body:'Aufgabe'}),/Aufgaben/);
});

test('notification settings distinguish permission, registered device and configured push',()=>{
 const source=section(frontend,'function ftCommNotificationState_','function ftMessages_');
 function state(permission,configured=true,registered=false,installed=true,available=true){
  const notification={permission};
  const window={Notification:available?notification:undefined,isSecureContext:true,
   PushManager:()=>{},matchMedia:()=>({matches:installed})};
  const navigator={setAppBadge:()=>Promise.resolve(),standalone:false,
   serviceWorker:{},userAgent:'Mozilla desktop'};
  const ST={pushSettings:{info:{configured,publicKey:'test'},
   status:{deliveryConfigured:configured,deviceCount:registered?1:0},onThisDevice:registered}};
  const ctx={window,navigator,Notification:notification,E:x=>String(x),ST};
  return vm.runInNewContext(source+';({ftCommNotificationState_,ftCommNotificationUI_})',ctx);
 }
 for(const [status,label] of [['default','Nicht aktiviert'],['granted','Erlaubt'],['denied','Blockiert']]){
  const context=state(status),info=context.ftCommNotificationState_();
  assert.equal(info.label,label);
  const html=context.ftCommNotificationUI_();
  assert.match(html,/Hintergrund-Push/);
  assert.match(html,/Geräteberechtigung/);
 }
 assert.match(state('default').ftCommNotificationUI_(),/Push aktivieren/);
 assert.match(state('granted',true,true).ftCommNotificationUI_(),/Push aktiv/);
 assert.match(state('granted',true,true).ftCommNotificationUI_(),/Testbenachrichtigung senden/);
 assert.doesNotMatch(state('denied').ftCommNotificationUI_(),/data-act="pushEnable"/);
 assert.match(state('default',false).ftCommNotificationUI_(),/Nicht eingerichtet/);
 assert.match(state('default',true,false,true,false).ftCommNotificationUI_(),/Nicht verfügbar/);
});
test('long explanatory hints collapse, while important warnings remain visible',()=>{
 assert.match(frontend,/function hint\(t,title='Mehr Informationen'\)/);
 assert.match(frontend,/<details class="ft-page-hint">/);
 assert.match(frontend,/Feiertagsarbeit festgestellt: gesetzliche/);
 assert.match(frontend,/ft-plan-message ft-plan-warning/);
 assert.match(frontend,/function ftCommNotificationState_\(/);
 assert.doesNotMatch(frontend,/>Icon-Hinweise<\/button>/);
});

test('UI exposes messages, photo capture, badge API, and both pause buttons',()=>{
 assert.match(frontend,/function ftMessages_\(/);
 assert.match(frontend,/timerPauseStart/);
 assert.match(frontend,/timerPauseStop/);
 assert.match(frontend,/commPhoto/);
 assert.match(frontend,/function ftCommPhotoData_\(/);
 assert.match(frontend,/navigator\.setAppBadge/);
 assert.match(frontend,/commCreate/);
 assert.match(frontend,/commReply/);
 assert.match(frontend,/Kollege · /);
 assert.match(frontend,/Administrator · /);
});


test('existing Drive photos open by file signature even if content type is generic',()=>{
 const code=section(backend,'function ft_commPhoto_(actor,p)','function ft_commList_');
 const actor={id:'staff-a',role:'STAFF',companyId:'company-a'};
 const thread={id:'thread-1',companyId:'company-a',createdBy:'staff-a',recipientId:'staff-b',
  attachmentId:'photo-1'};
 const jpeg=[255,216,255,224,0,1,3,5];
 const png=[137,80,78,71,13,10,26,10,0,0,0,0];
 const webp=[82,73,70,70,5,0,0,0,87,69,66,80,0];
 let bytes=jpeg;
 const ctx={
  String,Error,
  ft_commThread_:()=>thread,
  ft_commReplies_:()=>[],
  DriveApp:{getFileById:id=>{
   assert.equal(id,'photo-1');
   return {getBlob:()=>({getContentType:()=> 'application/octet-stream',getBytes:()=>bytes})};
  }},
  Utilities:{base64Encode:list=>Buffer.from(list.map(x=>x&255)).toString('base64')}
 };
 const fn=vm.runInNewContext(code+';ft_commPhoto_',ctx);
 for(const [sample,type] of [[jpeg,'image/jpeg'],[png,'image/png'],[webp,'image/webp']]){
  bytes=sample;const out=fn(actor,{threadId:'thread-1',attachmentId:'photo-1'});
  assert.equal(out.mime,type);
  assert.equal(out.data,Buffer.from(sample).toString('base64'));
 }
 assert.throws(()=>fn(actor,{threadId:'thread-1',attachmentId:'other'}),/gehört nicht/);
 bytes=[60,115,99,114,105,112,116,62];
 assert.throws(()=>fn(actor,{threadId:'thread-1',attachmentId:'photo-1'}),/unterstütztes Bild- oder PDF-Format/);
});
test('image viewer and contextual UI are current, and PWA cache works in subpaths',()=>{
 assert.match(frontend,/function ftCommPhotoPreview_\(/);
 assert.match(frontend,/URL\.createObjectURL/);
 assert.match(frontend,/ft-photo-viewer/);
 assert.match(frontend,/Anhang konnte nicht geöffnet werden/);
 assert.match(frontend,/const FT_VISIBLE_VERSION='1\.8\.16'/);
 assert.match(frontend,/ft-help-header/);
 assert.match(frontend,/Stand der geladenen App-Oberfläche/);
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 assert.doesNotThrow(()=>new vm.Script(sw));
 assert.match(sw,/self\.registration\.scope/);
 assert.match(sw,/cache:'no-store'/);
 assert.match(sw,/firetime-shell-20261026-v1816/);
});
