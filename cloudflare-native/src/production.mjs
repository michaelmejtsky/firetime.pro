import {Buffer} from 'node:buffer';
import {createHash,randomBytes} from 'node:crypto';
const sql=(db,q,...v)=>db.prepare(q).bind(...v);
async function key(env){if(String(env.FT_PEPPER||'').length<32)throw Error('Dauerhafter Systemschlüssel fehlt.');return crypto.subtle.importKey('raw',createHash('sha256').update(env.FT_PEPPER+'|FireTime Production v1').digest(),'AES-GCM',false,['encrypt','decrypt']);}
export async function sealSystem(env,context,value){const iv=randomBytes(12),bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:Buffer.from(context)},await key(env),Buffer.from(JSON.stringify(value)));return iv.toString('base64url')+'.'+Buffer.from(bytes).toString('base64url');}
export async function unsealSystem(env,context,value){const [iv,bytes]=value.split('.');return JSON.parse(Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url'),additionalData:Buffer.from(context)},await key(env),Buffer.from(bytes,'base64url'))).toString());}
export async function productionSettings(env,{createPush=false}={}){
 let current={...env};
 if(env.MAIL_PROVIDER==='gmail'){const gmail=await sql(env.DB,"SELECT public_json FROM integrations WHERE key='gmail'").first();const pub=gmail?JSON.parse(gmail.public_json):{};current.GMAIL_READY=pub.clientId===env.GOOGLE_DRIVE_CLIENT_ID&&pub.email===env.GOOGLE_DRIVE_ACCOUNT?'true':'false';}
 if(env.PUSH_ENABLED==='true'&&(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_JWK)){
  let row=await sql(env.DB,"SELECT * FROM integrations WHERE key='webpush'").first();
  if(!row&&createPush){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey),publicKey=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url');
   await sql(env.DB,"INSERT INTO integrations VALUES('webpush',?,?,?) ON CONFLICT(key) DO NOTHING",await sealSystem(env,'webpush',{privateKey}),JSON.stringify({publicKey}),new Date().toISOString()).run();row=await sql(env.DB,"SELECT * FROM integrations WHERE key='webpush'").first();
  }
  if(row){const secret=await unsealSystem(env,'webpush',row.encrypted);current.VAPID_PUBLIC_KEY=JSON.parse(row.public_json).publicKey;current.VAPID_PRIVATE_JWK=JSON.stringify(secret.privateKey);}
 }
 return current;
}
export async function productionStatus(env){
 const counts=(await sql(env.DB,'SELECT kind,status,count(*) AS count FROM outbox GROUP BY kind,status').all()).results;
 const gmail=await sql(env.DB,"SELECT public_json FROM integrations WHERE key='gmail'").first();
 const lastErrors=(await sql(env.DB,"SELECT status,error,created_at AS createdAt FROM outbox WHERE kind='mail' AND status IN ('ERROR','RETRY') ORDER BY rowid DESC LIMIT 5").all()).results;
 return {version:'2.1.0',production:env.MIGRATION_MODE==='production'&&env.WRITE_ENABLED==='true',automations:env.AUTOMATION_ENABLED==='true',mail:{enabled:env.MAIL_ENABLED==='true',provider:env.MAIL_PROVIDER||'resend',connected:env.MAIL_PROVIDER==='gmail'?env.GMAIL_READY==='true':Boolean(env.MAIL_API_KEY&&env.MAIL_FROM),email:gmail?JSON.parse(gmail.public_json).email:env.GOOGLE_DRIVE_ACCOUNT||'',callbackPath:'/gmail-callback',lastErrors},push:{enabled:env.PUSH_ENABLED==='true',configured:Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_JWK)},calendar:env.CALENDAR_ENABLED==='true',outbox:counts,pilotAdmin:env.PILOT_ADMIN_EMAIL||''};
}
