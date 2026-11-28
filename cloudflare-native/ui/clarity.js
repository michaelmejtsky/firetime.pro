// Product redesign layer for the isolated Cloudflare app.
const FT_CLARITY_OLD={nav,mobileNav,page,action,submit,api,time,staff,reports,leave,availability,rules,settings,ftMessages_,ftLocalPdf,ftTimerPanel_,ftAbsencePanel_,ftCommUpdateLocalTask_,ftStandbySections_,ftActivityPicker_};
const FT_CLARITY_CACHE=new Map(),FT_CLARITY_PENDING=new Set();
const FT_CLARITY_READS=new Set(['storageStatus','driveStorageTest','yearOverview','availabilityOverview','pdfVector','summaryPdf','reportSubmissions']);
LABELS.messages='Aufgaben';LABELS.totals='Gesamtstunden';
const uiHours=n=>ftReportHours_(Number(n)||0)+' h';
const uiDate=s=>E(ftLeaveDate(String(s||'').slice(0,10)));
const uiFold=(title,body,open=false,id='')=>'<details class="ui-fold"'+(open?' open':'')+(id?' id="'+E(id)+'"':'')+'><summary>'+title+'</summary><div class="ui-fold-body">'+body+'</div></details>';
const uiButton=(label,act,id='',primary=false)=>'<button type="button" class="btn'+(primary?' primary':'')+'" data-act="ui:'+act+'" data-id="'+E(id)+'">'+label+'</button>';
const uiTabs=(name,items,selected)=>'<div class="ui-tabs" role="tablist">'+items.map(([key,label,count])=>'<button role="tab" aria-selected="'+(key===selected)+'" type="button" class="'+(key===selected?'on':'')+'" data-act="ui:tab" data-key="'+E(name)+'" data-id="'+E(key)+'">'+E(label)+(count===undefined?'':'<span class="ui-count">'+count+'</span>')+'</button>').join('')+'</div>';
const uiKpis=rows=>'<div class="ui-kpis">'+rows.map(([label,value])=>'<div class="ui-kpi"><span>'+E(label)+'</span><strong>'+E(value)+'</strong></div>').join('')+'</div>';
function uiCacheKey(type,p){return [ST.token,firm()?.id,me()?.id,type,JSON.stringify(p)].join('|');}
function uiRemote(type,p,render,id){
 const key=uiCacheKey(type,p),cached=FT_CLARITY_CACHE.get(key);
 if(!cached||Date.now()-cached.at>60000){if(!FT_CLARITY_PENDING.has(key)){FT_CLARITY_PENDING.add(key);Promise.resolve().then(async()=>{
  try{const value=await api(type,p);if(uiCacheKey(type,p)!==key)return;FT_CLARITY_CACHE.set(key,{at:Date.now(),value});const target=document.getElementById(id);if(target?.dataset.key===key)target.innerHTML=render(value);}
  catch(err){const target=document.getElementById(id);if(target?.dataset.key===key)target.innerHTML='<p class="ui-note">'+E(err.message||err)+'</p>'+uiButton('Erneut versuchen','refresh');}
  finally{FT_CLARITY_PENDING.delete(key);}
 });}}
 return '<div id="'+id+'" data-key="'+E(key)+'">'+(cached?render(cached.value):'<div class="ui-empty" role="status">Übersicht wird geladen …</div>')+'</div>';
}
api=function(action,p={}){
 const promise=FT_CLARITY_READS.has(action)?rpc('ft_api',ST.token,action,p):FT_CLARITY_OLD.api(action,p);
 const reads=new Set(['home','adminOverview','profileGet','licenseGet','activityTypesGet','commList','commPulse','commPhoto','pushStatus','planWorkflow','shiftPeriodSummary','leaveAccount','absenceHistory','absencePdfArchive','absencePdfChunk','report','pdfJobStatus','pdfArchive','pdfChunk','pdfBatchArchive','pdfBatchChunk','rulesGet','calendarTest','audit','timerStatus']);
 return promise.then(result=>{if(!reads.has(action)&&!FT_CLARITY_READS.has(action))FT_CLARITY_CACHE.clear();return result;});
};
nav=function(){const items=FT_CLARITY_OLD.nav();if(firm()&&has('REPORTS'))items.splice(items.indexOf('reports')+1,0,'totals');return items;};
function uiTaskLabel(status){return {OPEN:'Neu',ACCEPTED:'Angenommen',DONE:'Erledigt',CLOSED:'Abgeschlossen',RETURNED:'Zur Aufgabe zurückgesendet'}[status]||status;}
ftTaskStatusLabel_=uiTaskLabel;
ftCommUpdateLocalTask_=function(id,status,result){return FT_CLARITY_OLD.ftCommUpdateLocalTask_(id,result?.status||status,result);};
function uiTaskDetail(task,data){
 const person=id=>E((data.users||[]).find(u=>u.id===id)?.name||'Mitarbeiter'),replies=(data.replies||[]).filter(r=>r.threadId===task.id).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
 let html='<p>'+E(task.body)+'</p><p class="ui-caption">'+person(task.createdBy)+' · Erstellt '+E(ftViennaDateTime(task.createdAt))+(task.dueDate?' · Fällig '+uiDate(task.dueDate):'')+'</p>'+ftCommPhotoButton_(task.attachmentId,task.id);
 if(task.recipientId===me().id&&['OPEN','RETURNED'].includes(task.status))html+='<div class="actions"><button type="button" class="btn primary" data-act="commAccept" data-id="'+E(task.id)+'">Aufgabe annehmen</button></div>';
 if(task.recipientId===me().id&&task.status==='ACCEPTED')html+='<form id="ftCommCompleteForm" data-thread="'+E(task.id)+'"><h3>Durchführung melden</h3><label class="field"><span>Dokumentationsfoto</span><input type="file" name="photo" accept="image/jpeg,image/png" required></label><label class="field"><span>Bemerkung (optional)</span><textarea name="note" rows="2" maxlength="1000"></textarea></label><button type="submit" class="btn primary">Als erledigt zur Kontrolle senden</button></form>';
 if(isAdmin()&&task.createdBy===me().id&&task.status==='DONE')html+='<div class="actions"><button type="button" class="btn primary" data-act="commClose" data-id="'+E(task.id)+'">Abschließen</button><button type="button" class="btn" data-act="commReopen" data-id="'+E(task.id)+'">Zur Bearbeitung zurücksenden</button></div>';
 if(task.status==='RETURNED')html+='<p class="ui-note">Die Aufgabe wurde zur Überarbeitung zurückgesendet. Der Grund steht im Verlauf.</p>';
 html+=uiFold('Verlauf ('+replies.length+')',replies.map(r=>'<div class="ft-msg-reply"><b>'+person(r.authorId)+'</b><p>'+E(r.body)+'</p><small>'+E(ftViennaDateTime(r.createdAt))+'</small>'+ftCommPhotoButton_(r.attachmentId,task.id)+'</div>').join('')||'<p>Noch keine Einträge.</p>');
 if(isAdmin()&&task.createdBy===me().id)html+=uiFold('Titel und Frist bearbeiten','<form id="uiTaskEditForm" data-thread="'+E(task.id)+'">'+input('Titel','title',task.title,'text','required minlength="3" maxlength="120"')+input('Zu erledigen bis','dueDate',task.dueDate||'','date')+'<button type="submit" class="btn">Änderungen speichern</button></form>');
 if(task.status!=='CLOSED')html+=uiFold('Rückfrage zur Aufgabe','<form id="ftCommReplyForm" data-thread="'+E(task.id)+'"><label class="field"><span>Rückfrage / Information</span><textarea name="body" rows="2" maxlength="3000" required></textarea></label><label class="field"><span>Anhang (optional)</span><input type="file" name="photo" accept="image/jpeg,image/png,application/pdf"></label><button type="submit" class="btn">Zur Aufgabe senden</button></form>');
 return html;
}
ftMessages_=function(){
 ST.commSection='TASK';const data=ST.comm;
 if(!data)return '<section class="card"><h2>Aufgaben</h2><p>'+(ST.commError?E(ST.commError):'Aufgaben werden geladen …')+'</p><button class="btn" data-act="commRefresh">Aktualisieren</button></section>';
 const tasks=(data.threads||[]).filter(t=>t.kind==='TASK'),manager=isAdmin();
 const filter=ST.uiTaskFilter||'OPEN',matches=(t,s)=>s==='OPEN'&&manager?['OPEN','RETURNED'].includes(t.status):t.status===s;
 const states=manager?[['OPEN','Neu'],['ACCEPTED','Angenommen'],['DONE','Erledigt'],['CLOSED','Abgeschlossen']]:[['OPEN','Neu'],['ACCEPTED','Angenommen'],['DONE','Erledigt'],['RETURNED','Zurückgesendet']];
 const list=rows=>rows.map(task=>'<details class="ui-task" data-state="'+E(task.status)+'" data-task="'+E(task.id)+'"'+(ST.commOpen===task.id?' open':'')+'><summary><span><span class="ui-task-title">'+E(task.title)+'</span><span class="ui-task-meta">'+(manager?E((data.users||[]).find(u=>u.id===task.recipientId)?.name||'Mitarbeiter')+' · ':'')+(task.dueDate?'Fällig '+uiDate(task.dueDate):'Ohne Frist')+'</span></span><span class="ui-task-status">'+uiTaskLabel(task.status)+'</span></summary><div class="ui-task-body">'+uiTaskDetail(task,data)+'</div></details>').join('')||'<div class="ui-empty">Keine Aufgaben in diesem Reiter.</div>';
 let composer='';if(manager&&ST.commCompose)composer='<section class="card"><h2>Aufgabe zuordnen</h2><form id="uiTaskCreateForm"><label class="field"><span>Titel</span><input name="title" maxlength="120" minlength="3" required></label><label class="field"><span>Was ist zu erledigen?</span><textarea name="body" rows="3" maxlength="3000" required></textarea></label><h3>Mitarbeiter auswählen</h3><div class="ui-people">'+(data.recipients||[]).map(u=>'<label><input type="checkbox" name="recipientIds" value="'+E(u.id)+'">'+E(u.name)+'</label>').join('')+'</div><p class="ui-caption">Jede ausgewählte Person erhält eine Aufgabe mit eigenem Fortschritt.</p><div class="cols">'+input('Zu erledigen bis (optional)','dueDate','','date')+'<label class="field"><span>Anhang (optional)</span><input type="file" name="photo" accept="image/jpeg,image/png,application/pdf"></label></div><div class="actions"><button type="submit" class="btn primary">Aufgabe zuordnen</button><button type="button" class="btn" data-act="commCloseCompose">Abbrechen</button></div></form></section>';
 return '<div class="ui-toolbar"><div><h2>'+(manager?'Aufgaben verwalten':'Meine Aufgaben')+'</h2><p class="ui-caption">Aufgabe antippen, um Informationen und Bearbeitung zu öffnen.</p></div><div>'+uiButton('Aktualisieren','tasksRefresh')+(manager?uiButton('Aufgabe erstellen','taskNew','',true):'')+'</div></div>'+composer+uiTabs('uiTaskFilter',states.map(([s,l])=>[s,l,tasks.filter(t=>matches(t,s)).length]),filter)+list(tasks.filter(t=>matches(t,filter)))+(!manager?uiFold('Abgeschlossene Aufgaben ('+tasks.filter(t=>t.status==='CLOSED').length+')',list(tasks.filter(t=>t.status==='CLOSED'))):'');
};
function uiYearSelect(){const year=Number(ST.uiYear||ST.month.slice(0,4)),current=new Date().getFullYear();return select('uiYear','Jahr',Array.from({length:current-1999+1},(_,i)=>[String(current+1-i),String(current+1-i)]),String(year));}
function uiStatus(status){const label={OPEN:'Noch nicht eingereicht',SUBMITTED:'Eingereicht',APPROVED:'Freigegeben',FINAL:'Abgeschlossen',RETURNED:'Zurückgegeben',NOT_TRACKED:'Vor Abrechnungsbeginn'}[status]||status;return '<span class="ui-pill '+(['APPROVED','FINAL'].includes(status)?'ok':status==='SUBMITTED'?'warn':status==='OPEN'||status==='RETURNED'?'bad':'neutral')+'">'+E(label)+'</span>';}
function uiYearData(render,id='uiYearOverview'){const year=Number(['totals','leave'].includes(ST.tab)?ST.uiYear||ST.month.slice(0,4):ST.month.slice(0,4));return uiRemote('yearOverview',{companyId:firm().id,year,month:String(year)+ST.month.slice(4)},render,id);}
function ftTotals_(){
 return '<div class="ui-toolbar"><div><h2>'+(isAdmin()?'Gesamtstunden & Urlaub':'Meine Jahresübersicht')+'</h2><p class="ui-caption">Arbeitszeit, Bereitschaft und Urlaub getrennt im Überblick.</p></div>'+uiYearSelect()+'</div>'+uiYearData(data=>{
  const people=data.employees||[],sum=k=>people.reduce((s,e)=>s+Number(e.throughMonth[k]||0),0);
  const body=uiKpis([['Arbeitszeit bis '+data.month,uiHours(sum('worked'))],['Soll bis '+data.month,uiHours(sum('target'))],['Bereitschaft separat',uiHours(sum('standby'))],['Monatliche Konten',people.length]])+
   '<section class="card"><h3>'+(isAdmin()?'Alle Mitarbeiter':'Mein Stundenkonto')+'</h3><div class="table"><table><thead><tr><th>Name</th><th>Jahressoll (Plan)</th><th>Ist bis '+E(data.month)+'</th><th>Bereitschaft</th><th>Gesamtsaldo</th><th>Resturlaub</th><th></th></tr></thead><tbody>'+people.map(e=>'<tr><td>'+E(e.user.name)+'</td><td>'+uiHours(e.annualPlannedTarget)+'</td><td>'+uiHours(e.throughMonth.worked)+'</td><td>'+uiHours(e.throughMonth.standby)+'</td><td>'+uiHours(e.runningBalance)+'</td><td>'+N(e.leave.balanceDays)+' Tage'+(e.leave.balanceHours===null?'':' / '+uiHours(e.leave.balanceHours))+'</td><td>'+uiButton('Details','person',e.user.id)+'</td></tr>').join('')+'</tbody></table></div><p class="ui-caption">'+E(data.targetNote)+'</p></section>';
  const selected=people.find(e=>e.user.id===(ST.uiPerson||me().id))||people[0];return body+(selected?uiFold('Jahresdetails · '+E(selected.user.name),'<div class="actions">'+uiButton('Jahresübersicht als PDF','annualPdf',selected.user.id)+'</div>'+uiYearMonths(selected),Boolean(ST.uiPerson)):'');
 });
}
function uiYearMonths(employee){return '<div class="table"><table><tr><th>Monat</th><th>Soll</th><th>Arbeitszeit</th><th>Bereitschaft</th><th>Abgabe</th></tr>'+employee.months.map(m=>'<tr><td>'+E(ftPdfMonthLabel(m.month))+'</td><td>'+uiHours(m.target)+'</td><td>'+uiHours(m.worked)+'</td><td>'+uiHours(m.standby)+'</td><td>'+uiStatus(m.status)+'</td></tr>').join('')+'</table></div>';}
ftActivityPicker_=function(type,id,timer=false){
 const items=ftDirectActivityOptions_().map(([value,label])=>[value,String(label).replace(/^Wartung\s*[-–:/]?\s*RWA.*$/i,'Wartung RWA')]);
 const value=String(type||'OBJECT')+'|'+String(id||'');if(!items.some(x=>x[0]===value))items.push([value,'Bisherige Tätigkeit']);
 return select(timer?'timerActivity':'activitySelection','Tätigkeit',items,value);
};
ftTimePauseCheckForm_=()=>true;
time=function(){
 const rows=(ST.h.activities||[]).filter(x=>x.start.slice(0,7)===ST.month||x.end.slice(0,7)===ST.month),edit=rows.find(x=>x.id===ST.edit);
 let form='<form id="uiTimeForm"><input type="hidden" name="id" value="'+E(edit?.id||'')+'"><div class="cols">'+(isAdmin()?optionsUsers('userId',edit?.userId||ST.selected||''):'')+ftActivityPicker_(edit?.type||'OBJECT',edit?.activityOptionId||'')+input('Beginn / tatsächliche Abfahrt','start',edit?stampInput(edit.start):ftTimeToday_()+'T08:00','datetime-local','required')+input('Ende / Rückkehr','end',edit?stampInput(edit.end):ftTimeToday_()+'T09:00','datetime-local','required')+'</div>'+
  '<label class="cbox"><input type="checkbox" name="autoBreak"'+(!edit?' checked':'')+'><span>30 Minuten Pause automatisch berücksichtigen, wenn die Dauer mehr als 6 Stunden beträgt.<small style="display:block">Mit dem Speichern bestätige ich, dass diese Pause tatsächlich genommen wurde.</small></span></label>'+
  uiFold('Pause selbst erfassen / keine Pause',input('Tatsächlich genommene Pause (Minuten)','breakMinutes',edit?.breakMinutes||0,'number','min="0" max="1440" step="1"')+'<p class="ui-caption">Manuelle Pausen werden berücksichtigt und nicht doppelt abgezogen. Ohne Pause die Automatik ausschalten und 0 Minuten eintragen.</p>')+
  uiFold('Ort und Beschreibung (optional)',input('Objekt / Einsatzort','object',edit?.object||'')+'<label class="field"><span>Beschreibung</span><textarea name="description" rows="2">'+E(edit?.description||'')+'</textarea></label>')+
  '<div class="actions"><button class="btn primary" type="submit">Arbeitszeit speichern</button>'+(edit?'<button class="btn" type="button" data-act="cancelEdit">Abbrechen</button>':'')+'</div></form>';
 const list=rows.slice().sort((a,b)=>String(b.start).localeCompare(String(a.start))).map(x=>'<details class="ui-task"><summary><span><span class="ui-task-title">'+ftTimeLabel_(x)+'</span><span class="ui-task-meta">'+uiDate(x.start)+' · '+E((isAdmin()?who(x.userId).name+' · ':'')+uiHours(Math.max(0,(new Date(x.end)-new Date(x.start))/3600000-Number(x.breakMinutes||0)/60)))+'</span></span></summary><div class="ui-task-body">'+ftTimeRange_(x)+'<p>'+E(x.object||'')+'</p><p>'+E(x.description||'')+'</p>'+ftTimePauseWarning_(x)+(isAdmin()&&ftTimePauseRequired_(x.type,x.start,x.end)&&Number(x.breakMinutes||0)<30?uiButton('Pausenabweichung prüfen','breakReview',x.id):'')+'<div class="actions"><button class="btn" data-act="editTime" data-id="'+E(x.id)+'">Bearbeiten</button><button class="btn danger" data-act="deleteTime" data-id="'+E(x.id)+'">Löschen</button></div></div></details>').join('');
 return monthPick()+uiFold('Arbeitszeit starten / beenden',ftTimerPanel_(),Boolean(ST.h.runningTimer))+uiFold(edit?'Arbeitszeit bearbeiten':'Arbeitszeit manuell erfassen',form,Boolean(edit))+'<section class="card"><h2>Arbeitszeiten · '+E(ftPdfMonthLabel(ST.month))+'</h2><p class="ui-caption">Nur Einträge dieses Monats. Jahres- und Gesamtsalden findest du unter „Gesamtstunden“.</p><div class="ui-time-list">'+(list||'<div class="ui-empty">Noch keine Arbeitszeiten erfasst.</div>')+'</div></section>';
};
ftTimerPanel_=function(){let html=FT_CLARITY_OLD.ftTimerPanel_().replace('Nur tatsächlich gestartete und beendete Pausen werden abgezogen.','Gestempelte oder beim Beenden ausdrücklich bestätigte Pausen zählen.');if(ST.h?.runningTimer)html=html.replace('<div class="ft-clock-actions">','<label class="cbox"><input type="checkbox" id="uiTimerAutoBreak"><span>30 Minuten tatsächlich genommene Pause ergänzen (bei mehr als 6 Stunden; vorhandene Pausen zählen mit).</span></label><div class="ft-clock-actions">');return html;};
staff=function(){
 const html=FT_CLARITY_OLD.staff();if(!html)return html;const template=document.createElement('template');template.innerHTML=html;
 const form=template.content.querySelector('#staffForm');if(!form)return html;
 const card=form.closest('.card'),basic=document.createElement('div'),advanced=document.createElement('details');basic.className='ui-basic-fields';advanced.className='ui-fold';advanced.innerHTML='<summary>Weitere Angaben und Urlaubsregelung</summary><div class="ui-fold-body"></div>';
 const keep=['name','email','monthlyHours','hourlyRate','leaveBalance','leaveEntitlement'];
 for(const key of keep){const field=form.querySelector('[name="'+key+'"]')?.closest('label');if(field)basic.appendChild(field);}
 const current=myUsers().find(u=>u.id===ST.edit);basic.insertAdjacentHTML('beforeend','<p class="ui-caption">Kalender zuordnen: Firmenprofil → Google Kalender. Mitarbeiter können unter Mein Konto ihren eigenen Google-Kalender verbinden.</p>'+input('Urlaubsstunden je Tag (nur wenn vereinbart)','leaveHoursPerDay',current?.leaveHoursPerDay??'','text','inputmode="decimal"'));
 const controls=[...form.children].filter(x=>x.tagName==='BUTTON'||x.tagName==='INPUT'&&x.type==='hidden');const body=advanced.querySelector('.ui-fold-body');for(const child of [...form.children])if(!controls.includes(child))body.appendChild(child);
 form.prepend(basic);form.appendChild(advanced);for(const control of controls)form.appendChild(control);
 for(const note of form.querySelectorAll('.ft-staff-leave-opening-note,.ft-balance-start-help'))body.appendChild(note);
 for(const span of basic.querySelectorAll('label>span:first-child')){const key=span.closest('label').querySelector('[name]')?.name;const labels={monthlyHours:'Monatsstunden (Soll)',hourlyRate:'Verdienst je Arbeitsstunde (€)',leaveBalance:'Aktueller Resturlaub (Tage)',leaveEntitlement:'Urlaubsanspruch pro Jahr (Tage)'};if(labels[key])span.textContent=labels[key];}
 const details=document.createElement('details');details.className='ui-fold';details.open=Boolean(ST.edit||ST.uiStaffNew);details.innerHTML='<summary>'+(ST.edit?'Mitarbeiter bearbeiten':'Mitarbeiter anlegen')+'</summary><div class="ui-fold-body"></div>';card.replaceWith(details);details.querySelector('div').append(card);
 return template.innerHTML;
};
function uiMonthlyReport(snapshot,user){
 const r=snapshot.report;ST.h.reports??={};ST.h.reports[user.id]=r;
 const state=(ST.h.months||[]).find(x=>x.userId===user.id&&x.month===ST.month);
 return '<h3>'+E(user.name)+' · '+E(ftPdfMonthLabel(ST.month))+'</h3>'+uiKpis([['Monatssoll',uiHours(r.target)],['Arbeitszeit',uiHours(r.worked)],['Monatssaldo',uiHours(r.saldo)],['Bereitschaft separat',uiHours(r.standby)]])+uiStatus(state?.status||'OPEN')+
 '<div class="actions">'+(!state||state.status==='RETURNED'?'<button class="btn primary" data-act="submitMonth">Monat einreichen</button>':'')+(isAdmin()&&state?.status==='SUBMITTED'?'<button class="btn primary" data-act="approveMonth" data-id="'+E(state.id)+'">Freigeben</button><button class="btn" data-act="returnMonth" data-id="'+E(state.id)+'">Zurückgeben</button>':'')+'<button class="btn primary" data-act="pdfSave">PDF erstellen und speichern</button><button class="btn" data-act="pdfLocal">PDF herunterladen</button><button class="btn" data-act="pdfArchive">PDF-Archiv</button></div>'+uiFold('Monatsdetails',uiKpis([['Objektkontrollen',uiHours(r.object)],['Einsätze',uiHours(r.incident)],['Sonstige Arbeit',uiHours(r.other)],['Urlaubs-/Krankenstandsgutschrift',uiHours(Number(r.leaveCredit||0)+Number(r.sickCredit||0))]]))+'<div id="ftPdfArchive" aria-live="polite"></div>';
}
reports=function(){
 const users=isAdmin()?myUsers().filter(u=>u.role==='STAFF'):[me()];if(!users.length)return '<div class="card">Noch keine Mitarbeiterkonten vorhanden.</div>';
 const selected=users.find(u=>u.id===ST.selected)||users[0];ST.selected=selected.id;
 const review=isAdmin()?uiFold('Abgaben · letzte drei Monate',uiRemote('reportSubmissions',{companyId:firm().id,month:ST.month},data=>'<div class="table ui-month-review"><table><tr><th>Mitarbeiter</th>'+data.months.map(m=>'<th>'+E(ftPdfMonthLabel(m))+'</th>').join('')+'</tr>'+data.employees.map(e=>'<tr><td>'+E(e.name)+'</td>'+e.months.map(m=>'<td class="ui-row-'+(['APPROVED','FINAL'].includes(m.status)?'approved':m.status==='SUBMITTED'?'submitted':'open')+'">'+uiStatus(m.status)+'<div>'+uiButton('Öffnen','reportOpen',e.id+'|'+m.month)+'</div></td>').join('')+'</tr>').join('')+'</table></div>','uiSubmissionOverview'),true):'';
 return monthPick()+review+'<section class="card">'+(isAdmin()?select('reportUser','Mitarbeiter',users.map(u=>[u.id,u.name]),selected.id):'')+uiRemote('report',{companyId:firm().id,userId:selected.id,month:ST.month},snapshot=>uiMonthlyReport(snapshot,selected),'uiMonthlyReport')+'</section>'+uiFold(isAdmin()?'Jahresübersicht der Mitarbeiter':'Mein Jahr',uiYearData(data=>{const e=data.employees.find(x=>x.user.id===selected.id);return e?uiKpis([['Jahressoll (Plan)',uiHours(e.annualPlannedTarget)],['Ist bis '+data.month,uiHours(e.throughMonth.worked)],['Bereitschaft bis '+data.month,uiHours(e.throughMonth.standby)]])+uiYearMonths(e)+uiButton('Jahresübersicht als PDF','annualPdf',e.user.id):'';},'uiReportYear'))+(isAdmin()?uiFold('Sammelberichte und Buchhaltung',ftPayrollPanel_()+ftBulkPanel(users)):'');
};
function uiLeaveOverview(data){
 return '<div class="table"><table><tr><th>Mitarbeiter</th><th>Resturlaub gesamt</th><th>Genehmigt '+data.year+'</th><th>Monat '+data.month+'</th><th>Offene Anträge</th><th>Aktuell</th></tr>'+data.employees.map(e=>'<tr><td>'+E(e.user.name)+'</td><td>'+N(e.leave.balanceDays)+' Tage'+(e.leave.balanceHours===null?'<small class="ui-caption" style="display:block">Stundenbasis nicht festgelegt</small>':' / '+uiHours(e.leave.balanceHours))+'</td><td>'+(e.leave.approvedYearDays===null?'Zuordnung offen':N(e.leave.approvedYearDays)+' Tage')+'</td><td>'+(e.leave.approvedMonthDays===null?'Zuordnung offen':N(e.leave.approvedMonthDays)+' Tage')+'</td><td>'+N(e.leave.pendingDays)+' Tage</td><td>'+(e.leave.currentlyAway?'<span class="ui-pill ok">Im Urlaub</span>':'–')+'</td></tr>').join('')+'</table></div><p class="ui-caption">Jahres-/Monatswerte zeigen genehmigte Urlaube. Der Gesamtrest bleibt davon getrennt. Stunden werden nur mit einer hinterlegten Stundenbasis umgerechnet. Bei flexiblen Urlauben über Monats-/Jahresgrenzen bleiben zeitlich nicht zugeordnete Tage als „Zuordnung offen“ ausgewiesen.</p>';
}
leave=function(){
 const legacy=FT_CLARITY_OLD.leave(),template=document.createElement('template');template.innerHTML=legacy;
 const request=template.content.querySelector('#leaveForm')?.closest('section'),formHtml=request?.outerHTML||'';
 const mine=(ST.h.leaves||[]).filter(l=>l.companyId===firm().id&&(isAdmin()||l.userId===me().id)),tab=ST.uiLeaveTab||'PENDING',today=ftVacationToday();
 const filters=[['PENDING','Offen'],['APPROVED','Genehmigt'],['OTHER','Storniert / abgelehnt'],['AWAY','Aktuell im Urlaub']];
 const match=(l,t)=>t==='PENDING'?['PENDING','CANCEL_PENDING'].includes(l.status):t==='OTHER'?['REJECTED','CANCELLED','WITHDRAWN'].includes(l.status):t==='AWAY'?['APPROVED','CANCEL_PENDING'].includes(l.status)&&l.from<=today&&l.to>=today:l.status==='APPROVED';
 const labels={PENDING:'Offen',APPROVED:'Genehmigt',REJECTED:'Abgelehnt',WITHDRAWN:'Zurückgezogen',CANCEL_PENDING:'Stornierung offen',CANCELLED:'Storniert'};
 const list=mine.filter(l=>match(l,tab)).sort((a,b)=>String(a.from).localeCompare(String(b.from))).map(l=>ftVacationItem(l,labels,s=>s==='APPROVED'?'approved':s==='PENDING'||s==='CANCEL_PENDING'?'pending':'rejected',today)).join('');
 const account=ftAbsencePanel_();
 return '<div class="ui-toolbar"><h2>'+(isAdmin()?'Urlaub verwalten':'Mein Urlaub')+'</h2>'+uiYearSelect()+'</div>'+(isAdmin()&&has('REPORTS')?uiFold('Urlaubsstände aller Mitarbeiter',uiYearData(uiLeaveOverview,'uiLeaveOverview'),true):uiKpis([['Resturlaub gesamt',N(me().leaveBalance)+' Tage'],['Anspruch pro Jahr',N(me().leaveEntitlement)+' Tage']]))+uiTabs('uiLeaveTab',filters.map(([s,l])=>[s,l,mine.filter(x=>match(x,s)).length]),tab)+'<section class="card"><h3>'+E(filters.find(x=>x[0]===tab)?.[1]||'Urlaube')+'</h3>'+(list||'<div class="ui-empty">Keine Anträge in diesem Reiter.</div>')+'</section>'+uiFold(ST.edit?'Urlaubsantrag bearbeiten':'Urlaub beantragen',formHtml,Boolean(ST.edit))+uiFold(isAdmin()?'Mitarbeiter einzeln · Urlaubskonto, Historie & PDF':'Urlaubskonto, Historie & PDF',account,false,'uiLeaveDetails');
};
ftAbsenceResultHtml_=((original)=>function(data){
 const template=document.createElement('template');template.innerHTML=original(data);
 const nodes=[...template.content.children];const groups=[];let group=null;
 for(const el of nodes){if(el.matches('h3')){group=document.createElement('details');group.className='ui-fold';group.innerHTML='<summary>'+el.textContent+'</summary><div class="ui-fold-body"></div>';groups.push(group);el.remove();}else if(group)group.querySelector('div').append(el);}
 for(const g of groups)template.content.append(g);return template.innerHTML;
})(ftAbsenceResultHtml_);
availability=function(){
 return '<div class="ui-toolbar"><h2>Verfügbarkeit</h2></div>'+uiFold(isAdmin()?'Abgaben aller Mitarbeiter':'Meine Abgaben',uiRemote('availabilityOverview',{companyId:firm().id,month:ST.month},data=>isAdmin()?'<div class="table"><table><tr><th>Name</th>'+data.periods.map(m=>'<th>'+E(ftPdfMonthLabel(m))+'</th>').join('')+'</tr>'+data.employees.map(u=>'<tr><td>'+E(u.name)+'</td>'+u.months.map(m=>'<td><button class="ui-month-chip '+(m.submitted?'done':'open')+'" data-act="ui:availabilityMonth" data-id="'+m.month+'">'+(m.submitted?'Abgegeben':m.answered?'Begonnen '+m.answered+'/'+m.days:'Noch offen')+'</button></td>').join('')+'</tr>').join('')+'</table></div>':data.employees.map(u=>'<div class="ui-availability-grid">'+u.months.map(m=>'<button class="ui-month-chip '+(m.submitted?'done':'open')+'" data-act="ui:availabilityMonth" data-id="'+m.month+'">'+E(ftPdfMonthLabel(m.month))+'<br>'+ (m.submitted?'Abgegeben':m.answered?'Begonnen '+m.answered+'/'+m.days:'Noch offen')+'</button>').join('')+'</div>').join(''),'uiAvailabilityOverview'),true)+uiFold('Tage für '+E(ftPdfMonthLabel(ST.month))+' auswählen',FT_CLARITY_OLD.availability().replace(/<div class="card"><h2>Abgaben der Mitarbeiter<\/h2>[\s\S]*$/,''),Boolean(ST.uiAvailOpen));
};
rules=function(){
 if(!isAdmin()||!ST.rules)return FT_CLARITY_OLD.rules();const r=ST.rules.current;
 const group=(key,title,pct)=>'<div class="card"><h3>'+title+'</h3>'+input('Zuschlag in Prozent',pct,r[pct],'number','min="0" step="0.01" required')+'<p class="ui-caption">Gilt für:</p>'+RULE_TYPES.filter(([k])=>!ftIsBsbRules_()||k!=='STANDBY').map(([keyValue,label])=>'<label class="cbox"><input type="checkbox" name="'+key+'" value="'+keyValue+'"'+(r[key].includes(keyValue)?' checked':'')+'><span>'+E(label)+'</span></label>').join('')+'</div>';
 return '<section class="card"><h2>Zuschläge einfach einstellen</h2><p class="ui-caption">Pro Zuschlag den Prozentsatz und die betroffenen Tätigkeiten wählen. Bereits freigegebene Monate bleiben unverändert.</p><form id="rulesForm"><div class="cols">'+input('Gültig ab','effectiveMonth',ST.month,'month','required')+input('Bereitschaft: Euro je Stunde','standbyRate',r.standbyRate,'number','min="0" step="any" required')+'</div><div class="ui-rule-grid">'+group('nightTypes','Nacht · '+(firm().nightStart??22)+'–'+(firm().nightEnd??6)+' Uhr','nightPct')+group('sundayTypes','Sonntag','sundayPct')+group('holidayTypes','Feiertag','holidayPct')+'</div>'+uiFold('Feiertage und Grundlage',select('holidayCalendar','Feiertagskalender',[['AT','Österreich'],['NONE','Keine automatische Erkennung']],r.holidayCalendar)+input('Zusätzliche Tage (JJJJ-MM-TT, Komma getrennt)','extraHolidays',r.extraHolidays.join(', '))+'<label class="field"><span>Vertrag / Grundlage</span><textarea name="note" rows="2">'+E(r.note)+'</textarea></label>')+'<p class="ui-note">'+(ftIsBsbRules_()?'BSB3100: Bereitschaft hat einen einheitlichen Satz; keine Zuschläge auf Bereitschaft. ':'')+'Beispiel: 20 % Zuschlag auf 15 € pro Arbeitsstunde ergeben 3 € zusätzlich. Vertragliche und gesetzliche Ansprüche bleiben gesondert zu prüfen.</p><button class="btn primary">Regeln speichern</button></form></section>'+uiFold('Frühere Regelversionen',ST.rules.history.map(x=>'<p>'+E(x.effectiveMonth)+' · '+DT(x.createdAt)+'</p>').join('')||'Noch keine Versionen');
};
ftStandbySections_=function(all,sick,full){
 if(full)return FT_CLARITY_OLD.ftStandbySections_(all,sick,full);
 const now=Date.now(),groups=[['Noch nicht bestätigt',(all||[]).filter(x=>x.actualStatus!=='DONE'&&Date.parse(x.end)<=now)],['Eingeteilt',(all||[]).filter(x=>x.actualStatus!=='DONE'&&Date.parse(x.end)>now)],['Bestätigt',(all||[]).filter(x=>x.actualStatus==='DONE')]];
 return groups.map(([name,rows],i)=>uiFold(name+' ('+rows.length+')',rows.map(x=>ftStandbyCard_(x,sick,i===0?'due':i===2?'done':'future')).join('')||'<p class="ui-empty">Keine Dienste.</p>',i===0&&rows.length>0)).join('');
};
async function uiDownloadPdf(result){const raw=atob(result.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:'application/pdf'});ftPdfOfferDownload_({blob,name:result.name});return blob;}
ftLocalPdf=async function(options={download:true}){
 const companyId=firm()?.id,month=ST.month,userId=options.userId||ST.selected||me().id;
 const result=await api('pdfVector',{companyId,month,userId,bulk:options.bulk===true,userIds:options.userIds});
 if(firm()?.id!==companyId||ST.month!==month)throw Error('Firma oder Monat wurde während des Exports geändert.');
 const raw=atob(result.base64),blob=new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:'application/pdf'});
 const out={blob,name:result.name,size:blob.size,pages:result.pages,report:result.report,staffCount:result.staffCount,context:{companyId,userId,month}};if(options.download!==false)ftPdfOfferDownload_(out);return out;
};
action=async function(button){
 const act=button.dataset.act,id=button.dataset.id||'';
 if(act==='timerStop'&&document.getElementById('uiTimerAutoBreak')?.checked){
  if(!confirm('Die tatsächlich genommene Pause auf mindestens 30 Minuten ergänzen und die Arbeitszeit beenden? Bereits erfasste Pausen werden nicht doppelt abgezogen.'))return;
  button.disabled=true;try{await api('timerStop',{companyId:firm().id,autoBreak:true,breakConfirmed:true});await load();say('Arbeitszeit mit bestätigter Pause gespeichert.');}catch(err){say(err.message,true);}finally{if(button.isConnected)button.disabled=false;}return;
 }
 if(!act.startsWith('ui:'))return FT_CLARITY_OLD.action(button);
 if(act==='ui:tab'){ST[button.dataset.key]=id;page();return;}
 if(act==='ui:taskNew'){ST.commCompose=true;page();return;}
 if(act==='ui:tasksRefresh'){ST.comm=null;await ftCommFetch_(true);return;}
 if(act==='ui:refresh'){FT_CLARITY_CACHE.clear();page();return;}
 if(act==='ui:person'){ST.uiPerson=id;page();return;}
 if(act==='ui:availabilityMonth'){ST.month=id;ST.availMonth='';ST.uiAvailOpen=true;await load();return;}
 if(act==='ui:reportOpen'){const [uid,month]=id.split('|');ST.selected=uid;ST.month=month;ST.tab='reports';await load();return;}
 if(act==='ui:driveConnect'){button.disabled=true;try{const result=await api('driveConnect');const url=new URL(result.url);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw Error('Google-Verbindungsadresse ist ungültig.');window.location.assign(url.href);}catch(err){say(err.message,true);if(button.isConnected)button.disabled=false;}return;}
 if(act==='ui:driveTest'){button.disabled=true;try{const r=await api('driveStorageTest');say('Drive-Ordner erreichbar: '+r.email);}catch(err){say(err.message,true);}finally{if(button.isConnected)button.disabled=false;}return;}
 if(act==='ui:annualPdf'){button.disabled=true;try{await uiDownloadPdf(await api('summaryPdf',{companyId:firm().id,userId:id,year:Number(['totals','leave'].includes(ST.tab)?ST.uiYear||ST.month.slice(0,4):ST.month.slice(0,4)),month:String(['totals','leave'].includes(ST.tab)?ST.uiYear||ST.month.slice(0,4):ST.month.slice(0,4))+ST.month.slice(4)}));}catch(err){say(err.message,true);}finally{if(button.isConnected)button.disabled=false;}return;}
 if(act==='ui:breakReview'){const note=prompt('Pausenabweichung prüfen. Tatsächliche Arbeitszeit bleibt unverändert. Grund / Prüfergebnis:');if(!note)return;await run(async()=>{await api('breakReview',{activityId:id,companyId:firm().id,note});await load();},'Pausenabweichung geprüft.');return;}
};
submit=async function(form){
 if(form.getAttribute('id')==='uiTaskEditForm'){const p=fields(form);await run(async()=>{await api('taskUpdate',{companyId:firm().id,threadId:form.dataset.thread,title:p.title,dueDate:p.dueDate||''});await ftCommFetch_(true);},'Aufgabenangaben gespeichert; Kalenderübertragung vorgemerkt.');return;}
 if(form.getAttribute('id')==='uiTaskCreateForm'){
  const button=form.querySelector('button[type=submit]');button.disabled=true;
  try{const p=fields(form),recipientIds=[...form.querySelectorAll('[name="recipientIds"]:checked')].map(x=>x.value);if(!recipientIds.length)throw Error('Bitte mindestens einen Mitarbeiter auswählen.');
   const photo=await ftCommPhotoData_(form.elements.namedItem('photo'));const result=await api('tasksCreate',{companyId:firm().id,kind:'TASK',recipientIds,title:p.title,body:p.body,dueDate:p.dueDate||'',photo});
   ST.commCompose=false;ST.uiTaskFilter='OPEN';ST.commOpen=result.threads?.[0]?.id||'';await ftCommFetch_(true);say(result.created+' Aufgabe'+(result.created===1?'':'n')+' zugeordnet.');
  }catch(err){say(err.message,true);}finally{if(button.isConnected)button.disabled=false;}return;
 }
 if(form.getAttribute('id')==='uiTimeForm'){
  const p=fields(form),choice=ftDirectActivityPayload_(p.activitySelection),minutes=Number(p.breakMinutes||0),mode=p.autoBreak?'AUTO':minutes>0?'MANUAL':'NONE';
  if(mode==='NONE'&&(new Date(p.end)-new Date(p.start))>6*3600000&&!confirm('Du bestätigst, dass keine Pause genommen wurde. Die Arbeitszeit wird vollständig gespeichert und die Pausenabweichung zur Prüfung markiert.'))return;
  const button=form.querySelector('button[type=submit]');button.disabled=true;try{await api('activitySave',{...p,...choice,companyId:firm().id,breakMode:mode,breakConfirmed:true});ST.edit='';FT_CLARITY_CACHE.clear();if(!p.id&&p.start)ST.month=p.start.slice(0,7);await load();say('Arbeitszeit gespeichert.');}catch(err){say(err.message,true);}finally{if(button.isConnected)button.disabled=false;}return;
 }
 return FT_CLARITY_OLD.submit(form);
};
document.addEventListener('toggle',event=>{
 const detail=event.target;if(!detail.matches?.('details[data-task]')||!detail.open)return;
 ST.commOpen=detail.dataset.task;const row=ST.comm?.threads?.find(x=>x.id===ST.commOpen);if(row?.unread){api('commRead',{companyId:firm().id,threadId:row.id}).then(()=>{row.unread=false;ftCommSetBadge_((ST.comm?.threads||[]).filter(t=>t.kind==='TASK'&&t.unread).length);}).catch(()=>{});}
},true);
document.addEventListener('change',event=>{const el=event.target;if(el.name==='uiYear'){ST.uiYear=el.value;page();}if(el.form?.getAttribute('id')==='uiTimeForm'&&el.name==='start')ftTimeSyncEndDate_(el.form);});

