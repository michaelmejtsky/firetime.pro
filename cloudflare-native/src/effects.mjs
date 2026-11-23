import {calendarOAuthFetch,writableCalendar,validateCalendarJobKey} from './calendar-oauth.mjs';
import {Buffer} from 'node:buffer';
import {statement} from './store.mjs';
import {pushOne,pushConfigured} from './push.mjs';
const CALENDAR_ACTIONS=new Set(['calendarTest','calendarResync','planCalendarShare','planAssign','planDelete','handoverRespond','workPublish','workDelete']);
const b64=s=>Buffer.from(typeof s==='string'?s:Buffer.from(s)).toString('base64url');
let cachedToken=null;
async function calendarToken(env){
 const raw=String(env.GOOGLE_CALENDAR_SERVICE_ACCOUNT||'');
 if(cachedToken&&cachedToken.account===raw&&cachedToken.exp>Date.now()+60000)return cachedToken.token;
 const sa=JSON.parse(raw);if(!sa.client_email||!sa.private_key)throw Error('Kalender-Servicekonto fehlt.');
 const now=Math.floor(Date.now()/1000),head=b64(JSON.stringify({alg:'RS256',typ:'JWT'})),payload=b64(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
 const unsigned=head+'.'+payload,key=await crypto.subtle.importKey('pkcs8',Buffer.from(sa.private_key.replace(/-----[^-]+-----|\s/g,''),'base64'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signature=b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned)));
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(10000)});
 const result=await response.json();if(!response.ok||!result.access_token)throw Error('Kalender-Autorisierung fehlgeschlagen.');
 cachedToken={account:raw,token:result.access_token,exp:Date.now()+Number(result.expires_in||3600)*1000};return result.access_token;
}
async function google(env,path,options={}){
 const token=await calendarToken(env);return fetch('https://www.googleapis.com/calendar/v3/'+path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
}
const eventPath=(calendar,id)=>'calendars/'+encodeURIComponent(calendar)+'/events/'+encodeURIComponent(id.replace(/@google\.com$/,''));
export async function prepareCalendars(env,snapshot,input){
 const calendars=new Map();if(env.CALENDAR_ENABLED!=='true'||!CALENDAR_ACTIONS.has(input.action))return calendars;
 const selected=input.data?.companyId||snapshot.user?.companyId;
 const companies=snapshot.records.filter(r=>r.table_name==='Companies').map(r=>JSON.parse(r.data)).filter(c=>c.id===selected||input.action==='planDelete'&&snapshot.records.some(r=>r.table_name==='Shifts'&&r.record_id===input.data?.shiftId&&JSON.parse(r.data).companyId===c.id));
 for(const company of companies){
  if(!company.calendarId)continue;
  const connectionKey='calendar:'+company.id;
  const response=env.CALENDAR_AUTH==='oauth'?null:await google(env,'calendars/'+encodeURIComponent(company.calendarId));
  if(response&&!response.ok)throw Error('Kalenderzugriff fehlgeschlagen (HTTP '+response.status+').');
  const data=env.CALENDAR_AUTH==='oauth'?await writableCalendar(env,connectionKey,company.calendarId):await response.json(),events=new Map();
  const request=(path,options)=>env.CALENDAR_AUTH==='oauth'?calendarOAuthFetch(env,connectionKey,path,options):google(env,path,options);

  // Only events in the affected month or record are needed; no full external calendar scan.
  const relevant=new Set(snapshot.records.filter(r=>['Shifts','ShiftSegments','WorkShifts'].includes(r.table_name)).map(r=>JSON.parse(r.data)).filter(r=>r.companyId===company.id&&(r.id===input.data?.id||r.id===input.data?.shiftId||r.shiftId===input.data?.shiftId||!input.data?.month||String(r.day||r.start).startsWith(input.data.month))).flatMap(r=>[r.eventId,r.calendarEventId]).filter(Boolean));
  if(relevant.size>100)throw Error('Zu viele Kalendertermine in einem Vorgang. Bitte Zeitraum aufteilen.');
  await Promise.all([...relevant].map(async id=>{const r=await request(eventPath(company.calendarId,id));if(r.status===404||r.status===410)events.set(id,null);else if(r.ok)events.set(id,await r.json());else throw Error('Kalendertermin nicht lesbar (HTTP '+r.status+').');}));
  // Unloaded existing IDs must never be synthesized: required operations fail closed.
  calendars.set(company.calendarId,{verified:true,name:data.summary||company.name,events,companyId:company.id,connectionKey});
 }
 return calendars;
}
async function deliverCalendar(env,job){
 if(env.CALENDAR_ENABLED!=='true')throw Error('Kalenderzustellung deaktiviert.');
 const key=env.CALENDAR_AUTH==='oauth'?validateCalendarJobKey(job):'';
 const request=(path,options)=>env.CALENDAR_AUTH==='oauth'?calendarOAuthFetch(env,key,path,options):google(env,path,options);
 const base='calendars/'+encodeURIComponent(job.calendarId)+'/events';
 const options=job.delete?{method:'DELETE'}:job.create?{method:'POST',body:JSON.stringify({...job.data,id:job.eventId})}:{method:'PATCH',body:JSON.stringify(job.data)};
 const response=await request((job.create?base:eventPath(job.calendarId,job.eventId))+'?sendUpdates=all',options);
 if(job.delete&&[404,410].includes(response.status))return;
 if(job.create&&response.status===409){const patch=await request(eventPath(job.calendarId,job.eventId)+'?sendUpdates=all',{method:'PATCH',body:JSON.stringify(job.data)});if(!patch.ok)throw Error('Kalenderaktualisierung HTTP '+patch.status);return;}
 if(!response.ok)throw Error('Kalenderzustellung HTTP '+response.status);
}
async function markNotification(db,id,status,error){
 if(!id)return [];
 return [statement(db,"UPDATE records SET data=json_set(data,'$.status',?,'$.sentAt',?,'$.error',?) WHERE table_name='Notifications' AND record_id=?",status,new Date().toISOString(),error,id)];
}
export async function drainOutbox(env){
 const calendarOnly=env.AUTOMATION_ENABLED!=='true';
 if(env.CALENDAR_AUTH==='oauth'&&(env.WRITE_ENABLED!=='true'||env.CUTOVER_CONFIRMED!=='true'))return {processed:0};
 if(env.MIGRATION_MODE!=='production'||(calendarOnly&&env.CALENDAR_ENABLED!=='true'))return {processed:0};
 const now=Date.now(),due=(await statement(env.DB,"SELECT current.* FROM outbox current WHERE (((current.status='QUEUED' OR current.status='RETRY') AND current.available_at<=?) OR (current.status='RUNNING' AND current.lease_until<?)) AND (current.kind<>'calendar' OR NOT EXISTS (SELECT 1 FROM outbox previous WHERE previous.kind='calendar' AND previous.rowid<current.rowid AND previous.status<>'SENT' AND json_extract(previous.payload,'$.calendarId')=json_extract(current.payload,'$.calendarId') AND json_extract(previous.payload,'$.eventId')=json_extract(current.payload,'$.eventId'))) AND (?=0 OR current.kind='calendar') ORDER BY current.rowid LIMIT 8",now,now,calendarOnly?1:0).all()).results;
 const results=await Promise.all(due.map(async job=>{
  const claimed=await statement(env.DB,"UPDATE outbox SET status='RUNNING',lease_until=?,attempts=attempts+1 WHERE id=? AND (status IN ('QUEUED','RETRY') OR (status='RUNNING' AND lease_until<?)) RETURNING id",now+120000,job.id,now).first();if(!claimed)return false;
  const payload=JSON.parse(job.payload);let gone=[];
  try{
   if(job.kind==='mail'){
    if(env.MAIL_ENABLED!=='true'||!env.MAIL_API_KEY||!env.MAIL_FROM)throw Error('E-Mail-Zustellung deaktiviert.');
    const m=payload.message;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.MAIL_API_KEY,'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify({from:env.MAIL_FROM,to:[m.to],subject:m.subject,text:m.body}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('E-Mail-Zustellung HTTP '+response.status);
   }else if(job.kind==='push'){
    if(env.PUSH_ENABLED!=='true'||!pushConfigured(env))throw Error('Push-Zustellung deaktiviert.');
    const kind=payload.notification.kind,tab=/AVAILABILITY/.test(kind)?'availability':/SHIFT|HANDOVER|PLAN|DUTY/.test(kind)?'standby':/TIMER/.test(kind)?'time':/LEAVE/.test(kind)?'leave':/SICK/.test(kind)?'sick':/MONTH/.test(kind)?'reports':'messages';
    const results=await Promise.all(payload.devices.map(device=>pushOne(env,{id:device.id,subscription:{endpoint:device.endpoint,p256dh:device.p256dh,auth:device.auth}},{...payload.notification,url:'/firetime.pro/?tab='+tab})));
    gone=results.filter(x=>x.gone||x.invalid).map(x=>x.id);
    const failed=results.filter(x=>!x.ok&&!x.gone&&!x.invalid);
    if(failed.length){payload.devices=payload.devices.filter(d=>failed.some(x=>x.id===d.id));throw Error('Push teilweise fehlgeschlagen.');}
    if(!results.some(x=>x.ok))throw Error('Kein aktives Push-Gerät erreichbar.');
   }else if(job.kind==='calendar')await deliverCalendar(env,payload);
   else throw Error('Unbekannter Hintergrundauftrag.');
   const changes=[statement(env.DB,"UPDATE outbox SET status='SENT',lease_until=0,error='' WHERE id=?",job.id),...await markNotification(env.DB,payload.notificationId,'SENT','')];
   if(job.kind==='calendar'&&payload.mirrorId&&!payload.delete)changes.push(statement(env.DB,"UPDATE records SET data=json_set(data,'$.status','SENT') WHERE table_name='CalendarMirrors' AND record_id=? AND json_extract(data,'$.sourceHash')=? AND json_extract(data,'$.calendarId')=? AND json_extract(data,'$.eventId')=?",payload.mirrorId,payload.mirrorHash,payload.calendarId,payload.eventId));
   for(const id of gone)changes.push(statement(env.DB,"DELETE FROM records WHERE table_name='PushDevices' AND record_id=? AND company_id=?",id,payload.actor.companyId));
   changes.push(statement(env.DB,"UPDATE metadata SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='revision'"));
   await env.DB.batch(changes);
   if(job.kind==='calendar')for(const planId of payload.planIds||[])await env.DB.batch([
    statement(env.DB,"UPDATE records SET data=json_set(data,'$.shareStatus','SENT','$.warnings','') WHERE table_name='PlanMonths' AND record_id=? AND json_extract(data,'$.shareStatus')='QUEUED' AND NOT EXISTS (SELECT 1 FROM outbox, json_each(outbox.payload,'$.planIds') p WHERE outbox.kind='calendar' AND p.value=? AND outbox.status<>'SENT')",planId,planId),
    statement(env.DB,"UPDATE metadata SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='revision'")
   ]);return true;
  }catch(err){
   const terminal=Number(job.attempts)+1>=8,error=String(err.message||'Zustellfehler').slice(0,150);
   const changes=[statement(env.DB,"UPDATE outbox SET status=?,payload=?,available_at=?,lease_until=0,error=? WHERE id=?",terminal?'ERROR':'RETRY',JSON.stringify(payload),Date.now()+Math.min(3600000,30000*2**Number(job.attempts)),error,job.id),...await markNotification(env.DB,payload.notificationId,terminal?'ERROR':'QUEUED',error)];
   if(job.kind==='calendar'&&payload.mirrorId&&!payload.delete&&terminal)changes.push(statement(env.DB,"UPDATE records SET data=json_set(data,'$.status','ERROR') WHERE table_name='CalendarMirrors' AND record_id=? AND json_extract(data,'$.sourceHash')=? AND json_extract(data,'$.calendarId')=? AND json_extract(data,'$.eventId')=?",payload.mirrorId,payload.mirrorHash,payload.calendarId,payload.eventId));
   for(const id of gone)changes.push(statement(env.DB,"DELETE FROM records WHERE table_name='PushDevices' AND record_id=? AND company_id=?",id,payload.actor.companyId));
   changes.push(statement(env.DB,"UPDATE metadata SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='revision'"));await env.DB.batch(changes);
   if(job.kind==='calendar'&&terminal)for(const planId of payload.planIds||[])await env.DB.batch([
    statement(env.DB,"UPDATE records SET data=json_set(data,'$.shareStatus','PARTIAL','$.warnings','Kalenderzustellung fehlgeschlagen; Hintergrundauftrag prüfen.') WHERE table_name='PlanMonths' AND record_id=?",planId),
    statement(env.DB,"UPDATE metadata SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='revision'")
   ]);return false;
  }
 }));
 return {processed:results.filter(Boolean).length};
}
