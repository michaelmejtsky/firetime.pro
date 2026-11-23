// Native-only product changes. Legacy accounting and import source remain intact.
function ft_employeePref_(u){return ft_absenceRows_('EmployeePreferences',FT_NATIVE_PREF_COLS,false).find(x=>x.companyId===u.companyId&&x.userId===u.id)||null;}
function ft_safe_(u){const out=ft_legacy_safe_(u),pref=ft_employeePref_(u);out.leaveHoursPerDay=pref?.leaveHoursPerDay===''?null:Number(pref?.leaveHoursPerDay)||null;out.calendarId=String(pref?.calendarId||'');return out;}
function ft_employeePrefSave_(actor,u,p){
 if(p.leaveHoursPerDay===undefined&&p.calendarId===undefined)return;
 const old=ft_employeePref_(u),hours=p.leaveHoursPerDay===undefined?(old?.leaveHoursPerDay??''):p.leaveHoursPerDay===''||p.leaveHoursPerDay===null?'':ft_number_(Number(String(p.leaveHoursPerDay).replace(',','.')),0.1,24,'Urlaubsstunden je Tag');
 const calendarId=p.calendarId===undefined?String(old?.calendarId||''):String(p.calendarId||'').trim();
 if(calendarId&&(!/^[^\s<>]+@[^\s<>]+$/.test(calendarId)||calendarId.length>250))throw Error('Bitte die persönliche Google-Kalender-ID eintragen, keinen Link.');
 const before=old?ft_publicRow_(old):{};
 const row={id:old?.id||'pref_'+ft_sha_(u.id),companyId:u.companyId,userId:u.id,leaveHoursPerDay:hours,calendarId,updatedBy:actor.id,updatedAt:ft_now_()};
 if(old){Object.assign(old,row);ft_absenceSave_('EmployeePreferences',FT_NATIVE_PREF_COLS,old);}else ft_absenceAdd_('EmployeePreferences',FT_NATIVE_PREF_COLS,row);
 ft_audit_(actor,'EMPLOYEE_PREFERENCES','EmployeePreferences',row.id,before,row);
}
function ft_userCreate_(actor,p){const result=ft_legacy_userCreate_(actor,p);const u=ft_one_('Users',result.user?.id);if(u){ft_employeePrefSave_(actor,u,p);result.user=ft_safe_(u);}return result;}
function ft_userUpdate_(actor,p){const result=ft_legacy_userUpdate_(actor,p);ft_employeePrefSave_(actor,ft_user_(actor,p.id),p);return ft_safe_(ft_user_(actor,p.id));}
function ft_commThreads_(){return ft_legacy_commThreads_().filter(x=>x.kind==='TASK');}
function ft_commCreate_(actor,p){if(p.kind!=='TASK')throw Error('Es können nur Aufgaben erstellt werden.');return ft_legacy_commCreate_(actor,p);}
function ft_tasksCreate_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_commCompany_(actor,p);
 if(!Array.isArray(p.recipientIds)||!p.recipientIds.length||p.recipientIds.length>50)throw Error('Bitte 1 bis 50 Mitarbeiter auswählen.');
 const ids=[...new Set(p.recipientIds.map(String))];if(ids.length!==p.recipientIds.length)throw Error('Mitarbeiter wurde doppelt ausgewählt.');
 for(const id of ids){const u=ft_user_(actor,id);if(u.companyId!==c.id||u.status!=='ACTIVE'||u.role!=='STAFF')throw Error('Mitarbeiterauswahl ist nicht zulässig.');}
 // Validate the whole recipient set before creating a task/file or queueing a notification.
 const threads=[];let sharedAttachment='';for(const id of ids){
  const r=ft_commCreate_(actor,{...p,photo:threads.length?undefined:p.photo,kind:'TASK',recipientId:id});
  if(!threads.length)sharedAttachment=r.thread.attachmentId||'';
  else if(sharedAttachment){const row=ft_commThread_(actor,r.thread.id);row.attachmentId=sharedAttachment;ft_absenceSave_('CommThreads',FT_COMM_THREAD_COLS_,row);r.thread=ft_commPublic_(row);ft_audit_(actor,'TASK_ATTACHMENT_SHARED','CommThreads',row.id,{}, {attachmentId:sharedAttachment});}
  threads.push(r.thread);
 }
 return {threads,created:threads.length,delivery:'QUEUED_IF_CONFIGURED'};
}
function ft_commTaskStatus_(actor,p){
 const t=ft_commThread_(actor,p.threadId),returned=t.status==='RETURNED';
 if(returned&&p.status==='ACCEPTED'){t.status='OPEN';ft_absenceSave_('CommThreads',FT_COMM_THREAD_COLS_,t);}
 const returning=['OPEN','RETURNED'].includes(String(p.status));
 const result=ft_legacy_commTaskStatus_(actor,{...p,status:returning?'OPEN':p.status});
 if(returning){const row=ft_commThread_(actor,p.threadId);row.status='RETURNED';ft_absenceSave_('CommThreads',FT_COMM_THREAD_COLS_,row);result.status='RETURNED';}
 return result;
}
function ft_nativeBreakPolicy_(actor,activity,mode,confirmed,minutes){
 const rows=ft_absenceRows_('ActivityBreakPolicies',FT_NATIVE_BREAK_COLS,false),old=rows.find(r=>r.activityId===activity.id&&r.companyId===activity.companyId);
 const before=old?ft_publicRow_(old):{};
 const row={id:old?.id||'break_'+ft_sha_(activity.id),companyId:activity.companyId,userId:activity.userId,activityId:activity.id,mode,confirmed:confirmed===true,minutes,reviewedBy:'',reviewedAt:'',reviewNote:'',updatedBy:actor.id,updatedAt:ft_now_()};
 if(old){Object.assign(old,row);ft_absenceSave_('ActivityBreakPolicies',FT_NATIVE_BREAK_COLS,old);}else ft_absenceAdd_('ActivityBreakPolicies',FT_NATIVE_BREAK_COLS,row);
 ft_audit_(actor,'BREAK_POLICY','Activities',activity.id,before,row);
}
function ft_activitySave_(actor,p,internalAllowPausePending){
 const mode=String(p.breakMode||'');
 if(!mode)return ft_legacy_activitySave_(actor,p,internalAllowPausePending);
 if(!['AUTO','MANUAL','NONE'].includes(mode))throw Error('Pausenart ungültig.');
 const start=ft_datetime_(p.start),end=ft_datetime_(p.end),duration=(end-start)/60000;
 let minutes=Number(p.breakMinutes||0);
 if(mode==='AUTO'){
  if(p.breakConfirmed!==true)throw Error('Bitte bestätigen, dass die automatisch berücksichtigte Pause tatsächlich genommen wurde.');
  if(duration>360)minutes=Math.max(minutes,30);
 }
 if(mode==='NONE'){
  if(p.breakConfirmed!==true)throw Error('Bitte die fehlende Pause ausdrücklich bestätigen.');minutes=0;
 }
 const result=ft_legacy_activitySave_(actor,{...p,breakMinutes:minutes},internalAllowPausePending||mode==='NONE'||mode==='MANUAL'&&minutes<30&&duration>360);
 ft_nativeBreakPolicy_(actor,result,mode,p.breakConfirmed,minutes);return {...result,breakMode:mode};
}
function ft_timerStop_(actor,p){
 const result=ft_legacy_timerStop_(actor,p);
 if(p.autoBreak===true){
  if(p.breakConfirmed!==true)throw Error('Tatsächlich genommene Pause bestätigen.');
  const activity=ft_one_('Activities',result.activity.id),duration=(new Date(activity.end)-new Date(activity.start))/60000;
  const minutes=duration>360?Math.max(Number(activity.breakMinutes)||0,30):Number(activity.breakMinutes)||0;
  if(minutes!==Number(activity.breakMinutes)){const before=ft_publicRow_(activity);activity.breakMinutes=minutes;activity.description=String(activity.description).replace(/ \[Pausenangabe offen – bitte nachtragen\]/g,'');ft_save_('Activities',activity);ft_audit_(actor,'BREAK_AUTO_CONFIRMED','Activities',activity.id,before,activity);}
  ft_nativeBreakPolicy_(actor,activity,'AUTO',true,minutes);result.activity=ft_publicRow_(activity);
 }
 return result;
}
function ft_hoursBasis_(c,u){
 const preference=ft_employeePref_(u);if(Number(preference?.leaveHoursPerDay)>0)return Number(preference.leaveHoursPerDay);
 const profile=ft_profileRows_().find(p=>p.companyId===c.id);
 return profile&&profile.workModel==='OFFICE'&&Number(profile.workHours)>0?Number(profile.workHours):null;
}
function ft_yearOverview_(actor,p){
 const c=ft_company_(actor,p.companyId||actor.companyId);ft_need_(actor,c,'REPORTS');
 const year=Number(p.year||ft_localDate_(new Date()).slice(0,4));if(!Number.isInteger(year)||year<2000||year>2100)throw Error('Gültiges Jahr auswählen.');
 const asOf=ft_month_(p.month||ft_localMonth_(new Date()));
 const users=ft_get_('Users').filter(u=>u.companyId===c.id&&u.role==='STAFF'&&(actor.role!=='STAFF'||u.id===actor.id));
 const source={Activities:ft_get_('Activities'),Shifts:ft_get_('Shifts'),ShiftSegments:ft_get_('ShiftSegments'),Leaves:ft_get_('Leaves'),Months:ft_get_('Months'),SickLeaves:ft_get_('SickLeaves')};
 const since=String(year)+'-01-01',until=String(year)+'-12-31',today=ft_localDate_(new Date());
 const employees=users.map(u=>{
  const start=ft_balanceStartMonth_(u),hire=String(u.startDate||since).slice(0,7),hoursBasis=ft_hoursBasis_(c,u),account=ft_leaveAccount_(u);
  const months=Array.from({length:12},(_,i)=>{
   const month=String(year)+'-'+String(i+1).padStart(2,'0'),row=source.Months.find(x=>x.companyId===c.id&&x.userId===u.id&&x.month===month);
   const tracked=month>=start&&month>=hire,report=ft_report_(c,u,month,true,source);
   return {month,tracked,status:row?.status||(month<start||month<hire?'NOT_TRACKED':'OPEN'),recordId:row?.id||'',future:month>ft_localMonth_(new Date()),target:tracked?Number(report.target)||0:0,worked:Number(report.worked)||0,standby:Number(report.standby)||0,credit:Number(report.leaveCredit||0)+Number(report.sickCredit||0),saldo:tracked?Number(report.saldo)||0:0};
  });
  const toDate=months.filter(m=>m.month<=asOf),sum=key=>ft_2_(toDate.reduce((s,m)=>s+Number(m[key]||0),0));
  const approved=source.Leaves.filter(l=>l.companyId===c.id&&l.userId===u.id&&['APPROVED','CANCEL_PENDING'].includes(l.status));
  const requested=source.Leaves.filter(l=>l.companyId===c.id&&l.userId===u.id&&l.status==='PENDING');
  const daysIn=(l,from,to)=>{const a=String(l.from)>from?String(l.from):from,b=String(l.to)<to?String(l.to):to;if(a>b)return 0;return ft_leaveFlexFor_(u).leaveWorkModel==='FLEX'?(a===String(l.from)&&b===String(l.to)?Number(l.days||0):null):ft_leaveDays_(u,a,b);};
  const countDays=(from,to)=>{const values=approved.map(l=>daysIn(l,from,to));return values.includes(null)?null:ft_2_(values.reduce((s,n)=>s+n,0));};
  const leaveYear=countDays(since,until),leaveMonth=countDays(asOf+'-01',ft_localDate_(new Date(+ft_monthBounds_(asOf)[1]-86400000)));
  const report=ft_report_(c,u,asOf,false,source),plannedMonths=months.filter(m=>m.month>=hire).length;
  return {user:{id:u.id,name:u.name,status:u.status,monthlyHours:Number(u.monthlyHours)||0},months,annualPlannedTarget:ft_2_(plannedMonths*Number(u.monthlyHours||0)),throughMonth:{target:sum('target'),worked:sum('worked'),standby:sum('standby'),credit:sum('credit'),saldo:sum('saldo')},runningBalance:Number(report.runningBalance)||0,
   leave:{balanceDays:account.totalBalance,balanceHours:hoursBasis===null?null:ft_2_(account.totalBalance*hoursBasis),hoursPerDay:hoursBasis,annualEntitlement:account.annualEntitlement,currentYearGranted:account.currentYearGrant,approvedYearDays:leaveYear,approvedMonthDays:leaveMonth,approvedYearHours:hoursBasis===null||leaveYear===null?null:ft_2_(leaveYear*hoursBasis),approvedMonthHours:hoursBasis===null||leaveMonth===null?null:ft_2_(leaveMonth*hoursBasis),pendingDays:ft_2_(requested.reduce((s,l)=>s+Number(l.days||0),0)),currentlyAway:approved.some(l=>l.from<=today&&l.to>=today),ledgerStatus:account.ledgerStatus}};
 });
 return {company:{id:c.id,name:c.name},year,month:asOf,employees,generatedAt:ft_now_(),targetNote:'Jahressoll als Planwert mit aktuellem Monatssoll ab Beschäftigungsbeginn. Laufender Saldo berücksichtigt den hinterlegten Abrechnungsbeginn.'};
}
function ft_reportSubmissions_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_company_(actor,p.companyId||actor.companyId);ft_need_(actor,c,'REPORTS');const month=ft_month_(p.month||ft_localMonth_(new Date())),[y,m]=month.split('-').map(Number),periods=Array.from({length:3},(_,i)=>Utilities.formatDate(new Date(y,m-1-i,1,12),FT_TZ,'yyyy-MM'));return {months:periods,employees:ft_get_('Users').filter(u=>u.companyId===c.id&&u.role==='STAFF').map(u=>({id:u.id,name:u.name,months:periods.map(month=>{const row=ft_get_('Months').find(r=>r.companyId===c.id&&r.userId===u.id&&r.month===month);return {month,status:row?.status||(month<ft_balanceStartMonth_(u)?'NOT_TRACKED':'OPEN'),recordId:row?.id||''};})}))};}
function ft_availabilityOverview_(actor,p){
 const c=ft_company_(actor,p.companyId||actor.companyId);ft_need_(actor,c,'AVAILABILITY');
 const center=ft_month_(p.month||ft_localMonth_(new Date())),[y,m]=center.split('-').map(Number);
 const periods=Array.from({length:6},(_,i)=>Utilities.formatDate(new Date(y,m-3+i,1,12),FT_TZ,'yyyy-MM'));
 const users=ft_get_('Users').filter(u=>u.companyId===c.id&&u.role==='STAFF'&&u.status==='ACTIVE'&&(actor.role!=='STAFF'||u.id===actor.id));
 return {periods,employees:users.map(u=>({id:u.id,name:u.name,months:periods.map(month=>{const done=ft_get_('AvailabilitySubmissions').find(s=>s.companyId===c.id&&s.userId===u.id&&s.month===month);const answers=ft_get_('Availability').filter(a=>a.companyId===c.id&&a.userId===u.id&&a.month===month);return {month,submitted:Boolean(done),submittedAt:done?.submittedAt||'',answered:answers.filter(a=>['YES','NO'].includes(a.answer)).length,days:ft_days_(month)};})}))};
}
function ft_reportApi_(actor,p){const result=ft_legacy_reportApi_(actor,p);result.entries=(result.entries||[]).map(a=>{const pref=ft_absenceRows_('ActivityBreakPolicies',FT_NATIVE_BREAK_COLS,false).find(x=>x.activityId===a.id&&x.companyId===a.companyId);return {...a,breakMode:pref?.mode||'MANUAL',breakConfirmed:pref?.confirmed===true};});return result;}
function ft_pushStatus_(actor){const result=ft_legacy_pushStatus_(actor);result.deliveryConfigured=Boolean(runtime.pushEnabled&&runtime.env.VAPID_PRIVATE_JWK&&runtime.env.VAPID_PUBLIC_KEY);return result;}
function ft_api(token,action,p){
 const actor=ft_auth_(token);p=p||{};
 if(runtime.env.CALENDAR_AUTH==='oauth'&&['companyUpdate','userUpdate','userCreate'].includes(action)&&(p.calendarId!==undefined||p.calendarOn!==undefined))throw Error('Kalender bitte im Bereich Google Kalender verbinden und speichern.');
 if(action==='reportSubmissions')return ft_reportSubmissions_(actor,p);
 if(action==='yearOverview')return ft_yearOverview_(actor,p);
 if(action==='availabilityOverview')return ft_availabilityOverview_(actor,p);
 if(action==='pdfVector')return ft_pdfVector_(actor,p);
 if(action==='summaryPdf')return ft_summaryPdf_(actor,p);
 if(action==='breakReview')return ft_breakReview_(actor,p);
 if(action==='taskUpdate'){const result=ft_taskUpdate_(actor,p);ft_personalCalendarSync_(actor,ft_company_(actor,p.companyId||actor.companyId));return result;}
 if(action==='tasksCreate'){const result=ft_lock_(()=>ft_tasksCreate_(actor,p));ft_personalCalendarSync_(actor,ft_company_(actor,p.companyId||actor.companyId));return result;}
 const result=ft_legacy_api(token,action,p);
 if(['commCreate','commTaskStatus','planCalendarShare','calendarResync','planAssign','planDelete','handoverRespond','userUpdate','userCreate'].includes(action)){
  const cid=actor.companyId||p.companyId||(p.id?ft_one_('Users',p.id)?.companyId:'');
  if(cid)ft_personalCalendarSync_(actor,ft_company_(actor,cid));
 }
 return result;
}
function ft_pdfVector_(actor,p){
 const c=ft_company_(actor,p.companyId||actor.companyId);ft_need_(actor,c,'REPORTS');
 const ids=p.bulk===true?(ft_allowed_(actor,['SYSADMIN','ADMIN']),p.userIds):[actor.role==='STAFF'?actor.id:String(p.userId||actor.id)];
 if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length)throw Error('Bitte 1 bis 50 Mitarbeiter auswählen.');
 const blocks=[],month=ft_month_(p.month),[from,to]=ft_monthBounds_(month),n=v=>(Number(v)||0).toLocaleString('de-AT',{minimumFractionDigits:2,maximumFractionDigits:2})+' h';
 let report=null;
 for(const id of ids){const user=ft_user_(actor,id);if(user.companyId!==c.id||user.role!=='STAFF')throw Error('Mitarbeiter ist nicht zulässig.');
  const out=ft_reportApi_(actor,{companyId:c.id,userId:id,month});report=report||out.report;
  if(blocks.length)blocks.push({kind:'pagebreak'});
  blocks.push({kind:'paragraph',text:c.name,size:18,bold:true},{kind:'paragraph',text:'MONATSBERICHT · '+month+' · '+user.name,size:13,bold:true},
   {kind:'table',rows:[['Monatssoll','Arbeitszeit','Monatssaldo'],[n(out.report.target),n(out.report.worked),n(out.report.saldo)]].map(r=>r.map(text=>({text})))},
   {kind:'paragraph',text:'ARBEITSZEIT',size:13,bold:true},{kind:'paragraph',text:'Tatsächlich erfasste Arbeit; Bereitschaft wird im folgenden Abschnitt getrennt ausgewiesen.',size:9});
  const rows=[['Datum / Beginn','Ende','Tätigkeit','Pause','Im Monat']];
  for(const a of out.entries){const total=ft_hours_(a.start,a.end),part=ft_overlap_(a.start,a.end,from,to),fraction=total?part/total:0;const choice=ft_activityTypesFor_(c).find(x=>x.id===a.activityOptionId);
   rows.push([Utilities.formatDate(new Date(a.start),FT_TZ,'dd.MM.yyyy HH:mm'),Utilities.formatDate(new Date(a.end),FT_TZ,'dd.MM.yyyy HH:mm'),choice?.label||({OBJECT:'Objektkontrolle',INCIDENT:'Bereitschaftseinsatz',OTHER:'Sonstige Arbeit'})[a.type],String(a.breakMinutes||0)+' Min.',n(Math.max(0,part-Number(a.breakMinutes||0)/60*fraction))]);
   if(a.object||a.description)rows.push([{text:[a.object,a.description].filter(Boolean).join(' · '),colspan:5}]);
  }
  if(rows.length===1)rows.push(['Keine Arbeitszeiten','','','','']);blocks.push({kind:'table',header:true,rows:rows.map((r,i)=>r.map((text,j)=>typeof text==='object'?text:({text,bold:i===0,keepWithNext:j===0&&rows[i+1]?.[0]?.colspan===5})))},
   {kind:'paragraph',text:'Arbeitszeit gesamt: '+n(out.report.worked)+' · Urlaubsgutschrift: '+n(out.report.leaveCredit)+' · Krankenstand: '+n(out.report.sickCredit),bold:true,size:10},
   {kind:'pagebreak'},{kind:'paragraph',text:c.name+' · '+user.name+' · '+month,size:13,bold:true},{kind:'paragraph',text:'BEREITSCHAFT',size:16,bold:true},
   {kind:'paragraph',text:'Nur bestätigte Dienste. Einsätze unterbrechen die Bereitschaft; Objektkontrollen laufen parallel.',size:10});
  const source={Shifts:ft_get_('Shifts'),ShiftSegments:ft_get_('ShiftSegments')},standby=[['Beginn','Ende','Dauer brutto','Einsatzabzug','Bereitschaft netto']];
  const incidents=ft_get_('Activities').filter(x=>x.companyId===c.id&&x.userId===user.id&&x.type==='INCIDENT');
  for(const s of ft_accountableShifts_(source).filter(x=>x.companyId===c.id&&x.userId===user.id&&x.status==='PUBLISHED'&&x.actualStatus==='DONE'&&ft_overlap_(x.start,x.end,from,to)>0)){
   const start=Math.max(+new Date(s.start),+from),end=Math.min(+new Date(s.end),+to),gross=(end-start)/3600000,net=ft_ruleSegments_(start,end,incidents).reduce((total,[a,b])=>total+(b-a)/3600000,0);
   standby.push([Utilities.formatDate(new Date(start),FT_TZ,'dd.MM.yyyy HH:mm'),Utilities.formatDate(new Date(end),FT_TZ,'dd.MM.yyyy HH:mm'),n(gross),n(gross-net),n(net)]);
  }
  if(standby.length===1)standby.push(['Keine bestätigten Dienste','','','','']);blocks.push({kind:'table',header:true,rows:standby.map((r,i)=>r.map(text=>({text,bold:i===0})))},{kind:'paragraph',text:'Bereitschaft netto gesamt: '+n(out.report.standby),size:12,bold:true},{kind:'paragraph',text:'Uhrzeiten: Europe/Vienna (MEZ/MESZ). Kein Lohnabrechnungsbeleg. FireTime Pro · Developed by Michael Mejtsky',size:9});
 }
 const result=runtime.vectorPdf(blocks);return {name:'FireTimePro_'+month+(p.bulk?'_Sammelbericht':'_Monatsbericht')+'.pdf',base64:Utilities.base64Encode(result.bytes),pages:result.pages,report,staffCount:ids.length};
}
function ft_summaryPdf_(actor,p){
 const data=ft_yearOverview_(actor,p),rows=p.userId?data.employees.filter(x=>x.user.id===String(p.userId)):data.employees;if(!rows.length)throw Error('Mitarbeiter nicht gefunden.');
 const blocks=[],h=x=>(Number(x)||0).toFixed(2)+' h';for(const e of rows){if(blocks.length)blocks.push({kind:'pagebreak'});blocks.push({kind:'paragraph',text:data.company.name,size:18,bold:true},{kind:'paragraph',text:e.user.name+' · Jahresübersicht '+data.year,size:14,bold:true},{kind:'paragraph',text:'Jahressoll (Plan): '+h(e.annualPlannedTarget)+' · Arbeitszeit bis '+data.month+': '+h(e.throughMonth.worked),size:11},
 {kind:'table',header:true,rows:[['Monat','Soll','Ist','Bereitschaft','Status'],...e.months.map(m=>[m.month,h(m.target),h(m.worked),h(m.standby),m.status])].map((r,i)=>r.map(text=>({text,bold:i===0})))},
 {kind:'paragraph',text:'Urlaubskonto',size:13,bold:true},{kind:'paragraph',text:'Gesamtrest: '+e.leave.balanceDays+' Tage'+(e.leave.balanceHours===null?' · Stundenbasis nicht festgelegt':' / '+h(e.leave.balanceHours)),size:11},{kind:'paragraph',text:'Genehmigt im Jahr: '+(e.leave.approvedYearDays===null?'Zeitraumzuordnung offen':e.leave.approvedYearDays+' Tage')+' · Im ausgewählten Monat: '+(e.leave.approvedMonthDays===null?'Zeitraumzuordnung offen':e.leave.approvedMonthDays+' Tage'),size:10},{kind:'paragraph',text:data.targetNote,size:9});}
 const result=runtime.vectorPdf(blocks);return {name:'FireTimePro_Jahresuebersicht_'+data.year+'.pdf',base64:Utilities.base64Encode(result.bytes),pages:result.pages};
}
function ft_objectPausePending_(row){
 if(!ft_legacy_objectPausePending_(row))return false;
 const policy=ft_absenceRows_('ActivityBreakPolicies',FT_NATIVE_BREAK_COLS,false).find(p=>p.activityId===row.id&&p.companyId===row.companyId);return !policy?.reviewedBy;
}
function ft_breakReview_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);const a=ft_one_('Activities',String(p.activityId||''));if(!a)throw Error('Arbeitszeit nicht gefunden.');ft_scope_(actor,a.companyId);
 const note=ft_str_(p.note,500);if(note.length<5)throw Error('Bitte Prüfergebnis dokumentieren.');
 let policy=ft_absenceRows_('ActivityBreakPolicies',FT_NATIVE_BREAK_COLS,false).find(x=>x.activityId===a.id&&x.companyId===a.companyId);
 if(!policy){ft_nativeBreakPolicy_(actor,a,'MANUAL',true,Number(a.breakMinutes)||0);policy=ft_absenceRows_('ActivityBreakPolicies',FT_NATIVE_BREAK_COLS,false).find(x=>x.activityId===a.id);}
 const before={...policy};Object.assign(policy,{reviewedBy:actor.id,reviewedAt:ft_now_(),reviewNote:note});ft_absenceSave_('ActivityBreakPolicies',FT_NATIVE_BREAK_COLS,policy);ft_audit_(actor,'BREAK_REVIEW','Activities',a.id,before,policy);return {ok:true,minutesUnchanged:Number(a.breakMinutes)||0};
}
function ft_taskUpdate_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);const t=ft_commThread_(actor,p.threadId);if(t.createdBy!==actor.id)throw Error('Nur der Auftraggeber kann die Aufgabe ändern.');
 const c=ft_company_(actor,t.companyId),before=ft_publicRow_(t);
 if(p.dueDate!==undefined){if(p.dueDate)ft_date_(String(p.dueDate));t.dueDate=String(p.dueDate||'');}
 if(p.title!==undefined){const title=ft_str_(p.title,120);if(title.length<3)throw Error('Titel ist zu kurz.');t.titleEncoded=ft_commEncode_(title);}
 if(p.body!==undefined){const body=ft_str_(p.body,3000);if(!body)throw Error('Beschreibung fehlt.');t.bodyEncoded=ft_commEncode_(body);}
 t.updatedAt=ft_commNextUpdateTime_(t);ft_absenceSave_('CommThreads',FT_COMM_THREAD_COLS_,t);ft_audit_(actor,'TASK_UPDATE','CommThreads',t.id,before,ft_publicRow_(t));return {thread:ft_commPublic_(t)};
}
function ft_personalCalendarSync_(actor,company){
 if(runtime.env.CALENDAR_ENABLED!=='true'||!ft_enabled_(company,'CALENDAR')||!ft_bool_(company.calendarOn))return {queued:0};
 const cols=runtime.schema.CalendarMirrors,all=ft_absenceRows_('CalendarMirrors',cols,false).filter(r=>r.companyId===company.id),desired=new Map();
 const users=ft_get_('Users').filter(u=>u.companyId===company.id&&u.status==='ACTIVE'&&u.role==='STAFF');
 const add=(u,type,id,data)=>{
  const calendarId=String(ft_employeePref_(u)?.calendarId||'');if(!calendarId)return;
  if(calendarId===company.calendarId&&type!=='TASK')return; // The main event already is in this calendar.
  const key='mirror_'+ft_sha_(company.id+'|'+u.id+'|'+type+'|'+id),eventId=ft_sha_(key+'|'+calendarId+'|'+ft_uuid_()),hash=ft_sha_(JSON.stringify(data));desired.set(key,{id:key,companyId:company.id,userId:u.id,sourceType:type,sourceId:id,calendarId,eventId,connectionKey:ft_employeePref_(u)?.calendarConnectionKey||'calendar:'+company.id,sourceHash:hash,status:'QUEUED',updatedAt:ft_now_(),data});
 };
 const shifts=ft_get_('Shifts').filter(s=>s.companyId===company.id&&s.status==='PUBLISHED');
 for(const shift of shifts){const parts=ft_segmentRows_(shift);for(const s of parts.length?parts:[shift]){
   const u=users.find(x=>x.id===s.userId),mainId=parts.length?s.calendarEventId:shift.eventId;if(!u||!mainId)continue;
   add(u,parts.length?'SEGMENT':'SHIFT',s.id,{summary:'Bereitschaft – '+u.name,start:{dateTime:new Date(s.start).toISOString(),timeZone:FT_TZ},end:{dateTime:new Date(s.end).toISOString(),timeZone:FT_TZ},description:'Bereitschaft laut FireTime Pro. '+ft_clientUrl_(company),reminders:{useDefault:false,overrides:[{method:'popup',minutes:1440}]}});
  }}
 for(const task of ft_commThreads_().filter(t=>t.companyId===company.id&&t.dueDate&&t.status!=='CLOSED')){
  const u=users.find(x=>x.id===task.recipientId);if(!u)continue;
  const day=ft_date_(task.dueDate),next=new Date(day);next.setDate(next.getDate()+1);
  const status={OPEN:'Neu',ACCEPTED:'Angenommen',DONE:'Erledigt – Kontrolle offen',RETURNED:'Zurückgesendet'}[task.status]||task.status;
  add(u,'TASK',task.id,{summary:'Aufgabe fällig: '+ft_commDecode_(task.titleEncoded)+' ['+status+']',start:{date:task.dueDate},end:{date:ft_localDate_(next)},description:'Aufgabenfrist · '+status+'\nDetails und Dokumentation in FireTime Pro: '+ft_clientUrl_(company),reminders:{useDefault:false,overrides:[{method:'popup',minutes:540}]}});
 }
 let queued=0;
 for(const old of all.slice().sort((a,b)=>b.__row-a.__row))if(!desired.has(old.id)||desired.get(old.id).calendarId!==old.calendarId||(desired.get(old.id).connectionKey!==(old.connectionKey||'calendar:'+company.id))){
  runtime.enqueue('calendar',{companyId:company.id,userId:old.userId,connectionKey:old.connectionKey||'calendar:'+company.id,calendarId:old.calendarId,eventId:old.eventId,delete:true,mirrorId:old.id,mirrorHash:old.sourceHash});
  ft_absenceSheet_('CalendarMirrors',cols,false).deleteRow(old.__row);queued++;
 }
 // Reload after deletions: legacy row indices may have moved.
 for(const value of desired.values()){
  const existing=ft_absenceRows_('CalendarMirrors',cols,false).find(r=>r.id===value.id);
  if(existing&&existing.calendarId===value.calendarId&&existing.sourceHash===value.sourceHash)continue;
  // Keep an active event ID for edits. A new lifecycle gets a fresh ID because Google retains deleted-event tombstones.
  if(existing)value.eventId=existing.eventId;
  runtime.enqueue('calendar',{companyId:company.id,userId:value.userId,connectionKey:value.connectionKey,calendarId:value.calendarId,eventId:value.eventId,create:!existing,data:value.data,mirrorId:value.id,mirrorHash:value.sourceHash});
  const {data,...row}=value;if(existing){Object.assign(existing,row);ft_absenceSave_('CalendarMirrors',cols,existing);}else ft_absenceAdd_('CalendarMirrors',cols,row);queued++;
 }
 return {queued};
}
function ft_tick(){const result=ft_legacy_tick();if(runtime.env.CALENDAR_ENABLED==='true')for(const c of ft_get_('Companies').filter(x=>ft_bool_(x.active)))ft_personalCalendarSync_({id:'SYSTEM',role:'SYSADMIN'},c);return result;}