settings=function(){return FT_CLARITY_OLD.settings().replace('Google-Kalender-ID','Hauptkalender-ID für Bereitschaften').replace('Google-Kalender aktivieren','Haupt- und Mitarbeiterkalender aktivieren').replace('<h2>Arbeitszeitmodell</h2>','<h2>Arbeitszeitmodell</h2><p class="ui-note">Kalender werden oben unter „Google Kalender · Firma“ zugeordnet. Nach dem Verbinden des Firmen-Google-Kontos kannst du dort den Hauptkalender oder einen Mitarbeiter auswählen und dessen Kalender-ID hinterlegen. Mitarbeiter können alternativ unter „Mein Konto“ ihr eigenes Google-Konto verbinden.</p>');};

function uiDriveStoragePanel(){
 if(me()?.role!=='SYSADMIN')return '';
 return '<section class="card"><h2>Dateiablage · Google Drive</h2>'+uiRemote('storageStatus',{},s=>s.provider!=='drive'?'<p>Die Testkonfiguration verwendet eine andere Dateiablage.</p>':'<p>PDFs, Fotos und Anhänge werden privat im verbundenen Google-Konto gespeichert. Stunden und Mitarbeiter bleiben in Cloudflare.</p>'+uiKpis([['Verbindung',s.connected?'Verbunden':'Noch nicht verbunden'],['Google-Konto',s.email||'Noch nicht konfiguriert']])+(s.configured?'<div class="actions">'+uiButton(s.connected?'Google-Zugriff erneuern':'Google Drive verbinden','driveConnect','',true)+(s.connected?uiButton('Verbindung prüfen','driveTest'):'')+'</div>':'<p class="ui-note">Einmalig in Google Cloud einen OAuth-Web-Client einrichten. Client-ID und Client-Secret in Cloudflare hinterlegen; anschließend hier verbinden.</p>')+(s.folderUrl?'<p><a href="'+E(s.folderUrl)+'" target="_blank" rel="noopener noreferrer">Privaten FireTime-Ordner öffnen</a></p>':'')+uiFold('Adresse für die Google-Einrichtung','<p>Diese Adresse exakt als autorisierte Weiterleitungsadresse beim Google-OAuth-Client hinterlegen:</p><code style="overflow-wrap:anywhere">'+E(s.callbackUrl)+'</code>')+'<p class="ui-caption">Der Ordner wird von FireTime angelegt. Bitte nicht öffentlich freigeben. Zugriff auf Aufgabenanhänge und Berichte wird weiterhin über FireTime geprüft.</p>','uiDriveStorage')+'</section>';
}
const UI_STORAGE_OLD_SETTINGS=settings,UI_STORAGE_OLD_CUSTOMERS=customers;
settings=function(){return uiDriveStoragePanel()+UI_STORAGE_OLD_SETTINGS();};
customers=function(){return uiDriveStoragePanel()+UI_STORAGE_OLD_CUSTOMERS();};

