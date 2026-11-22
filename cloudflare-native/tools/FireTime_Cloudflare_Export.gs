/** Additive, read-only database export. No setup, migration or recalculation.
 * Creates ONLY a new private export folder and export progress properties.
 * Do not share its data: contains password hashes, sessions and private staff records.
 */
const FT_CF_EXPORT_SCHEMAS={"Companies":["id","name","slug","color","logoId","calendarId","calendarOn","remindAvailability","remindHours","remindShift","availabilityDay","nightStart","nightEnd","nightPct","sundayPct","holidayPct","standbyRate","active","createdAt"],"Users":["id","companyId","role","name","email","passwordHash","salt","status","monthlyHours","hourlyRate","leaveEntitlement","leaveBalance","openingHours","startDate","workdays","mustChange","createdAt"],"Sessions":["id","userId","expiresAt"],"Invites":["id","userId","expiresAt","usedAt"],"Activities":["id","companyId","userId","type","start","end","breakMinutes","object","description","createdAt","updatedAt","activityOptionId"],"Availability":["id","companyId","userId","month","day","answer","updatedAt"],"AvailabilitySubmissions":["id","companyId","userId","month","submittedAt"],"Shifts":["id","companyId","userId","day","start","end","status","eventId","actualStatus","confirmedAt","updatedAt"],"Leaves":["id","companyId","userId","from","to","days","creditHours","reason","status","reviewerId","reviewedAt","createdAt"],"Months":["id","companyId","userId","month","status","submittedAt","reviewerId","reviewedAt","note","pdfId","snapshot","snapshotHash"],"ShiftSegments":["id","companyId","shiftId","userId","start","end","actualStatus","confirmedAt","calendarEventId","updatedAt"],"ShiftChanges":["id","companyId","shiftId","fromUserId","toUserId","start","end","reason","status","createdAt","respondedAt","reviewedAt","reviewerId"],"SickLeaves":["id","companyId","userId","from","to","note","status","reportedBy","createdAt","reviewerId","reviewedAt","creditMode","creditHours","standbyCreditHours","reviewNote"],"PlanMonths":["id","companyId","month","fixedHash","fixedAt","fixedBy","publishedHash","publishedAt","publishedBy","sharedHash","sharedAt","sharedBy","shareStatus","calendarEvents","warnings","sharedAssignments","updatedAt"],"ActivityTimers":["id","companyId","userId","type","activityOptionId","start","object","description","createdAt","updatedAt"],"ActivityTypes":["id","companyId","type","label","active","sort","createdAt","updatedAt"],"Notifications":["id","companyId","userId","kind","reference","sentAt","status","error"],"Audit":["id","at","actorId","companyId","action","entity","entityId","previous","next"],"PdfArchive":["id","companyId","userId","month","fileId","name","createdAt","version","status"],"PdfBatchArchive":["id","companyId","month","fileId","name","createdAt","version","creatorId","userIds","status"],"PdfJobs":["id","companyId","userId","month","status","createdAt","updatedAt","error","archiveId"],"PushDevices":["id","companyId","userId","endpoint","p256dh","auth","deviceName","createdAt","updatedAt"],"CommThreads":["id","companyId","kind","titleEncoded","bodyEncoded","createdBy","recipientId","dueDate","status","createdAt","updatedAt","attachmentId"],"CommReplies":["id","companyId","threadId","authorId","bodyEncoded","createdAt","attachmentId"],"CommReads":["id","companyId","threadId","userId","seenAt"],"CompanyLicenses":["id","companyId","modules","updatedBy","updatedAt"],"CompanyProfiles":["id","companyId","workModel","workStart","workHours","workdays","standbyEnabled","standbyStart","standbyHours","availabilityEnabled","plannerEnabled","secondaryColor","welcomeText","updatedBy","updatedAt"],"CompanyRules":["id","companyId","effectiveMonth","nightTypes","sundayTypes","holidayTypes","nightPct","sundayPct","holidayPct","standbyRate","holidayCalendar","extraHolidays","note","createdBy","createdAt"],"WorkShifts":["id","companyId","userId","start","end","title","status","eventId","createdAt","updatedAt"],"LeaveLedger":["id","companyId","userId","kind","days","effectiveDate","periodStart","referenceId","carryoverBefore","note","actorId","createdAt"],"LeavePolicies":["id","companyId","yearMode","autoGrant","activationDate","updatedBy","updatedAt"],"LeaveStaffRules":["id","companyId","userId","yearMode","ruleType","legalBasis","note","updatedBy","updatedAt"],"LeaveFlexRules":["id","companyId","userId","mode","referenceDays","basis","balanceReviewed","updatedBy","updatedAt"],"LeaveFlexApprovals":["id","companyId","userId","leaveId","days","creditHours","referenceDays","basis","reviewerId","reviewedAt"],"AbsencePdfArchive":["id","companyId","userId","fromYear","toYear","fileId","name","createdAt","version","requestId"],"TimeBalanceStarts":["id","companyId","userId","startMonth","updatedBy","updatedAt"],"TimerPauseEvents":["id","companyId","userId","timerId","start","end"],"EmployeePreferences":["id","companyId","userId","leaveHoursPerDay","calendarId","updatedBy","updatedAt"],"ActivityBreakPolicies":["id","companyId","userId","activityId","mode","confirmed","minutes","reviewedBy","reviewedAt","reviewNote","updatedBy","updatedAt"],"CalendarMirrors":["id","companyId","userId","sourceType","sourceId","calendarId","eventId","sourceHash","status","updatedAt"]};

