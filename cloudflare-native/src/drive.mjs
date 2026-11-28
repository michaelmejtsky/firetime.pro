import {Buffer} from 'node:buffer';
import {createHash,randomBytes} from 'node:crypto';
const sql=(db,text,...values)=>db.prepare(text).bind(...values);
const hash=x=>createHash('sha256').update(x).digest('hex');
const error=(message,status=400)=>Object.assign(Error(message),{status});
const scope='https://www.googleapis.com/auth/drive.file';
const idOK=id=>/^[a-zA-Z0-9_-]{5,200}$/.test(String(id));
async function encryptionKey(env){
 if(String(env.FT_PEPPER||'').length<32)throw error('Dauerhafter Passwortschlüssel für die verschlüsselte Drive-Verbindung fehlt.',503);
 return crypto.subtle.importKey('raw',createHash('sha256').update(env.FT_PEPPER+'|FireTime Drive v1').digest(),'AES-GCM',false,['encrypt','decrypt']);
}
export async function sealDrive(env,data){const iv=randomBytes(12),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:Buffer.from('drive|'+env.GOOGLE_DRIVE_CLIENT_ID)},await encryptionKey(env),Buffer.from(JSON.stringify(data)));return iv.toString('base64url')+'.'+Buffer.from(cipher).toString('base64url');}
async function unseal(env,text){try{const [iv,cipher]=text.split('.');return JSON.parse(Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url'),additionalData:Buffer.from('drive|'+env.GOOGLE_DRIVE_CLIENT_ID)},await encryptionKey(env),Buffer.from(cipher,'base64url'))).toString());}catch{throw error('Drive-Verbindung ist nicht lesbar. Dauerhaften Passwortschlüssel und OAuth-Client prüfen.',503);}}
function configured(env){return Boolean(env.GOOGLE_DRIVE_CLIENT_ID&&env.GOOGLE_DRIVE_CLIENT_SECRET&&env.GOOGLE_DRIVE_ACCOUNT);}
async function connection(env){const row=await sql(env.DB,"SELECT * FROM integrations WHERE key='drive'").first();if(!row)throw error('Google Drive ist noch nicht verbunden. Im Firmenprofil als Systemadmin verbinden.',503);return {...JSON.parse(row.public_json),...await unseal(env,row.encrypted)};}
const accessTokens=new Map();
async function token(env,c){
 const key=hash(c.refreshToken+'|'+env.GOOGLE_DRIVE_CLIENT_ID),cached=accessTokens.get(key);if(cached?.expires>Date.now()+60000)return cached.token;
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_DRIVE_CLIENT_ID,client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET,refresh_token:c.refreshToken}),signal:AbortSignal.timeout(15000)});
 const data=await r.json().catch(()=>({}));if(!r.ok||!data.access_token)throw error('Google-Drive-Anmeldung abgelaufen oder widerrufen. Als Systemadmin erneut verbinden.',503);
 if(accessTokens.size>8)accessTokens.clear();accessTokens.set(key,{token:data.access_token,expires:Date.now()+Number(data.expires_in||3600)*1000});return data.access_token;
}
async function drive(access,path,options={}){return fetch('https://www.googleapis.com/'+path,{...options,headers:{Authorization:'Bearer '+access,...options.headers},signal:AbortSignal.timeout(30000)});}
async function checkedJson(r,label){if(!r.ok)throw error(label+' (HTTP '+r.status+').',503);return r.json().catch(()=>{throw error('Google hat keine gültige Antwort geliefert.',503);});}
async function metadata(access,id){return drive(access,'drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,parents,trashed,size,md5Checksum,appProperties,capabilities(canAddChildren)');}
export function hasFileStorage(env){return env.FILE_STORAGE==='drive'||Boolean(env.FILES);}
export function fileStorage(env){if(env.FILE_STORAGE==='drive')return new DriveFiles(env);if(!env.FILES)throw error('Dateiablage fehlt.',503);return env.FILES;}
export async function driveStatus(env,origin){
 const callbackUrl=new URL('/drive-callback',origin).href;
 if(env.FILE_STORAGE!=='drive')return {provider:'r2',connected:Boolean(env.FILES),configured:Boolean(env.FILES),callbackUrl};
 const row=await sql(env.DB,"SELECT public_json FROM integrations WHERE key='drive'").first();const data=row?JSON.parse(row.public_json):{};
 return {provider:'drive',configured:configured(env),connected:Boolean(row),email:data.email||env.GOOGLE_DRIVE_ACCOUNT||'',folderUrl:data.folderId?'https://drive.google.com/drive/folders/'+data.folderId:'',callbackUrl};
}
export async function startDriveConnect(env,actor,sessionId,origin){
 if(env.FILE_STORAGE!=='drive'||!configured(env))throw error('Google-Drive-Client-ID, Client-Secret und vorgesehenes Google-Konto zuerst in Cloudflare konfigurieren.',503);
 const state=randomBytes(32).toString('hex'),redirect=new URL('/drive-callback',origin).href;
 if(!redirect.startsWith('https://'))throw error('Drive-Verbindung benötigt HTTPS.');
 await sql(env.DB,'DELETE FROM oauth_states WHERE expires_at<?',Date.now()).run();
 await sql(env.DB,'INSERT INTO oauth_states VALUES(?,?,?,?,?)',hash(state),actor.id,sessionId,redirect,Date.now()+600000).run();
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:env.GOOGLE_DRIVE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope,access_type:'offline',prompt:'consent',state,login_hint:env.GOOGLE_DRIVE_ACCOUNT}).toString();return {url:url.href};
}
export async function finishDriveConnect(env,url){
 if(env.FILE_STORAGE!=='drive'||!configured(env)||env.WRITE_ENABLED!=='true')throw error('Drive-Verbindung ist noch nicht konfiguriert.',503);
 const raw=url.searchParams.get('state')||'';if(!/^[a-f0-9]{64}$/.test(raw))throw error('Google-Rückmeldung ist ungültig.',403);
 const state=await sql(env.DB,'DELETE FROM oauth_states WHERE id=? RETURNING *',hash(raw)).first();
 if(!state||state.expires_at<Date.now()||state.redirect_uri!==url.origin+'/drive-callback')throw error('Drive-Verbindungslink ist abgelaufen oder bereits verwendet.',403);
 const user=await sql(env.DB,"SELECT data FROM records WHERE table_name='Users' AND record_id=?",state.user_id).first(),session=await sql(env.DB,"SELECT data FROM records WHERE table_name='Sessions' AND record_id=?",state.session_id).first();
 const u=user&&JSON.parse(user.data),s=session&&JSON.parse(session.data);
 if(!u||u.role!=='SYSADMIN'||u.status!=='ACTIVE'||!s||s.userId!==u.id||Date.parse(s.expiresAt)<=Date.now())throw error('Systemadmin-Sitzung ist nicht mehr gültig.',403);
 if(url.searchParams.has('error'))throw error('Die Google-Freigabe wurde nicht abgeschlossen.');
 const code=url.searchParams.get('code');if(!code||code.length>4096)throw error('Google-Rückmeldung enthält keinen gültigen Code.');
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code,client_id:env.GOOGLE_DRIVE_CLIENT_ID,client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET,redirect_uri:state.redirect_uri}),signal:AbortSignal.timeout(15000)});
 const data=await checkedJson(r,'Google-Freigabe konnte nicht übernommen werden');if(!data.access_token)throw error('Google-Zugriffstoken fehlt.',503);
 if(!String(data.scope||'').split(' ').includes(scope))throw error('Google-Dateifreigabe wurde nicht erteilt.',403);
 const about=await checkedJson(await drive(data.access_token,'drive/v3/about?fields=user(emailAddress,permissionId)'),'Google-Konto konnte nicht geprüft werden');
 const email=String(about.user?.emailAddress||'').toLowerCase(),ownerId=String(about.user?.permissionId||'');
 if(email!==String(env.GOOGLE_DRIVE_ACCOUNT).trim().toLowerCase()||!ownerId)throw error('Bitte das vorgesehene Google-Konto für FireTime verwenden.',403);
 const old=await sql(env.DB,"SELECT * FROM integrations WHERE key='drive'").first(),previous=old?JSON.parse(old.public_json):{};
 if(old&&(previous.ownerId!==ownerId||previous.clientId!==env.GOOGLE_DRIVE_CLIENT_ID))throw error('Bestehende Dateiablage darf nicht auf ein anderes Konto oder einen anderen OAuth-Client umgestellt werden.',409);
 const refreshToken=data.refresh_token||(old?(await unseal(env,old.encrypted)).refreshToken:'');if(!refreshToken)throw error('Google hat keinen dauerhaften Zugriff erteilt. Verbindung erneut mit Freigabe starten.',503);
 let folderId=previous.folderId;
 if(folderId){const m=await checkedJson(await metadata(data.access_token,folderId),'FireTime-Ordner nicht erreichbar');if(m.trashed||m.mimeType!=='application/vnd.google-apps.folder'||m.capabilities?.canAddChildren===false)throw error('FireTime-Ordner fehlt oder ist nicht beschreibbar.',503);}
 else{const folder=await checkedJson(await drive(data.access_token,'drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'FireTime Pro – Private Dateien',mimeType:'application/vnd.google-apps.folder',appProperties:{firetime:'native-private-v1'}})}),'Privater FireTime-Ordner konnte nicht angelegt werden');folderId=folder.id;}
 if(!idOK(folderId))throw error('Google hat keine gültige Ordner-ID geliefert.',503);
 const publicData={email,ownerId,folderId,clientId:env.GOOGLE_DRIVE_CLIENT_ID};
 await sql(env.DB,"INSERT INTO integrations VALUES('drive',?,?,?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted,public_json=excluded.public_json,updated_at=excluded.updated_at",await sealDrive(env,{refreshToken}),JSON.stringify(publicData),new Date().toISOString()).run();
 return {connected:true};
}
export async function testDriveConnection(env){const c=await connection(env),access=await token(env,c),m=await checkedJson(await metadata(access,c.folderId),'FireTime-Ordner nicht erreichbar');if(m.trashed||m.mimeType!=='application/vnd.google-apps.folder'||m.capabilities?.canAddChildren===false)throw error('FireTime-Ordner ist nicht beschreibbar.',503);return {ok:true,provider:'drive',email:c.email};}
export class DriveFiles{
 constructor(env){this.env=env;}
 async ready(){if(!configured(this.env))throw error('Google Drive ist noch nicht eingerichtet.',503);this.pending??=connection(this.env);const c=await this.pending;if(!idOK(c.folderId)||c.clientId!==this.env.GOOGLE_DRIVE_CLIENT_ID||c.email!==String(this.env.GOOGLE_DRIVE_ACCOUNT).toLowerCase())throw error('Drive-Konto, OAuth-Client oder Ordner stimmen nicht mit der gespeicherten Verbindung überein.',503);return {c,access:await token(this.env,c)};}
 async location(id,c){const row=await sql(this.env.DB,'SELECT * FROM file_locations WHERE id=?',id).first();if(row&&(row.folder_id!==c.folderId||row.owner_id!==c.ownerId))throw error('Datei gehört zu einer anderen Drive-Ablage.',403);return row;}
 async put(id,value,options={}){
  const bytes=new Uint8Array(value),sha=hash(bytes);if(bytes.length>12000000)throw error('Datei ist zu groß.');
  const {c,access}=await this.ready();let row=await this.location(id,c);
  if(!row){const ids=await checkedJson(await drive(access,'drive/v3/files/generateIds?count=1&space=drive&type=files'),'Drive-Datei-ID konnte nicht reserviert werden');const remote=ids.ids?.[0];if(!idOK(remote))throw error('Drive-Datei-ID ungültig.',503);
   await sql(this.env.DB,"INSERT OR IGNORE INTO file_locations VALUES(?,?,?,?,?,?,'RESERVED',?)",id,remote,c.folderId,c.ownerId,sha,bytes.length,new Date().toISOString()).run();row=await this.location(id,c);
  }
  if(!row)throw error('Drive-Datei-ID konnte nicht eindeutig reserviert werden. Bitte erneut versuchen.',503);
  if(row.sha256!==sha||Number(row.size)!==bytes.length||row.state==='TRASHED')throw error('Eine vorhandene Datei darf nicht überschrieben werden.',409);
  const verify=async r=>{const m=await checkedJson(r,'Drive-Datei konnte nicht geprüft werden');if(m.trashed||!m.parents?.includes(c.folderId)||m.appProperties?.firetimeId!==id||m.appProperties?.firetimeSha256!==sha||Number(m.size)!==bytes.length||m.md5Checksum!==createHash('md5').update(bytes).digest('hex'))throw error('Drive-Datei stimmt nicht mit der gespeicherten Prüfsumme überein.',409);};
  let exists=false;if(row.state==='READY'){const r=await metadata(access,row.provider_id);if(r.status!==404){await verify(r);exists=true;}}
  if(!exists){
   let name=id;try{name=decodeURIComponent(options.customMetadata?.filename||id);}catch{}
   const mime=options.httpMetadata?.contentType||'application/octet-stream';if(!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime))throw error('Dateityp ungültig.');const boundary='firetime_'+randomBytes(16).toString('hex');
   const meta={id:row.provider_id,name,mimeType:mime,parents:[c.folderId],appProperties:{firetimeId:id,firetimeSha256:sha}};
   const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+boundary+'\r\nContent-Type: '+mime+'\r\n\r\n',bytes,'\r\n--'+boundary+'--\r\n']);
   const r=await drive(access,'upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
   if(r.status===409)await verify(await metadata(access,row.provider_id));else {const created=await checkedJson(r,'Datei konnte nicht in Drive gespeichert werden');if(created.id!==row.provider_id)throw error('Google hat eine unerwartete Datei-ID zurückgegeben.',503);}
  }
  await sql(this.env.DB,"UPDATE file_locations SET state='READY' WHERE id=?",id).run();
 }
 async get(id){
  const {c,access}=await this.ready(),row=await this.location(id,c);if(!row||row.state!=='READY')return null;
  const r=await drive(access,'drive/v3/files/'+encodeURIComponent(row.provider_id)+'?alt=media');if(r.status===404)return null;if(!r.ok)throw error('Datei konnte nicht aus Drive geladen werden (HTTP '+r.status+').',503);
  const length=Number(r.headers.get('Content-Length')||0);if(length>12000000)throw error('Drive-Datei ist zu groß.',503);
  if(Number(row.size)>12000000)throw error('Drive-Datei ist zu groß.',503);
  const reader=r.body.getReader(),chunks=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>Number(row.size)){await reader.cancel();throw error('Drive-Dateigröße hat sich geändert.',503);}chunks.push(part.value);}
  const content=new Uint8Array(size);let offset=0;for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.byteLength;}const bytes=content.buffer;if(bytes.byteLength!==Number(row.size)||hash(new Uint8Array(bytes))!==row.sha256)throw error('Drive-Dateiprüfsumme stimmt nicht.',503);return {arrayBuffer:async()=>bytes};
 }
 async delete(id){
  const {c,access}=await this.ready(),row=await this.location(id,c);if(!row||row.state==='TRASHED')return;
  const r=await drive(access,'drive/v3/files/'+encodeURIComponent(row.provider_id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:true})});if(!r.ok&&r.status!==404)throw error('Verworfene Datei konnte nicht in den Drive-Papierkorb verschoben werden.',503);
  await sql(this.env.DB,"UPDATE file_locations SET state='TRASHED' WHERE id=?",id).run();
 }
}
