import {Buffer} from 'node:buffer';
import {createHash,randomBytes} from 'node:crypto';
import {sealSystem,unsealSystem} from './production.mjs';
const sql=(db,q,...v)=>db.prepare(q).bind(...v),hash=s=>createHash('sha256').update(s).digest('hex');
const fail=(message,status=400)=>Object.assign(Error(message),{status}),scope='https://www.googleapis.com/auth/gmail.send';
const context=env=>'gmail|'+env.GOOGLE_DRIVE_CLIENT_ID;
async function checked(r,message){if(!r.ok)throw fail(message+' (HTTP '+r.status+').',503);return r.json();}
export async function startGmailConnect(env,actor,sessionId,origin){
 if(actor.role!=='SYSADMIN')throw fail('Nur der Systemadmin darf den zentralen Mailversand verbinden.',403);
 if(!env.GOOGLE_DRIVE_CLIENT_ID||!env.GOOGLE_DRIVE_CLIENT_SECRET)throw fail('Zentraler Google-Webclient fehlt.',503);
 const state=randomBytes(32).toString('hex'),redirect=new URL('/gmail-callback',origin).href;if(!redirect.startsWith('https://'))throw fail('HTTPS erforderlich.');
 await sql(env.DB,'INSERT INTO oauth_states VALUES(?,?,?,?,?)',hash(state),actor.id,sessionId,redirect,Date.now()+600000).run();
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:env.GOOGLE_DRIVE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'openid email '+scope,access_type:'offline',prompt:'consent',state,login_hint:env.GOOGLE_DRIVE_ACCOUNT}).toString();return {url:url.href};
}
export async function finishGmailConnect(env,url){
 if(env.WRITE_ENABLED!=='true')throw fail('Schreibzugriff deaktiviert.',503);
 const raw=url.searchParams.get('state')||'';if(!/^[a-f0-9]{64}$/.test(raw))throw fail('Google-Rückmeldung ungültig.',403);
 const state=await sql(env.DB,'DELETE FROM oauth_states WHERE id=? AND redirect_uri=? RETURNING *',hash(raw),url.origin+'/gmail-callback').first();if(!state||state.expires_at<Date.now())throw fail('Google-Verbindungslink abgelaufen oder bereits verwendet.',403);
 const ur=await sql(env.DB,"SELECT data FROM records WHERE table_name='Users' AND record_id=?",state.user_id).first(),sr=await sql(env.DB,"SELECT data FROM records WHERE table_name='Sessions' AND record_id=?",state.session_id).first(),u=ur&&JSON.parse(ur.data),s=sr&&JSON.parse(sr.data);
 if(!u||u.role!=='SYSADMIN'||u.status!=='ACTIVE'||!s||s.userId!==u.id||Date.parse(s.expiresAt)<=Date.now())throw fail('Systemadmin-Sitzung ist nicht mehr gültig.',403);
 if(url.searchParams.has('error'))throw fail('Google-Mailfreigabe wurde nicht abgeschlossen.');const code=url.searchParams.get('code');if(!code||code.length>4096)throw fail('Google-Code fehlt.');
 const tokens=await checked(await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code,client_id:env.GOOGLE_DRIVE_CLIENT_ID,client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET,redirect_uri:state.redirect_uri}),signal:AbortSignal.timeout(15000)}),'Google-Mailfreigabe fehlgeschlagen');
 if(!tokens.access_token||!String(tokens.scope||'').split(' ').includes(scope))throw fail('Bitte die Freigabe zum Senden von E-Mails bestätigen.',403);
 const account=await checked(await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(15000)}),'Google-Konto konnte nicht geprüft werden');
 if(!account.sub||account.email_verified!==true||String(account.email).toLowerCase()!==String(env.GOOGLE_DRIVE_ACCOUNT).toLowerCase())throw fail('Bitte das vorgesehene FireTime-Systemkonto verwenden.',403);
 const old=await sql(env.DB,"SELECT * FROM integrations WHERE key='gmail'").first(),pub=old?JSON.parse(old.public_json):{};
 if(old&&(pub.sub!==account.sub||pub.clientId!==env.GOOGLE_DRIVE_CLIENT_ID))throw fail('Bitte dasselbe zentrale Google-Konto verwenden.',409);
 const refreshToken=tokens.refresh_token||(old?(await unsealSystem(env,context(env),old.encrypted)).refreshToken:'');if(!refreshToken)throw fail('Dauerhafter Google-Zugriff fehlt. Bitte erneut verbinden.',503);
 await sql(env.DB,"INSERT INTO integrations VALUES('gmail',?,?,?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted,public_json=excluded.public_json,updated_at=excluded.updated_at",await sealSystem(env,context(env),{refreshToken}),JSON.stringify({sub:account.sub,email:String(account.email).toLowerCase(),clientId:env.GOOGLE_DRIVE_CLIENT_ID}),new Date().toISOString()).run();return {connected:true};
}
const cache=new Map();
async function access(env){const row=await sql(env.DB,"SELECT * FROM integrations WHERE key='gmail'").first();if(!row)throw fail('Zentralen Gmail-Versand bitte verbinden.',503);const pub=JSON.parse(row.public_json);if(pub.clientId!==env.GOOGLE_DRIVE_CLIENT_ID||pub.email!==env.GOOGLE_DRIVE_ACCOUNT)throw fail('Zentrales Gmail-Konto stimmt nicht überein.',503);const secret=await unsealSystem(env,context(env),row.encrypted),key=hash(secret.refreshToken+'|'+env.GOOGLE_DRIVE_CLIENT_ID),old=cache.get(key);if(old?.until>Date.now()+60000)return {token:old.token,email:pub.email};
 const data=await checked(await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:secret.refreshToken,client_id:env.GOOGLE_DRIVE_CLIENT_ID,client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET}),signal:AbortSignal.timeout(15000)}),'Gmail-Zugriff abgelaufen. Bitte erneut verbinden');if(!data.access_token)throw fail('Google-Zugriff fehlt.',503);if(cache.size>8)cache.clear();cache.set(key,{token:data.access_token,until:Date.now()+Number(data.expires_in||3600)*1000});return {token:data.access_token,email:pub.email};}