// Accept larger source logos and resize before upload to keep every page fast.
fileAsData=async function(file){
 if(!file)return null;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024){say('Logo: PNG/JPG/WEBP maximal 10 MB.',true);return null;}
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Bild kann nicht gelesen werden.'));img.src=url;});
  const factor=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(img.naturalWidth*factor));canvas.height=Math.max(1,Math.round(img.naturalHeight*factor));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Bild kann nicht verarbeitet werden.');ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL(file.type==='image/jpeg'?'image/jpeg':'image/png',.9);
 }catch(err){say(err.message,true);return null;}finally{URL.revokeObjectURL(url);}
};

// Calendar OAuth stays entirely inside the customer's FireTime workflow.
for(const name of ['calendarAccountStatus','calendarList','calendarSelectionTest'])FT_CLARITY_READS.add(name);
function uiCalendarPanel(kind){
 const c=firm();if(!c||!has('CALENDAR'))return '';
 const personal=kind==='personal',p={companyId:c.id,kind},suffix=personal?'Personal':'Company';
 return '<section class="card"><h2>'+ (personal?'Mein Google-Kalender':'Google Kalender · Firma')+'</h2><p>'+(personal?'Verbinde dein Google-Konto und wähle deinen bestehenden Kalender für Bereitschaften und Aufgabenfristen.':'Verbinde das Google-Konto deiner Firma. Danach kannst du vorhandene Kalender auswählen oder deren IDs eintragen. Keine Einrichtung in Google Cloud erforderlich.')+'</p>'+uiRemote('calendarAccountStatus',p,status=>{
  if(!status.configured)return '<p class="ui-note">Die zentrale Kalenderverbindung wird noch vom FireTime-Systemadmin eingerichtet.</p>';
  let body=uiKpis([['Google-Konto',status.email||'Noch nicht verbunden'],['Verbindung',status.connected?'Verbunden':'Noch nicht verbunden']])+uiButton(status.connected?'Google-Zugriff erneuern':'Google Kalender verbinden','calendarConnect',kind,true);
  if(status.connected)body+=uiRemote('calendarList',p,result=>{
   const users=myUsers().filter(x=>x.role==='STAFF'&&x.status==='ACTIVE');
   const current=personal?me().calendarId:c.calendarId;
   return '<form id="uiCalendarForm'+suffix+'" data-kind="'+kind+'"><div class="cols">'+(!personal?select('userId','Kalender zuordnen zu',[['','Hauptkalender der Firma'],...users.map(u=>[u.id,u.name])],''):'<input type="hidden" name="userId" value="'+E(me().id)+'">')+select('calendarChoice','Bestehenden Kalender auswählen',[['','Bitte auswählen'],...result.calendars.map(x=>[x.id,x.name+(x.primary?' (Hauptkalender)':'')])],current||'')+'</div>'+uiFold('Kalender-ID manuell eingeben',input('Kalender-ID (alternativ zur Auswahl)','calendarId','','text','maxlength="250"'))+'<p class="ui-caption">'+(personal?'Deine aktuelle Kalender-ID: '+E(current||'Noch kein Kalender ausgewählt'):'Für Mitarbeiter können hier Kalender zugeordnet werden, auf die das verbundene Firmenkonto Schreibzugriff hat. Andernfalls verbindet der Mitarbeiter sein Google-Konto unter „Mein Konto“.')+'</p><div class="actions"><button type="submit" class="btn primary">Kalender prüfen und speichern</button>'+uiButton('Zuordnung entfernen','calendarClear',kind)+'</div></form>';
  },'uiCalendarList'+suffix);
  if(me().role==='SYSADMIN')body+=uiFold('Zentrale Google-Einrichtung','<p>Diese Weiterleitungsadresse einmal beim zentralen Google-OAuth-Webclient ergänzen:</p><code style="overflow-wrap:anywhere">'+E(status.callbackUrl)+'</code><p>Google Calendar API aktivieren. Für Kundenbetrieb Google-Veröffentlichungsstatus und erforderliche Überprüfung abschließen.</p>');
  return body;
 },'uiCalendarAccount'+suffix)+'</section>';
}
const UI_CALENDAR_OLD_SETTINGS=settings,UI_CALENDAR_OLD_PROFILE=profile;
settings=function(){const html=UI_CALENDAR_OLD_SETTINGS(),doc=document.createElement('div');doc.innerHTML=html;const form=doc.querySelector('#settingsForm');if(form)for(const name of ['calendarId','calendarOn']){const field=form.querySelector('[name="'+name+'"]');if(field)field.closest('label')?.remove();}form?.querySelector('[data-act="calendarTest"]')?.remove();return uiCalendarPanel('company')+doc.innerHTML;};
profile=function(){return uiCalendarPanel('personal')+UI_CALENDAR_OLD_PROFILE();};
const UI_CALENDAR_OLD_ACTION=action,UI_CALENDAR_OLD_SUBMIT=submit;
action=async function(button){
 const act=button.dataset.act,kind=button.dataset.id;
 if(act==='ui:calendarConnect'){
  button.disabled=true;try{const result=await api('calendarConnect',{companyId:firm().id,kind}),url=new URL(result.url);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw Error('Google-Adresse ungültig.');sessionStorage.setItem('ft_calendar_return',JSON.stringify({cid:firm().id,kind}));location.assign(url.href);}catch(err){say(err.message,true);button.disabled=false;}return;
 }
 if(act==='ui:calendarClear'){
  const form=button.closest('form'),p=fields(form);if(!confirm('Diese Kalenderzuordnung entfernen? Bereits übertragene persönliche FireTime-Termine werden beim Abgleich entfernt.'))return;
  await run(async()=>{await api('calendarSave',{companyId:firm().id,kind,userId:p.userId||'',calendarId:''});await load();},'Kalenderzuordnung entfernt.');return;
 }
 return UI_CALENDAR_OLD_ACTION(button);
};
submit=async function(form){
 if((form.getAttribute('id')||'').startsWith('uiCalendarForm')){
  const p=fields(form),calendarId=String(p.calendarId||p.calendarChoice||'').trim();if(!calendarId){say('Bitte einen Kalender auswählen oder eine Kalender-ID eintragen.',true);return;}
  await run(async()=>{await api('calendarSave',{companyId:firm().id,kind:form.dataset.kind,userId:p.userId||'',calendarId});await load();},'Kalender geprüft und gespeichert.');return;
 }
 return UI_CALENDAR_OLD_SUBMIT(form);
};

