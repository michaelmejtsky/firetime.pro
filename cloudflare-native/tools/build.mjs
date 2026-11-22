import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
const root=path.resolve(import.meta.dirname,'..'),repo=path.resolve(root,'..');
const source=fs.readFileSync(path.join(repo,'apps-script/Code.gs'),'utf8');
const ast=parse(source,{ecmaVersion:'latest'});
const extra={BalanceStarts:'FT_BALANCE_START_COLS_',PdfArchive:'FT_PDF_ARCHIVE_HEADERS_',PdfBatchArchive:'FT_PDF_BATCH_COLS_',PdfJobs:'FT_PDF_JOB_HEAD_',TimerPauses:'FT_TIMER_PAUSE_COLS_',PushDevices:'FT_PUSH_COLS_',CommThreads:'FT_COMM_THREAD_COLS_',CommReplies:'FT_COMM_REPLY_COLS_',CommReads:'FT_COMM_READ_COLS_',CompanyLicenses:'FT_LICENSE_COLS_',CompanyProfiles:'FT_PROFILE_COLS_',CompanyRules:'FT_RULE_HEADERS_',WorkShifts:'FT_WORK_COLS_',LeaveLedger:'FT_LEAVE_LEDGER_COLS_',LeavePolicies:'FT_LEAVE_POLICY_COLS_',LeaveStaffRules:'FT_LEAVE_STAFF_RULE_COLS_',LeaveFlexRules:'FT_LEAVE_FLEX_COLS_',LeaveFlexApprovals:'FT_LEAVE_FLEX_APPROVAL_COLS_',AbsencePdfArchive:'FT_ABSENCE_PDF_COLS_'};
// Derive actual optional table names from their call sites; fail if ambiguous.
for(const [table,identifier] of Object.entries(extra)){
 const matches=[...source.matchAll(new RegExp("ft_(?:absenceSheet_|absenceRows_|absenceAdd_|absenceSave_)\\('([^']+)',"+identifier,'g'))];
 const names=[...new Set(matches.map(x=>x[1]))];
 if(names.length===1&&names[0]!==table){delete extra[table];extra[names[0]]=identifier;}
 if(names.length>1)throw Error('Ambiguous table mapping '+identifier);
}
const schemas=vm.runInNewContext(source+';({...FT_HEADERS,'+Object.entries(extra).map(([k,v])=>JSON.stringify(k)+':'+v).join(',')+'})');
schemas.EmployeePreferences=['id','companyId','userId','leaveHoursPerDay','calendarId','updatedBy','updatedAt'];
schemas.ActivityBreakPolicies=['id','companyId','userId','activityId','mode','confirmed','minutes','reviewedBy','reviewedAt','reviewNote','updatedBy','updatedAt'];
schemas.CalendarMirrors=['id','companyId','userId','sourceType','sourceId','calendarId','eventId','sourceHash','status','updatedAt'];
const nativeAliases=new Set(['ft_api','ft_safe_','ft_userCreate_','ft_userUpdate_','ft_commThreads_','ft_commCreate_','ft_commTaskStatus_','ft_activitySave_','ft_timerStop_','ft_reportApi_','ft_pushStatus_','ft_objectPausePending_','ft_tick']);
const overrides={
 ft_hex_:"function ft_hex_(bytes){return Array.from(bytes,b=>((b+256)%256).toString(16).padStart(2,'0')).join('');}",
 ft_db_:"function ft_db_(){return runtime.db;}",
 ft_lock_:"function ft_lock_(fn){return fn();}",
 ft_prop_:"function ft_prop_(key){return runtime.property(key);}",
 ft_pick_:"function ft_pick_(name,o){return FT_HEADERS[name].map(k=>o[k]??'');}",
 ft_sendMail_:"function ft_sendMail_(message){return runtime.mail(message);}",
 ft_pushWorkerUrl_:"function ft_pushWorkerUrl_(){return runtime.pushEnabled?'native://push':'';}",
 ft_pushDispatch_:"function ft_pushDispatch_(actor,kind,id,title,body){return runtime.push(actor,kind,id,title,body,ft_pushRows_().filter(x=>x.companyId===actor.companyId&&x.userId===actor.id),ft_commUnread_(actor,{id:actor.companyId}));}",
 ft_notification_: `function ft_notification_(c,u,kind,reference,subject,body){
 const id=ft_sha_(c.id+'|'+u.id+'|'+kind+'|'+reference),old=ft_one_('Notifications',id);
 if(old&&['SENT','QUEUED'].includes(old.status))return false;
 try{runtime.mail({to:u.email,subject,body,name:'Bereitschaftsdienste '+c.name},id);
 const row=old||{id,companyId:c.id,userId:u.id,kind,reference};Object.assign(row,{sentAt:ft_now_(),status:'QUEUED',error:''});
 if(old)ft_save_('Notifications',row);else ft_add_('Notifications',row);return true;
 }catch(err){return false;}}`,
 ft_pushOperationalOnce_: `function ft_pushOperationalOnce_(company,user,kind,reference,title,body){
 if(!runtime.pushEnabled||!company||!user||user.status!=='ACTIVE')return false;
 const id=ft_sha_(company.id+'|'+user.id+'|'+kind+'|'+reference),old=ft_one_('Notifications',id);
 if(old&&['SENT','QUEUED'].includes(old.status))return false;
 const outcome=ft_pushDispatch_(user,kind,reference,title,body);if(!outcome.queued)return false;
 runtime.linkNotification(outcome.jobId,id);
 const row=old||{id,companyId:company.id,userId:user.id,kind,reference};Object.assign(row,{sentAt:ft_now_(),status:'QUEUED',error:''});
 if(old)ft_save_('Notifications',row);else ft_add_('Notifications',row);return true;}`,
 ft_pushDueTick_: `function ft_pushDueTick_(){if(Number(Utilities.formatDate(new Date(),FT_TZ,'H'))!==9)return {queued:0};let queued=0;const tomorrow=Utilities.formatDate(new Date(Date.now()+86400000),FT_TZ,'yyyy-MM-dd');for(const t of ft_commThreads_().filter(x=>x.kind==='TASK'&&x.status==='OPEN'&&x.dueDate===tomorrow).slice(0,100)){const u=ft_one_('Users',t.recipientId),c=ft_one_('Companies',t.companyId);if(c&&u&&u.companyId===c.id&&ft_pushOperationalOnce_(c,u,'PUSH_TASK_DUE','due-'+t.id+'-'+t.dueDate,'FireTime Pro · Aufgabe morgen fällig','Bitte deine offene Aufgabe in FireTime Pro prüfen.'))queued++;}return {queued};}`,
 ft_calendarTest_:"function ft_calendarTest_(actor,companyId){ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_company_(actor,companyId);return runtime.calendarTest(c.calendarId);}",
 ft_setup:"function ft_setup(){throw Error('Setup ist im Cloudflare-Backend gesperrt. Nur geprüften Export importieren.');}",
 doPost:"function doPost(){throw Error('Native API required');}",
 doGet:"function doGet(){return null;}"
};
const names=ast.body.filter(x=>x.type==='FunctionDeclaration').map(x=>x.id.name);
for(const name of Object.keys(overrides))if(!names.includes(name))throw Error('Missing override '+name);
let native=source;
for(const node of [...ast.body].reverse())if(node.type==='FunctionDeclaration'&&(overrides[node.id.name]||nativeAliases.has(node.id.name))){const replacement=nativeAliases.has(node.id.name)?source.slice(node.start,node.end).replace('function '+node.id.name+'(', 'function ft_legacy_'+node.id.name.slice(3)+'('):overrides[node.id.name];native=native.slice(0,node.start)+replacement+native.slice(node.end);}
native=native.replace("  case 'adminOverview':return ft_adminOverview_(u,p);\n  case 'adminOverview':return ft_adminOverview_(u,p);","  case 'adminOverview':return ft_adminOverview_(u,p);");
const exports=['ft_api','ft_login','ft_activate','ft_logout','ft_changePassword','ft_passwordResetRequest_','ft_passwordResetConfirm_','ft_brandForLogin','ft_tick','ft_timerTick_','ft_pdfWorker_','ft_password_','ft_fastSha256Utf8_','ft_report_','ft_monthBounds_','ft_shiftRange_','ft_categoryHours_','ft_get_','ft_sha_','ft_safe_','ft_auth_'];
const globals='Utilities,PropertiesService,CacheService,SpreadsheetApp,DriveApp,CalendarApp,MailApp,DocumentApp,ScriptApp,LockService,UrlFetchApp,Logger,MimeType,ContentService,Date';
const domain=fs.readFileSync(path.join(root,'src/domain.js'),'utf8');
const generated=`// GENERATED from apps-script/Code.gs. Run npm run build. No runtime eval.\nexport function createCore(runtime){\nconst {${globals}}=runtime.globals;\n${native}\nconst FT_NATIVE_PREF_COLS=runtime.schema.EmployeePreferences,FT_NATIVE_BREAK_COLS=runtime.schema.ActivityBreakPolicies;\n${domain}\nreturn {${exports.join(',')},headers:FT_HEADERS};\n}\n`;
fs.mkdirSync(path.join(root,'dist/public'),{recursive:true});
fs.writeFileSync(path.join(root,'src/schema.json'),JSON.stringify(schemas,null,2)+'\n');
fs.writeFileSync(path.join(root,'dist/core.mjs'),generated);
const gateway=fs.readFileSync(path.join(repo,'cloudflare/worker.js'),'utf8');
fs.writeFileSync(path.join(root,'dist/push.mjs'),gateway.slice(gateway.indexOf('const PUSH_MAX_BATCH'),gateway.indexOf('async function pushInternal')).replace("kind:notification.kind||'MESSAGE'","kind:notification.kind||'MESSAGE',...(Number.isSafeInteger(notification.unreadCount)?{unreadCount:notification.unreadCount}:{})")+'\nexport {pushOne,pushConfigured};\n');
for(const file of fs.readdirSync(path.join(root,'src')))fs.copyFileSync(path.join(root,'src',file),path.join(root,'dist',file));
for(const file of ['index.html','sw.js','manifest.webmanifest','.nojekyll'])fs.copyFileSync(path.join(repo,file),path.join(root,'dist/public',file));
fs.cpSync(path.join(repo,'assets'),path.join(root,'dist/public/assets'),{recursive:true});
let html=fs.readFileSync(path.join(root,'dist/public/index.html'),'utf8');
html=html.replace("const FT_VISIBLE_VERSION='1.8.28'","const FT_VISIBLE_VERSION='2.1.0-preview'")
 .replace("credentials:'omit'","credentials:'same-origin'")
 .replace("body:JSON.stringify(request),cache:","body:JSON.stringify(request),cache:");
