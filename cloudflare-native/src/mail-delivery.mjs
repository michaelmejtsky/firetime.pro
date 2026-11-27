const sql=(db,q,...args)=>db.prepare(q).bind(...args);
export function mailDelivery(row){
 const status=row?.status||'NONE',error=String(row?.error||'').slice(0,250);
 const message=status==='SENT'?'Gmail hat die Einladung zum Versand angenommen. Bitte auch den Spamordner prüfen.':
  status==='ERROR'?'Einladung nicht als versendet bestätigt: '+(error||'Versand fehlgeschlagen.'):
  status==='RETRY'?'Einladung noch nicht versendet: '+(error||'Ein erneuter Versuch ist vorgemerkt.'):
  status==='RUNNING'?'Der Einladungsversand läuft; Gmail hat ihn noch nicht bestätigt.':
  status==='QUEUED'?'Einladung ist zum Versand vorgemerkt; Gmail hat sie noch nicht bestätigt.':
  'Für diesen Mitarbeiter liegt noch kein Einladungsversand vor.';
 return {status,message,error,attempts:Number(row?.attempts||0),createdAt:row?.created_at||'',confirmed:status==='SENT'};
}
export async function readMailDelivery(env,id){return mailDelivery(await sql(env.DB,'SELECT status,error,attempts,created_at FROM outbox WHERE kind=\'mail\' AND id=?',id).first());}
export async function invitationStatus(env,snapshot,p){
 const actor=snapshot.user;
 if(!['SYSADMIN','ADMIN'].includes(actor?.role))throw Object.assign(Error('Nur Administratoren dürfen den Einladungsversand prüfen.'),{status:403});
 const user=snapshot.records.filter(r=>r.table_name==='Users').map(r=>JSON.parse(r.data)).find(u=>u.id===String(p.id||''));
 if(!user||actor.role!=='SYSADMIN'&&user.companyId!==actor.companyId)throw Object.assign(Error('Kein Zugriff auf diesen Mitarbeiter.'),{status:403});
 // Support invitations queued before delivery metadata was introduced, without
 // returning their message bodies, activation links or other employees' data.
 const row=await sql(env.DB,"SELECT status,error,attempts,created_at FROM outbox WHERE kind='mail' AND ((json_extract(payload,'$.invitation.userId')=? AND json_extract(payload,'$.invitation.companyId')=?) OR (json_extract(payload,'$.invitation') IS NULL AND json_extract(payload,'$.message.to')=? AND json_extract(payload,'$.message.subject') LIKE 'Dein Zugang zu FireTime Pro%')) ORDER BY rowid DESC LIMIT 1",user.id,user.companyId||'',user.email).first();
 return {...mailDelivery(row),userId:user.id};
}
