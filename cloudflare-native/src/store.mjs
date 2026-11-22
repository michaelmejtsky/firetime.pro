import {Runtime,digest} from './runtime.mjs';
export class Conflict extends Error{}
export const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function loadSnapshot(env,input,{system=false}={}){
 const db=env.DB;
 // All reads go to the primary. A single batch provides a consistent revision + data snapshot.
 let user=null,session=null,scope=null,identityRows=[];
 if(!system&&input.type==='api'||!system&&['logout','password'].includes(input.type)){
  if(!/^[a-f0-9]{64}$/.test(String(input.token||'')))throw Object.assign(Error('Bitte anmelden.'),{status:401});
  session=await statement(db,"SELECT * FROM records WHERE table_name='Sessions' AND record_id=?",digest(input.token)).first();
  const s=session&&JSON.parse(session.data);
  if(!s||Date.parse(s.expiresAt)<=Date.now())throw Object.assign(Error('Sitzung abgelaufen. Bitte erneut anmelden.'),{status:401});
  const row=await statement(db,"SELECT * FROM records WHERE table_name='Users' AND record_id=?",s.userId).first();
  user=row&&JSON.parse(row.data);
  if(!user||user.status!=='ACTIVE')throw Object.assign(Error('Zugang nicht aktiv.'),{status:401});
  scope=user.role==='SYSADMIN'?'*':user.companyId;
  identityRows=[session,row];
 }else if(!system&&['login','resetRequest'].includes(input.type)){
  const email=String(input.email||'').trim().toLowerCase();
  identityRows=(await statement(db,"SELECT * FROM records WHERE table_name='Users' AND email=?",email).all()).results;
  // Only an authenticated caller can load another employee's password/session information.
  user=identityRows[0]&&JSON.parse(identityRows[0].data);
 }else if(!system&&['activate','resetConfirm'].includes(input.type)){
  const token=input.type==='activate'?input.invite:input.resetToken;
  if(!/^[a-f0-9]{64}$/.test(String(token||'')))throw Error('Ungültiger Link.');
  const key=(input.type==='activate'?'':'reset:')+digest(token);
  const invite=await statement(db,"SELECT * FROM records WHERE table_name='Invites' AND record_id=?",key).first();
  if(invite){const u=await statement(db,"SELECT * FROM records WHERE table_name='Users' AND record_id=?",JSON.parse(invite.data).userId).first();if(u){user=JSON.parse(u.data);identityRows=[invite,u];}}
 }
 let query,args=[];
 if(system||scope==='*')query='SELECT * FROM records ORDER BY table_name,ordinal';
 else if(scope){
  query="SELECT * FROM records WHERE company_id=? OR (table_name='Companies' AND record_id=?) OR (table_name IN ('Sessions','Invites') AND user_id IN (SELECT record_id FROM records WHERE table_name='Users' AND company_id=?)) ORDER BY table_name,ordinal";args=[scope,scope,scope];
 }else if(input.type==='brand'){
  query="SELECT * FROM records WHERE (table_name='Companies' AND json_extract(data,'$.slug')=?) OR (table_name='CompanyProfiles' AND company_id IN (SELECT record_id FROM records WHERE table_name='Companies' AND json_extract(data,'$.slug')=?)) ORDER BY table_name,ordinal";args=[String(input.slug||''),String(input.slug||'')];
 }else if(user){
  query="SELECT * FROM records WHERE (table_name='Users' AND record_id=?) OR (table_name IN ('Sessions','Invites') AND user_id=?) OR (table_name='Companies' AND record_id=?) ORDER BY table_name,ordinal";args=[user.id,user.id,user.companyId||''];
 }else query='SELECT * FROM records WHERE 0';
 const cacheKey='login:'+digest(String(input.email||'').trim().toLowerCase()),resetKey='ftreset:'+digest(String(input.email||'').trim().toLowerCase());
 const batch=await db.batch([
  statement(db,"SELECT value FROM metadata WHERE key='revision'"),
  statement(db,query,...args),
  statement(db,"SELECT key,value,expires_at FROM cache WHERE key IN (?,?) AND expires_at>?",cacheKey,resetKey,Date.now()),
  statement(db,'SELECT key,value FROM properties'),
  // Metadata contains no file bytes, and is bounded to referenced objects below.
 ]);
 let records=batch[1].results;
 // Identity rows read before the snapshot are only hints. Revalidate the live snapshot.
 if(scope){
  const active=records.find(x=>x.table_name==='Users'&&x.record_id===user.id),sess=records.find(x=>x.table_name==='Sessions'&&x.record_id===session.record_id);
  if(!active||JSON.parse(active.data).status!=='ACTIVE'||!sess||Date.parse(JSON.parse(sess.data).expiresAt)<=Date.now())throw Object.assign(Error('Sitzung abgelaufen. Bitte erneut anmelden.'),{status:401});
  const live=JSON.parse(active.data);if(live.role!==user.role||live.companyId!==user.companyId)throw new Conflict('Berechtigungen wurden geändert. Bitte erneut laden.');user=live;
 }
 const fileIds=new Set();
 // Logo only for a brand/full shell response; private attachment reads load exactly the requested file.
 const wantLogo=system||input.type==='brand'||input.action==='profileGet'||input.action==='pdf'||(input.action==='home'&&!input.data?.compact);
 for(const r of records){const data=JSON.parse(r.data);
  if(wantLogo&&r.table_name==='Companies'&&data.logoId)fileIds.add(String(data.logoId));
  if(['pdfChunk','pdfBatchChunk','absencePdfChunk'].includes(input.action)&&data.id===input.data?.id&&data.fileId)fileIds.add(String(data.fileId));
 }
 if(input.action==='commPhoto'&&input.data?.attachmentId){
  // Read authorization BEFORE loading bytes; the domain repeats the check before returning them.
  const threads=records.filter(x=>x.table_name==='CommThreads').map(x=>JSON.parse(x.data));
  const t=threads.find(x=>x.id===input.data.threadId&&(x.createdBy===user?.id||x.recipientId===user?.id));
  if(t){const allowed=[t.attachmentId,...records.filter(x=>x.table_name==='CommReplies').map(x=>JSON.parse(x.data)).filter(x=>x.threadId===t.id&&x.companyId===t.companyId).map(x=>x.attachmentId)];if(allowed.includes(input.data.attachmentId))fileIds.add(input.data.attachmentId);}
 }
 // Metadata is needed for archive/status checks; fetch only tenant-linked IDs.
 const referenced=new Set(fileIds);
 for(const r of records){const d=JSON.parse(r.data);for(const key of ['logoId','attachmentId','fileId','pdfId'])if(d[key])referenced.add(String(d[key]));}
 const objects=[];
 const ids=[...referenced];
 const queries=[];for(let i=0;i<ids.length;i+=80){const chunk=ids.slice(i,i+80);queries.push(statement(db,'SELECT * FROM objects WHERE id IN ('+chunk.map(()=>'?').join(',')+')',...chunk));}
 if(queries.length)for(const result of await db.batch(queries))objects.push(...result.results);
 const files=new Map();await Promise.all([...fileIds].map(async id=>{const meta=objects.find(x=>x.id===id);if(!meta||meta.trashed)return;const obj=await env.FILES.get(id);if(!obj)return;const bytes=new Uint8Array(await obj.arrayBuffer());if(bytes.length!==meta.size||digest(bytes)!==meta.sha256)throw Error('Dateiprüfsumme stimmt nicht.');files.set(id,bytes);}));
 return {revision:Number(batch[0].results[0]?.value||0),records,cache:batch[2].results,properties:batch[3].results,objects,files,env,user};
}
export async function commit(env,snapshot,runtime,{receipt=null,failure=false}={}){
 const db=env.DB,rows=failure?[]:runtime.changedRows();
 const persistentCache=[...runtime.cacheWrites].filter(([k])=>/^(login:|ftreset:)/.test(k));
 const propertyWrites=failure?[]:[...runtime.propertyWrites];
 const jobs=failure?[]:[...runtime.jobs.values()];
 const objects=failure?[]:[...runtime.objects.values()].filter(x=>runtime.initialObjects.get(x.id)!==JSON.stringify(x));
 if(!failure)for(const [key,job] of runtime.calendarChanges)jobs.push({id:'calendar-'+crypto.randomUUID(),kind:'calendar',payload:{...job,planIds:runtime.tables.get('PlanMonths').rows.filter(r=>r.shareStatus==='QUEUED'&&runtime.original.get('PlanMonths'+'\0'+r.id)!==JSON.stringify(r)).map(r=>r.id)},created_at:new Date().toISOString()});
 if(!rows.length&&!persistentCache.length&&!propertyWrites.length&&!jobs.length&&!objects.length&&!receipt)return false;
 // New objects are immutable. Upload before the atomic index; a failed commit leaves
 // an unreachable object, never a database pointer to a missing file.
 const uploaded=[];
 try{
  if(!failure)for(const [id,bytes] of runtime.newFiles){const m=runtime.objects.get(id);if(m?.trashed)continue;await env.FILES.put(id,bytes,{httpMetadata:{contentType:m.mime},customMetadata:{sha256:m.sha256}});uploaded.push(id);}
  const guard=crypto.randomUUID();
  const statements=[statement(db,"INSERT INTO commit_guards(id) VALUES((SELECT CASE WHEN CAST(value AS INTEGER)=? THEN ? ELSE NULL END FROM metadata WHERE key='revision'))",snapshot.revision,guard)];
  for(const r of rows){
   if(r.deleted)statements.push(statement(db,'DELETE FROM records WHERE table_name=? AND record_id=?',r.table,r.id));
   else statements.push(statement(db,'INSERT INTO records(table_name,record_id,ordinal,data) VALUES(?,?,(SELECT coalesce(max(ordinal),0)+1 FROM records WHERE table_name=?),?) ON CONFLICT(table_name,record_id) DO UPDATE SET data=excluded.data',r.table,r.id,r.table,r.data));
  }
  for(const [key,v] of persistentCache)statements.push(v?statement(db,'INSERT INTO cache VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at',key,v.value,v.expires_at):statement(db,'DELETE FROM cache WHERE key=?',key));
  for(const [key,value] of propertyWrites)statements.push(statement(db,'INSERT INTO properties VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,value));
  for(const m of objects)statements.push(statement(db,'INSERT INTO objects(id,name,mime,size,sha256,trashed) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET trashed=excluded.trashed',m.id,m.name,m.mime,m.size,m.sha256,m.trashed));
  for(const j of jobs)statements.push(statement(db,"INSERT INTO outbox(id,kind,payload,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='QUEUED',attempts=0,available_at=0,lease_until=0,error='',payload=excluded.payload WHERE outbox.status='ERROR'",j.id,j.kind,JSON.stringify(j.payload),j.created_at));
  if(receipt)statements.push(statement(db,'INSERT INTO request_receipts VALUES(?,?,?,?,?)',receipt.id,receipt.actorId,receipt.hash,JSON.stringify(receipt.response),Date.now()+86400000));
  statements.push(statement(db,"UPDATE metadata SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='revision'"),statement(db,'DELETE FROM commit_guards WHERE id=?',guard));
  await db.batch(statements);return true;
 }catch(err){
  for(const id of uploaded)try{await env.FILES.delete(id);}catch{}
  if(/commit_guards|NOT NULL/.test(String(err.message)))throw new Conflict('Daten wurden gleichzeitig geändert. Bitte erneut laden.');
  throw err;
 }
}
export async function readReceipt(env,id,actorId,hash){
 const receipt=await statement(env.DB,'SELECT * FROM request_receipts WHERE id=? AND expires_at>?',id,Date.now()).first();
 if(!receipt)return null;
 if(receipt.actor_id!==actorId||receipt.request_hash!==hash)throw Object.assign(Error('Anfragekennung wurde bereits für einen anderen Vorgang verwendet.'),{status:409});
 return JSON.parse(receipt.response);
}
