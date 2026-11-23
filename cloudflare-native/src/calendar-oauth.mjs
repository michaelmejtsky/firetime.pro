import {Buffer} from 'node:buffer';
import {createHash,randomBytes} from 'node:crypto';
const sql=(db,q,...v)=>db.prepare(q).bind(...v),hash=s=>createHash('sha256').update(s).digest('hex');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const scopes=['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events'];
export const calendarClient=env=>({id:env.GOOGLE_CALENDAR_CLIENT_ID||env.GOOGLE_DRIVE_CLIENT_ID,secret:env.GOOGLE_CALENDAR_CLIENT_SECRET||env.GOOGLE_DRIVE_CLIENT_SECRET});
const keyFor=(cid,uid)=>uid?'calendar-user:'+cid+':'+uid:'calendar:'+cid;
async function cryptoKey(env){if(String(env.FT_PEPPER||'').length<32)throw fail('Kalenderverbindung ist noch nicht eingerichtet.',503);return crypto.subtle.importKey('raw',createHash('sha256').update(env.FT_PEPPER+'|FireTime Calendar v1').digest(),'AES-GCM',false,['encrypt','decrypt']);}
export async function sealCalendar(env,key,value){const iv=randomBytes(12),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:Buffer.from(key+'|'+calendarClient(env).id)},await cryptoKey(env),Buffer.from(JSON.stringify(value)));return iv.toString('base64url')+'.'+Buffer.from(cipher).toString('base64url');}
async function unseal(env,key,text){try{const [iv,data]=text.split('.');return JSON.parse(Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url'),additionalData:Buffer.from(key+'|'+calendarClient(env).id)},await cryptoKey(env),Buffer.from(data,'base64url'))).toString());}catch{throw fail('Google-Kalender bitte erneut verbinden.',503);}}
async function json(response,label){if(!response.ok)throw fail(label+' (HTTP '+response.status+').',response.status===403?403:503);return response.json();}
function target(snapshot,p={}){
 const actor=snapshot.user,cid=String(p.companyId||actor?.companyId||''),personal=p.kind==='personal';
 if(!actor||actor.status!=='ACTIVE')throw fail('Bitte anmelden.',401);
 if(!cid||(actor.role!=='SYSADMIN'&&actor.companyId!==cid))throw fail('Kein Zugriff auf diese Firma.',403);
 const company=snapshot.records.find(x=>x.table_name==='Companies'&&x.record_id===cid);if(!company)throw fail('Firma nicht gefunden.',403);const active=JSON.parse(company.data).active;if(![true,'true','TRUE'].includes(active))throw fail('Firma ist nicht aktiv.',403);
 if(!personal&&!['ADMIN','SYSADMIN'].includes(actor.role))throw fail('Nur Firmenadministratoren dürfen den Hauptkalender verbinden.',403);
 return {actor,cid,uid:personal?actor.id:'',key:keyFor(cid,personal?actor.id:'')};
}
async function rowFor(env,key){return sql(env.DB,'SELECT * FROM integrations WHERE key=?',key).first();}
export async function calendarAccountStatus(env,snapshot,p,origin){const t=target(snapshot,p),row=await rowFor(env,t.key),pub=row?JSON.parse(row.public_json):{};return {configured:Boolean(calendarClient(env).id&&calendarClient(env).secret),connected:Boolean(row),email:pub.email||'',callbackUrl:new URL('/calendar-callback',origin).href,kind:t.uid?'personal':'company',enabled:env.CALENDAR_ENABLED==='true'};}
export async function startCalendarConnect(env,snapshot,p,sessionId,origin){
 const t=target(snapshot,p),client=calendarClient(env);if(!client.id||!client.secret)throw fail('Die zentrale Google-Kalenderverbindung muss vom Systemadmin eingerichtet werden.',503);
 const redirect=new URL('/calendar-callback',origin).href;if(!redirect.startsWith('https://'))throw fail('Google-Verbindung benötigt HTTPS.');
 const state=randomBytes(32).toString('hex');await sql(env.DB,'DELETE FROM oauth_states WHERE expires_at<?',Date.now()).run();
 await sql(env.DB,'INSERT INTO oauth_states VALUES(?,?,?,?,?)',hash(state),JSON.stringify({userId:t.actor.id,companyId:t.cid,personal:Boolean(t.uid)}),sessionId,redirect,Date.now()+600000).run();
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:client.id,redirect_uri:redirect,response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent',state}).toString();return {url:url.href};
}
export async function finishCalendarConnect(env,url){
 if(env.WRITE_ENABLED!=='true')throw fail('Schreibzugriff deaktiviert.',503);
 const raw=url.searchParams.get('state')||'';if(!/^[a-f0-9]{64}$/.test(raw))throw fail('Google-Rückmeldung ungültig.',403);
 const state=await sql(env.DB,'DELETE FROM oauth_states WHERE id=? AND redirect_uri=? RETURNING *',hash(raw),url.origin+'/calendar-callback').first();
 if(!state||state.expires_at<Date.now())throw fail('Verbindungslink abgelaufen oder bereits verwendet.',403);
 let context;try{context=JSON.parse(state.user_id);}catch{throw fail('Google-Rückmeldung ungültig.',403);}
 const ur=await sql(env.DB,"SELECT data FROM records WHERE table_name='Users' AND record_id=?",context.userId).first(),sr=await sql(env.DB,"SELECT data FROM records WHERE table_name='Sessions' AND record_id=?",state.session_id).first(),cr=await sql(env.DB,"SELECT data FROM records WHERE table_name='Companies' AND record_id=?",context.companyId).first();
 const actor=ur&&JSON.parse(ur.data),session=sr&&JSON.parse(sr.data);
 if(!session||session.userId!==actor?.id||Date.parse(session.expiresAt)<=Date.now()||!cr)throw fail('Sitzung abgelaufen. Bitte erneut anmelden.',403);
 const t=target({user:actor,records:[{table_name:'Companies',record_id:context.companyId,data:cr.data}]},{companyId:context.companyId,kind:context.personal?'personal':'company'});
 if(url.searchParams.has('error'))throw fail('Die Google-Freigabe wurde nicht abgeschlossen.');
 const code=url.searchParams.get('code');if(!code||code.length>4096)throw fail('Google-Code fehlt.');const client=calendarClient(env);
 const data=await json(await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code,client_id:client.id,client_secret:client.secret,redirect_uri:state.redirect_uri}),signal:AbortSignal.timeout(15000)}),'Google-Freigabe konnte nicht gespeichert werden');
 if(!data.access_token||scopes.slice(2).some(scope=>!String(data.scope||'').split(' ').includes(scope)))throw fail('Bitte den Kalenderzugriff bei Google vollständig bestätigen.',403);
 const user=await json(await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+data.access_token},signal:AbortSignal.timeout(15000)}),'Google-Konto konnte nicht geprüft werden');
 if(!user.sub||!user.email||!user.email_verified)throw fail('Google-Konto konnte nicht bestätigt werden.',403);
 const old=await rowFor(env,t.key),pub=old?JSON.parse(old.public_json):{};
 if(old&&(pub.sub!==user.sub||pub.clientId!==client.id))throw fail('Dieses Kalenderkonto ist bereits zugeordnet. Bitte dasselbe Google-Konto verwenden.',409);
 const refreshToken=data.refresh_token||(old?(await unseal(env,t.key,old.encrypted)).refreshToken:'');if(!refreshToken)throw fail('Google hat keinen dauerhaften Zugriff erteilt. Bitte erneut verbinden.',503);
 await sql(env.DB,'INSERT INTO integrations VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted,public_json=excluded.public_json,updated_at=excluded.updated_at',t.key,await sealCalendar(env,t.key,{refreshToken}),JSON.stringify({companyId:t.cid,userId:t.uid,sub:user.sub,email:user.email,clientId:client.id}),new Date().toISOString()).run();return {connected:true};
}
const tokens=new Map();
async function access(env,key){const row=await rowFor(env,key);if(!row)throw fail('Google Kalender bitte zuerst in FireTime verbinden.',503);const pub=JSON.parse(row.public_json),client=calendarClient(env);if(pub.clientId!==client.id)throw fail('Google Kalender bitte erneut verbinden.',503);const secret=await unseal(env,key,row.encrypted),cacheKey=hash(key+'|'+secret.refreshToken+'|'+client.id),cached=tokens.get(cacheKey);if(cached?.until>Date.now()+60000)return cached.token;
 const data=await json(await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:secret.refreshToken,client_id:client.id,client_secret:client.secret}),signal:AbortSignal.timeout(15000)}),'Google-Kalenderzugriff abgelaufen. Bitte erneut verbinden');if(!data.access_token)throw fail('Google-Kalender bitte erneut verbinden.',503);if(tokens.size>64)tokens.clear();tokens.set(cacheKey,{token:data.access_token,until:Date.now()+Number(data.expires_in||3600)*1000});return data.access_token;}