// Each user intent carries one idempotency key; no automatic retry of writes.
html=html.replace("headers:{'Content-Type':'application/json'},\n      body:JSON.stringify(request)","headers:{'Content-Type':'application/json','X-Request-Id':crypto.randomUUID()},\n      body:JSON.stringify(request)");
html=html.replace('<body>','<body><div style="padding:8px 16px;background:#7b431d;color:#fff;font:14px system-ui">FireTime Pro · Cloudflare-Testversion · getrennte Datenkopie</div>');
html=html.replace('const views={dashboard,customers,license,staff,time,reports,leave,work,standby,sick,availability,rules,settings,profile,messages:ftMessages_};','const views={dashboard,customers,license,staff,time,reports,totals:ftTotals_,leave,work,standby,sick,availability,rules,settings,profile,messages:ftMessages_};').replace("['Zeit & Berichte',['reports']]","['Zeit & Berichte',['reports','totals']]").replaceAll('Post/Aufgaben','Aufgaben').replaceAll('ungelesene Nachrichten','ungelesene Aufgaben').replaceAll('Kalender teilen & Einladungen','Haupt- und Mitarbeiterkalender').replaceAll('Im Kalender teilen & Einladungen senden','In Haupt- und Mitarbeiterkalender übertragen').replaceAll('Jedes Firmenlogo wird auch in die PDF-Monatsberichte übernommen.','Monats-PDFs enthalten scharfen Text und getrennte Abschnitte für Arbeit und Bereitschaft.');
html=html.replace('</head>','<style>'+fs.readFileSync(path.join(root,'ui/clarity.css'),'utf8')+'</style></head>').replace('</script></body>',fs.readFileSync(path.join(root,'ui/clarity.js'),'utf8')+'\n</script></body>');
fs.writeFileSync(path.join(root,'dist/public/index.html'),html);
const sw=fs.readFileSync(path.join(root,'dist/public/sw.js'),'utf8').replace(/firetime-shell-\d+-v\d+/g,'firetime-native-preview-v210');
fs.writeFileSync(path.join(root,'dist/public/sw.js'),sw);
fs.writeFileSync(path.join(root,'dist/public/config.js'),"window.FT_API_URL = location.origin + '/api';\n");
const actions=['taskUpdate','breakReview','reportSubmissions','tasksCreate','yearOverview','availabilityOverview','pdfVector','summaryPdf',...new Set([...source.slice(source.indexOf('function ft_api('),source.indexOf('function ft_workflowReady_(')).matchAll(/case '([^']+)'/g)].map(x=>x[1]))];
const manifest={version:'2.1.0-migration-candidate',sourceSha256:createHash('sha256').update(source).digest('hex'),tables:Object.keys(schemas),actions,overrides:Object.keys(overrides)};
fs.writeFileSync(path.join(root,'src/contract.json'),JSON.stringify(manifest,null,2)+'\n');
fs.copyFileSync(path.join(root,'src/contract.json'),path.join(root,'dist/contract.json'));
console.log(`Built native candidate: ${actions.length} actions, ${Object.keys(schemas).length} tables; production files unchanged.`);