function ft_cloudflareExportManifest(){
 const lock=LockService.getScriptLock();lock.waitLock(20000);
 try{
  const db=ft_db_(),tables={},refs=new Set();
  const actual=db.getSheets().map(s=>s.getName()),unknown=actual.filter(n=>!FT_CF_EXPORT_SCHEMAS[n]);
  if(unknown.length)throw Error('Unbekannte Tabellen vor Export prüfen: '+unknown.join(', '));
  for(const name of Object.keys(FT_CF_EXPORT_SCHEMAS)){
   const sh=db.getSheetByName(name);if(!sh)continue;
   const values=sh.getDataRange().getValues(),headers=values.shift().map(String),expected=FT_CF_EXPORT_SCHEMAS[name];
   if(headers.some(h=>!expected.includes(h))||!headers.includes('id'))throw Error('Unerwartete Spalten: '+name);
   const rows=values.map(row=>headers.map((key,i)=>{
    let v=row[i];if(v instanceof Date){
     if(key==='month'||key==='effectiveMonth'||key==='startMonth')return Utilities.formatDate(v,'Europe/Vienna','yyyy-MM');
     if(['day','startDate','effectiveDate','periodStart','activationDate','dueDate'].includes(key)||(name==='Leaves'&&['from','to'].includes(key)))return Utilities.formatDate(v,'Europe/Vienna','yyyy-MM-dd');
     if(name==='CompanyProfiles'&&['workStart','standbyStart'].includes(key))return Utilities.formatDate(v,'Europe/Vienna','HH:mm');
     return v.toISOString();
    }return v===null||v===undefined?'':v;
   })).filter(row=>row[headers.indexOf('id')]!=='');
   for(const row of rows)for(const key of ['logoId','pdfId','fileId','attachmentId']){const i=headers.indexOf(key);if(i>=0&&row[i])refs.add(String(row[i]));}
   tables[name]={headers,rows};
  }
  const manifest={format:'firetime-native-export-v1',exportedAt:new Date().toISOString(),sourceVersion:FT_VERSION,tables,files:[],pendingFiles:[...refs],missingFiles:[]};
  const folder=DriveApp.createFolder('FireTime_Cloudflare_Export_'+Utilities.formatDate(new Date(),'Europe/Vienna','yyyyMMdd_HHmmss'));
  const file=folder.createFile(Utilities.newBlob(JSON.stringify(manifest),'application/json','data.json'));
  folder.createFolder('files');
  PropertiesService.getScriptProperties().setProperty('FT_CF_EXPORT_FOLDER',folder.getId()).setProperty('FT_CF_EXPORT_MANIFEST',file.getId());
  Logger.log('Privater Exportordner: '+folder.getUrl());Logger.log('Nun ft_cloudflareExportFilesNext wiederholt ausführen, bis pendingFiles = 0.');
  return {folderUrl:folder.getUrl(),tables:Object.keys(tables).length,pendingFiles:refs.size};
 }finally{lock.releaseLock();}
}
function ft_cloudflareExportFilesNext(){
 const properties=PropertiesService.getScriptProperties(),folder=DriveApp.getFolderById(properties.getProperty('FT_CF_EXPORT_FOLDER'));
 const manifestFile=DriveApp.getFileById(properties.getProperty('FT_CF_EXPORT_MANIFEST')),data=JSON.parse(manifestFile.getBlob().getDataAsString());
 const files=folder.getFoldersByName('files').next(),started=Date.now();let count=0;
 while(data.pendingFiles.length&&count<10&&Date.now()-started<180000){
  const id=data.pendingFiles.shift();
  try{
   const original=DriveApp.getFileById(id),blob=original.getBlob(),bytes=blob.getBytes();
   const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>((b+256)%256).toString(16).padStart(2,'0')).join('');
   const duplicate=files.getFilesByName(id);if(!duplicate.hasNext())files.createFile(blob.setName(id));
   data.files.push({id,name:original.getName(),mime:original.getMimeType(),size:bytes.length,sha256:hash,trashed:original.isTrashed()});
  }catch(e){data.missingFiles.push(id);Logger.log('Nicht lesbare Datei: '+id);}
  count++;
 }
 manifestFile.setContent(JSON.stringify(data));
 const result={remaining:data.pendingFiles.length,exported:data.files.length,missing:data.missingFiles.length,folderUrl:folder.getUrl()};Logger.log(JSON.stringify(result));return result;
}