export function gmailRaw(email,message,jobId){
 const address=String(message.to||'').trim();if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address))throw fail('Ungültige Empfängeradresse.');
 const subject=Buffer.from(String(message.subject||'FireTime Pro').replace(/[\r\n]/g,' ')).toString('base64'),body=Buffer.from(String(message.body||'')).toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
 const raw=['From: FireTime Pro <'+email+'>','To: '+address,'Subject: =?UTF-8?B?'+subject+'?=','Message-ID: <firetime-'+hash(jobId)+'@'+email.split('@')[1]+'>','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',''+body].join('\r\n');return Buffer.from(raw).toString('base64url');
}
export async function sendGmail(env,message,jobId){let c;try{c=await access(env);}catch(err){err.definitelyNotSent=true;throw err;}let response;try{response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({raw:gmailRaw(c.email,message,jobId)}),signal:AbortSignal.timeout(15000)});}catch{throw Object.assign(Error('Gmail-Versandstatus unklar. Vor erneutem Versand im Gesendet-Ordner prüfen.'),{uncertain:true});}
 if(!response.ok)throw Object.assign(Error('Gmail-Zustellung HTTP '+response.status),{uncertain:response.status>=500,definitelyNotSent:response.status<500});let data;try{data=await response.json();}catch{throw Object.assign(Error('Gmail-Bestätigung unklar. Gesendet-Ordner prüfen.'),{uncertain:true});}if(!data.id)throw Object.assign(Error('Gmail-Bestätigung fehlt. Gesendet-Ordner prüfen.'),{uncertain:true});return data.id;}