function ft_nativeInitialize_(p){
 if(ft_get_('Users').length||ft_get_('Companies').length||runtime.properties.has('FT_NATIVE_INITIALIZED'))throw Error('System ist bereits eingerichtet.');
 const salt=ft_rand_(),admin={id:ft_uuid_(),companyId:'',role:'SYSADMIN',name:'Michael Mejtsky',email:ft_email_(p.email),status:'ACTIVE',passwordHash:ft_password_(p.password,salt),salt,monthlyHours:0,hourlyRate:0,leaveEntitlement:0,leaveBalance:0,openingHours:0,startDate:'',workdays:'1,2,3,4,5',mustChange:false,createdAt:ft_now_()};
 ft_add_('Users',admin);
 const company=ft_companyCreate_(admin,{name:'BSB3100',slug:'bsb3100',color:'#ff784f'});
 ft_licenseSave_(admin,{companyId:company.id,modules:['TIME','REPORTS','LEAVE','WORKPLAN','STANDBY','AVAILABILITY','CALENDAR']});
 ft_profileSave_(admin,{companyId:company.id,workModel:'FLEX',workStart:'08:00',workHours:8,workdays:'1,2,3,4,5',standbyStart:'07:00',standbyHours:24,secondaryColor:'#19354d',welcomeText:''});
 if(p.publicUrl)PropertiesService.getScriptProperties().setProperty('FT_PUBLIC_GITHUB_URL',p.publicUrl);
 PropertiesService.getScriptProperties().setProperty('FT_NATIVE_INITIALIZED',ft_now_());
 ft_audit_(admin,'NATIVE_FIRST_START','Users',admin.id,{}, {email:admin.email,companyId:company.id});
 return {email:admin.email,companyId:company.id,initialized:true};
}