if(new URLSearchParams(location.search).get('calendar')==='connected'){
 try{const context=JSON.parse(sessionStorage.getItem('ft_calendar_return')||'null');sessionStorage.removeItem('ft_calendar_return');if(context&&ST.token){ST.cid=context.cid;ST.tab=context.kind==='personal'?'profile':'settings';queueMicrotask(()=>load({force:true}));}history.replaceState(null,'',location.pathname);}
 catch{sessionStorage.removeItem('ft_calendar_return');}
}

document.addEventListener('change',event=>{
 const field=event.target,form=field.closest?.('#uiCalendarFormCompany');if(!form||field.name!=='userId')return;
 const id=field.value,assigned=id?myUsers().find(u=>u.id===id)?.calendarId:firm().calendarId;
 form.elements.namedItem('calendarChoice').value=assigned||'';form.elements.namedItem('calendarId').value='';
});

FT_CLARITY_READS.add('productionStatus');FT_CLARITY_READS.add('invitationStatus');
function uiProductionPanel(){
 if(me()?.role!=='SYSADMIN')return '';
 return '<section class="card"><h2>Systembetrieb · FireTime Pro</h2>'+uiRemote('productionStatus',{},s=>uiKpis([['Betrieb',s.production?'Produktiv':'Einrichtung'],['Automatische Abläufe',s.automations?'Aktiv':'Aus'],['E-Mail',s.mail.connected?'Verbunden':'Freigabe fehlt'],['Push',s.push.configured?'Eingerichtet':'Wird eingerichtet']])+'<p>Zentraler Absender: <strong>'+E(s.mail.email)+'</strong></p>'+uiButton(s.mail.connected?'Gmail-Zugriff erneuern':'Gmail-Versand verbinden','gmailConnect','',true)+'<p class="ui-caption">Eine gespeicherte Verbindung bestätigt noch keinen Versand. Bei fehlender Freigabe mit dem zentralen Google-Konto erneut verbinden.</p>'+((s.mail.lastErrors||[]).length?uiFold('Letzte E-Mail-Fehler',(s.mail.lastErrors||[]).map(x=>'<p><b>'+E(x.status)+'</b> · '+E(x.error)+'<br><small>'+E(x.createdAt)+'</small></p>').join(''),true):'')+'<p>Firmenadmin BSB3100: <strong>'+E(s.pilotAdmin||'Nicht vorkonfiguriert')+'</strong>. Die einmalige Zugangseinrichtung erfolgt nach der Gmail-Verbindung automatisch.</p>'+uiFold('Zustellstatus',s.outbox.length?'<div class="table"><table><tr><th>Kanal</th><th>Status</th><th>Anzahl</th></tr>'+s.outbox.map(x=>'<tr><td>'+E(x.kind)+'</td><td>'+E(x.status)+'</td><td>'+E(x.count)+'</td></tr>').join('')+'</table></div>':'<p>Noch keine Zustellungen.</p>')+uiButton('Status aktualisieren','refresh'),'uiProductionStatus')+'</section>';
}
const UI_PRODUCTION_CUSTOMERS=customers,UI_PRODUCTION_ACTION=action;
customers=function(){return uiProductionPanel()+UI_PRODUCTION_CUSTOMERS();};
action=async function(button){
 if(button.dataset.act==='ui:gmailConnect'){
  button.disabled=true;try{const result=await api('gmailConnect'),url=new URL(result.url);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw Error('Google-Adresse ungültig.');location.assign(url.href);}catch(err){say(err.message,true);button.disabled=false;}return;
 }
 return UI_PRODUCTION_ACTION(button);
};
if(new URLSearchParams(location.search).get('gmail')==='connected'&&ST.token){ST.cid='';ST.tab='customers';queueMicrotask(()=>load({force:true}));history.replaceState(null,'',location.pathname);}

