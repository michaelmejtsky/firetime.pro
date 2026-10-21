/**
 * FireTime Pro – Cloudflare Worker API gateway
 * Static UI: GitHub Pages. Data/authorization: Google Apps Script + Sheets.
 * No credential, password or service secret is stored in GitHub Pages.
 */
const MAX_BYTES = 3_700_000;
const MAX_RESPONSE_BYTES = 7_000_000;
const REQUEST_TYPES = new Set(['login', 'activate', 'logout', 'password', 'brand', 'api']);

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
}
function output(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type':'application/json; charset=utf-8', ...cors(origin)}
  });
}
function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function sign(secret, message) {
  const utf8 = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',utf8.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']
  );
  return hex(await crypto.subtle.sign('HMAC',key,utf8.encode(message)));
}

/** RFC 8291 (aes128gcm) + RFC 8292 (VAPID), native Workers WebCrypto.
 * VAPID_PRIVATE_JWK, VAPID_PUBLIC_KEY and VAPID_SUBJECT are Cloudflare secrets/vars.
 * NEVER place the signing key into a browser bundle, Sheets, or GitHub.
 */
const PUSH_MAX_BATCH=12;
const PUSH_MAX_BYTES=4096;
const PUSH_DOMAINS=['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','web.push.apple.com'];
const te=new TextEncoder();
function pushConfigured(env){
 try{
  const k=JSON.parse(env.VAPID_PRIVATE_JWK||'{}'),publicKey=String(env.VAPID_PUBLIC_KEY||'');
  return Boolean(env.VAPID_SUBJECT&&/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.VAPID_SUBJECT)&&
   k.kty==='EC'&&k.crv==='P-256'&&k.x&&k.y&&k.d&&
   /^[A-Za-z0-9_-]{86,88}$/.test(publicKey)&&pushB64ToBytes(publicKey).length===65);
 }catch{return false;}
}
function pushB64ToBytes(s){
 const x=String(s||'').replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(x+'='.repeat((4-x.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function pushB64(bytes){
 let s='';for(const b of bytes)s+=String.fromCharCode(b);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function pushJoin(...parts){
 const size=parts.reduce((total,p)=>total+p.length,0),out=new Uint8Array(size);
 let off=0;for(const p of parts){out.set(p,off);off+=p.length;}
 return out;
}
async function pushHmac(key,bytes){
 const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',k,bytes));
}
async function pushExpand(prk,info,length){
 return (await pushHmac(prk,pushJoin(info,Uint8Array.of(1)))).slice(0,length);
}
function pushDestination(endpoint){
 try{
  const u=new URL(endpoint);
  if(u.protocol!=='https:'||u.username||u.password||u.port||
     !PUSH_DOMAINS.includes(u.hostname.toLowerCase()))return null;
  return u;
 }catch{return null;}
}
function pushValidSubscription(s){
 if(!s||typeof s!=='object'||!pushDestination(s.endpoint))return false;
 try{return pushB64ToBytes(s.p256dh).length===65&&pushB64ToBytes(s.auth).length>=16;}
 catch{return false;}
}
async function pushEncrypt(text,subscription){
 const ua=pushB64ToBytes(subscription.p256dh);
 const auth=pushB64ToBytes(subscription.auth);
 const clientKey=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const as=new Uint8Array(await crypto.subtle.exportKey('raw',ephemeral.publicKey));
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:clientKey},ephemeral.privateKey,256));
 const prk=await pushHmac(auth,shared);
 const ikm=await pushExpand(prk,pushJoin(te.encode('WebPush: info'),Uint8Array.of(0),ua,as),32);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const base=await pushHmac(salt,ikm);
 const cek=await pushExpand(base,pushJoin(te.encode('Content-Encoding: aes128gcm'),Uint8Array.of(0)),16);
 const nonce=await pushExpand(base,pushJoin(te.encode('Content-Encoding: nonce'),Uint8Array.of(0)),12);
 const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const plaintext=pushJoin(te.encode(text),Uint8Array.of(2));
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,plaintext));
 const recordSize=4096;
 const rs=new Uint8Array([recordSize>>>24,(recordSize>>>16)&255,(recordSize>>>8)&255,recordSize&255]);
 const body=pushJoin(salt,rs,Uint8Array.of(as.length),as,encrypted);
 if(body.length>PUSH_MAX_BYTES)throw Error('Push message too long');
 return body;
}
async function pushVapid(env,audience){
 const jwk=JSON.parse(env.VAPID_PRIVATE_JWK);
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const header=pushB64(te.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
 const payload=pushB64(te.encode(JSON.stringify({aud:audience,exp:Math.floor(Date.now()/1000)+3600,sub:env.VAPID_SUBJECT})));
 const token=header+'.'+payload;
 const raw=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,te.encode(token)));
 // WebCrypto ECDSA signatures are JOSE r||s (64 bytes), as required by JWT ES256.
 if(raw.length!==64)throw Error('Unexpected VAPID signature format');
 return token+'.'+pushB64(raw);
}
async function pushOne(env,entry,notification){
 const s=entry.subscription;
 if(!pushValidSubscription(s))return {id:entry.id,ok:false,invalid:true};
 const destination=pushDestination(s.endpoint);
 const payload=JSON.stringify({
  title:notification.title||'FireTime Pro',
  body:notification.body||'Du hast eine neue Mitteilung.',
  tag:'firetime-'+String(notification.id||'message').slice(0,80),
  url:notification.url||'/',
  kind:notification.kind||'MESSAGE'
 });
 try{
  const [encrypted,jwt]=await Promise.all([
   pushEncrypt(payload,s),
   pushVapid(env,destination.origin)
  ]);
  const res=await fetch(s.endpoint,{
   method:'POST',
   headers:{
    'Content-Encoding':'aes128gcm',
    'Content-Type':'application/octet-stream',
    'Authorization':'vapid t='+jwt+', k='+env.VAPID_PUBLIC_KEY,
    'TTL':'86400',
    'Urgency':'normal'
   },
   body:encrypted,
   // Cloudflare Workers only supports 'follow' and 'manual'; never follow push redirects.
   redirect:'manual',
   signal:AbortSignal.timeout(9000)
  });
  return {id:entry.id,ok:res.status===201||res.status===202||res.status===200,
   gone:[404,410].includes(res.status),status:res.status};
 }catch(err){
  return {id:entry.id,ok:false,status:0,error:String(err.message||err).slice(0,160)};
 }
}
async function pushInternal(request,env){
 if(!env.GAS_SHARED_KEY||env.GAS_SHARED_KEY.length<48)return output({ok:false,error:'Push gateway secret missing'},503,'');
 const raw=await request.text();
 if(raw.length>60000)return output({ok:false,error:'Payload too large'},413,'');
 let signed;
 try{signed=JSON.parse(raw);}catch{return output({ok:false,error:'Bad JSON'},400,'');}
 const ts=Number(signed.ts),nonce=String(signed.nonce||''),payload=String(signed.payload||'');
 const sig=String(signed.signature||'').toLowerCase();
 if(!Number.isInteger(ts)||Math.abs(Date.now()/1000-ts)>120||! /^[a-f0-9]{32}$/.test(nonce)||
  !/^[a-f0-9]{64}$/.test(sig)||payload.length>50000)
  return output({ok:false,error:'Invalid push authorization'},401,'');
 const expected=await sign(env.GAS_SHARED_KEY,ts+'.'+nonce+'.'+payload);
 const a=te.encode(expected),b=te.encode(sig);
 // Comparison length fixed by previous syntax check.
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 if(diff!==0)return output({ok:false,error:'Invalid push signature'},403,'');
 if(!pushConfigured(env))return output({ok:false,error:'VAPID not configured'},503,'');
 let data;
 try{data=JSON.parse(payload);}catch{return output({ok:false,error:'Invalid payload'},400,'');}
 if(!Array.isArray(data.devices)||data.devices.length>PUSH_MAX_BATCH||
  !data.notification||typeof data.notification!=='object')
  return output({ok:false,error:'Invalid push request'},400,'');
 // IMPORTANT: restrict notification content; GAS generated this HMAC payload.
 // Only authenticated Apps Script can select a push category. Restrict navigation
 // to known tabs; never use a client-provided URL or arbitrary external origin.
 const kind=String(data.notification.kind||'COMM').slice(0,50);
 const tab=/^PUSH_(AVAILABILITY)$/.test(kind)?'availability':
   /^PUSH_(SHIFT|HANDOVER|PLAN)/.test(kind)?'standby':
   /^PUSH_TIMER_/.test(kind)?'time':
   /^PUSH_LEAVE/.test(kind)?'leave':
   /^PUSH_SICK/.test(kind)?'sick':
   /^PUSH_MONTH_/.test(kind)?'reports':'messages';
 const notice={
  title:String(data.notification.title||'FireTime Pro').slice(0,90),
  body:String(data.notification.body||'Neue Nachricht oder Aufgabe').slice(0,160),
  url:'/firetime.pro/?tab='+tab, // only whitelisted local tabs
  kind,
  id:String(data.notification.id||'message').slice(0,80)
 };
 const results=await Promise.all(data.devices.map(x=>pushOne(env,x,notice)));
 return output({ok:true,results},200,'');
}

