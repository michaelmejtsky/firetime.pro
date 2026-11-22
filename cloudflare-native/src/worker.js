import {createCore} from './core.mjs';
import {Runtime,digest} from './runtime.mjs';
import {loadSnapshot,commit,Conflict,readReceipt,statement} from './store.mjs';
import {prepareCalendars,drainOutbox} from './effects.mjs';
import contract from './contract.json' with {type:'json'};
const TYPES=new Set(['login','activate','resetRequest','resetConfirm','logout','password','brand','api','pushInfo']);
const READS=new Set(['home','adminOverview','profileGet','licenseGet','activityTypesGet','timerStatus','commList','commPulse','commPhoto','pushStatus','planWorkflow','shiftPeriodSummary','leaveAccount','leavePolicyGet','absenceHistory','absencePdfArchive','absencePdfChunk','report','pdfJobStatus','pdfArchive','pdfChunk','pdfBatchArchive','pdfBatchChunk','rulesGet','calendarTest','audit','reportSubmissions','yearOverview','availabilityOverview','pdfVector','summaryPdf']);
function allowedOrigin(request,env){const origin=request.headers.get('Origin')||'';const self=new URL(request.url).origin;const allowed=new Set([self,...String(env.PUBLIC_ORIGINS||'').split(',').map(x=>x.trim()).filter(x=>/^https:\/\//.test(x))]);return allowed.has(origin)?origin:origin?'':self;}
function headers(origin){return {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Request-Id, X-FireTime-Staging-Key','Vary':'Origin'};}
function json(value,status=200,origin=''){return new Response(JSON.stringify(value),{status,headers:headers(origin)});}
const secureEqual=(a,b)=>digest(String(a))===digest(String(b));
function stagingAllowed(request,env){if(env.MIGRATION_MODE==='production')return true;const key=String(env.STAGING_ACCESS_KEY||'');if(key.length<32)return false;const cookie=request.headers.get('Cookie')||'';return secureEqual(request.headers.get('X-FireTime-Staging-Key')||'',key)||cookie.split(';').some(x=>x.trim()==='ft_staging='+digest(key+'|firetime-preview'));}
async function body(request){if(Number(request.headers.get('Content-Length')||0)>16000000)throw Object.assign(Error('Anfrage zu groß.'),{status:413});const reader=request.body?.getReader();let length=0;const chunks=[];if(!reader)throw Error('Leere Anfrage.');while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16000000){await reader.cancel();throw Object.assign(Error('Anfrage zu groß.'),{status:413});}chunks.push(value);}const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));}
function validate(input){if(!input||typeof input!=='object'||!TYPES.has(input.type))throw Error('Ungültige Anfrage.');if(input.type==='api'&&(!contract.actions.includes(input.action)||input.data&&typeof input.data!=='object'))throw Error('Unbekannte API-Aktion.');if(['login','activate','resetConfirm','password'].includes(input.type)&&JSON.stringify(input).length>2000)throw Error('Anfrage zu groß.');}
export async function execute(env,input,requestId=''){
 if(env.MIGRATION_MODE==='production'&&env.CUTOVER_CONFIRMED!=='true')throw Object.assign(Error('Produktivumschaltung wurde noch nicht freigegeben.'),{status:503});
 if(!env.DB||!env.FILES)throw Object.assign(Error('Cloudflare-Datenbank oder Dateiablage fehlt.'),{status:503});
 if(!env.FT_PEPPER&&['login','activate','password','resetConfirm'].includes(input.type))throw Object.assign(Error('Passwortkonfiguration fehlt. Bestehenden FT_PEPPER sicher übernehmen.'),{status:503});
 const logicalWrite=input.type==='api'?!READS.has(input.action):!['brand','pushInfo'].includes(input.type);
 if(logicalWrite&&env.WRITE_ENABLED!=='true')throw Object.assign(Error('Testsystem ist schreibgeschützt. Datenübernahme und Freigabe fehlen noch.'),{status:503});
 const requestHash=digest(JSON.stringify(input));
 for(let attempt=0;attempt<3;attempt++){
  const snapshot=await loadSnapshot(env,input);
  if(input.type==='api'&&logicalWrite&&requestId){const saved=await readReceipt(env,requestId,snapshot.user.id,requestHash);if(saved)return saved;}
  const calendars=await prepareCalendars(env,snapshot,input);
  const runtime=new Runtime({...snapshot,calendars}),core=createCore(runtime);
  let value;
  try{
   switch(input.type){
    case 'login':value=core.ft_login(input.email,input.password,input.remember===true);break;
    case 'activate':value=core.ft_activate(input.invite,input.password);break;
    case 'resetRequest':value=core.ft_passwordResetRequest_(input.email);break;
    case 'resetConfirm':value=core.ft_passwordResetConfirm_(input.resetToken,input.password);break;
    case 'logout':value=core.ft_logout(input.token);break;
    case 'password':value=core.ft_changePassword(input.token,input.current,input.next);break;
    case 'brand':value=core.ft_brandForLogin(input.slug);break;
    case 'api':value=core.ft_api(input.token,input.action,input.data||{});break;
   }
  }catch(err){
   try{await commit(env,snapshot,runtime,{failure:true});}catch(conflict){if(conflict instanceof Conflict&&attempt<2)continue;throw conflict;}
   throw err;
  }
  // Persist queued external effects truthfully; never label queue acceptance as delivery.
  if(runtime.calendarChanges.size){
   for(const row of runtime.tables.get('PlanMonths').rows)if(row.shareStatus==='SENT'&&(runtime.original.get('PlanMonths'+'\0'+row.id)!==JSON.stringify(row)||(row.companyId===(input.data?.companyId||snapshot.user?.companyId)&&row.month===input.data?.month))){row.shareStatus='QUEUED';row.warnings='Kalenderübertragung vorgemerkt. Zustellstatus folgt im Hintergrund.';}
   if(value&&typeof value==='object'&&!Array.isArray(value)){value.calendarQueued=true;value.calendarUpdated=false;value.warning='Kalenderübertragung vorgemerkt; noch nicht als zugestellt bestätigt.';}
  }
  if(runtime.jobs.size&&typeof value==='string')value+=' (Zur Zustellung vorgemerkt.)';
  const result={ok:true,data:value};
  const receipt=input.type==='api'&&logicalWrite&&requestId?{id:requestId,actorId:snapshot.user.id,hash:requestHash,response:result}:null;
  if(env.WRITE_ENABLED!=='true'&&(runtime.changedRows().length||runtime.jobs.size||runtime.newFiles.size))throw Object.assign(Error('Dieser Abruf benötigt einen Schreibzugriff; Testsystem bleibt schreibgeschützt.'),{status:503});
  try{await commit(env,snapshot,runtime,{receipt});return result;}catch(err){
   if(err instanceof Conflict){if(receipt){const existing=await readReceipt(env,requestId,snapshot.user.id,requestHash);if(existing)return existing;}if(attempt<2)continue;}
   throw err;
  }
 }
 throw new Conflict('Gleichzeitige Änderung. Bitte neu laden.');
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url),origin=allowedOrigin(request,env),path=url.pathname.replace(/^\/firetime\.pro(?=\/)/,'');
  if(path==='/health')return json({ok:true,version:contract.version,mode:env.MIGRATION_MODE||'staging',databaseConfigured:Boolean(env.DB),filesConfigured:Boolean(env.FILES),writes:env.WRITE_ENABLED==='true'},200,origin);
  if(path==='/staging-access'&&request.method==='POST'){
   if(!origin)return json({ok:false,error:'Origin nicht erlaubt.'},403,'');
   const form=await request.formData(),key=String(env.STAGING_ACCESS_KEY||'');
   if(key.length<32||!secureEqual(form.get('key')||'',key))return new Response('Testzugang ungültig.',{status:403});
   return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':`ft_staging=${digest(key+'|firetime-preview')}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`,'Cache-Control':'no-store'}});
  }
  if(request.method==='OPTIONS')return origin?new Response(null,{status:204,headers:headers(origin)}):json({ok:false,error:'Origin nicht erlaubt.'},403,'');
  if(!stagingAllowed(request,env)){
   if(path==='/api')return json({ok:false,error:'Geschützter Testbetrieb. Testzugang erforderlich.'},403,origin);
   return new Response('<!doctype html><html lang="de"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FireTime Pro Testbetrieb</title><body style="font:18px system-ui;background:#12263e;color:#fff;padding:10vh 8vw"><h1>FireTime Pro · Testbetrieb</h1><p>Getrennte Vorschau für die Cloudflare-Umstellung.</p><form method="post" action="/staging-access"><label>Testzugang <input name="key" type="password" required autocomplete="off"></label> <button>Öffnen</button></form></body></html>',{status:401,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
  }
  if(path!=='/api'){
   if(!env.ASSETS)return new Response('Frontend nicht gebaut.',{status:503});
   const assetUrl=new URL(request.url);assetUrl.pathname=path;return env.ASSETS.fetch(new Request(assetUrl,request));
  }
  if(!origin)return json({ok:false,error:'Origin nicht erlaubt.'},403,'');
  if(request.method!=='POST')return json({ok:false,error:'Nur POST erlaubt.'},405,origin);
  if(!String(request.headers.get('Content-Type')||'').startsWith('application/json'))return json({ok:false,error:'JSON erforderlich.'},415,origin);
  const started=Date.now();let input;
  try{
   input=await body(request);validate(input);
   if(input.type==='pushInfo')return json({ok:true,data:{configured:env.PUSH_ENABLED==='true'&&Boolean(env.VAPID_PUBLIC_KEY)&&Boolean(env.VAPID_PRIVATE_JWK),publicKey:env.PUSH_ENABLED==='true'?env.VAPID_PUBLIC_KEY||'':'',origin}},200,origin);
   const id=request.headers.get('X-Request-Id')||'';
   if(id&&!/^[a-zA-Z0-9_-]{12,100}$/.test(id))throw Error('Ungültige Anfragekennung.');
   const result=await execute(env,input,id);
   if(env.MIGRATION_MODE==='production'&&env.AUTOMATION_ENABLED==='true')ctx.waitUntil(drainOutbox(env));
   return json(result,200,origin);
  }catch(err){
   const status=err instanceof Conflict?409:err.status||(/anmelden|Sitzung|Passwort ungültig|Zugang nicht aktiv/.test(err.message)?401:400);
   const safe=/D1_|SQLITE_|UNIQUE constraint|NOT NULL constraint/.test(String(err.message))?'Datenbankkonflikt. Bitte Eingabe prüfen und erneut laden.':String(err.message||'Serverfehler.').slice(0,350);
   // No request bodies, tokens, names, email addresses or document text in logs.
   console.warn('firetime-native',{action:input?.type==='api'?input.action:input?.type||'parse',status,ms:Date.now()-started});
   return json({ok:false,error:safe,status},status,origin);
  }
 },
 async scheduled(controller,env,ctx){
  if(env.AUTOMATION_ENABLED!=='true'||env.WRITE_ENABLED!=='true'||env.MIGRATION_MODE!=='production'||env.CUTOVER_CONFIRMED!=='true')return;
  ctx.waitUntil((async()=>{
   for(let attempt=0;attempt<3;attempt++){
    const snapshot=await loadSnapshot(env,{},{system:true}),runtime=new Runtime(snapshot),core=createCore(runtime);
    core.ft_timerTick_();core.ft_tick();core.ft_pdfWorker_();
    try{await commit(env,snapshot,runtime);break;}catch(err){if(!(err instanceof Conflict)||attempt===2)throw err;}
   }
   await drainOutbox(env);
   await env.DB.batch([statement(env.DB,'DELETE FROM cache WHERE expires_at<?',Date.now()),statement(env.DB,'DELETE FROM request_receipts WHERE expires_at<?',Date.now())]);
  })());
 }
};