function ft_calendarSelectionSave_(actor,p){
 const company=ft_company_(actor,p.companyId);ft_need_(actor,company,'CALENDAR');
 if(p.userId){
  const user=ft_user_(actor,p.userId);if(user.companyId!==company.id||(actor.role==='STAFF'&&actor.id!==user.id))throw Error('Kein Zugriff auf diesen Mitarbeiter.');
  ft_employeePrefSave_(actor,user,{calendarId:p.calendarId});const pref=ft_employeePref_(user);pref.calendarConnectionKey=p.connectionKey||'';ft_absenceSave_('EmployeePreferences',FT_NATIVE_PREF_COLS,pref);
 }else{
  ft_allowed_(actor,['SYSADMIN','ADMIN']);
  if(company.calendarId&&company.calendarId!==p.calendarId&&(ft_get_('Shifts').some(x=>x.companyId===company.id&&x.eventId)||ft_get_('ShiftSegments').some(x=>x.companyId===company.id&&x.calendarEventId)||ft_get_('WorkShifts').some(x=>x.companyId===company.id&&x.calendarEventId)))throw Error('Der Hauptkalender enthält bereits übertragene FireTime-Termine. Bitte zuerst den bisherigen Kalenderabgleich bereinigen lassen.');
  ft_companyUpdate_(actor,{id:company.id,calendarId:p.calendarId,calendarOn:Boolean(p.calendarId)});
 }
 ft_personalCalendarSync_(actor,company);return {saved:true,calendarId:p.calendarId};
}
