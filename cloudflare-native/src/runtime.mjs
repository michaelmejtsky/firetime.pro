import {Buffer} from 'node:buffer';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {formatDate,ViennaDate} from './time.mjs';
import {documentModel,renderPdf} from './pdf.mjs';
import schemas from './schema.json' with {type:'json'};
export const digest=value=>createHash('sha256').update(value).digest('hex');
export class NotLoaded extends Error {constructor(id){super('Private Datei wurde nicht geladen.');this.fileId=id;}}
export class Runtime {
 constructor({records=[],cache=[],properties=[],objects=[],files=new Map(),env={},calendars=new Map()}){
  this.vectorPdf=blocks=>{const bytes=renderPdf(blocks);return {bytes,pages:Number(bytes.toString('latin1').match(/\/Type \/Pages \/Count (\d+)/)?.[1]||1)};};this.env=env;this.schema=schemas;this.files=files;this.objects=new Map(objects.map(x=>[x.id,{...x}]));this.initialObjects=new Map(objects.map(x=>[x.id,JSON.stringify(x)]));
  this.tables=new Map(Object.entries(schemas).map(([name,cols])=>[name,{cols:[...cols],rows:[]} ]));
  for(const record of records){const table=this.tables.get(record.table_name);if(!table)throw Error('Unbekannte Datenbanktabelle: '+record.table_name);table.rows.push(JSON.parse(record.data));}
  this.original=new Map();for(const [name,t] of this.tables)for(const r of t.rows)this.original.set(name+'\0'+r.id,JSON.stringify(r));
  this.cache=new Map(cache.filter(x=>x.expires_at>Date.now()).map(x=>[x.key,{value:x.value,expires_at:x.expires_at}]));this.cacheWrites=new Map();
  this.properties=new Map(properties.map(x=>[x.key,x.value]));this.propertyWrites=new Map();this.jobs=new Map();this.calendarChanges=new Map();this.calendars=calendars;this.documents=new Map();this.newFiles=new Map();
  this.pushEnabled=env.PUSH_ENABLED==='true';
  const ctx=this;
  const range=(table,row,col,numRows=1,numCols=1)=>({
   getValues:()=>Array.from({length:numRows},(_,i)=>Array.from({length:numCols},(_,j)=>{
    const r=row+i;if(r===1)return table.cols[col+j-1]??'';return table.rows[r-2]?.[table.cols[col+j-1]]??'';
   })),
   setValues(values){for(let i=0;i<values.length;i++)for(let j=0;j<values[i].length;j++){
    const r=row+i,c=col+j;if(r===1){if(table.cols[c-1]&&table.cols[c-1]!==values[i][j])throw Error('Schemaänderung verweigert');table.cols[c-1]=values[i][j];}
    else {if(!table.rows[r-2])table.rows[r-2]={};table.rows[r-2][table.cols[c-1]]=values[i][j];}
   }return this;},setValue(v){return this.setValues([[v]]);},setNumberFormat(){return this;},setFontWeight(){return this;},setBackground(){return this;},setFontColor(){return this;}
  });
  const sheet=name=>{
   const t=ctx.tables.get(name);if(!t)return null;
   return {getName:()=>name,getDataRange:()=>range(t,1,1,t.rows.length+1,t.cols.length),getLastRow:()=>t.rows.length+1,getLastColumn:()=>t.cols.length,
    getRange:(r,c,n,m)=>typeof r==='string'?range(t,1,1):range(t,r,c,n,m),
    appendRow(values){t.rows.push(Object.fromEntries(t.cols.map((key,i)=>[key,values[i]??''])));return this;},
    deleteRow(row){if(row<2||row>t.rows.length+1)throw Error('Ungültige Datenzeile');t.rows.splice(row-2,1);return this;},setFrozenRows(){return this;}
   };
  };
  this.db={getSheetByName:sheet,insertSheet:name=>{if(!schemas[name])throw Error('Unbekanntes Schema '+name);if(!ctx.tables.has(name))ctx.tables.set(name,{cols:[...schemas[name]],rows:[]});return sheet(name);},getSpreadsheetTimeZone:()=> 'Europe/Vienna'};
  const blob=(bytes,mime='application/octet-stream',name='Datei')=>{
   const b=typeof bytes==='string'?Buffer.from(bytes,'utf8'):Buffer.from(bytes);
   const o={getBytes:()=>b,getContentType:()=>mime,getDataAsString:()=>b.toString('utf8'),getName:()=>name,setName(n){name=n;return o;}};return o;
  };
  const file=id=>{
   const model=ctx.documents.get(id),meta=ctx.objects.get(id);
   if(model)return {getId:()=>id,getAs:()=>blob(model.bytes(),'application/pdf','document.pdf'),setTrashed:()=>ctx.documents.delete(id)};
   if(!meta)throw Error('Datei nicht vorhanden.');
   return {getId:()=>id,getName:()=>meta.name,getMimeType:()=>meta.mime,getSize:()=>meta.size,isTrashed:()=>Boolean(meta.trashed),
    getUrl:()=>'',getBlob:()=>{const bytes=ctx.newFiles.get(id)||ctx.files.get(id);if(!bytes)throw new NotLoaded(id);return blob(bytes,meta.mime,meta.name);},
    setTrashed:v=>{meta.trashed=v?1:0;return file(id);}};
  };
  const folder={createFile(b){const id=randomUUID(),bytes=Buffer.from(b.getBytes()),meta={id,name:b.getName(),mime:b.getContentType(),size:bytes.length,sha256:digest(bytes),trashed:0};ctx.objects.set(id,meta);ctx.newFiles.set(id,bytes);return file(id);},getFoldersByName:()=>({hasNext:()=>true,next:()=>folder}),createFolder:()=>folder};
  const cacheApi={get:key=>{const x=ctx.cache.get(key);return x&&x.expires_at>Date.now()?x.value:null;},put:(key,value,seconds)=>{const v={value:String(value),expires_at:Date.now()+Math.min(seconds,21600)*1000};ctx.cache.set(key,v);ctx.cacheWrites.set(key,v);},remove:key=>{ctx.cache.delete(key);ctx.cacheWrites.set(key,null);}};
  const props={getProperty:key=>ctx.property(key),setProperty:(key,value)=>{if(/PEPPER|KEY|SECRET|TOKEN|DB_ID|ROOT_ID/.test(key))throw Error('Secret-Änderung nur über Worker-Konfiguration.');ctx.properties.set(key,String(value));ctx.propertyWrites.set(key,String(value));return props;}};
  const trigger={timeBased(){return this;},after(){return this;},everyMinutes(){return this;},atHour(){return this;},everyDays(){return this;},create(){return this;}};
  this.globals={
   Date:ViennaDate,Utilities:{getUuid:randomUUID,formatDate,base64Encode:b=>Buffer.from(typeof b==='string'?b:Buffer.from(b)).toString('base64'),base64Decode:s=>Buffer.from(s,'base64'),base64EncodeWebSafe:s=>Buffer.from(s).toString('base64url'),base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),newBlob:blob,
    computeDigest:(_,input)=>createHash('sha256').update(typeof input==='string'?input:Buffer.from(input)).digest(),computeHmacSha256Signature:(input,key)=>createHmac('sha256',key).update(input).digest(),DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF-8'}},
   PropertiesService:{getScriptProperties:()=>props},CacheService:{getScriptCache:()=>cacheApi},SpreadsheetApp:{openById:()=>ctx.db},
   DriveApp:{getFileById:file,getFolderById:()=>folder},
   DocumentApp:{create:()=>{const id='doc-'+randomUUID(),model=documentModel();ctx.documents.set(id,model);return {getId:()=>id,getBody:()=>model.body,saveAndClose:()=>{}};},ParagraphHeading:{HEADING1:'HEADING1',HEADING2:'HEADING2'}},
   CalendarApp:{getCalendarById:id=>ctx.calendar(id)},
   LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock:()=>{},releaseLock:()=>{}})},
   ScriptApp:{getProjectTriggers:()=>[],deleteTrigger:()=>{},newTrigger:()=>trigger},
   MailApp:{getRemainingDailyQuota:()=>100,sendEmail:message=>ctx.mail(message)},
   UrlFetchApp:{fetch:()=>{throw Error('Unportierter externer API-Aufruf; Aktion gesperrt.');},getRequest:()=>{throw Error('Google-Autorisierung im nativen Backend nicht erforderlich.');}},
   Logger:{log:()=>{}},MimeType:{PDF:'application/pdf'},ContentService:{MimeType:{TEXT:'text/plain',JSON:'application/json'},createTextOutput:()=>({setMimeType(){return this;}})}
  };
 }
 property(key){if(key==='FT_DB_ID'||key==='FT_ROOT_ID')return 'native';if(key==='FT_PUSH_WORKER_URL')return this.pushEnabled?'native://push':'';return this.env[key]??this.properties.get(key)??null;}
 enqueue(kind,payload,id=randomUUID()){
  const existing=this.jobs.get(id);if(existing)return id;
  this.jobs.set(id,{id,kind,payload,created_at:new Date().toISOString()});return id;
 }
 mail(message,notificationId){
  if(this.env.MAIL_ENABLED!=='true'||!this.env.MAIL_API_KEY||!this.env.MAIL_FROM)throw Error('E-Mail-Versand ist noch nicht eingerichtet.');
  const id=notificationId?'mail-'+notificationId:randomUUID();this.enqueue('mail',{message,notificationId},id);return {queued:true};
 }
 push(actor,kind,id,title,body,devices,unreadCount){
  if(!this.pushEnabled||!this.env.VAPID_PRIVATE_JWK||!this.env.VAPID_PUBLIC_KEY)return {sent:0,reason:'not_configured'};
  if(!devices.length)return {sent:0,reason:'no_devices'};
  const key='push-'+digest(actor.id+'|'+kind+'|'+id);
  this.enqueue('push',{actor:{id:actor.id,companyId:actor.companyId},devices:devices.slice(0,5),notification:{kind,id,title,body,unreadCount},notificationId:null},key);
  return {sent:0,queued:devices.length,jobId:key,reason:'Zur Zustellung vorgemerkt.'};
 }
 linkNotification(jobId,notificationId){this.jobs.get(jobId).payload.notificationId=notificationId;}
 calendarTest(id){const c=this.calendars.get(id);if(!c?.verified)throw Error('Kalenderanbindung noch nicht verifiziert.');return {name:c.name,id,readable:true,note:'Google Calendar REST-Zugriff geprüft.'};}
 calendar(id){
  if(this.env.CALENDAR_ENABLED!=='true'||!this.calendars.has(id))throw Error('Kalenderanbindung ist noch nicht eingerichtet.');
  const ctx=this,entry=this.calendars.get(id);
  const event=(eventId,initial={})=>{
   const key=id+'\0'+eventId;
   let job=ctx.calendarChanges.get(key);
   if(!job){const writable=['summary','description','location','start','end','attendees','reminders','transparency','colorId','visibility','status'];const clean=Object.fromEntries(Object.entries(initial).filter(([k])=>writable.includes(k)));if(ctx.env?.CALENDAR_ENABLED==='true'&&Array.isArray(clean.attendees)){const prefs=ctx.tables.get('EmployeePreferences')?.rows||[],users=ctx.tables.get('Users')?.rows||[];clean.attendees=clean.attendees.filter(a=>!users.some(u=>u.email===a.email&&prefs.some(p=>p.userId===u.id&&p.calendarId)));}job={companyId:entry.companyId,connectionKey:entry.connectionKey,calendarId:id,eventId,data:clean,delete:false};ctx.calendarChanges.set(key,job);}
   const api={getId:()=>eventId,setTitle:s=>{job.data.summary=s;return api;},setTime:(s,e)=>{job.data.start={dateTime:s.toISOString(),timeZone:'Europe/Vienna'};job.data.end={dateTime:e.toISOString(),timeZone:'Europe/Vienna'};return api;},setDescription:s=>{job.data.description=s;return api;},removeAllReminders:()=>{job.data.reminders={useDefault:false,overrides:[]};return api;},addPopupReminder:n=>{job.data.reminders??={useDefault:false,overrides:[]};job.data.reminders.overrides.push({method:'popup',minutes:n});return api;},deleteEvent:()=>{job.delete=true;return api;}};return api;
  };
  return {getName:()=>entry.name,getEventById:eventId=>{if(!entry.events?.has(eventId))throw Error('Kalendertermin wurde nicht verifiziert.');return entry.events.get(eventId)===null?null:event(eventId,entry.events.get(eventId));},createEvent:(title,start,end,opts={})=>{const ev=event(randomUUID().replaceAll('-',''));ev.setTitle(title).setTime(start,end).setDescription(opts.description||'');const job=ctx.calendarChanges.get(id+'\0'+ev.getId());job.create=true;job.data.attendees=String(opts.guests||'').split(',').filter(Boolean).filter(email=>{const u=ctx.tables.get('Users').rows.find(x=>x.email===email);return !u||!ctx.tables.get('EmployeePreferences').rows.some(p=>p.userId===u.id&&p.calendarId);}).map(email=>({email}));return ev;}};
 }
 changedRows(){
  const changes=[],seen=new Set();
  for(const [name,t] of this.tables)for(const row of t.rows){if(!row.id)throw Error('Datensatz ohne ID');const clean={...row};delete clean.__row;const key=name+'\0'+clean.id;seen.add(key);const serialized=JSON.stringify(clean);if(this.original.get(key)!==serialized)changes.push({table:name,id:String(clean.id),data:serialized});}
  for(const key of this.original.keys())if(!seen.has(key)){const [table,id]=key.split('\0');changes.push({table,id,deleted:true});}
  return changes;
 }
}