// Public information stays accessible from the sign-in screen.
const UI_PUBLIC_AUTH=auth;
auth=function(){const result=UI_PUBLIC_AUTH();const login=document.querySelector('.login');if(login&&!login.querySelector('[data-public-links]'))login.insertAdjacentHTML('beforeend','<nav data-public-links style="display:flex;gap:16px;flex-wrap:wrap;margin-top:22px;font-size:14px"><a href="/info" style="color:#93c5fd">Über FireTime</a><a href="/datenschutz" style="color:#93c5fd">Datenschutz</a><a href="/impressum" style="color:#93c5fd">Impressum</a></nav>');return result;};
if(!ST.token)queueMicrotask(()=>auth());

const UI_MAIL_ACTION=action,UI_MAIL_STAFF=staff;
staff=function(){
 const template=document.createElement('template');template.innerHTML=UI_MAIL_STAFF();
 for(const button of template.content.querySelectorAll('[data-act="invite"]'))button.insertAdjacentHTML('afterend',uiButton('Versandstatus prüfen','inviteStatus',button.dataset.id));
 return template.innerHTML;
};
action=async function(button){
 const act=button.dataset.act;
 if(act==='invite'||act==='ui:inviteStatus'){
  if(act==='invite'&&!confirm('Einladungslink erneut versenden?'))return;
  button.disabled=true;
  try{const result=await api(act==='invite'?'userInvite':'invitationStatus',{id:button.dataset.id});say(result?.message||'Versand ist noch nicht bestätigt.',result?.confirmed!==true);}
  catch(err){say('Einladung nicht als versendet bestätigt: '+String(err.message||err),true);}
  finally{if(button.isConnected)button.disabled=false;}return;
 }
 return UI_MAIL_ACTION(button);
};