export async function calendarOAuthFetch(env,key,path,options={}){const token=await access(env,key);return fetch('https://www.googleapis.com/calendar/v3/'+path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});}
export async function writableCalendar(env,key,id){
 if(!id||id.length>250||!/^[^\s<>]+@[^\s<>]+$/.test(id))throw fail('Bitte eine gültige Kalender-ID auswählen oder eintragen.');
 const item=await json(await calendarOAuthFetch(env,key,'users/me/calendarList/'+encodeURIComponent(id)),'Kalender ist für dieses Google-Konto nicht zugänglich');
 if(!['owner','writer'].includes(item.accessRole))throw fail('Für diesen Kalender fehlen Schreibrechte. Bitte den Besitzer in FireTime verbinden lassen.',403);return item;
}
export async function calendarList(env,snapshot,p){const t=target(snapshot,p);let next='',items=[];for(let page=0;page<10;page++){const data=await json(await calendarOAuthFetch(env,t.key,'users/me/calendarList?minAccessRole=writer&maxResults=250'+(next?'&pageToken='+encodeURIComponent(next):'')),'Kalenderliste konnte nicht geladen werden');items.push(...(data.items||[]).filter(x=>!x.deleted&&['owner','writer'].includes(x.accessRole)).map(x=>({id:x.id,name:x.summaryOverride||x.summary||x.id,primary:Boolean(x.primary)})));next=data.nextPageToken;if(!next)break;}return {calendars:items};}
export async function verifyCalendarSelection(env,snapshot,p){
 const actor=snapshot.user,cid=String(p.companyId||actor.companyId||''),userId=String(p.userId||''),own=userId===actor.id;
 // Main-calendar writes require an administrator; staff can change only their own calendar.
 const personal=p.kind==='personal';
 if(actor.role==='STAFF'&&(!own||!personal))throw fail('Nur der eigene Kalender kann geändert werden.',403);
 if(personal&&!own)throw fail('Nur der eigene Google-Zugang kann verwendet werden.',403);
 const t=target(snapshot,{companyId:cid,kind:personal?'personal':'company'});
 if(userId&&!snapshot.records.some(x=>x.table_name==='Users'&&x.record_id===userId&&JSON.parse(x.data).companyId===cid))throw fail('Mitarbeiter gehört nicht zur Firma.',403);
 const id=String(p.calendarId||'').trim();if(!id)return {...p,companyId:cid,userId,calendarId:'',connectionKey:''};
 const key=t.key;
 if(!own&&t.uid)throw fail('Kein Zugriff.',403);
 await writableCalendar(env,key,id);return {...p,companyId:cid,userId,calendarId:id,connectionKey:key};
}
export function validateCalendarJobKey(job){const key=job.connectionKey||keyFor(job.companyId,''),allowed=[keyFor(job.companyId,''),...(job.userId?[keyFor(job.companyId,job.userId)]:[])];if(!job.companyId||!allowed.includes(key))throw fail('Kalenderauftrag gehört nicht zur Verbindung.',403);return key;}