export default {
  async fetch(request, env) {
    const allowed = String(env.PUBLIC_ORIGIN || '').replace(/\/$/,'');
    const origin = request.headers.get('Origin') || '';
    const path = new URL(request.url).pathname;
    if(path==='/internal/push'){
      if(request.method!=='POST')return output({ok:false,error:'Method not allowed'},405,'');
      try{return await pushInternal(request,env);}
      catch(err){return output({ok:false,error:'Push delivery failed'},502,'');}
    }
    if (!allowed || !allowed.startsWith('https://')) {
      return new Response('Gateway origin not configured', {status:503});
    }
    if (origin !== allowed) {
      // This includes requests without Origin. CORS is NOT the authentication layer;
      // Apps Script independently verifies the signed request AND user session.
      return output({ok:false,error:'Origin nicht erlaubt.'},403,allowed);
    }
    if (path !== '/api') return output({ok:false,error:'Nicht gefunden.'},404,allowed);
    if(request.method==='POST'&&request.headers.get('content-type')?.startsWith('application/json')){
      // pushInfo is public by design: the VAPID *public* key is not a secret.
      // All subscription writes are authorized by Apps Script user sessions.
      const cloned=request.clone();
      let info;
      try{info=await cloned.json();}catch{}
      if(info?.type==='pushInfo'){
        return output({ok:true,data:{configured:pushConfigured(env),
          publicKey:pushConfigured(env)?env.VAPID_PUBLIC_KEY:'',
          origin:allowed}},200,allowed);
      }
    }
    if (request.method === 'OPTIONS') {
      return new Response(null,{status:204,headers:cors(allowed)});
    }
    if (request.method !== 'POST') {
      return output({ok:false,error:'Nur POST erlaubt.'},405,allowed);
    }
    if (!env.GAS_WEBAPP_URL || !env.GAS_SHARED_KEY || env.GAS_SHARED_KEY.length < 48) {
      return output({ok:false,error:'Gateway nicht vollständig eingerichtet.'},503,allowed);
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(env.GAS_WEBAPP_URL)) {
      return output({ok:false,error:'Ungültige Backend-Adresse.'},503,allowed);
    }
    const length = Number(request.headers.get('content-length'));
    if (length && length > MAX_BYTES) {
      return output({ok:false,error:'Anfrage zu groß.'},413,allowed);
    }
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_BYTES) {
        return output({ok:false,error:'Anfrage zu groß.'},413,allowed);
      }
      const input = JSON.parse(raw);
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          !REQUEST_TYPES.has(input.type)) {
        return output({ok:false,error:'Ungültige Anfrage.'},400,allowed);
      }
      const payload = JSON.stringify(input);
      const ts = Math.floor(Date.now()/1000);
      const nonce = crypto.randomUUID().replaceAll('-','');
      const signature = await sign(env.GAS_SHARED_KEY, `${ts}.${nonce}.${payload}`);
      const backend = await fetch(env.GAS_WEBAPP_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ts,nonce,payload,signature}),
        redirect:'follow',
        signal:AbortSignal.timeout(25000)
      });
      if (!backend.ok) {
        return output({ok:false,error:'Google-Backend antwortet nicht korrekt.'},502,allowed);
      }
      const backendText = await backend.text();
      if (backendText.length > MAX_RESPONSE_BYTES) {
        return output({ok:false,error:'Backend-Antwort zu groß.'},502,allowed);
      }
      let result;
      try {result=JSON.parse(backendText);} catch(e) {
        return output({ok:false,error:'Backend liefert kein JSON. Ist die WebApp bereitgestellt?'},502,allowed);
      }
      if (!result || typeof result.ok !== 'boolean') {
        return output({ok:false,error:'Ungültige Antwort vom Backend.'},502,allowed);
      }
      return output(result,result.ok?200:(result.status||400),allowed);
    } catch(e) {
      return output({ok:false,error:'Verbindungsfehler zum Backend.'},502,allowed);
    }
  }
};