// Keep the availability editor open and retain device drafts across reloads.
const UI_AVAIL_RENDER=availability,UI_AVAIL_ACTION=action,UI_AVAIL_PAGE=page,UI_AVAIL_API=api;
function uiAvailDraftKey(month=ST.month){return 'ft_availability_draft_v1:'+JSON.stringify([me()?.id,firm()?.id,month]);}
function uiAvailRememberRoute(){
 const url=new URL(location.href);
 if(ST.tab==='availability'){url.searchParams.set('tab','availability');url.searchParams.set('month',ST.month);}
 else if(url.searchParams.get('tab')==='availability'){url.searchParams.delete('tab');url.searchParams.delete('month');}
 history.replaceState(history.state,'',url);
}
availability=function(){
 const initialized=ST.availMonth===ST.month;
 let html=UI_AVAIL_RENDER();
 const submitted=ST.h.availSubmissions.some(x=>x.userId===me().id),key=uiAvailDraftKey();
 try{
  if(submitted)localStorage.removeItem(key);
  else if(!initialized){
   const draft=JSON.parse(localStorage.getItem(key)||'null');
   if(draft&&typeof draft==='object'&&!Array.isArray(draft)){
    ST.avail={};for(let day=1;day<=days(ST.month);day++)if(['YES','NO'].includes(draft[day]))ST.avail[day]=draft[day];
    ST.uiAvailOpen=true;html=UI_AVAIL_RENDER();
   }
  }
 }catch{}
 // Only this editor gets a stable identifier; overview folding is independent.
 const template=document.createElement('template');template.innerHTML=html;
 const editor=[...template.content.children].filter(el=>el.tagName==='DETAILS')[1];
 if(editor){editor.id='uiAvailabilityEditor';editor.open=Boolean(ST.uiAvailOpen);if(!submitted)editor.querySelector('.ui-fold-body').insertAdjacentHTML('afterbegin','<p class="ui-caption">Deine Auswahl wird auf diesem Gerät gesichert. Mit „Zwischenspeichern“ im System speichern; mit „Verbindlich abgeben“ für die Planung freigeben.</p>');}
 return template.innerHTML;
};
document.addEventListener('toggle',event=>{
 if(event.target?.id==='uiAvailabilityEditor'&&event.target.isConnected)ST.uiAvailOpen=event.target.open;
},true);
action=async function(button){
 if(['availDay','availAllYes','availAllNo'].includes(button.dataset.act)){
  ST.uiAvailOpen=document.getElementById('uiAvailabilityEditor')?.open??true;
  const scrollX=window.scrollX,scrollY=window.scrollY;
  await UI_AVAIL_ACTION(button);
  try{localStorage.setItem(uiAvailDraftKey(),JSON.stringify(ST.avail));}catch{say('Auswahl konnte auf diesem Gerät nicht gesichert werden. Bitte zwischenspeichern.',true);}
  window.scrollTo(scrollX,scrollY);return;
 }
 return UI_AVAIL_ACTION(button);
};
api=function(name,p={}){
 const key=uiAvailDraftKey(p.month||ST.month);
 return UI_AVAIL_API(name,p).then(result=>{if(['availabilitySave','availabilitySubmit'].includes(name))try{localStorage.removeItem(key);}catch{}return result;});
};
page=function(){const result=UI_AVAIL_PAGE();if(ST.h?.me)uiAvailRememberRoute();return result;};
