// -----------------------------------------------------------------
// 00_BOOT
// -----------------------------------------------------------------
/** FireTime Pro · Developed by Michael Mejtsky
 * Nur API, kein Google-HTML-WebApp-Frontend.
 * Öffentlicher Zugriff führt nicht zu google.script.run.
 */
const FT_VERSION='1.8.5-pause-messages-20261021';
function doGet(e){
 return ContentService.createTextOutput('FireTime Pro API. Bitte die GitHub-Website öffnen.')
  .setMimeType(ContentService.MimeType.TEXT);
}

// -----------------------------------------------------------------
// 01_Datenbank
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 01_Datenbank.gs */
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | Serverkern */
const FT_TZ='Europe/Vienna';
const FT_HEADERS={
 Companies:['id','name','slug','color','logoId','calendarId','calendarOn','remindAvailability','remindHours','remindShift','availabilityDay','nightStart','nightEnd','nightPct','sundayPct','holidayPct','standbyRate','active','createdAt'],
 Users:['id','companyId','role','name','email','passwordHash','salt','status','monthlyHours','hourlyRate','leaveEntitlement','leaveBalance','openingHours','startDate','workdays','mustChange','createdAt'],
 Sessions:['id','userId','expiresAt'],
 Invites:['id','userId','expiresAt','usedAt'],
 Activities:['id','companyId','userId','type','start','end','breakMinutes','object','description','createdAt','updatedAt','activityOptionId'],
 Availability:['id','companyId','userId','month','day','answer','updatedAt'],
 AvailabilitySubmissions:['id','companyId','userId','month','submittedAt'],
 Shifts:['id','companyId','userId','day','start','end','status','eventId','actualStatus','confirmedAt','updatedAt'],
 Leaves:['id','companyId','userId','from','to','days','creditHours','reason','status','reviewerId','reviewedAt','createdAt'],
 Months:['id','companyId','userId','month','status','submittedAt','reviewerId','reviewedAt','note','pdfId','snapshot','snapshotHash'],
  ShiftSegments:['id','companyId','shiftId','userId','start','end','actualStatus','confirmedAt','calendarEventId','updatedAt'],
  ShiftChanges:['id','companyId','shiftId','fromUserId','toUserId','start','end','reason','status','createdAt','respondedAt','reviewedAt','reviewerId'],
  SickLeaves:['id','companyId','userId','from','to','note','status','reportedBy','createdAt','reviewerId','reviewedAt','creditMode','creditHours','standbyCreditHours','reviewNote'],
 PlanMonths:['id','companyId','month','fixedHash','fixedAt','fixedBy','publishedHash','publishedAt','publishedBy','sharedHash','sharedAt','sharedBy','shareStatus','calendarEvents','warnings','sharedAssignments','updatedAt'],
 ActivityTimers:['id','companyId','userId','type','activityOptionId','start','object','description','createdAt','updatedAt'],
 ActivityTypes:['id','companyId','type','label','active','sort','createdAt','updatedAt'],
 Notifications:['id','companyId','userId','kind','reference','sentAt','status','error'],
 Audit:['id','at','actorId','companyId','action','entity','entityId','previous','next']
};
const FT_ROLES=['SYSADMIN','ADMIN','STAFF'];
// Read-through cache nur fuer eine einzelne doPost-Anfrage; kein Cache ueber Benutzer hinweg.
let FT_REQUEST_CACHE=null;
function ft_invalidate_(name){if(FT_REQUEST_CACHE)delete FT_REQUEST_CACHE.tables[name];}


function ft_prop_(k){return PropertiesService.getScriptProperties().getProperty(k);}

function ft_now_(){return new Date().toISOString();}

function ft_uuid_(){return Utilities.getUuid();}

function ft_db_(){
  if(FT_REQUEST_CACHE?.db)return FT_REQUEST_CACHE.db;
  const id=ft_prop_('FT_DB_ID');
  if(!id)throw Error('FireTime Pro ist noch nicht eingerichtet. ft_setup() ausführen.');
  const db=SpreadsheetApp.openById(id);
  if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.db=db;
  return db;
}

function ft_sheet_(name){
  if(FT_REQUEST_CACHE?.sheets[name])return FT_REQUEST_CACHE.sheets[name];
  const s=ft_db_().getSheetByName(name);
  if(!s)throw Error('Fehlende Datenbanktabelle: '+name);
  if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.sheets[name]=s;
  return s;
}

/**
 * Google Sheets erkennt Monate und reine ISO-Daten bei getValues() gelegentlich
 * automatisch als Date. Die API verwendet dafuer jedoch Strings (YYYY-MM
 * bzw. YYYY-MM-DD). Zeitstempel bleiben unveraendert in ISO-Form.
 * Dies gilt auch fuer bereits vorhandene Daten; keine Tabellenmigration.
 */
function ft_readCell_(table,field,value){
  const monthOnly=(field==='month'&&['Availability','AvailabilitySubmissions','Months','PlanMonths'].includes(table));
  const dateOnly=(field==='startDate'&&table==='Users') ||
    (field==='day'&&['Shifts'].includes(table)) ||
    (['from','to'].includes(field)&&table==='Leaves');
  if(value instanceof Date){
    if(!Number.isFinite(value.getTime()))return '';
    if(monthOnly)return Utilities.formatDate(value,FT_TZ,'yyyy-MM');
    if(dateOnly)return Utilities.formatDate(value,FT_TZ,'yyyy-MM-dd');
    return value.toISOString();
  }
  // Aeltere Eintraege koennen zuvor als ISO-Text geschrieben worden sein.
  if(typeof value==='string'){
    if(monthOnly&&/^20\d{2}-\d{2}-\d{2}T/.test(value))return value.slice(0,7);
    if(dateOnly&&/^20\d{2}-\d{2}-\d{2}T/.test(value))return value.slice(0,10);
  }
  return value;
}

function ft_get_(name){
  if(FT_REQUEST_CACHE&&Object.prototype.hasOwnProperty.call(FT_REQUEST_CACHE.tables,name))return FT_REQUEST_CACHE.tables[name];
  const sheet=ft_sheet_(name),values=sheet.getDataRange().getValues(),head=FT_HEADERS[name];
  const rows=values.slice(1).map((r,i)=>{
    const o={__row:i+2};
    head.forEach((h,j)=>o[h]=ft_readCell_(name,h,r[j]));
    return o;
  }).filter(x=>x.id!=='');
  if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.tables[name]=rows;
  return rows;
}

function ft_pick_(name,o){return FT_HEADERS[name].map(h=>{const v=o[h];if(v===undefined||v===null)return '';if(typeof v==='string'&&/^[\s]*[=+@-]/.test(v))return '\''+v;return v;});}

function ft_add_(name,o){ft_sheet_(name).appendRow(ft_pick_(name,o));ft_invalidate_(name);return o;}

function ft_save_(name,o){if(!o.__row)throw Error('Fehlende Tabellenzeile');ft_sheet_(name).getRange(o.__row,1,1,FT_HEADERS[name].length).setValues([ft_pick_(name,o)]);ft_invalidate_(name);return o;}

function ft_one_(name,id){return ft_get_(name).find(r=>String(r.id)===String(id));}

function ft_lock_(fn){const l=LockService.getScriptLock();l.waitLock(20000);try{return fn();}finally{l.releaseLock();}}

function ft_hex_(bytes){return bytes.map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}

function ft_sha_(s){return ft_hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8));}

function ft_rand_(){return ft_sha_(ft_uuid_()+ft_uuid_()+ft_now_());}

/** SHA-256 in local V8 CPU. Same digest as Utilities.computeDigest(SHA_256, UTF_8),
 * but avoids 1500 cross-service digest calls for each login.
 * Existing password hashes and peppers remain unchanged. */
const FT_SHA256_K_ = [
 0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
 0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
 0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
 0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
 0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
 0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
 0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
 0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function ft_fastSha256Utf8_(value){
 const data=unescape(encodeURIComponent(String(value)));
 const len=data.length,total=Math.ceil((len+9)/64)*64;
 const bytes=new Uint8Array(total);
 for(let i=0;i<len;i++)bytes[i]=data.charCodeAt(i);
 bytes[len]=0x80;
 const bitLength=len*8;
 // Length modulo 2^64, with a high word for large inputs.
 const high=Math.floor(bitLength/0x100000000),low=bitLength>>>0;
 bytes[total-8]=(high>>>24)&255;bytes[total-7]=(high>>>16)&255;
 bytes[total-6]=(high>>>8)&255;bytes[total-5]=high&255;
 bytes[total-4]=(low>>>24)&255;bytes[total-3]=(low>>>16)&255;
 bytes[total-2]=(low>>>8)&255;bytes[total-1]=low&255;
 let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a;
 let h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
 const w=new Uint32Array(64);
 for(let pos=0;pos<total;pos+=64){
  for(let t=0;t<16;t++){
   const o=pos+t*4;
   w[t]=((bytes[o]<<24)|(bytes[o+1]<<16)|(bytes[o+2]<<8)|bytes[o+3])>>>0;
  }
  for(let t=16;t<64;t++){
   const a=w[t-15],b=w[t-2];
   const s0=((a>>>7)|(a<<25))^((a>>>18)|(a<<14))^(a>>>3);
   const s1=((b>>>17)|(b<<15))^((b>>>19)|(b<<13))^(b>>>10);
   w[t]=(w[t-16]+s0+w[t-7]+s1)>>>0;
  }
  let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
  for(let t=0;t<64;t++){
   const s1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));
   const ch=(e&f)^(~e&g);
   const tmp1=(h+s1+ch+FT_SHA256_K_[t]+w[t])>>>0;
   const s0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));
   const maj=(a&b)^(a&c)^(b&c);
   const tmp2=(s0+maj)>>>0;
   h=g;g=f;f=e;e=(d+tmp1)>>>0;d=c;c=b;b=a;a=(tmp1+tmp2)>>>0;
  }
  h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;
  h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
 }
 return [h0,h1,h2,h3,h4,h5,h6,h7].map(v=>v.toString(16).padStart(8,'0')).join('');
}
function ft_password_(password,salt){
 let v=salt+'|'+password+'|'+ft_prop_('FT_PEPPER');
 for(let i=0;i<1500;i++)v=ft_fastSha256Utf8_(v+salt);
 return v;
}


function ft_email_(v){const s=String(v||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)||s.length>200)throw Error('Ungültige E-Mail-Adresse');return s;}

function ft_str_(v,max=500){return String(v===undefined||v===null?'':v).trim().slice(0,max);}

function ft_number_(v,min,max,name){const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw Error('Ungültiger Wert: '+name);return n;}

function ft_bool_(v){return v===true||v==='TRUE'||v==='true'||v===1||v==='1';}

function ft_date_(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))throw Error('Datum im Format JJJJ-MM-TT erforderlich');const d=new Date(s+'T12:00:00');if(isNaN(d)||Utilities.formatDate(d,FT_TZ,'yyyy-MM-dd')!==s)throw Error('Ungültiges Datum');return d;}

function ft_month_(s){if(!/^20\d\d-(0[1-9]|1[012])$/.test(String(s||'')))throw Error('Ungültiger Monat');return s;}

function ft_localDate_(d){return Utilities.formatDate(d,FT_TZ,'yyyy-MM-dd');}

function ft_localMonth_(d){return Utilities.formatDate(d,FT_TZ,'yyyy-MM');}

function ft_datetime_(s){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(s||'')))throw Error('Datum/Uhrzeit fehlen');const d=new Date(s+':00');if(isNaN(d))throw Error('Ungültige Uhrzeit');return d;}

function ft_audit_(u,action,entity,id,before,after){ft_add_('Audit',{id:ft_uuid_(),at:ft_now_(),actorId:u?u.id:'SYSTEM',companyId:(after&&after.companyId)||(before&&before.companyId)||(u&&u.companyId)||'',action,entity,entityId:id,previous:JSON.stringify(before||{}).slice(0,25000),next:JSON.stringify(after||{}).slice(0,25000)});}

function ft_safe_(u){return {id:u.id,companyId:u.companyId,role:u.role,name:u.name,email:u.email,monthlyHours:Number(u.monthlyHours)||0,hourlyRate:Number(u.hourlyRate)||0,leaveEntitlement:Number(u.leaveEntitlement)||0,leaveBalance:Number(u.leaveBalance)||0,openingHours:Number(u.openingHours)||0,startDate:u.startDate,workdays:u.workdays||'1,2,3,4,5',status:u.status,mustChange:ft_bool_(u.mustChange),hoursStartMonth:ft_balanceStartMonth_(u),...ft_leaveStaffPublic_(u)};}

function ft_allowed_(u,roles){if(!roles.includes(u.role))throw Error('Keine Berechtigung für diese Funktion.');}

function ft_scope_(u,companyId){if(u.role!=='SYSADMIN'&&String(u.companyId)!==String(companyId))throw Error('Kein Zugriff auf diese Firma.');}

function ft_company_(u,id){const cid=id||(u.role==='SYSADMIN'?'':u.companyId);if(!cid)throw Error('Firma auswählen');ft_scope_(u,cid);const c=ft_one_('Companies',cid);if(!c||!ft_bool_(c.active))throw Error('Firma ist nicht aktiv.');return c;}

function ft_user_(actor,id){const u=ft_one_('Users',id);if(!u)throw Error('Mitarbeiter nicht gefunden');ft_scope_(actor,u.companyId);return u;}

function ft_companyData_(c){const copy=Object.assign({},c);delete copy.__row;return copy;}

function ft_requireMonthOpen_(companyId,userId,month){const m=ft_get_('Months').find(x=>x.companyId===companyId&&x.userId===userId&&x.month===month);if(m&&['SUBMITTED','APPROVED','FINAL'].includes(m.status))throw Error('Monat ist eingereicht oder freigegeben. Administrator um Rückgabe bitten.');}

function ft_publicRow_(r){const o=Object.assign({},r);delete o.__row;return o;}

// -----------------------------------------------------------------
// 02_Anmeldung
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 02_Anmeldung.gs */
function ft_auth_(token){if(!/^[a-f0-9]{64}$/.test(String(token||'')))throw Error('Bitte anmelden.');const h=ft_sha_(token),s=ft_get_('Sessions').find(x=>x.id===h);if(!s||new Date(s.expiresAt).getTime()<Date.now())throw Error('Sitzung abgelaufen. Bitte erneut anmelden.');const u=ft_one_('Users',s.userId);if(!u||u.status!=='ACTIVE')throw Error('Zugang nicht aktiv.');return u;}

function ft_login(email,password){
 const em=ft_email_(email),cache=CacheService.getScriptCache(),key='login:'+ft_sha_(em),tries=Number(cache.get(key)||0);
 if(tries>=7)throw Error('Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
 const u=ft_get_('Users').find(x=>x.email===em&&x.status==='ACTIVE');
 if(!u||!u.salt||ft_password_(String(password||''),u.salt)!==u.passwordHash){cache.put(key,String(tries+1),900);throw Error('E-Mail-Adresse oder Passwort ungültig.');}
 cache.remove(key);const token=ft_rand_();ft_lock_(()=>ft_add_('Sessions',{id:ft_sha_(token),userId:u.id,expiresAt:new Date(Date.now()+12*3600000).toISOString()}));
 return {token,user:ft_safe_(u)};
}

function ft_activate(invite,password){
 if(!/^[a-f0-9]{64}$/.test(invite||''))throw Error('Ungültige Einladung.');if(String(password||'').length<12||String(password).length>150)throw Error('Passwort muss 12–150 Zeichen lang sein.');
 return ft_lock_(()=>{const key=ft_sha_(invite),i=ft_one_('Invites',key);if(!i||i.usedAt||new Date(i.expiresAt)<new Date())throw Error('Einladung ungültig oder abgelaufen.');const u=ft_one_('Users',i.userId);if(!u)throw Error('Benutzer nicht gefunden.');const before=ft_safe_(u);u.salt=ft_rand_();u.passwordHash=ft_password_(password,u.salt);u.status='ACTIVE';u.mustChange=false;ft_save_('Users',u);i.usedAt=ft_now_();ft_save_('Invites',i);ft_audit_(u,'ACTIVATE','Users',u.id,before,ft_safe_(u));return 'Konto aktiviert. Du kannst dich jetzt anmelden.';});
}

function ft_changePassword(token,current,next){const u=ft_auth_(token);if(String(next||'').length<12)throw Error('Neues Passwort mindestens 12 Zeichen');if(ft_password_(String(current||''),u.salt)!==u.passwordHash)throw Error('Bisheriges Passwort falsch');return ft_lock_(()=>{u.salt=ft_rand_();u.passwordHash=ft_password_(next,u.salt);u.mustChange=false;ft_save_('Users',u);ft_get_('Sessions').filter(s=>s.userId===u.id).sort((a,b)=>b.__row-a.__row).forEach(s=>ft_sheet_('Sessions').deleteRow(s.__row));return 'Passwort geändert. Bitte neu anmelden.';});}

function ft_logout(token){const h=ft_sha_(String(token||'')),s=ft_one_('Sessions',h);if(s)ft_lock_(()=>ft_sheet_('Sessions').deleteRow(s.__row));return true;}

function ft_invite_(actor,user){
 if(!user.email)throw Error('E-Mail fehlt.');
 const company=user.companyId?ft_one_('Companies',user.companyId):null;
 const base=company?ft_clientUrl_(company):ft_publicGithubUrl_();
 if(!base||!base.startsWith('https://'))throw Error('Öffentliche GitHub-Adresse nicht eingestellt.');
 const token=ft_rand_();
 const row={id:ft_sha_(token),userId:user.id,
  expiresAt:new Date(Date.now()+7*86400000).toISOString(),usedAt:''};
 // Avoid orphan invitation records when email sending fails: insert only after
 // the mail service accepts the message; concurrent retries are separate tokens.
 const link=base+(base.includes('?')?'&':'?')+'invite='+encodeURIComponent(token);
 ft_sendMail_({to:user.email,
  subject:'Dein Zugang zu FireTime Pro – '+(company?company.name:'System'),
  body:'Hallo '+user.name+'!\n\nAktiviere deinen FireTime-Pro-Zugang über diesen einmalig nutzbaren Link (7 Tage gültig):\n'+link+'\n\nFireTime Pro – Developed by Michael Mejtsky',
  name:'FireTime Pro'});
 ft_add_('Invites',row);
 ft_audit_(actor,'INVITE','Users',user.id,{}, {email:user.email});
 return 'Einladung verschickt.';
}

// -----------------------------------------------------------------
// 03_Firmen
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 03_Firmen.gs */
function ft_companyCreate_(u,p){ft_allowed_(u,['SYSADMIN']);const name=ft_str_(p.name,100),slug=ft_str_(p.slug,40).toLowerCase().replace(/[^a-z0-9-]/g,'');if(!name||!slug||!/^[a-z0-9]/.test(slug))throw Error('Firma und Kürzel erforderlich');if(ft_get_('Companies').some(x=>x.slug===slug))throw Error('Firmenkürzel bereits vergeben');const c={id:ft_uuid_(),name,slug,color:p.color||'#ff784f',logoId:'',calendarId:'',calendarOn:false,remindAvailability:true,remindHours:true,remindShift:true,availabilityDay:20,nightStart:22,nightEnd:6,nightPct:0,sundayPct:0,holidayPct:0,standbyRate:0,active:true,createdAt:ft_now_()};ft_add_('Companies',c);ft_audit_(u,'CREATE','Companies',c.id,{},c);return c;}

function ft_companyUpdate_(u,p){ft_allowed_(u,['SYSADMIN','ADMIN']);const c=ft_company_(u,p.id),before=Object.assign({},c);const allowed=['name','color','calendarId','calendarOn','remindAvailability','remindHours','remindShift','availabilityDay','nightStart','nightEnd','nightPct','sundayPct','holidayPct','standbyRate'];
 allowed.forEach(k=>{if(p[k]===undefined)return;if(['calendarOn','remindAvailability','remindHours','remindShift'].includes(k))c[k]=ft_bool_(p[k]);else if(['availabilityDay','nightStart','nightEnd','nightPct','sundayPct','holidayPct','standbyRate'].includes(k))c[k]=ft_number_(p[k],0,k==='availabilityDay'?28:k==='standbyRate'?1000:k.includes('Start')||k.includes('End')?23:1000,k);else c[k]=ft_str_(p[k],k==='calendarId'?255:100);});
 if(!c.name)throw Error('Firmenname fehlt');ft_save_('Companies',c);ft_audit_(u,'UPDATE','Companies',c.id,before,c);return ft_companyData_(c);}

function ft_logo_(u,p){
 ft_allowed_(u,['SYSADMIN','ADMIN']);
 const c=ft_company_(u,p.companyId||u.companyId);
 const data=String(p.data||'');
 const match=/^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(data);
 if(!match)throw Error('Logo als PNG, JPG oder WEBP erforderlich.');
 const bytes=Utilities.base64Decode(match[2].replace(/\s/g,''));
 if(!bytes.length||bytes.length>2097152)throw Error('Firmenlogo maximal 2 MB.');
 const b=i=>bytes[i]&255;
 const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>b(i)===n);
 const jpg=bytes.length>=3&&b(0)===255&&b(1)===216&&b(2)===255;
 const webp=bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4).map(n=>n&255))==='RIFF'&&
   String.fromCharCode(...bytes.slice(8,12).map(n=>n&255))==='WEBP';
 const mime=match[1];
 if(!(mime==='image/png'&&png||mime==='image/jpeg'&&jpg||mime==='image/webp'&&webp)){
   throw Error('Der Dateiinhalt ist kein gültiges PNG/JPG/WEBP-Bild.');
 }
 const extension=png?'png':jpg?'jpg':'webp';
 const folder=DriveApp.getFolderById(ft_prop_('FT_ROOT_ID'));
 const file=folder.createFile(Utilities.newBlob(bytes,mime,'Logo_'+c.slug+'.'+extension));
 const before={logoId:c.logoId||''};
 c.logoId=file.getId();
 ft_save_('Companies',c);
 ft_audit_(u,'LOGO','Companies',c.id,before,{companyId:c.id,logoId:c.logoId});
 return {ok:true,logo:ft_logoData_(c),logoId:c.logoId};
}

function ft_logoData_(c){if(!c||!c.logoId)return '';try{const blob=DriveApp.getFileById(c.logoId).getBlob();return 'data:'+blob.getContentType()+';base64,'+Utilities.base64Encode(blob.getBytes());}catch(e){return '';}}

function ft_publicBrand(slug){return ft_brandForLogin(slug);}


/** Übernommenes Stundenkonto: Der Anfangssaldo gilt VOR dem ersten
 * abzurechnenden FireTime-Monat, nicht seit dem Beschäftigungsbeginn.
 * Historische Users-Zeilen, Months-Snapshots und PDFs bleiben unverändert.
 */
const FT_BALANCE_START_COLS_=['id','companyId','userId','startMonth','updatedBy','updatedAt'];
function ft_balanceStartRows_(){
 const key='FT_BALANCE_START';
 if(FT_REQUEST_CACHE&&FT_REQUEST_CACHE.tables[key])return FT_REQUEST_CACHE.tables[key];
 const rows=ft_absenceRows_('TimeBalanceStarts',FT_BALANCE_START_COLS_,false);
 if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.tables[key]=rows;
 return rows;
}
function ft_balanceStartMonth_(user){
 if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(user.hoursStartMonth||'')))
  return String(user.hoursStartMonth);
 const found=ft_balanceStartRows_().find(x=>String(x.companyId)===String(user.companyId)&&String(x.userId)===String(user.id));
 if(found){
  const raw=String(found.startMonth||'');
  if(/^20\d{2}-(0[1-9]|1[0-2])/.test(raw))return raw.slice(0,7);
  throw Error('Der Abrechnungsbeginn des Stundenkontos ist ungültig.');
 }
 const created=String(user.createdAt||''),hired=String(user.startDate||'');
 const c=/^20\d{2}-(0[1-9]|1[0-2])/.test(created)?created.slice(0,7):'';
 const h=/^20\d{2}-(0[1-9]|1[0-2])/.test(hired)?hired.slice(0,7):'';
 if(c&&h)return c>h?c:h;
 if(c||h)return c||h;
 return ft_localMonth_(new Date());
}
function ft_balanceStartSave_(actor,user,month){
 const start=ft_month_(String(month||''));
 if(user.startDate&&start<String(user.startDate).slice(0,7))
  throw Error('Stundenabrechnung kann nicht vor dem Beschäftigungsbeginn starten.');
 const rows=ft_balanceStartRows_();
 const original=rows.find(x=>String(x.companyId)===String(user.companyId)&&String(x.userId)===String(user.id));
 const before=ft_balanceStartMonth_(user);
 if(before===start)return start;
 const record=original||{id:ft_uuid_(),companyId:user.companyId,userId:user.id};
 Object.assign(record,{startMonth:start,updatedBy:actor.id,updatedAt:ft_now_()});
 const sheet=ft_absenceSheet_('TimeBalanceStarts',FT_BALANCE_START_COLS_,true);
 sheet.getRange('D:D').setNumberFormat('@');
 if(original)ft_absenceSave_('TimeBalanceStarts',FT_BALANCE_START_COLS_,record);
 else ft_absenceAdd_('TimeBalanceStarts',FT_BALANCE_START_COLS_,record);
 if(FT_REQUEST_CACHE)delete FT_REQUEST_CACHE.tables.FT_BALANCE_START;
 ft_audit_(actor,'BALANCE_START','Users',user.id,{hoursStartMonth:before},
  {companyId:user.companyId,hoursStartMonth:start});
 return start;
}

// -----------------------------------------------------------------
// 04_Mitarbeiter
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 04_Mitarbeiter.gs */
function ft_userCreate_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_company_(actor,p.companyId||actor.companyId),role=String(p.role||'STAFF');if(!['STAFF','ADMIN'].includes(role))throw Error('Ungültige Rolle');const email=ft_email_(p.email),name=ft_str_(p.name,100);if(!name)throw Error('Name fehlt');if(ft_get_('Users').some(x=>x.email===email))throw Error('E-Mail ist bereits im System vergeben');const u={id:ft_uuid_(),companyId:c.id,role,name,email,passwordHash:'',salt:'',status:'INVITED',monthlyHours:ft_number_(p.monthlyHours||0,0,300,'Monatssoll'),hourlyRate:ft_number_(p.hourlyRate||0,0,10000,'Stundensatz'),leaveEntitlement:ft_number_(p.leaveEntitlement||0,0,366,'Urlaubsanspruch'),leaveBalance:ft_number_(p.leaveBalance||0,0,1000,'Resturlaub'),openingHours:ft_number_(p.openingHours||0,-10000,10000,'Startsaldo'),startDate:p.startDate||ft_localDate_(new Date()),workdays:ft_str_(p.workdays||'1,2,3,4,5',30),mustChange:false,createdAt:ft_now_()};ft_date_(u.startDate);
 if(p.hoursStartMonth!==undefined){
  ft_month_(String(p.hoursStartMonth));
  if(String(p.hoursStartMonth)<String(u.startDate).slice(0,7))
   throw Error('Beginn der FireTime-Abrechnung darf nicht vor dem Beschäftigungsbeginn liegen.');
 }
 const hasLeaveRule=p.leaveYearMode!==undefined||p.leaveRuleType!==undefined;
 const leaveRule=hasLeaveRule?ft_leaveStaffCheck_(p,u,false):null;
 const flexRule=p.leaveWorkModel!==undefined?ft_leaveFlexValidate_(p,u,false):null;
 if(leaveRule)ft_absenceSheet_('LeaveStaffRules',FT_LEAVE_STAFF_RULE_COLS_,true);
 ft_add_('Users',u);
 if(p.hoursStartMonth!==undefined)ft_balanceStartSave_(actor,u,p.hoursStartMonth);
 if(leaveRule)ft_leaveStaffSave_(actor,u,leaveRule);
 if(flexRule)ft_leaveFlexSave_(actor,u,flexRule);
 ft_audit_(actor,'CREATE','Users',u.id,{},ft_safe_(u));
 // Bei neuen Frontends: zuerst erfolgreich speichern und rueckmelden.
 // Der E-Mail-Versand laeuft danach in einem separaten API-Aufruf.
 if(p.deferInvite===true)return {user:ft_safe_(u),message:'Mitarbeiter angelegt.',invitePending:true};
 let message='Mitarbeiter angelegt. ';
 try{message+=ft_invite_(actor,u);}catch(e){message+='Einladung noch nicht verschickt: '+e.message;}
 return {user:ft_safe_(u),message};}

function ft_userUpdate_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const u=ft_user_(actor,p.id);if(u.role==='SYSADMIN')throw Error('Systemadmin nicht über Firmenverwaltung ändern');const before=ft_safe_(u);
 if(p.startDate!==undefined&&p.startDate!==u.startDate&&ft_leaveLedgerRows_(false).some(x=>x.companyId===u.companyId&&x.userId===u.id&&x.kind==='GRANT')&&before.leaveYearMode==='ANNIVERSARY')
  throw Error('Das Eintrittsdatum nach bereits verbuchten Jahresgutschriften bitte nicht ohne kontrollierte Urlaubsjahr-Umstellung ändern.');
 if(p.leaveBalance!==undefined&&Number(p.leaveBalance)!==Number(u.leaveBalance))ft_leaveEnsureOpening_(u,actor);const fields=['name','monthlyHours','hourlyRate','leaveEntitlement','leaveBalance','openingHours','startDate','workdays','status'];fields.forEach(k=>{if(p[k]===undefined)return;if(['monthlyHours','hourlyRate','leaveEntitlement','leaveBalance','openingHours'].includes(k))u[k]=ft_number_(p[k],k==='openingHours'?-10000:0,k==='openingHours'?10000:k==='monthlyHours'?300:k==='hourlyRate'?10000:1000,k);else u[k]=ft_str_(p[k],100);});if(p.role&&['ADMIN','STAFF'].includes(p.role))u.role=p.role;if(!['ACTIVE','DISABLED','INVITED'].includes(u.status))throw Error('Ungültiger Status');if(!/^[1-7](,[1-7])*$/.test(u.workdays)||new Set(u.workdays.split(',')).size!==u.workdays.split(',').length)throw Error('Arbeitstage im Format 1,2,3,4,5 eingeben, ohne Duplikate.');if(u.startDate)ft_date_(u.startDate);
 if(p.hoursStartMonth!==undefined){
  ft_month_(String(p.hoursStartMonth));
  if(u.startDate&&String(p.hoursStartMonth)<String(u.startDate).slice(0,7))
   throw Error('Beginn der FireTime-Abrechnung darf nicht vor dem Beschäftigungsbeginn liegen.');
 }
 const hasLeaveRule=p.leaveYearMode!==undefined||p.leaveRuleType!==undefined;
 const leaveRule=hasLeaveRule?ft_leaveStaffCheck_(p,u,true):null;
 const flexRule=p.leaveWorkModel!==undefined?ft_leaveFlexValidate_(p,u,true):null;
 if(leaveRule)ft_absenceSheet_('LeaveStaffRules',FT_LEAVE_STAFF_RULE_COLS_,true);
 ft_save_('Users',u);
 if(p.hoursStartMonth!==undefined)ft_balanceStartSave_(actor,u,p.hoursStartMonth);
 if(leaveRule)ft_leaveStaffSave_(actor,u,leaveRule);if(flexRule)ft_leaveFlexSave_(actor,u,flexRule);if(p.leaveBalance!==undefined&&Number(p.leaveBalance)!==Number(before.leaveBalance))ft_leaveLedgerRecord_(actor,u,'ADJUST',Number(u.leaveBalance)-Number(before.leaveBalance),'USER_UPDATE_'+ft_uuid_(),'Administrator-Korrektur des Urlaubssaldos');ft_audit_(actor,'UPDATE','Users',u.id,before,ft_safe_(u));return ft_safe_(u);}

// -----------------------------------------------------------------
// 05_Zeiterfassung
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 05_Zeiterfassung.gs */
function ft_monthBounds_(m){ft_month_(m);const [y,n]=m.split('-').map(Number);return [new Date(y,n-1,1,0,0),new Date(y,n,1,0,0)];}

function ft_hours_(a,b){return Math.max(0,(new Date(b)-new Date(a))/3600000);}

function ft_overlap_(a,b,c,d){return Math.max(0,Math.min(+new Date(b),+new Date(d))-Math.max(+new Date(a),+new Date(c)))/3600000;}

function ft_2_(v){return Math.round((Number(v)||0)*100)/100;}
function ft_hourRound_(v){return Math.round((Number(v)||0)*1e8)/1e8;}

function ft_easter_(year){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;return new Date(year,mo-1,day,12);}

function ft_dayShift_(date,days){const d=new Date(date);d.setDate(d.getDate()+days);return ft_localDate_(d);}

function ft_holiday_(str){const y=Number(str.slice(0,4)),fixed=['01-01','01-06','05-01','08-15','10-26','11-01','12-08','12-25','12-26'];if(fixed.includes(str.slice(5)))return true;const easter=ft_easter_(y);return [1,39,50,60].some(d=>ft_dayShift_(easter,d)===str);}

function ft_categoryHours_(start,end,c){const result={night:0,sunday:0,holiday:0};let t=+new Date(start),stop=+new Date(end);let guard=0;while(t<stop&&guard++<1000){const next=Math.min(stop,Math.floor(t/3600000+1)*3600000),mid=new Date((t+next)/2),hours=(next-t)/3600000;const local=ft_localDate_(mid),hour=Number(Utilities.formatDate(mid,FT_TZ,'H')),weekday=Number(Utilities.formatDate(mid,FT_TZ,'u'));const ns=Number(c.nightStart||22),ne=Number(c.nightEnd===0?0:c.nightEnd||6);if(ns<=ne?(hour>=ns&&hour<ne):(hour>=ns||hour<ne))result.night+=hours;if(weekday===7)result.sunday+=hours;if(ft_holiday_(local))result.holiday+=hours;t=next;}return result;}


/**
 * Pausenregel bei einer zusammenhängenden Objektkontrolle: mehr als 6 Stunden
 * Zeitspanne erfordert eine ausdrückliche Angabe von mindestens 30 Minuten
 * tatsächlich genommener Pause. Kein automatischer Pausenabzug.
 *
 * Mehrere getrennte Tätigkeitsbuchungen am Tag werden nicht ohne Kenntnis
 * der tatsächlich genommenen Pausen zusammengezogen. Der Arbeitgeber muss
 * die Tagesarbeitszeit und eventuelle Zwischenpausen zusätzlich prüfen.
 */
function ft_objectPauseRequired_(type,start,end){
 return String(type)==='OBJECT'&&ft_hours_(start,end)>6+1/3600000;
}
function ft_objectPausePending_(row){
 return ft_objectPauseRequired_(row.type,row.start,row.end)&&Number(row.breakMinutes||0)<30;
}
function ft_objectPauseOpenInMonth_(companyId,userId,month){
 return ft_get_('Activities').filter(x=>x.companyId===companyId&&x.userId===userId&&
   x.type==='OBJECT'&&(ft_localMonth_(new Date(x.start))===month||
   ft_localMonth_(new Date(new Date(x.end).getTime()-1))===month)&&ft_objectPausePending_(x));
}
function ft_objectPauseEnsureReady_(companyId,userId,month){
 const pending=ft_objectPauseOpenInMonth_(companyId,userId,month);
 if(pending.length){
  const date=ft_localDate_(new Date(pending[0].start));
  throw Error('Objektkontrolle vom '+date+': Mehr als 6 Stunden erfasst, aber keine 30 Minuten Pause bestätigt. '+
   'Bitte die tatsächlich genommene Pause in der Zeiterfassung nachtragen. Es wird nichts automatisch abgezogen.');
 }
}

function ft_activitySave_(actor,p,internalAllowPausePending){const uid=actor.role==='STAFF'?actor.id:p.userId||actor.id,u=ft_user_(actor,uid),c=ft_company_(actor,u.companyId);const type=String(p.type||'OBJECT');if(!['OBJECT','INCIDENT','OTHER'].includes(type))throw Error('Ungültige Tätigkeit');const start=ft_datetime_(p.start),end=ft_datetime_(p.end);if(end<=start||ft_hours_(start,end)>48)throw Error('Ende muss nach Beginn liegen; maximal 48 Stunden.');const br=ft_number_(p.breakMinutes||0,0,1440,'Pausen');if(br>=ft_hours_(start,end)*60)throw Error('Pause darf nicht die ganze Schicht umfassen.');if(ft_objectPauseRequired_(type,start,end)&&br<30&&!internalAllowPausePending)throw Error('Objektkontrolle über 6 Stunden: Bitte mindestens 30 Minuten tatsächlich genommene Pause eintragen. Nichts wird automatisch abgezogen. Wenn keine Pause stattgefunden hat, Arbeitszeit nicht falsch kürzen und mit dem Arbeitgeber klären.');const dates=[ft_localMonth_(start),ft_localMonth_(new Date(end.getTime()-1))];dates.forEach(m=>ft_requireMonthOpen_(c.id,u.id,m));const entries=ft_get_('Activities').filter(x=>x.companyId===c.id&&x.userId===u.id&&x.id!==p.id);if(entries.some(x=>ft_overlap_(start,end,x.start,x.end)>0))throw Error('Aktive Arbeitszeiten dürfen sich nicht überschneiden. Objektkontrollen während Bereitschaft sind erlaubt.');let row=p.id?ft_one_('Activities',p.id):null;if(p.id&&(!row||row.userId!==u.id||row.companyId!==c.id))throw Error('Zeiteintrag nicht gefunden');const before=row?ft_publicRow_(row):{};row=row||{id:ft_uuid_(),companyId:c.id,userId:u.id,createdAt:ft_now_()};
 const activityOptionId=String(p.activityOptionId||'').trim();
 if(activityOptionId){
   const choice=ft_activityTypesFor_(c).find(x=>x.id===activityOptionId&&x.type===type);
   if(!choice)throw Error('Tätigkeitsauswahl gehört nicht zu dieser Firma oder Tätigkeitsart.');
 }
 const note=' [Pausenangabe offen – bitte nachtragen]';
 let description=ft_str_(p.description,1000).replace(/ \[Pausenangabe offen – bitte nachtragen\]/g,'');
 if(internalAllowPausePending&&ft_objectPauseRequired_(type,start,end)&&br<30)description=description.slice(0,1000-note.length)+note;
 Object.assign(row,{type,start:start.toISOString(),end:end.toISOString(),breakMinutes:br,object:ft_str_(p.object,150),description,activityOptionId,updatedAt:ft_now_()});if(row.__row)ft_save_('Activities',row);else ft_add_('Activities',row);ft_audit_(actor,p.id?'UPDATE':'CREATE','Activities',row.id,before,ft_publicRow_(row));return ft_publicRow_(row);}

function ft_activityDelete_(actor,p){const r=ft_one_('Activities',p.id);if(!r)throw Error('Eintrag nicht gefunden');ft_scope_(actor,r.companyId);if(actor.role==='STAFF'&&r.userId!==actor.id)throw Error('Keine Berechtigung');[ft_localMonth_(new Date(r.start)),ft_localMonth_(new Date(new Date(r.end).getTime()-1))].forEach(m=>ft_requireMonthOpen_(r.companyId,r.userId,m));ft_sheet_('Activities').deleteRow(r.__row);ft_audit_(actor,'DELETE','Activities',r.id,r,{});return true;}

function ft_leaveDaysRange_(start,end){const s=ft_date_(start),e=ft_date_(end);if(s>e||Math.round((e-s)/86400000)>100)throw Error('Ungültiger Urlaubszeitraum');return true;}
function ft_leaveDays_(u,start,end){const work=String(u.workdays||'1,2,3,4,5').split(',').map(Number);const s=ft_date_(start),e=ft_date_(end);if(s>e||Math.round((e-s)/86400000)>100)throw Error('Ungültiger Urlaubszeitraum');let count=0;for(let d=new Date(s);d<=e;d.setDate(d.getDate()+1)){const weekday=Number(Utilities.formatDate(d,FT_TZ,'u'));if(work.includes(weekday)&&!ft_holiday_(ft_localDate_(d)))count++;}return count;}

function ft_leaveRequest_(actor,p){const u=actor.role==='STAFF'?actor:ft_user_(actor,p.userId||actor.id);ft_scope_(actor,u.companyId);const flex=ft_leaveFlexFor_(u).leaveWorkModel==='FLEX';
 const days=flex?(ft_leaveDaysRange_(p.from,p.to),0):ft_leaveDays_(u,p.from,p.to);
 if(!flex&&!days)throw Error('Der Zeitraum enthält keine konfigurierten Arbeitstage.');if(ft_get_('Leaves').some(x=>x.companyId===u.companyId&&x.userId===u.id&&!['REJECTED','WITHDRAWN','CANCELLED'].includes(x.status)&&!(p.to<x.from||p.from>x.to)))throw Error('Überlappender Urlaubsantrag vorhanden.');const row={id:ft_uuid_(),companyId:u.companyId,userId:u.id,from:p.from,to:p.to,days,creditHours:0,reason:ft_str_(p.reason,300),status:'PENDING',reviewerId:'',reviewedAt:'',createdAt:ft_now_()};ft_add_('Leaves',row);ft_audit_(actor,'REQUEST','Leaves',row.id,{},row);return row;}

function ft_leaveUpdate_(actor,p){
 const l=ft_one_('Leaves',p.id);
 if(!l)throw Error('Urlaubsantrag nicht gefunden.');
 ft_scope_(actor,l.companyId);
 if(actor.role==='STAFF'&&l.userId!==actor.id)throw Error('Keine Berechtigung.');
 if(l.status!=='PENDING')throw Error('Nur offene Urlaubsanträge können bearbeitet werden.');
 const u=ft_user_(actor,l.userId),before=ft_publicRow_(l);
 const from=String(p.from||''),to=String(p.to||'');
 const flex=ft_leaveFlexFor_(u).leaveWorkModel==='FLEX';
 const days=flex?(ft_leaveDaysRange_(from,to),0):ft_leaveDays_(u,from,to);
 if(!flex&&!days)throw Error('Der Zeitraum enthält keine Arbeitstage.');
 if(ft_get_('Leaves').some(x=>x.id!==l.id&&x.companyId===l.companyId&&x.userId===l.userId&&
    !['REJECTED','WITHDRAWN','CANCELLED'].includes(x.status)&&!(to<x.from||from>x.to)))
   throw Error('Überlappender Urlaubsantrag vorhanden.');
 Object.assign(l,{from,to,days,reason:ft_str_(p.reason,300)});
 ft_save_('Leaves',l);
 ft_audit_(actor,'UPDATE','Leaves',l.id,before,ft_publicRow_(l));
 return ft_publicRow_(l);
}
function ft_leaveWithdraw_(actor,p){
 const l=ft_one_('Leaves',p.id);
 if(!l)throw Error('Urlaubsantrag nicht gefunden.');
 ft_scope_(actor,l.companyId);
 if(actor.role==='STAFF'&&l.userId!==actor.id)throw Error('Keine Berechtigung.');
 const before=ft_publicRow_(l);
 if(l.status==='PENDING')l.status='WITHDRAWN';
 else if(l.status==='APPROVED')l.status='CANCEL_PENDING';
 else throw Error('Für diesen Urlaubsantrag ist kein Rückzug möglich.');
 ft_save_('Leaves',l);
 ft_audit_(actor,'WITHDRAW','Leaves',l.id,before,ft_publicRow_(l));
 return ft_publicRow_(l);
}
function ft_leaveReview_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);
 const l=ft_one_('Leaves',p.id);
 if(!l)throw Error('Antrag nicht gefunden');
 ft_scope_(actor,l.companyId);
 const status=String(p.status||''),before=ft_publicRow_(l);
 const u=ft_user_(actor,l.userId);
 if(l.status==='CANCEL_PENDING'){
   if(!['CANCELLED','APPROVED'].includes(status))throw Error('Stornierung nur bestätigen oder ablehnen.');
   if(status==='CANCELLED'){
     ft_leaveEnsureOpening_(u,actor);
     const old=Number(u.leaveBalance)||0;
     u.leaveBalance=ft_2_(old+Number(l.days||0));
     ft_save_('Users',u);
     ft_audit_(actor,'LEAVE_BALANCE','Users',u.id,{leaveBalance:old},{leaveBalance:u.leaveBalance});
     l.status='CANCELLED';l.creditHours=0;
   }else l.status='APPROVED';
 }else{
   if(l.status!=='PENDING')throw Error('Dieser Antrag wurde bereits bearbeitet.');
   if(!['APPROVED','REJECTED'].includes(status))throw Error('Ungültiger Status');
   if(status==='APPROVED'){
     const flex=ft_leaveFlexFor_(u);
     if(flex.leaveWorkModel==='FLEX'){
       if(!flex.leaveFlexConfigured)throw Error('Flexibler Urlaub: rechnerische Urlaubstage/Woche und geprüfte Bewertungsgrundlage müssen zuerst hinterlegt werden. Keine automatische Abbuchung.');
       if(p.flexBasisConfirmed!==true)throw Error('Flexibler Urlaub muss vom Administrator ausdrücklich nach dokumentierter Grundlage bestätigt werden.');
       const days=ft_number_(p.flexDays,1,100,'Genehmigte Urlaubstage');
       if(!Number.isInteger(days))throw Error('Bitte ganze Urlaubstage gemäß der dokumentierten Vereinbarung angeben.');
       if(!Number.isFinite(Number(p.creditHours))||Number(p.creditHours)<=0)throw Error('Die Sollstundengutschrift für flexiblen Urlaub ausdrücklich erfassen.');
       l.days=days;
     }
     if(Number(l.days)<=0)throw Error('Ohne nachvollziehbare Bewertung dürfen keine null Urlaubstage genehmigt werden.');
     if(Number(u.leaveBalance)<Number(l.days))throw Error('Resturlaub reicht nicht aus');
     ft_leaveEnsureOpening_(u,actor);
     const old=Number(u.leaveBalance);
     u.leaveBalance=ft_2_(old-Number(l.days));
     l.creditHours=ft_number_(p.creditHours||0,0,300,'Urlaubs-Zeitgutschrift');
     ft_save_('Users',u);
     ft_audit_(actor,'LEAVE_BALANCE','Users',u.id,{leaveBalance:old},{leaveBalance:u.leaveBalance});
   }
   l.status=status;
 }
 l.reviewerId=actor.id;l.reviewedAt=ft_now_();
 ft_save_('Leaves',l);
 if(l.status==='APPROVED'&&before.status==='PENDING'&&ft_leaveFlexFor_(u).leaveWorkModel==='FLEX'){
  const rule=ft_leaveFlexFor_(u);
  ft_absenceAdd_('LeaveFlexApprovals',FT_LEAVE_FLEX_APPROVAL_COLS_,{
   id:'flex_approval_'+ft_sha_(l.companyId+'|'+l.id),companyId:l.companyId,userId:l.userId,leaveId:l.id,days:l.days,
   creditHours:l.creditHours,referenceDays:rule.leaveFlexReferenceDays,basis:rule.leaveFlexBasis,
   reviewerId:actor.id,reviewedAt:l.reviewedAt});
 }
 if(l.status==='APPROVED'&&before.status==='PENDING')ft_leaveLedgerRecord_(actor,u,'TAKEN',-Number(l.days||0),l.id,'Genehmigter Urlaubsantrag');
 if(l.status==='CANCELLED'&&before.status==='CANCEL_PENDING')ft_leaveLedgerRecord_(actor,u,'RESTORE',Number(l.days||0),l.id,'Bestätigte Urlaubstornierung');
 ft_audit_(actor,'REVIEW','Leaves',l.id,before,ft_publicRow_(l));
 return ft_publicRow_(l);
}

// -----------------------------------------------------------------
// 06_Abrechnung
// -----------------------------------------------------------------
/** FireTime Pro V1.2 | Abrechnung mit firmenspezifischen Zuschlagsregeln.
 *  Ist-Arbeitszeiten und Bereitschaft werden getrennt ausgewiesen.
 */
function ft_report_(c,u,month,skipCumulative,source){
  source=source||{
    Activities:ft_get_('Activities'),Shifts:ft_get_('Shifts'),ShiftSegments:ft_get_('ShiftSegments'),SickLeaves:ft_get_('SickLeaves'),
    Leaves:ft_get_('Leaves'),Months:ft_get_('Months')
  };
  const locked=source.Months.find(x=>x.companyId===c.id&&x.userId===u.id&&
    x.month===month&&['APPROVED','FINAL'].includes(x.status)&&x.snapshot);
  if(locked){try{return JSON.parse(locked.snapshot);}catch(e){throw Error('Gespeicherter Bericht beschädigt.');}}
  const rule=ft_rulesFor_(c,month);
  const [from,to]=ft_monthBounds_(month);
  const activities=source.Activities.filter(a=>a.companyId===c.id&&a.userId===u.id&&
    ft_overlap_(a.start,a.end,from,to)>0);
  const t={month,ruleEffectiveMonth:rule.effectiveMonth,
    worked:0,object:0,incident:0,other:0,breaks:0,
    night:0,sunday:0,holiday:0,standby:0,
    standbyNight:0,standbySunday:0,standbyHoliday:0,
    objectSunday:0,objectHoliday:0,
    incidentSunday:0,incidentHoliday:0,
    sundayPremiumHours:0,holidayPremiumHours:0,nightPremiumHours:0,
    statutoryHolidayWorkHours:0,
    leaveCredit:0,target:Number(u.monthlyHours)||0,
    opening:Number(u.openingHours)||0};
  const hoursByType={STANDBY:{night:0,sunday:0,holiday:0},
    OBJECT:{night:0,sunday:0,holiday:0},
    INCIDENT:{night:0,sunday:0,holiday:0},
    OTHER:{night:0,sunday:0,holiday:0}};
  const add=(type,cat,scale)=>{
    for(const k of ['night','sunday','holiday'])hoursByType[type][k]+=cat[k]*scale;
  };
  activities.forEach(a=>{
    const overlap=ft_overlap_(a.start,a.end,from,to);
    const full=ft_hours_(a.start,a.end);
    if(!full||!overlap)return;
    const fraction=Math.max(0,1-(Number(a.breakMinutes)||0)/(full*60));
    const net=overlap*fraction;
    t.worked+=net;
    t.breaks+=overlap-net;
    const type=['OBJECT','INCIDENT','OTHER'].includes(a.type)?a.type:'OTHER';
    t[type.toLowerCase()]+=net;
    const start=Math.max(+new Date(a.start),+from);
    const end=Math.min(+new Date(a.end),+to);
    const cat=ft_ruleBuckets_(start,end,c,rule);
    add(type,cat,fraction);
  });
  const incidents=activities.filter(x=>x.type==='INCIDENT');
  const shifts=ft_accountableShifts_(source).filter(s=>s.companyId===c.id&&s.userId===u.id&&
    s.status==='PUBLISHED'&&s.actualStatus==='DONE'&&
    ft_overlap_(s.start,s.end,from,to)>0);
  shifts.forEach(s=>{
    const start=Math.max(+new Date(s.start),+from);
    const end=Math.min(+new Date(s.end),+to);
    // Einsätze unterbrechen die Bereitschaft, Objektkontrollen ausdrücklich nicht.
    ft_ruleSegments_(start,end,incidents).forEach(([lo,hi])=>{
      if(hi<=lo)return;
      t.standby+=(hi-lo)/3600000;
      add('STANDBY',ft_ruleBuckets_(lo,hi,c,rule),1);
    });
  });
  for(const k of ['night','sunday','holiday']){
    t[k]=hoursByType.OBJECT[k]+hoursByType.INCIDENT[k]+hoursByType.OTHER[k];
    t['standby'+k[0].toUpperCase()+k.slice(1)]=hoursByType.STANDBY[k];
    const included=ft_rulePremiumTypes_(c,rule[k+'Types']);
    t[k+'PremiumHours']=included.reduce((sum,type)=>sum+hoursByType[type][k],0);
  }
  t.objectSunday=hoursByType.OBJECT.sunday;
  t.objectHoliday=hoursByType.OBJECT.holiday;
  t.incidentSunday=hoursByType.INCIDENT.sunday;
  t.incidentHoliday=hoursByType.INCIDENT.holiday;
  t.statutoryHolidayWorkHours=t.holiday;
  source.Leaves.filter(l=>l.companyId===c.id&&l.userId===u.id&&l.status==='APPROVED')
    .forEach(l=>{
      const all=Number(l.days)||1;
      const fromD=l.from>month+'-01'?l.from:month+'-01';
      const endD=l.to<ft_localDate_(new Date(to.getTime()-3600000))?
        l.to:ft_localDate_(new Date(to.getTime()-3600000));
      if(fromD<=endD)t.leaveCredit+=(Number(l.creditHours)||0)*
        (ft_leaveFlexFor_(u).leaveWorkModel==='FLEX'?ft_flexLeaveDaysForMonth_(l,fromD,endD):ft_leaveDays_(u,fromD,endD)/all);
    });
  t.sickCredit=0;t.sickStandbyCredit=0;
  (source.SickLeaves||ft_get_('SickLeaves')).filter(x=>x.companyId===c.id&&x.userId===u.id&&x.status==='APPROVED')
   .forEach(x=>{const dur=ft_hours_(x.from,x.to),part=ft_overlap_(x.from,x.to,from,to);
     if(dur>0&&part>0){t.sickCredit+=(Number(x.creditHours)||0)*part/dur;
       t.sickStandbyCredit+=(Number(x.standbyCreditHours)||0)*part/dur;}
   });
  const wage=Number(u.hourlyRate)||0;
  const rate=Number(rule.standbyRate)||0;
  t.basePay=t.worked*wage;
  t.standbyPay=t.standby*rate;
  // Zuschlagsbasis ist bei Bereitschaft der Bereitschaftssatz,
  // bei Tätigkeiten der Mitarbeiter-Stundensatz.
  for(const k of ['night','sunday','holiday']){
    const types=ft_rulePremiumTypes_(c,rule[k+'Types']);
    const base=types.reduce((sum,type)=>sum+
      hoursByType[type][k]*(type==='STANDBY'?rate:wage),0);
    t[k+'Pay']=base*(Number(rule[k+'Pct'])||0)/100;
  }
  t.leavePay=t.leaveCredit*wage;
  t.sickPay=t.sickCredit*wage;t.sickStandbyPay=t.sickStandbyCredit*rate;
  t.estimatedGross=t.basePay+t.standbyPay+t.nightPay+t.sundayPay+
    t.holidayPay+t.leavePay+t.sickPay+t.sickStandbyPay;
  t.saldo=t.worked+t.leaveCredit+t.sickCredit-t.target;
  // Keine Behauptung, dass gesetzliches Feiertagsarbeitsentgelt
  // damit bereits vollständig berechnet wäre.
  t.needsHolidayPayReview=t.statutoryHolidayWorkHours>0;
  if(!skipCumulative){
    let cur=ft_balanceStartMonth_(u);
    let balance=t.opening,n=0;
    t.balanceStartMonth=cur;
    t.balanceBreakdown=[];
    while(cur<=month&&n<60){
      const current=cur===month?t:ft_report_(c,u,cur,true,source);
      const delta=Number(current.saldo)||0;
      balance+=delta;
      t.balanceBreakdown.push({month:cur,target:Number(current.target)||0,
        worked:Number(current.worked)||0,leaveCredit:Number(current.leaveCredit)||0,
        sickCredit:Number(current.sickCredit)||0,saldo:ft_hourRound_(delta)});
      n++;
      const [y,m]=cur.split('-').map(Number);
      cur=Utilities.formatDate(new Date(y,m,1,12),FT_TZ,'yyyy-MM');
    }
    t.runningBalance=balance;
    t.balanceLimited=cur<=month;
    t.balanceBeforeStart=t.balanceStartMonth>month;
  }
  for(const k of Object.keys(t))if(typeof t[k]==='number'){
   const isHour=['worked','object','incident','other','breaks','night','sunday','holiday',
    'standby','standbyNight','standbySunday','standbyHoliday','objectSunday','objectHoliday',
    'incidentSunday','incidentHoliday','sundayPremiumHours','holidayPremiumHours','nightPremiumHours',
    'statutoryHolidayWorkHours','leaveCredit','sickCredit','sickStandbyCredit','target','opening','saldo',
    'runningBalance'].includes(k);
   t[k]=isHour?ft_hourRound_(t[k]):ft_2_(t[k]);
  }
  return t;
}

function ft_monthSubmit_(actor,p){
 const uid=actor.role==='STAFF'?actor.id:p.userId||actor.id;
 const u=ft_user_(actor,uid),c=ft_company_(actor,u.companyId),month=ft_month_(p.month);
 if(month>ft_localMonth_(new Date()))throw Error('Zukünftige Monate können nicht eingereicht werden.');
 const modified=new Set(ft_get_('ShiftSegments').map(x=>x.shiftId));
 const pendingLegacy=ft_get_('Shifts').find(s=>s.companyId===c.id&&s.userId===u.id&&
  s.status==='PUBLISHED'&&!modified.has(s.id)&&s.day.slice(0,7)===month&&s.actualStatus!=='DONE');
 const pendingPart=ft_get_('ShiftSegments').find(x=>x.companyId===c.id&&x.userId===u.id&&
  ft_localMonth_(new Date(x.start))===month&&x.actualStatus!=='DONE');
 const pending=pendingLegacy||pendingPart;
 if(pending)throw Error('Bereitschaft ist noch nicht bestaetigt: '+(pending.day||ft_localDate_(new Date(pending.start))));
 if(ft_get_('ShiftChanges').some(x=>x.companyId===c.id&&x.status==='PENDING'&&
  (x.fromUserId===u.id||x.toUserId===u.id)&&ft_localMonth_(new Date(x.start))===month))
  throw Error('Offene Bereitschaftsuebergabe erst klaeren.');
 ft_objectPauseEnsureReady_(c.id,u.id,month);
 const existing=ft_get_('Months').find(x=>x.companyId===c.id&&x.userId===u.id&&x.month===month);
 if(existing&&['SUBMITTED','APPROVED','FINAL'].includes(existing.status))throw Error('Monat bereits eingereicht.');
 const row=existing||{id:ft_uuid_(),companyId:c.id,userId:u.id,month};
 const before=existing?ft_publicRow_(row):{};
 Object.assign(row,{status:'SUBMITTED',submittedAt:ft_now_(),reviewerId:'',reviewedAt:'',note:'',pdfId:'',snapshot:'',snapshotHash:''});
 if(existing)ft_save_('Months',row);else ft_add_('Months',row);
 ft_audit_(actor,'SUBMIT','Months',row.id,before,row);
 return row;
}
function ft_monthReview_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);
 const r=ft_one_('Months',p.id);
 if(!r)throw Error('Monat nicht gefunden');
 ft_scope_(actor,r.companyId);
 if(r.status!=='SUBMITTED')throw Error('Nur eingereichte Monate können geprüft werden.');
 if(!['APPROVED','RETURNED'].includes(p.status))throw Error('Ungültiger Freigabestatus.');
 const before=ft_publicRow_(r);
 if(p.status==='APPROVED'){
  if(ft_get_('SickLeaves').some(x=>x.companyId===r.companyId&&x.userId===r.userId&&
     x.status==='PENDING'&&ft_localMonth_(new Date(x.from))<=r.month&&ft_localMonth_(new Date(x.to))>=r.month))
   throw Error('Krankenstand vor Monatsfreigabe pruefen.');
  const c=ft_company_(actor,r.companyId),u=ft_user_(actor,r.userId);
  ft_objectPauseEnsureReady_(c.id,u.id,r.month);
  const snap=JSON.stringify(ft_report_(c,u,r.month));
  r.snapshot=snap;r.snapshotHash=ft_sha_(snap);
 }else{r.snapshot='';r.snapshotHash='';}
 r.status=p.status;r.note=ft_str_(p.note,500);
 r.reviewerId=actor.id;r.reviewedAt=ft_now_();
 if(p.status==='APPROVED'){
   for(const x of ft_get_('ShiftChanges').filter(x=>x.companyId===r.companyId&&x.status==='ACCEPTED'&&!x.reviewedAt&&
    (x.fromUserId===r.userId||x.toUserId===r.userId)&&ft_localMonth_(new Date(x.start))===r.month)){
    x.reviewedAt=ft_now_();x.reviewerId=actor.id;ft_save_('ShiftChanges',x);
   }
 }
 ft_save_('Months',r);
 ft_audit_(actor,'REVIEW','Months',r.id,before,r);
 return r;
}
function ft_publicReport_(c,report){
 const out=Object.assign({},report);
 if(!ft_enabled_(c,'PAY_PREVIEW')){
  ['basePay','standbyPay','nightPay','sundayPay','holidayPay','leavePay',
   'sickPay','sickStandbyPay','estimatedGross'].forEach(k=>delete out[k]);
 }
 return out;
}
function ft_reportApi_(actor,p){
 const uid=actor.role==='STAFF'?actor.id:p.userId||actor.id;
 const u=ft_user_(actor,uid),c=ft_company_(actor,u.companyId),m=ft_month_(p.month);
 return {user:ft_safe_(u),company:ft_companyData_(c),report:ft_publicReport_(c,ft_report_(c,u,m)),
  entries:ft_get_('Activities').filter(a=>a.companyId===c.id&&a.userId===u.id&&
   ft_overlap_(a.start,a.end,...ft_monthBounds_(m))>0).map(ft_publicRow_)};
}
/**
 * FireTime Pro · Moderner PDF-Monatsbericht
 * Ersetzt ausschliesslich ft_reportPdf_ in der bestehenden Code.gs.
 * Bestehende Daten / Berechnungen / API unveraendert.
 * Developed by Michael Mejtsky
 */
function ft_reportPdf_(actor,p){
  const out=ft_reportApi_(actor,p);
  const user=out.user, company=out.company, r=out.report, entries=out.entries||[];
  const month=String(r.month||p.month||'');
  const germanMonths=['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const parts=month.split('-').map(Number);
  const period=(parts.length===2&&parts[1]>=1&&parts[1]<=12)?germanMonths[parts[1]-1]+' '+parts[0]:month;
  const primary=/^#[0-9a-fA-F]{6}$/.test(String(company.color||''))?company.color:'#2874B8';
  const navy='#14273D', soft='#EFF4F9', ink='#253244', muted='#667587', line='#DDE5ED', white='#FFFFFF';
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const show=v=>Math.abs(n(v))>0.004;
  const fmt=v=>n(v).toLocaleString('de-AT',{minimumFractionDigits:2,maximumFractionDigits:2});
  const hours=v=>fmt(v)+' h';
  const euro=v=>fmt(v)+' €';
  const signed=v=>(n(v)>0?'+':'')+hours(v);
  const safeDate=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?Utilities.formatDate(d,FT_TZ,'dd.MM.yyyy'):String(value||'–');};
  const safeTime=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?Utilities.formatDate(d,FT_TZ,'HH:mm'): '–';};
  const shortDay=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?Utilities.formatDate(d,FT_TZ,'dd.MM. HH:mm'):String(value||'–');};
  const doc=DocumentApp.create('FireTime Pro | '+company.name+' | '+user.name+' | '+month);
  const body=doc.getBody();
  // A4, dezente Raender. Auch bei anderer Dokumentvorlage lauffaehig.
  for(const [method,arg] of [['setMarginTop',35],['setMarginBottom',38],['setMarginLeft',42],['setMarginRight',42]]){
    if(typeof body[method]==='function')body[method](arg);
  }
  const txt=(str,opt)=>{
    opt=opt||{};
    const para=body.appendParagraph(String(str));
    if(opt.heading)para.setHeading(opt.heading);
    if(typeof para.setSpacingBefore==='function')para.setSpacingBefore(opt.before||0);
    if(typeof para.setSpacingAfter==='function')para.setSpacingAfter(opt.after===undefined?5:opt.after);
    const text=para.editAsText();
    text.setFontFamily('Arial').setFontSize(opt.size||9).setForegroundColor(opt.color||ink);
    if(opt.bold)text.setBold(true);
    return para;
  };
  const cell=(c,opts)=>{
    opts=opts||{};
    if(opts.bg)c.setBackgroundColor(opts.bg);
    for(const [method,size] of [['setPaddingTop',opts.padTop===undefined?7:opts.padTop],
      ['setPaddingBottom',opts.padBottom===undefined?7:opts.padBottom],
      ['setPaddingLeft',opts.padLeft===undefined?8:opts.padLeft],
      ['setPaddingRight',opts.padRight===undefined?8:opts.padRight]]){
      if(typeof c[method]==='function')c[method](size);
    }
    const text=c.editAsText();
    if(c.getText()){
      text.setFontFamily('Arial').setFontSize(opts.size||9).setForegroundColor(opts.color||ink);
      if(opts.bold)text.setBold(true);
    }
    return c;
  };
  const table=(data,opt)=>{
    opt=opt||{};
    const t=body.appendTable(data.map(row=>row.map(x=>String(x===null||x===undefined?'':x))));
    if(typeof t.setBorderWidth==='function')t.setBorderWidth(opt.border===undefined?0:opt.border);
    if(typeof t.setBorderColor==='function')t.setBorderColor(line);
    for(let ri=0;ri<data.length;ri++)for(let ci=0;ci<data[ri].length;ci++){
      const isHeader=opt.header&&ri===0;
      const background=isHeader?navy:(ri%2===0?white:'#F5F8FB');
      cell(t.getRow(ri).getCell(ci),{bg:background,color:isHeader?white:ink,
        bold:isHeader||Boolean(opt.boldFirst&&ci===0),size:opt.size||8.5,
        padTop:opt.pad===undefined?6:opt.pad,padBottom:opt.pad===undefined?6:opt.pad});
    }
    return t;
  };
  const section=title=>{
    txt(title.toUpperCase(),{size:10,bold:true,color:navy,before:13,after:5});
    const bar=body.appendTable([['','']]);
    if(typeof bar.setBorderWidth==='function')bar.setBorderWidth(0);
    cell(bar.getRow(0).getCell(0),{bg:primary,padTop:1,padBottom:1});
    cell(bar.getRow(0).getCell(1),{bg:soft,padTop:1,padBottom:1});
  };
  const keyValues=(pairs)=>{
    if(!pairs.length)return;
    const t=body.appendTable(pairs.map(([label,value])=>[label,value]));
    if(typeof t.setBorderWidth==='function')t.setBorderWidth(0);
    for(let i=0;i<pairs.length;i++){
      cell(t.getRow(i).getCell(0),{bg:i%2?white:'#F2F6FA',size:8.5,color:muted});
      cell(t.getRow(i).getCell(1),{bg:i%2?white:'#F2F6FA',bold:true,size:9,color:ink});
    }
  };
  // Firmenlogo an oberster Stelle, links neben dem Unternehmen.
  const head=body.appendTable([['','']]);
  if(typeof head.setBorderWidth==='function')head.setBorderWidth(0);
  const imageCell=head.getRow(0).getCell(0),titleCell=head.getRow(0).getCell(1);
  cell(imageCell,{bg:white,padTop:6,padBottom:8});
  cell(titleCell,{bg:navy,padTop:14,padBottom:14});
  let logoWarning='';
  if(company.logoId){
    try{
      const blob=DriveApp.getFileById(company.logoId).getBlob();
      if(!/^(image\/png|image\/jpeg|image\/gif|image\/bmp)$/i.test(blob.getContentType()))
        throw Error('Logo ist kein PNG/JPG/GIF/BMP. Bitte Firmenlogo als PNG oder JPG neu hochladen.');
      const img=imageCell.appendImage(blob);
      const w=img.getWidth(),h=img.getHeight();
      if(w>0&&h>0){const factor=Math.min(1,130/w,66/h);img.setWidth(Math.round(w*factor));img.setHeight(Math.round(h*factor));}
    }catch(err){logoWarning='Firmenlogo konnte nicht eingebettet werden: '+err.message;
      cell(imageCell,{bg:soft,bold:true,color:navy,size:12});imageCell.appendParagraph('FT  PRO');
      Logger.log('FireTime Pro PDF: '+logoWarning);
    }
  }else{
    logoWarning='Für diese Firma ist noch kein Logo hinterlegt. Unter Firmenprofil ein PNG/JPG hochladen.';
    cell(imageCell,{bg:soft,color:navy});imageCell.appendParagraph('FT  PRO');
  }
  const cp=titleCell.appendParagraph(String(company.name||'Firma'));
  cp.editAsText().setFontFamily('Arial').setFontSize(17).setBold(true).setForegroundColor(white);
  const sp=titleCell.appendParagraph('MONATSNACHWEIS  ·  FIRETIME PRO');
  sp.editAsText().setFontFamily('Arial').setFontSize(9).setForegroundColor('#D8E5F4');
  const periodText=titleCell.appendParagraph(period);
  periodText.editAsText().setFontFamily('Arial').setFontSize(11).setForegroundColor(white);

  const monthRow=ft_get_('Months').find(x=>x.companyId===company.id&&x.userId===user.id&&String(x.month)===month);
  const status=monthRow?({SUBMITTED:'Eingereicht',APPROVED:'Freigegeben',FINAL:'Abgeschlossen',RETURNED:'Zurückgegeben'}[monthRow.status]||'Offen'):'Offen';
  txt('MITARBEITER / MONAT',{size:8,bold:true,color:muted,before:11,after:3});
  table([['Mitarbeiter','Zeitraum','Status'],[user.name,period,status]],{header:true,size:8.5,pad:7});

  section('Monat auf einen Blick');
  const cards=[['SOLL',hours(r.target)],['GELEISTET',hours(r.worked)],['SALDO',signed(r.saldo)]];
  if(show(r.standby))cards.push(['BEREITSCHAFT NETTO',hours(r.standby)]);
  const summary=body.appendTable([cards.map(x=>x[0]),cards.map(x=>x[1])]);
  if(typeof summary.setBorderWidth==='function')summary.setBorderWidth(0);
  cards.forEach((_,i)=>{
    cell(summary.getRow(0).getCell(i),{bg:soft,color:muted,size:7.5,bold:true,padBottom:3});
    cell(summary.getRow(1).getCell(i),{bg:soft,color:i===2?(n(r.saldo)<0?'#B42318':'#127154'):navy,size:13,bold:true,padTop:3,padBottom:12});
  });
  const balance=[];
  if(show(r.runningBalance))balance.push(['Gesamtsaldo inkl. Vormonate',signed(r.runningBalance)]);
  if(show(r.leaveCredit))balance.push(['Genehmigte Urlaubsgutschrift',hours(r.leaveCredit)]);
  if(show(r.sickCredit))balance.push(['Genehmigte Krankenstands-Sollgutschrift',hours(r.sickCredit)]);
  if(show(r.sickStandbyCredit))balance.push(['Krankenstand: gesonderter Bereitschaftsanspruch',hours(r.sickStandbyCredit)]);
  if(balance.length){txt('Zusätzliche Gutschriften / Salden',{size:9,bold:true,color:navy,before:9});keyValues(balance);}

  const components=[
    ['Objektkontrollen',r.object],['Einsätze (aktive Arbeitszeit)',r.incident],
    ['Sonstige Arbeitszeit',r.other],['Bestätigte Bereitschaft netto',r.standby],
    ['Nachtarbeit',r.night],['Bereitschaft in Nachtstunden',r.standbyNight],
    ['Sonntagsarbeit',r.sunday],['Bereitschaft sonntags',r.standbySunday],
    ['Feiertagsarbeit',r.holiday],['Bereitschaft feiertags',r.standbyHoliday],
    ['Zuschlagsfähige Nachtstunden',r.nightPremiumHours],
    ['Zuschlagsfähige Sonntagsstunden',r.sundayPremiumHours],
    ['Zuschlagsfähige Feiertagsstunden',r.holidayPremiumHours]
  ].filter(x=>show(x[1])).map(x=>[x[0],hours(x[1])]);
  if(components.length){section('Arbeits- und Bereitschaftsarten');keyValues(components);}

  const sorted=entries.slice().sort((a,b)=>String(a.start).localeCompare(String(b.start)));
  if(sorted.length){
    section('Tätigkeitsnachweise');
    const types={OBJECT:'Objektkontrolle',INCIDENT:'Einsatz',OTHER:'Sonstiges'};
    const items=sorted.map(a=>{
      const net=Math.max(0,ft_hours_(a.start,a.end)-(n(a.breakMinutes)/60));
      return [safeDate(a.start),safeTime(a.start)+'–'+safeTime(a.end),types[a.type]||String(a.type||'Arbeit'),hours(net),[a.object,a.description].filter(Boolean).join(' · ').slice(0,160)||'–'];
    });
    table([['DATUM','UHRZEIT','ART','DAUER','NOTIZ / OBJEKT'],...items],{header:true,size:7.3,pad:5});
  }

  // Angezeigt werden nur bestaetigte Bereitschaftsabschnitte. Das beugt
  // doppelter Anzeige nach Teiluebergabe vor und betrifft nur den aktuellen Monat.
  const monthly=ft_monthBounds_(month),source={Shifts:ft_get_('Shifts'),ShiftSegments:ft_get_('ShiftSegments')};
  const confirmed=ft_accountableShifts_(source).filter(s=>s.companyId===company.id&&s.userId===user.id&&
    s.status==='PUBLISHED'&&s.actualStatus==='DONE'&&ft_overlap_(s.start,s.end,monthly[0],monthly[1])>0)
    .sort((a,b)=>String(a.start).localeCompare(String(b.start)));
  if(confirmed.length){
    section('Bestätigte Bereitschaftsabschnitte');
    const data=confirmed.map(s=>[shortDay(s.start),shortDay(s.end),hours(ft_overlap_(s.start,s.end,monthly[0],monthly[1])),'Bestätigt']);
    table([['VON','BIS','BRUTTO','STATUS'],...data],{header:true,size:7.7});
    txt('Netto-Bereitschaft nach Abzug der Einsatzunterbrechungen: '+hours(r.standby),{size:8,color:muted,after:5});
  }

  const leaveData=ft_get_('Leaves').filter(x=>x.companyId===company.id&&x.userId===user.id&&
    x.status==='APPROVED'&&String(x.from).slice(0,7)<=month&&String(x.to).slice(0,7)>=month);
  const sickData=ft_get_('SickLeaves').filter(x=>x.companyId===company.id&&x.userId===user.id&&
    x.status==='APPROVED'&&ft_overlap_(x.from,x.to,monthly[0],monthly[1])>0);
  if(leaveData.length||sickData.length){
    section('Genehmigte Abwesenheiten');
    const rows=leaveData.map(x=>['Urlaub',String(x.from)+' – '+String(x.to),show(x.creditHours)?hours(x.creditHours):'–']);
    sickData.forEach(x=>rows.push(['Krankenstand',safeDate(x.from)+' – '+safeDate(x.to),
      show(x.creditHours)?hours(x.creditHours)+' Sollgutschrift':'keine Sollgutschrift']));
    table([['ART','ZEITRAUM','ANRECHNUNG'],...rows],{header:true,size:8});
  }

  // Entgelt ist eine unverbindliche Vorschau. Null-Positionen werden weggelassen.
  const pay=[
    ['Aktive Arbeitszeit',r.basePay],['Bereitschaftsvergütung',r.standbyPay],
    ['Nachtzuschlag laut Firmenregel',r.nightPay],['Sonntagszuschlag laut Firmenregel',r.sundayPay],
    ['Feiertagszuschlag laut Firmenregel',r.holidayPay],['Urlaubsgutschrift',r.leavePay],
    ['Krankenstandsgutschrift',r.sickPay],['Krankenstand: Bereitschaftsanspruch',r.sickStandbyPay]
  ].filter(x=>show(x[1])).map(x=>[x[0],euro(x[1])]);
  if(pay.length){
    section('Unverbindliche Vergütungsvorschau');
    keyValues(pay);
    const total=body.appendTable([['GESCHÄTZTE GESAMTSUMME',euro(r.estimatedGross)]]);
    if(typeof total.setBorderWidth==='function')total.setBorderWidth(0);
    cell(total.getRow(0).getCell(0),{bg:navy,color:white,bold:true,size:9,padTop:9,padBottom:9});
    cell(total.getRow(0).getCell(1),{bg:navy,color:white,bold:true,size:12,padTop:9,padBottom:9});
  }

  if(r.needsHolidayPayReview)txt('HINWEIS: Arbeit an einem gesetzlichen Feiertag ist erfasst. Feiertagsentgelt und Ansprüche nach Gesetz/Kollektivvertrag sind gesondert zu prüfen.',{size:8,color:'#9D3B1B',before:12});
  if(monthRow&&['APPROVED','FINAL'].includes(monthRow.status)&&monthRow.reviewedAt){
    txt('Monatsprüfung: '+status+' am '+safeDate(monthRow.reviewedAt),{size:8,bold:true,color:'#127154',before:12});
  }
  txt('Hinweis: Dieser Monatsnachweis ist keine rechtsverbindliche Lohn- oder Gehaltsabrechnung. Gesetzliche und kollektivvertragliche Ansprüche sind gesondert zu prüfen.',{size:8,color:muted,before:12,after:8});
  txt('FireTime Pro  ·  Developed by Michael Mejtsky  ·  Erstellt: '+safeDate(new Date()),{size:8,color:muted});
  doc.saveAndClose();
  const folder=DriveApp.getFolderById(ft_prop_('FT_ROOT_ID'));
  const name='FireTimePro_'+String(company.slug||'firma')+'_'+String(user.name||'Mitarbeiter').replace(/[^a-z0-9äöü -]/gi,'_')+'_'+month+'.pdf';
  // Google Docs dient nur als temporaere Vorlage; im Drive bleibt das PDF.
  const docFile=DriveApp.getFileById(doc.getId());
  const pdf=folder.createFile(docFile.getAs(MimeType.PDF).setName(name));
  docFile.setTrashed(true);
  ft_audit_(actor,'PDF','Reports',pdf.getId(),{}, {companyId:company.id,userId:user.id,month});
  if(pdf.getSize()>6*1024*1024)throw Error('PDF gespeichert, aber für Direktdownload zu groß.');
  return {name:pdf.getName(),data:p.metadataOnly?'':'data:application/pdf;base64,'+Utilities.base64Encode(pdf.getBlob().getBytes()),id:pdf.getId(),logoWarning};
}


// -----------------------------------------------------------------
// 06B_PDF_ARCHIV (versionierte, mandantenbezogene Metadaten)
// -----------------------------------------------------------------
const FT_PDF_ARCHIVE_HEADERS_=['id','companyId','userId','month','fileId','name','createdAt','version','status'];
// Auch in PdfArchive/PdfJobs koennen Google-Sheets-Monatswerte Date-Objekte werden.
function ft_pdfReadCell_(key,value){
 if(value instanceof Date){
  if(!Number.isFinite(value.getTime()))return '';
  return key==='month'?Utilities.formatDate(value,FT_TZ,'yyyy-MM'):value.toISOString();
 }
 if(key==='month'){
  const t=String(value||'').trim();
  if(/^20\d\d-(0[1-9]|1[0-2])(?:-\d\d|T|$)/.test(t))return t.slice(0,7);
 }
 return value;
}
function ft_pdfArchiveSheet_(create){
  let sheet=ft_db_().getSheetByName('PdfArchive');
  if(!sheet&&create){sheet=ft_db_().insertSheet('PdfArchive');sheet.appendRow(FT_PDF_ARCHIVE_HEADERS_);sheet.setFrozenRows(1);sheet.getRange('D:D').setNumberFormat('@');}
  if(sheet){
    const found=sheet.getRange(1,1,1,FT_PDF_ARCHIVE_HEADERS_.length).getValues()[0].map(String);
    if(found.join('|')!==FT_PDF_ARCHIVE_HEADERS_.join('|'))throw Error('PDF-Archivschema stimmt nicht.');
  }
  return sheet;
}
function ft_pdfArchiveRows_(){
  const sheet=ft_pdfArchiveSheet_(false);
  if(!sheet||sheet.getLastRow()<2)return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,FT_PDF_ARCHIVE_HEADERS_.length).getValues().map((v,i)=>{
    const o={__row:i+2};FT_PDF_ARCHIVE_HEADERS_.forEach((key,j)=>o[key]=ft_pdfReadCell_(key,v[j]));return o;
  });
}
function ft_pdfIdentity_(actor,p){
  const userId=actor.role==='STAFF'?actor.id:String(p.userId||actor.id);
  const user=ft_user_(actor,userId),company=ft_company_(actor,user.companyId),month=ft_month_(p.month);
  ft_need_(actor,company,'REPORTS');
  return {user,company,month};
}
function ft_pdfMetadata_(row){return {id:String(row.id),name:String(row.name),month:String(row.month),createdAt:String(row.createdAt),version:Number(row.version)||1,status:String(row.status||'')};}
/**
 * Sicherer Sofort-PDF-Export: Der Browser erstellt die PDF aus dem geladenen
 * (und serverseitig gespeicherten) Monatsbericht; Apps Script speichert sie
 * in Drive und indiziert sie im firmenspezifisch geschuetzten Archiv.
 * Kein Google Docs, kein installierbarer Trigger, kein ft_setup erforderlich.
 * Die uebertragene PDF wird NICHT als autoritative Zeitbuchung verwendet.
 */
function ft_pdfStore_(actor,p){
  const x=ft_pdfIdentity_(actor,p);
  const key=String(p.requestId||'');
  if(!/^[a-zA-Z0-9_-]{12,100}$/.test(key))throw Error('PDF-Anfragekennung fehlt. Bitte Seite aktualisieren.');
  const data=String(p.base64||'');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length>2900000||data.length<100)
    throw Error('PDF ist ungueltig oder zu gross (maximal 2 MB).');
  const bytes=Utilities.base64Decode(data);
  if(bytes.length<100||bytes.length>2*1024*1024||
      bytes.slice(0,5).map(v=>v&255).join(',')!=='37,80,68,70,45')
    throw Error('Das Dokument ist kein gueltiges PDF (maximal 2 MB).');
  const suffix=ft_hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    x.company.id+'|'+x.user.id+'|'+x.month+'|'+key,Utilities.Charset.UTF_8));
  // Doppelte Anfragen derselben Browser-Aktion erzeugen keine Doppeldateien.
  const existing=ft_pdfArchiveRows_().find(r=>String(r.id)===suffix&&
    String(r.companyId)===String(x.company.id)&&String(r.userId)===String(x.user.id));
  if(existing)return ft_pdfMetadata_(existing);
  const safeUser=String(x.user.name||'Mitarbeiter').replace(/[^a-z0-9äöü -]/gi,'_').slice(0,65);
  const filename='FireTimePro_'+String(x.company.slug||'Firma')+'_'+safeUser+'_'+x.month+'_'+key.slice(0,8)+'.pdf';
  let file=null;
  try{
    const folder=DriveApp.getFolderById(ft_prop_('FT_ROOT_ID'));
    file=folder.createFile(Utilities.newBlob(bytes,MimeType.PDF,filename));
    // Nur das kurze Index-Schreiben wird gesperrt – keine Docs-Erstellung darin.
    const recorded=ft_lock_(()=>{
      const previous=ft_pdfArchiveRows_();
      const dup=previous.find(r=>String(r.id)===suffix);
      if(dup)return ft_pdfMetadata_(dup);
      const version=previous.filter(r=>String(r.companyId)===String(x.company.id)&&
        String(r.userId)===String(x.user.id)&&String(r.month)===x.month)
        .reduce((v,r)=>Math.max(v,Number(r.version)||1),0)+1;
      const record={id:suffix,companyId:x.company.id,userId:x.user.id,month:x.month,
        fileId:file.getId(),name:filename,createdAt:ft_now_(),version,status:'READY'};
      ft_pdfArchiveSheet_(true).appendRow(FT_PDF_ARCHIVE_HEADERS_.map(k=>record[k]||''));
      return ft_pdfMetadata_(record);
    });
    // Falls zeitgleich schon dieselbe requestId gespeichert war, die zusaetzliche
    // Drive-Datei nicht als unindexiertes Duplikat liegenlassen.
    if(recorded.id===suffix){
      const hits=ft_pdfArchiveRows_().find(r=>String(r.id)===suffix);
      if(hits&&String(hits.fileId)!==String(file.getId()))file.setTrashed(true);
    }
    return recorded;
  }catch(err){
    // Keine verwaisten PDF-Dateien bei nicht vollstaendigem Indexeintrag.
    if(file)try{
      const saved=ft_pdfArchiveRows_().some(r=>String(r.id)===suffix&&String(r.fileId)===String(file.getId()));
      if(!saved)file.setTrashed(true);
    }catch(_){ }
    throw err;
  }
}
function ft_pdfArchive_(actor,p){
  const x=ft_pdfIdentity_(actor,p);
  return ft_pdfArchiveRows_().filter(r=>String(r.companyId)===String(x.company.id)&&String(r.userId)===String(x.user.id)&&String(r.month)===x.month)
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(ft_pdfMetadata_);
}
// -----------------------------------------------------------------
// PDF-Sammelarchiv: ein Dokument pro gewaehlter Mitarbeitergruppe.
// Getrennte Index-Tabelle vom persoenlichen PDF-Archiv.
// -----------------------------------------------------------------
const FT_PDF_BATCH_COLS_=['id','companyId','month','fileId','name','createdAt','version','creatorId','userIds','status'];
function ft_pdfBatchSheet_(create){
 let sh=ft_db_().getSheetByName('PdfBatchArchive');
 if(!sh&&create){sh=ft_db_().insertSheet('PdfBatchArchive');
   sh.appendRow(FT_PDF_BATCH_COLS_);sh.setFrozenRows(1);sh.getRange('C:C').setNumberFormat('@');}
 if(sh){
  const actual=sh.getRange(1,1,1,FT_PDF_BATCH_COLS_.length).getValues()[0].map(String);
  if(actual.join('|')!==FT_PDF_BATCH_COLS_.join('|'))throw Error('Sammel-PDF-Archivschema stimmt nicht.');
 }
 return sh;
}
function ft_pdfBatchRows_(){
 const sh=ft_pdfBatchSheet_(false);if(!sh||sh.getLastRow()<2)return [];
 return sh.getRange(2,1,sh.getLastRow()-1,FT_PDF_BATCH_COLS_.length).getValues().map((v,i)=>{
  const row={__row:i+2};FT_PDF_BATCH_COLS_.forEach((k,j)=>row[k]=ft_pdfReadCell_(k,v[j]));return row;
 });
}
function ft_pdfBatchScope_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);
 const company=ft_company_(actor,p.companyId||actor.companyId);
 ft_need_(actor,company,'REPORTS');
 return {company,month:ft_month_(p.month)};
}
function ft_pdfBatchMeta_(r){
 let userIds=[];try{userIds=JSON.parse(String(r.userIds||'[]'));}catch(_){}
 return {id:String(r.id),month:String(r.month),name:String(r.name),
  createdAt:String(r.createdAt),version:Number(r.version)||1,
  status:String(r.status||''),userIds:Array.isArray(userIds)?userIds:[]};
}
function ft_pdfBatchStore_(actor,p){
 const x=ft_pdfBatchScope_(actor,p);
 const requestId=String(p.requestId||'');
 if(!/^[a-zA-Z0-9_-]{12,100}$/.test(requestId))throw Error('Ungueltige Sammel-PDF-Anfragekennung.');
 if(!Array.isArray(p.userIds)||p.userIds.length<1||p.userIds.length>200)
  throw Error('Bitte 1 bis 200 Mitarbeiter auswaehlen.');
 const ids=[...new Set(p.userIds.map(String))];
 if(ids.length!==p.userIds.length)throw Error('Mitarbeiterliste enthaelt Duplikate.');
 const allUsers=ft_get_('Users');
 for(const id of ids){const user=allUsers.find(u=>String(u.id)===id);
  if(!user||String(user.companyId)!==String(x.company.id))throw Error('Unberechtigter Mitarbeiter im Sammelbericht.');
 }
 const data=String(p.base64||'');
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length<100||data.length>11.2e6)
  throw Error('Sammel-PDF zu gross oder ungueltig (maximal 8 MB).');
 const bytes=Utilities.base64Decode(data);
 if(bytes.length<100||bytes.length>8*1024*1024||
    bytes.slice(0,5).map(v=>v&255).join(',')!=='37,80,68,70,45')
  throw Error('Sammel-PDF ungueltig (maximal 8 MB).');
 const suffix=ft_sha_(x.company.id+'|BATCH|'+x.month+'|'+requestId);
 const existing=ft_pdfBatchRows_().find(a=>String(a.id)===suffix&&String(a.companyId)===String(x.company.id));
 if(existing)return ft_pdfBatchMeta_(existing);
 const filename='FireTimePro_'+String(x.company.slug||'Firma').replace(/[^a-z0-9_-]/gi,'_')+'_'+
  x.month+'_Sammelbericht_'+ids.length+'_Mitarbeiter_'+requestId.slice(0,8)+'.pdf';
 let file=null;
 try{
  file=DriveApp.getFolderById(ft_prop_('FT_ROOT_ID'))
   .createFile(Utilities.newBlob(bytes,MimeType.PDF,filename));
  const result=ft_lock_(()=>{
   const rows=ft_pdfBatchRows_(),dup=rows.find(r=>String(r.id)===suffix);
   if(dup)return ft_pdfBatchMeta_(dup);
   const version=rows.filter(r=>String(r.companyId)===String(x.company.id)&&String(r.month)===x.month)
    .reduce((v,r)=>Math.max(v,Number(r.version)||1),0)+1;
   const record={id:suffix,companyId:x.company.id,month:x.month,fileId:file.getId(),
    name:filename,createdAt:ft_now_(),version,creatorId:actor.id,userIds:JSON.stringify(ids),status:'READY'};
   ft_pdfBatchSheet_(true).appendRow(FT_PDF_BATCH_COLS_.map(k=>record[k]||''));
   return ft_pdfBatchMeta_(record);
  });
  const indexed=ft_pdfBatchRows_().find(a=>String(a.id)===suffix);
  if(indexed&&String(indexed.fileId)!==String(file.getId()))file.setTrashed(true);
  return result;
 }catch(e){
  if(file)try{if(!ft_pdfBatchRows_().some(r=>String(r.id)===suffix&&String(r.fileId)===String(file.getId())))file.setTrashed(true);}catch(_){}
  throw e;
 }
}
function ft_pdfBatchArchive_(actor,p){
 const x=ft_pdfBatchScope_(actor,p);
 return ft_pdfBatchRows_().filter(r=>String(r.companyId)===String(x.company.id)&&String(r.month)===x.month)
   .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(ft_pdfBatchMeta_);
}
function ft_pdfBatchChunk_(actor,p){
 const x=ft_pdfBatchScope_(actor,p);
 const row=ft_pdfBatchRows_().find(r=>String(r.id)===String(p.id)&&
  String(r.companyId)===String(x.company.id)&&String(r.month)===x.month);
 if(!row)throw Error('Sammelbericht nicht vorhanden oder Zugriff verweigert.');
 const file=DriveApp.getFileById(String(row.fileId));
 if(file.isTrashed()||file.getMimeType()!==MimeType.PDF)throw Error('PDF-Datei nicht verfuegbar.');
 const bytes=file.getBlob().getBytes(),chunkSize=65536,total=Math.ceil(bytes.length/chunkSize),index=Number(p.index);
 if(!Number.isSafeInteger(index)||index<0||index>=total)throw Error('Ungueltiger PDF-Abschnitt.');
 return {id:String(row.id),index,total,name:String(row.name),size:bytes.length,
   base64:Utilities.base64Encode(bytes.slice(index*chunkSize,(index+1)*chunkSize))};
}

// Asynchroner PDF-Auftrag: Google Docs wird NICHT in der Cloudflare-HTTP-Anfrage erzeugt.
const FT_PDF_JOB_HEAD_=['id','companyId','userId','month','status','createdAt','updatedAt','error','archiveId'];
function ft_pdfJobsSheet_(create){
 let s=ft_db_().getSheetByName('PdfJobs');
 if(!s&&create){s=ft_db_().insertSheet('PdfJobs');s.appendRow(FT_PDF_JOB_HEAD_);s.setFrozenRows(1);s.getRange('D:D').setNumberFormat('@');}
 if(s){const cols=s.getRange(1,1,1,FT_PDF_JOB_HEAD_.length).getValues()[0].map(String);
  if(cols.join('|')!==FT_PDF_JOB_HEAD_.join('|'))throw Error('PDF-Auftragsschema nicht korrekt.');}
 return s;
}
function ft_pdfJobsRows_(){const s=ft_pdfJobsSheet_(false);if(!s||s.getLastRow()<2)return [];
 return s.getRange(2,1,s.getLastRow()-1,FT_PDF_JOB_HEAD_.length).getValues().map((values,i)=>{
  const o={__row:i+2};FT_PDF_JOB_HEAD_.forEach((k,j)=>o[k]=ft_pdfReadCell_(k,values[j]));return o;});}
function ft_pdfJobPublic_(r){return {id:String(r.id),status:String(r.status),createdAt:String(r.createdAt),error:String(r.error||''),archiveId:String(r.archiveId||'')};}
function ft_pdfPrepare_(actor,p){
 // Schneller Auftragsstart: Keine Google-Drive-Dateipruefung und keine Triggeranlage
 // innerhalb der globalen Script-Sperre. Der HTTP-Request erstellt KEIN PDF.
 const x=ft_pdfIdentity_(actor,p);
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(4500)){
   throw Error('PDF-System ist momentan ausgelastet. Bitte wenige Sekunden warten und denselben Auftrag erneut pruefen.');
 }
 let result=null,needsTrigger=false;
 try{
   const match=r=>String(r.companyId)===String(x.company.id)&&
     String(r.userId)===String(x.user.id)&&String(r.month)===x.month;
   const pending=ft_pdfJobsRows_().filter(r=>match(r)&&['QUEUED','RUNNING'].includes(String(r.status)))
     .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
   if(pending){
     const age=Date.now()-new Date(pending.updatedAt||pending.createdAt).getTime();
     // Apps Script beendet einzelne Ausfuehrungen spaetestens nach der Laufzeitgrenze;
     // ein aelterer RUNNING-Datensatz darf nicht dauerhaft alle neuen PDFs blockieren.
     if(pending.status==='RUNNING' && age>9*60*1000){
       pending.status='ERROR';
       pending.error='PDF-Worker hat die maximale Wartezeit ueberschritten. Der Auftrag kann neu gestartet werden.';
       pending.updatedAt=ft_now_();
       ft_pdfJobsSheet_(false).getRange(pending.__row,1,1,FT_PDF_JOB_HEAD_.length)
         .setValues([FT_PDF_JOB_HEAD_.map(k=>pending[k]||'')]);
     }else{
       result=ft_pdfJobPublic_(pending);
       needsTrigger=pending.status==='QUEUED';
     }
   }
   // Ein vorhandener PDF-Bericht darf explizit neu erstellt werden,
   // beispielsweise nach nachtraeglich erfassten Stunden in einem OFFENEN Monat.
   if(!result && !ft_bool_(p.refresh)){
     const previous=ft_pdfArchiveRows_().filter(match)
       .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
     if(previous)result={status:'READY',...ft_pdfMetadata_(previous)};
   }
   if(!result){
     const job={id:ft_uuid_(),companyId:x.company.id,userId:x.user.id,month:x.month,
       status:'QUEUED',createdAt:ft_now_(),updatedAt:ft_now_(),error:'',archiveId:''};
     ft_pdfJobsSheet_(true).appendRow(FT_PDF_JOB_HEAD_.map(k=>job[k]||''));
     result=ft_pdfJobPublic_(job);needsTrigger=true;
   }
 }finally{lock.releaseLock();}
 if(needsTrigger){
   // Ausserhalb der globalen Schreibsperre: andere FireTime-Anfragen blockieren nicht.
   try{
     const exists=ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='ft_pdfWorker_');
     if(!exists)ScriptApp.newTrigger('ft_pdfWorker_').timeBased().after(1000).create();
   }catch(e){
     console.error('PDF-Auftrags-Trigger konnte nicht angelegt werden:',e);
     // Auftrag bleibt auffindbar; beim naechsten Aufruf wird die Triggeranlage erneut versucht.
     throw Error('PDF-Auftrag gespeichert, aber Hintergrundverarbeitung konnte nicht gestartet werden: '+String(e.message||e));
   }
 }
 return result;
}
/** Tageskontrolle: fehlende oder blockierte PDF-Archive nach genehmigtem Monat
 * selbsttaetig wieder anstossen. Begrenzt auf einen Job pro Aufruf. */
function ft_pdfRecoverApproved_(){
 const approved=ft_get_('Months').filter(m=>m.status==='APPROVED')
   .sort((a,b)=>String(a.reviewedAt).localeCompare(String(b.reviewedAt)));
 if(!approved.length)return {scheduled:0};
 const archived=ft_pdfArchiveRows_();
 for(const month of approved){
  const same=a=>String(a.companyId)===String(month.companyId)&&
    String(a.userId)===String(month.userId)&&String(a.month)===String(month.month);
  if(archived.some(a=>same(a)&&a.status==='READY'&&
    new Date(a.createdAt).getTime()>=new Date(month.reviewedAt||0).getTime()-1000))continue;
  const user=ft_one_('Users',month.userId);
  if(!user||String(user.companyId)!==String(month.companyId))continue;
  try{
   const actor={id:user.id,role:'STAFF',companyId:month.companyId};
   const job=ft_pdfPrepare_(actor,{companyId:month.companyId,userId:month.userId,
     month:month.month,refresh:true});
   console.info('FireTime PDF-Wiederaufnahme',job.id,job.status,month.month);
   return {scheduled:1,status:job.status};
  }catch(e){console.warn('PDF-Wiederaufnahme fuer '+month.id+': '+String(e.message||e));}
 }
 return {scheduled:0};
}
/** Einreichen braucht KEIN PDF. Die Freigabe erzeugt stets einen nachvollziehbaren
 * automatischen, mandantengebundenen PDF-Auftrag. Die Google-Ausfuehrung laeuft
 * unabhaengig vom Browser weiter; das bestehende Archiv bleibt erhalten. */
function ft_pdfAutoQueueApproved_(actor,reviewed){
 if(!reviewed||reviewed.status!=='APPROVED')return {status:'SKIPPED'};
 return ft_pdfPrepare_(actor,{companyId:reviewed.companyId,userId:reviewed.userId,
   month:reviewed.month,refresh:true});
}
function ft_pdfJobStatus_(actor,p){
 const x=ft_pdfIdentity_(actor,p);
 const job=ft_pdfJobsRows_().find(r=>String(r.id)===String(p.id)&&
   String(r.companyId)===String(x.company.id)&&
   String(r.userId)===String(x.user.id)&&String(r.month)===x.month);
 if(!job)throw Error('PDF-Auftrag nicht gefunden.');
 const result=ft_pdfJobPublic_(job);
 if(job.status==='READY'&&job.archiveId){
  const saved=ft_pdfArchiveRows_().find(r=>String(r.id)===String(job.archiveId)&&
    String(r.companyId)===String(x.company.id)&&String(r.userId)===String(x.user.id));
  if(saved)return {status:'READY',...ft_pdfMetadata_(saved)};
  return {status:'ERROR',error:'PDF wurde als fertig markiert, fehlt aber im Dokumentenarchiv.',id:result.id};
 }
 if(job.status==='RUNNING' &&
   Date.now()-new Date(job.updatedAt||job.createdAt).getTime()>9*60*1000){
  return {status:'ERROR',id:result.id,
    error:'PDF-Worker hat seine Laufzeit ueberschritten. Der Auftrag ist haengengeblieben. Bitte neuen Auftrag versuchen.'};
 }
 if(job.status==='QUEUED' &&
   Date.now()-new Date(job.updatedAt||job.createdAt).getTime()>45*1000){
   // Wird nur dann neu eingeplant, wenn kein Trigger mehr vorhanden ist.
   try{
     const exists=ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='ft_pdfWorker_');
     if(!exists)ScriptApp.newTrigger('ft_pdfWorker_').timeBased().after(1000).create();
   }catch(e){return {status:'ERROR',id:result.id,
      error:'PDF-Trigger kann nicht gestartet werden: '+String(e.message||e)};}
 }
 return result;
}
function ft_pdfWorker_(){
 FT_REQUEST_CACHE={db:null,sheets:Object.create(null),tables:Object.create(null),profiles:null,rules:null};
 let job=null;
 try{
  job=ft_lock_(()=>{
   const pending=ft_pdfJobsRows_().find(r=>r.status==='QUEUED');
   if(!pending)return null;
   pending.status='RUNNING';pending.updatedAt=ft_now_();
   ft_pdfJobsSheet_(false).getRange(pending.__row,1,1,FT_PDF_JOB_HEAD_.length).setValues([FT_PDF_JOB_HEAD_.map(k=>pending[k]||'')]);
   return {id:pending.id,companyId:pending.companyId,userId:pending.userId,month:pending.month};
  });
  if(!job)return;
  console.info('FireTime PDF-Worker: beginne Auftrag '+job.id);
  // Verhindert wiederholte Abfragen mit einem veralteten Request-Cache.
  FT_REQUEST_CACHE.tables=Object.create(null);
  const c=ft_one_('Companies',job.companyId),u=ft_one_('Users',job.userId);
  if(!c||!u||u.companyId!==c.id)throw Error('Firma/Mitarbeiter für PDF-Auftrag nicht mehr verfügbar.');
  // Worker mit festgelegter Mandantenidentität, keine übergreifenden Abfragen.
  const actor={id:u.id,role:'STAFF',companyId:c.id};
  // Falls der Browser die PDF sofort nach Freigabe hochgeladen hat,
  // denselben genehmigten Monatsbericht nicht erneut erzeugen.
  const jobRow=ft_pdfJobsRows_().find(x=>x.id===job.id);
  const existingArchive=ft_pdfArchiveRows_().filter(x=>String(x.companyId)===String(c.id)&&
    String(x.userId)===String(u.id)&&String(x.month)===job.month&&
    new Date(x.createdAt).getTime()>=new Date(jobRow?.createdAt||0).getTime()-1000)
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if(existingArchive){
   ft_lock_(()=>{
    const row=ft_pdfJobsRows_().find(x=>x.id===job.id);
    if(!row||row.status!=='RUNNING')return;
    row.status='READY';row.archiveId=existingArchive.id;row.updatedAt=ft_now_();
    ft_pdfJobsSheet_(false).getRange(row.__row,1,1,FT_PDF_JOB_HEAD_.length)
      .setValues([FT_PDF_JOB_HEAD_.map(k=>row[k]||'')]);
   });
   return;
  }
  const pdf=ft_reportPdf_(actor,{month:job.month,userId:u.id,companyId:c.id,metadataOnly:true});
  ft_lock_(()=>{
   const rows=ft_pdfJobsRows_(),row=rows.find(r=>r.id===job.id);
   if(!row||row.status!=='RUNNING')return;
   const lastVersion=ft_pdfArchiveRows_().filter(a=>String(a.companyId)===String(c.id)&&String(a.userId)===String(u.id)&&String(a.month)===job.month).reduce((v,a)=>Math.max(v,Number(a.version)||1),0);
   const prior=ft_pdfArchiveRows_().filter(a=>String(a.companyId)===String(c.id)&&
     String(a.userId)===String(u.id)&&String(a.month)===job.month&&
     new Date(a.createdAt).getTime()>=new Date(row.createdAt).getTime()-1000)[0];
   if(prior){
     row.status='READY';row.archiveId=prior.id;row.updatedAt=ft_now_();
     ft_pdfJobsSheet_(false).getRange(row.__row,1,1,FT_PDF_JOB_HEAD_.length)
       .setValues([FT_PDF_JOB_HEAD_.map(k=>row[k]||'')]);
     try{DriveApp.getFileById(pdf.id).setTrashed(true);}catch(e){console.warn(e);}
     return;
   }
   const archive={id:ft_uuid_(),companyId:c.id,userId:u.id,month:job.month,fileId:pdf.id,name:pdf.name,createdAt:ft_now_(),version:lastVersion+1,status:'READY'};
   ft_pdfArchiveSheet_(true).appendRow(FT_PDF_ARCHIVE_HEADERS_.map(k=>archive[k]||''));
   row.status='READY';row.archiveId=archive.id;row.updatedAt=ft_now_();
   console.info('FireTime PDF-Worker: PDF gespeichert, Auftrag '+job.id+', Datei '+pdf.id);
   ft_pdfJobsSheet_(false).getRange(row.__row,1,1,FT_PDF_JOB_HEAD_.length).setValues([FT_PDF_JOB_HEAD_.map(k=>row[k]||'')]);
  });
 }catch(e){
  console.error('PDF-Worker:',e);
  if(job){try{ft_lock_(()=>{const r=ft_pdfJobsRows_().find(x=>x.id===job.id);if(!r)return;
   r.status='ERROR';r.error=String(e.message||e).slice(0,500);r.updatedAt=ft_now_();
   ft_pdfJobsSheet_(false).getRange(r.__row,1,1,FT_PDF_JOB_HEAD_.length).setValues([FT_PDF_JOB_HEAD_.map(k=>r[k]||'')]);});}catch(inner){console.error(inner);}}
 }finally{
  // Trigger-Löschung nur für eigene Einmal-Worker; bestehende Tagestrigger bleiben erhalten.
  const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='ft_pdfWorker_');
  triggers.forEach(t=>{try{ScriptApp.deleteTrigger(t);}catch(e){console.warn(e.message);}});
  // Neue Aufträge können während der PDF-Erzeugung hinzugekommen sein.
  try{if(ft_pdfJobsRows_().some(r=>r.status==='QUEUED'))ScriptApp.newTrigger('ft_pdfWorker_').timeBased().after(1000).create();}catch(e){console.warn('PDF-Folgeauftrag:',e.message);}
  FT_REQUEST_CACHE=null;
 }
}
function ft_pdfChunk_(actor,p){
  const x=ft_pdfIdentity_(actor,p);
  const record=ft_pdfArchiveRows_().find(r=>String(r.id)===String(p.id)&&String(r.companyId)===String(x.company.id)&&String(r.userId)===String(x.user.id)&&String(r.month)===x.month);
  if(!record)throw Error('PDF nicht gefunden oder keine Zugriffsberechtigung.');
  const file=DriveApp.getFileById(String(record.fileId));
  if(file.isTrashed()||file.getMimeType()!==MimeType.PDF)throw Error('PDF-Datei ist nicht verfügbar.');
  const bytes=file.getBlob().getBytes();
  const chunkSize=65536,total=Math.ceil(bytes.length/chunkSize);
  const index=Number(p.index);
  if(!Number.isSafeInteger(index)||index<0||index>=total)throw Error('Ungültiger PDF-Abschnitt.');
  return {id:String(record.id),index,total,name:String(record.name),size:bytes.length,base64:Utilities.base64Encode(bytes.slice(index*chunkSize,(index+1)*chunkSize))};
}

// -----------------------------------------------------------------
// 23_Dienstplan-Freigabe, nachvollziehbarer Kalender und Stempeluhr
// -----------------------------------------------------------------
/** EINMAL NACH VOLLSTAENDIGEM ERSETZEN DER Code.gs AUSFUEHREN.
 * Erstellt NUR neue Tabellen, erweitert Activities um optionId und einen Zeittrigger.
 * Bestehende Aktivitaeten, Urlaubs-, Arbeits- und Bereitschaftsdaten werden NICHT neu berechnet.
 * ft_setup() NIEMALS erneut ausfuehren.
 */
function ft_workflowUpgrade(){
 const db=ft_db_();
 for(const tab of ['PlanMonths','ActivityTimers','ActivityTypes']){
  if(!db.getSheetByName(tab)){
   const sh=db.insertSheet(tab);sh.appendRow(FT_HEADERS[tab]);sh.setFrozenRows(1);
  }
 }
 const acts=db.getSheetByName('Activities');
 if(!acts)throw Error('Die bestehende Tabelle Activities wurde nicht gefunden.');
 const headers=acts.getRange(1,1,1,acts.getLastColumn()).getValues()[0];
 if(!headers.includes('activityOptionId')){
  const expected=FT_HEADERS.Activities.length;
  if(acts.getLastColumn()>=expected)acts.insertColumnAfter(expected-1);
  acts.getRange(1,expected).setValue('activityOptionId');
 }else if(headers.indexOf('activityOptionId')!==FT_HEADERS.Activities.length-1){
  throw Error('activityOptionId steht an einer unerwarteten Spalte. Vor der Weiterarbeit Tabellenstruktur kontrollieren.');
 }
 // Trigger wird neu eingerichtet, NICHT im bestehenden ft_tick-Lock nachgebildet.
 const previous=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='ft_timerTick_');
 previous.forEach(t=>ScriptApp.deleteTrigger(t));
 ScriptApp.newTrigger('ft_timerTick_').timeBased().everyMinutes(15).create();
 return {ok:true,version:FT_VERSION,tables:['PlanMonths','ActivityTimers','ActivityTypes'],timerTrigger:'15 Minuten'};
}
function ft_planSheetRows_(){
 const db=ft_db_(),sheet=db.getSheetByName('PlanMonths');
 if(!sheet)return [];
 return ft_get_('PlanMonths');
}
function ft_planSchedule_(c,month){
 const rows=ft_get_('Shifts').filter(s=>s.companyId===c.id&&s.day.startsWith(month)).sort((a,b)=>String(a.day).localeCompare(String(b.day)));
 const gaps=[];
 for(let d=1;d<=ft_days_(month);d++){
  const day=month+'-'+String(d).padStart(2,'0');
  if(!rows.some(s=>s.day===day&&s.userId))gaps.push(day);
 }
 const signature=ft_sha_(JSON.stringify(rows.filter(s=>s.userId).map(s=>[s.day,s.userId,s.start,s.end])));
 return {rows,gaps,signature};
}
function ft_planWorkflow_(actor,p){
 const {c,m}=ft_planCheck_(actor,p),schedule=ft_planSchedule_(c,m);
 const ready=Boolean(ft_db_().getSheetByName('PlanMonths'));
 if(!ready)return {supported:false,gaps:schedule.gaps.length};
 const state=ft_planSheetRows_().find(x=>x.companyId===c.id&&x.month===m);
 const legacyPublished=schedule.rows.some(x=>x.status==='PUBLISHED')&&!state;
 const fixed=Boolean(state?.fixedHash&&state.fixedHash===schedule.signature);
 const published=Boolean(fixed&&state.publishedHash===schedule.signature);
 const shared=Boolean(published&&state.sharedHash===schedule.signature&&state.shareStatus==='SENT');
 const calendarEnabled=ft_enabled_(c,'CALENDAR')&&ft_bool_(c.calendarOn)&&!!c.calendarId;
 return {supported:true,companyId:c.id,month:m,gaps:schedule.gaps.length,
  fixed,published,shared,calendarEnabled,
  fixedAt:state?.fixedAt||'',publishedAt:state?.publishedAt||'',sharedAt:state?.sharedAt||'',
  fixedBy:state?.fixedBy||'',publishedBy:state?.publishedBy||'',sharedBy:state?.sharedBy||'',
  shareStatus:state?.shareStatus||'NONE',calendarEvents:Number(state?.calendarEvents||0),
  warnings:String(state?.warnings||''),legacyPublished,legacyCalendarUnknown:legacyPublished,
  needsReapproval:Boolean(state?.fixedHash&&!fixed),
  needsReshare:Boolean(state?.sharedHash&&!shared)};
}
function ft_planState_(c,m){
 let row=ft_planSheetRows_().find(x=>x.companyId===c.id&&x.month===m);
 if(row)return row;
 row={id:ft_uuid_(),companyId:c.id,month:m,fixedHash:'',fixedAt:'',fixedBy:'',publishedHash:'',publishedAt:'',publishedBy:'',sharedHash:'',sharedAt:'',sharedBy:'',shareStatus:'NONE',calendarEvents:0,warnings:'',sharedAssignments:'{}',updatedAt:ft_now_()};
 ft_add_('PlanMonths',row);return ft_one_('PlanMonths',row.id);
}
function ft_planFinalize_(actor,p){
 const {c,m}=ft_planCheck_(actor,p),plan=ft_planSchedule_(c,m);
 if(plan.gaps.length)throw Error('Noch nicht besetzte Bereitschaftstage: '+plan.gaps.join(', '));
 const state=ft_planState_(c,m),before=ft_publicRow_(state),changed=state.fixedHash!==plan.signature;
 state.fixedHash=plan.signature;state.fixedAt=ft_now_();state.fixedBy=actor.id;
 // Alte Freigabe- und Versandnachweise bleiben fuer die Historie erhalten; Hashvergleich erkennt Aenderungen.
 state.updatedAt=ft_now_();ft_save_('PlanMonths',state);
 ft_audit_(actor,'PLAN_FINALIZE','PlanMonths',state.id,before,ft_publicRow_(state));
 return {fixed:true,month:m,changed};
}
function ft_planPublishOnly_(actor,p){
 const {c,m}=ft_planCheck_(actor,p),plan=ft_planSchedule_(c,m);
 if(plan.gaps.length)throw Error('Noch nicht besetzte Bereitschaftstage.');
 const state=ft_planState_(c,m);
 if(state.fixedHash!==plan.signature)throw Error('Bitte den aktuellen Plan zuerst festlegen.');
 let published=0;
 for(const shift of plan.rows){
  if(shift.status==='PUBLISHED')continue;
  const before=ft_publicRow_(shift);shift.status='PUBLISHED';shift.updatedAt=ft_now_();ft_save_('Shifts',shift);
  ft_audit_(actor,'PUBLISH_NO_INVITE','Shifts',shift.id,before,shift);published++;
 }
 const before=ft_publicRow_(state);
 state.publishedHash=plan.signature;state.publishedAt=ft_now_();state.publishedBy=actor.id;
 state.updatedAt=ft_now_();ft_save_('PlanMonths',state);
 ft_audit_(actor,'PLAN_PUBLISH','PlanMonths',state.id,before,ft_publicRow_(state));
 return {published,warnings:[],calendarInvitationsSent:false};
}
function ft_planCalendarShare_(actor,p){
 const {c,m}=ft_planCheck_(actor,p),plan=ft_planSchedule_(c,m),state=ft_planState_(c,m);
 if(!ft_enabled_(c,'CALENDAR')||!ft_bool_(c.calendarOn))throw Error('Google-Kalender ist nicht freigeschaltet oder aktiviert.');
 if(state.fixedHash!==plan.signature||state.publishedHash!==plan.signature)throw Error('Bitte den geänderten Plan zuerst festlegen und veröffentlichen.');
 if(state.sharedHash===plan.signature&&state.shareStatus==='SENT')return {alreadyShared:true,count:state.calendarEvents,warnings:[]};
 // Prüfen, bevor ein Termin angelegt wird. Eine Teilantwort wird dauerhaft als solche gespeichert.
 ft_calendar_(c);
 const warns=[];let count=0;
 let previous={};try{previous=JSON.parse(String(state.sharedAssignments||'{}'));}catch(_){}
 const nextAssignments={...previous};
 for(const shift of plan.rows){
  try{
   const split=ft_segmentRows_(shift);
   if(split.length){
    for(const part of split){
     if(part.calendarEventId&&previous[part.id]!==part.userId){
      const event=ft_calendar_(c).getEventById(part.calendarEventId);
      if(event)event.deleteEvent();
      part.calendarEventId='';ft_save_('ShiftSegments',part);
     }
    }
    ft_syncShiftParts_(c,shift);count+=split.length;
    for(const part of split)nextAssignments[part.id]=part.userId;
   }else if(shift.userId){
    const prevUser=previous[shift.id]||'__UNKNOWN_PREVIOUS_GUEST__';
    ft_syncShift_(c,shift,{...ft_publicRow_(shift),userId:prevUser});count++;
    nextAssignments[shift.id]=shift.userId;
   }
  }catch(err){warns.push(shift.day+': '+String(err.message||err));}
 }
 const before=ft_publicRow_(state);
 state.sharedAt=ft_now_();state.sharedBy=actor.id;state.sharedHash=plan.signature;
 state.shareStatus=warns.length?'PARTIAL':'SENT';state.calendarEvents=count;
 state.warnings=warns.join(' | ').slice(0,1000);state.sharedAssignments=JSON.stringify(nextAssignments);state.updatedAt=ft_now_();ft_save_('PlanMonths',state);
 ft_audit_(actor,'PLAN_CALENDAR_SHARE','PlanMonths',state.id,before,ft_publicRow_(state));
 return {count,warnings:warns,shareStatus:state.shareStatus};
}
// Standardauswahl ist virtuell: keine Migration, vorhandene historische Daten bleiben unangetastet.
const FT_STANDARD_ACTIVITIES_=[
 {id:'FT_STD_INCIDENT',type:'INCIDENT',label:'Bereitschaftseinsatz (von Abfahrt bis Einsatzende)'},
 {id:'FT_STD_MAINTENANCE',type:'OTHER',label:'Wartungsarbeiten'},
 {id:'FT_STD_EXTINGUISHER',type:'OTHER',label:'Feuerlöscher'},
 {id:'FT_STD_OFFICE',type:'OTHER',label:'Büro'},
 {id:'FT_STD_OTHER',type:'OTHER',label:'Sonstige'}
];
function ft_activityTypesRows_(){return ft_db_().getSheetByName('ActivityTypes')?ft_get_('ActivityTypes'):[];}
function ft_activityTypesFor_(c){
 const saved=ft_activityTypesRows_().filter(x=>x.companyId===c.id)
  .sort((a,b)=>Number(a.sort||0)-Number(b.sort||0))
  .map(x=>({id:x.id,type:x.type,label:x.label,active:ft_bool_(x.active)}));
 return FT_STANDARD_ACTIVITIES_.map(x=>({...x,active:true,standard:true})).concat(saved);
}
function ft_activityTypesGet_(actor,p){
 const c=ft_company_(actor,p.companyId||actor.companyId);ft_need_(actor,c,'TIME');
 const rows=ft_activityTypesRows_().filter(x=>x.companyId===c.id);
 return rows.map(x=>({id:x.id,type:x.type,label:x.label,active:ft_bool_(x.active),sort:Number(x.sort||0)}));
}
function ft_activityTypesSave_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);
 const c=ft_company_(actor,p.companyId||actor.companyId);ft_need_(actor,c,'TIME');
 if(!ft_db_().getSheetByName('ActivityTypes'))throw Error('Einmalig ft_workflowUpgrade ausführen.');
 const type=String(p.type||''),label=ft_str_(p.label,75).trim();
 if(!['OBJECT','INCIDENT','OTHER'].includes(type))throw Error('Tätigkeitsart ungültig.');
 if(label.length<2)throw Error('Bitte eine Bezeichnung mit mindestens zwei Zeichen angeben.');
 let row=p.id?ft_activityTypesRows_().find(x=>x.id===p.id&&x.companyId===c.id):null;
 if(p.id&&!row)throw Error('Tätigkeitsauswahl nicht gefunden.');
 const before=row?ft_publicRow_(row):{};
 row=row||{id:ft_uuid_(),companyId:c.id,createdAt:ft_now_(),sort:ft_activityTypesRows_().filter(x=>x.companyId===c.id).length+1};
 row.type=type;row.label=label;row.active=p.active===undefined?true:ft_bool_(p.active);row.updatedAt=ft_now_();
 if(row.__row)ft_save_('ActivityTypes',row);else ft_add_('ActivityTypes',row);
 ft_audit_(actor,'ACTIVITY_TYPE_SAVE','ActivityTypes',row.id,before,ft_publicRow_(row));
 return {id:row.id,type:row.type,label:row.label,active:ft_bool_(row.active)};
}

/** Separate Pausen-Ereignisse ohne Migration der bestehenden ActivityTimers-Tabelle. */
const FT_TIMER_PAUSE_COLS_=['id','companyId','userId','timerId','start','end'];
function ft_timerPauseRows_(){return ft_absenceRows_('TimerPauseEvents',FT_TIMER_PAUSE_COLS_,false);}
function ft_timerPauseData_(timer){
 const rows=ft_timerPauseRows_().filter(x=>x.companyId===timer.companyId&&x.userId===timer.userId&&x.timerId===timer.id);
 const now=Date.now(),active=rows.find(x=>!x.end);
 const completed=rows.filter(x=>x.end).reduce((sum,x)=>sum+Math.max(0,(Date.parse(x.end)-Date.parse(x.start))/60000),0);
 return {rows,paused:Boolean(active),active,completedMinutes:Math.round(completed),
  currentPauseStart:active?.start||'',pauseStartedAt:active?.start||''};
}
function ft_timerPauseAction_(actor,action){
 const u=actor.role==='STAFF'?actor:ft_user_(actor,actor.id);
 const timer=ft_get_('ActivityTimers').find(x=>x.companyId===u.companyId&&x.userId===u.id);
 if(!timer)throw Error('Keine laufende Arbeitszeit. Bitte zuerst Arbeit beginnen.');
 const company=ft_company_(actor,timer.companyId);ft_need_(actor,company,'TIME');
 const info=ft_timerPauseData_(timer),now=new Date();
 const deadline=ft_viennaWallDate_(ft_localDate_(new Date(timer.start))+'T19:00');
 if(now>=deadline)throw Error('Die Arbeitszeit ist bereits bei 19:00 Uhr angekommen. Bitte den automatischen Abschluss abwarten und die tatsächliche Pause danach nachtragen.');
 if(action==='start'){
  if(info.paused)throw Error('Die Pause läuft bereits. Bitte erst Pause beenden.');
  // Do not create any guessed pause. The recorded start is the actual server timestamp.
  ft_absenceAdd_('TimerPauseEvents',FT_TIMER_PAUSE_COLS_,{id:ft_uuid_(),companyId:timer.companyId,
   userId:timer.userId,timerId:timer.id,start:now.toISOString(),end:''});
  ft_audit_(actor,'TIMER_PAUSE_START','ActivityTimers',timer.id,{}, {at:now.toISOString()});
 }else if(action==='stop'){
  if(!info.paused)throw Error('Es läuft derzeit keine Pause.');
  const row=info.active;row.end=now.toISOString();
  if(Date.parse(row.end)<=Date.parse(row.start))throw Error('Pause kann erst nach ihrem tatsächlichen Beginn beendet werden.');
  ft_absenceSave_('TimerPauseEvents',FT_TIMER_PAUSE_COLS_,row);
  ft_audit_(actor,'TIMER_PAUSE_STOP','ActivityTimers',timer.id,{}, {start:row.start,end:row.end});
 }else throw Error('Unbekannte Pausenaktion.');
 return ft_timerActive_(timer.companyId,timer.userId);
}
function ft_timerPauseClear_(rows){
 const sh=ft_db_().getSheetByName('TimerPauseEvents');if(!sh)return;
 rows.slice().sort((a,b)=>b.__row-a.__row).forEach(x=>sh.deleteRow(x.__row));
}

function ft_timerActive_(companyId,userId){
 const db=ft_db_();if(!db.getSheetByName('ActivityTimers'))return null;
 const r=ft_get_('ActivityTimers').find(x=>x.companyId===companyId&&x.userId===userId);
 if(!r)return null;
 const state=ft_timerPauseData_(r);
 return {id:r.id,start:r.start,type:r.type,activityOptionId:r.activityOptionId||'',
  object:r.object||'',description:r.description||'',paused:state.paused,
  pauseStartedAt:state.pauseStartedAt,completedPauseMinutes:state.completedMinutes};
}
function ft_timerStatus_(actor,p){
 const userId=actor.role==='STAFF'?actor.id:String(p.userId||actor.id),u=ft_user_(actor,userId);
 const c=ft_company_(actor,u.companyId);ft_need_(actor,c,'TIME');
 return {running:ft_timerActive_(c.id,u.id)};
}
function ft_timerStart_(actor,p){
 const uid=actor.role==='STAFF'?actor.id:String(p.userId||actor.id),user=ft_user_(actor,uid),c=ft_company_(actor,user.companyId);
 ft_need_(actor,c,'TIME');
 if(!ft_db_().getSheetByName('ActivityTimers'))throw Error('Einmalig ft_workflowUpgrade ausführen.');
 if(ft_timerActive_(c.id,uid))throw Error('Du hast bereits eine laufende Arbeitszeit. Bitte zuerst beenden.');
 const now=new Date(),clock=Number(Utilities.formatDate(now,FT_TZ,'H'));
 if(clock>=19)throw Error('Nach 19:00 bitte manuell mit Beginn und Ende erfassen. Automatisches Stoppen gilt nur für Starts vor 19:00 Uhr.');
 const type=String(p.type||'OBJECT');if(!['OBJECT','INCIDENT','OTHER'].includes(type))throw Error('Bitte eine gültige Tätigkeitsart auswählen.');
 const optionId=String(p.activityOptionId||'');
 if(optionId&&!ft_activityTypesFor_(c).some(x=>x.id===optionId&&x.type===type&&x.active))throw Error('Die Tätigkeitsauswahl stimmt nicht mit der Tätigkeit überein.');
 ft_requireMonthOpen_(c.id,uid,ft_localMonth_(now));
 const row={id:ft_uuid_(),companyId:c.id,userId:uid,type,activityOptionId:optionId,start:now.toISOString(),object:ft_str_(p.object||'',150),description:ft_str_(p.description||'',1000),createdAt:ft_now_(),updatedAt:ft_now_()};
 ft_add_('ActivityTimers',row);ft_audit_(actor,'TIMER_START','ActivityTimers',row.id,{},row);
 return {running:ft_timerActive_(c.id,uid)};
}
function ft_viennaWallDate_(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value||''));
 if(!match)throw Error('Ungültiges österreichisches Ortsdatum.');
 const target=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]));
 let ms=target;
 // Convert Vienna wall time to a real instant without relying on the script/server's timezone.
 for(let i=0;i<4;i++){
  const local=Utilities.formatDate(new Date(ms),FT_TZ,'yyyy-MM-dd HH:mm');
  const m=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(local);
  if(!m)throw Error('Wiener Uhrzeit kann nicht ermittelt werden.');
  const seen=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]));
  const diff=target-seen;if(!diff)break;ms+=diff;
 }
 return new Date(ms);
}
function ft_timerClose_(timer,actor,auto,actualPauseMinutes){
 const beginning=new Date(timer.start),day=ft_localDate_(beginning),endOfDay=ft_viennaWallDate_(day+'T19:00');
 const pauses=ft_timerPauseData_(timer);
 if(pauses.paused&&!auto)throw Error('Bitte zuerst die laufende Pause beenden und dann die Arbeitszeit stoppen.');
 const minutes=pauses.rows.length?pauses.completedMinutes:Number(actualPauseMinutes)||0;
 let finish=new Date();if(finish>endOfDay)finish=endOfDay;
 if(finish<=beginning)throw Error('Endzeit muss nach dem Arbeitsbeginn liegen.');
 const out=ft_activitySave_(actor,{userId:timer.userId,companyId:timer.companyId,
  type:timer.type,activityOptionId:timer.activityOptionId||'',
  start:Utilities.formatDate(beginning,FT_TZ,"yyyy-MM-dd'T'HH:mm"),end:Utilities.formatDate(finish,FT_TZ,"yyyy-MM-dd'T'HH:mm"),
  object:timer.object||'',description:(timer.description||'')+
   (auto?' [Automatisch um 19:00 Uhr beendet; bitte ggf. korrigieren.]':'')+
   (pauses.paused?' [Laufende Pause beim Abschluss ungeklärt – bitte korrigieren.]':''),
  breakMinutes:minutes},Boolean(auto));
 ft_timerPauseClear_(pauses.rows);
 ft_sheet_('ActivityTimers').deleteRow(timer.__row);ft_invalidate_('ActivityTimers');
 ft_audit_(actor,auto?'TIMER_AUTO_CLOSE':'TIMER_STOP','ActivityTimers',timer.id,timer,{activityId:out.id,end:finish.toISOString()});
 return {activity:out,autoClosed:auto||false,closedAt:finish.toISOString()};
}
function ft_timerStop_(actor,p){
 const uid=actor.role==='STAFF'?actor.id:String(p.userId||actor.id),user=ft_user_(actor,uid),c=ft_company_(actor,user.companyId);
 ft_need_(actor,c,'TIME');
 const row=ft_get_('ActivityTimers').find(x=>x.companyId===c.id&&x.userId===uid);
 if(!row)throw Error('Keine laufende Arbeitszeit. Eventuell wurde diese bereits um 19:00 Uhr beendet.');
 const pause=ft_number_(p.breakMinutes||0,0,1440,'Pause in Minuten');
 return ft_timerClose_(row,actor,false,pause);
}
/** Automatische Schließung: genau eine Benachrichtigung pro Arbeitszeiteintrag.
 * Status ERROR wird beim nächsten 15-Minuten-Trigger erneut versucht.
 * Keine E-Mail bei manueller Stopptaste.
 */
function ft_timerAutoNotice_(company,user,activity){
 if(!company||!user||!activity||!user.email)return false;
 const stamp=Utilities.formatDate(new Date(activity.end),FT_TZ,'dd.MM.yyyy HH:mm');
 const url=ft_clientUrl_(company)||ft_publicGithubUrl_();
 return ft_notification_(company,user,'TIMER_AUTO_CLOSE',activity.id,
  'FireTime Pro – Arbeitszeit automatisch um 19:00 Uhr beendet',
  'Hallo '+user.name+'!\n\nDeine Arbeitszeit vom '+stamp+
  ' Uhr wurde automatisch mit 19:00 Uhr beendet, weil kein manuelles Arbeitsende erfasst wurde.'+
  '\n\nBitte öffne FireTime Pro, kontrolliere Anfang und tatsächliches Arbeitsende sowie die tatsächlich genommene Pause und berichtige den Eintrag unter „Arbeitszeiten → Bearbeiten“.'+
  '\nDie automatische Endzeit ist vorläufig. Bitte auch protokollierte oder nicht abgeschlossene Pausen prüfen; es wird keine Pause erfunden.'+
  '\n\n'+url+'\n\n'+company.name);
}
function ft_timerRetryNotices_(){
 let retried=0;
 for(const n of ft_get_('Notifications').filter(x=>x.kind==='TIMER_AUTO_CLOSE'&&x.status==='ERROR').slice(0,25)){
  const c=ft_one_('Companies',n.companyId),u=ft_one_('Users',n.userId),a=ft_one_('Activities',n.reference);
  if(c&&u&&a&&a.companyId===c.id&&a.userId===u.id&&ft_timerAutoNotice_(c,u,a))retried++;
 }
 return retried;
}
function ft_timerSweep_(){
 const sh=ft_db_().getSheetByName('ActivityTimers');if(!sh)return {closed:0,errors:[]};
 const timers=ft_get_('ActivityTimers').slice(),now=new Date();
 const ready=timers.filter(x=>now>=ft_viennaWallDate_(ft_localDate_(new Date(x.start))+'T19:00'));
 let closed=0;const errors=[];
 // Rückwärts verarbeiten, weil jede erfolgreiche Buchung eine Tabellenzeile löscht.
 ready.sort((a,b)=>b.__row-a.__row);
 for(const t of ready){
  try{const user=ft_one_('Users',t.userId);if(!user)throw Error('Mitarbeiter fehlt.');
   const result=ft_timerClose_(t,user,true);closed++;
   try{
    const company=ft_one_('Companies',t.companyId);
    ft_timerAutoNotice_(company,user,result.activity);
   }catch(mailError){errors.push('E-Mail '+t.id+': '+String(mailError.message||mailError));}}
  catch(err){errors.push(t.id+': '+String(err.message||err));}
 }
 try{ft_timerRetryNotices_();}catch(retryError){errors.push('E-Mail-Wiederholung: '+String(retryError.message||retryError));}
 return {closed,errors};
}
function ft_timerTick_(){return ft_lock_(()=>ft_timerSweep_());}

// -----------------------------------------------------------------
// 07_Bereitschaft
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 07_Bereitschaft.gs */
function ft_days_(month){const [y,m]=ft_month_(month).split('-').map(Number);return new Date(y,m,0).getDate();}

function ft_availabilitySave_(actor,p){const u=actor.role==='STAFF'?actor:ft_user_(actor,p.userId||actor.id),c=ft_company_(actor,u.companyId),m=ft_month_(p.month);if(!Array.isArray(p.days)||p.days.length>31)throw Error('Ungültige Tagesauswahl');if(!ft_enabled_(c,'AVAILABILITY'))throw Error('Verfügbarkeitsmeldung bei dieser Firma deaktiviert.');const max=ft_days_(m),existing=ft_get_('Availability').filter(x=>x.companyId===c.id&&x.userId===u.id&&x.month===m);if(ft_get_('AvailabilitySubmissions').some(s=>s.companyId===c.id&&s.userId===u.id&&s.month===m)&&actor.role==='STAFF')throw Error('Verfügbarkeit bereits abgegeben. Änderungen bitte über Administrator.');const deletions=[];p.days.forEach(item=>{const d=Number(item.day),answer=String(item.answer||'');if(!Number.isInteger(d)||d<1||d>max||!['YES','NO',''].includes(answer))throw Error('Ungültige Verfügbarkeit');const old=existing.find(x=>Number(x.day)===d),before=old?ft_publicRow_(old):{};if(!answer){if(old)deletions.push({old,before});return;}const row=old||{id:ft_uuid_(),companyId:c.id,userId:u.id,month:m,day:d};row.answer=answer;row.updatedAt=ft_now_();if(old)ft_save_('Availability',row);else ft_add_('Availability',row);if(!old||before.answer!==answer)ft_audit_(actor,'SAVE','Availability',row.id,before,row);});deletions.sort((a,b)=>b.old.__row-a.old.__row).forEach(({old,before})=>{ft_sheet_('Availability').deleteRow(old.__row);ft_audit_(actor,'DELETE','Availability',old.id,before,{});});return true;}

function ft_availabilitySubmit_(actor,p){const u=actor.role==='STAFF'?actor:ft_user_(actor,p.userId||actor.id),c=ft_company_(actor,u.companyId),m=ft_month_(p.month);if(!ft_enabled_(c,'AVAILABILITY'))throw Error('Verfügbarkeitsmeldung bei dieser Firma deaktiviert.');const rows=ft_get_('Availability').filter(x=>x.companyId===c.id&&x.userId===u.id&&x.month===m);if(new Set(rows.map(x=>Number(x.day))).size!==ft_days_(m))throw Error('Bitte zuerst jeden Tag mit Kann oder Kann nicht markieren.');const existing=ft_get_('AvailabilitySubmissions').find(x=>x.companyId===c.id&&x.userId===u.id&&x.month===m);if(existing)throw Error('Bereits abgegeben.');const r={id:ft_uuid_(),companyId:c.id,userId:u.id,month:m,submittedAt:ft_now_()};ft_add_('AvailabilitySubmissions',r);ft_audit_(actor,'SUBMIT','AvailabilitySubmissions',r.id,{},r);return r;}

function ft_shiftRange_(day,company){
 ft_date_(day);
 const profile=ft_profileFor_(company);
 if(!ft_enabled_(company,'STANDBY'))throw Error('Bereitschaft bei dieser Firma nicht aktiviert.');
 const st=ft_datetime_(day+'T'+profile.standbyStart);
 const en=new Date(st);
 en.setHours(en.getHours()+Number(profile.standbyHours)); // lokale Uhrzeit inkl. Sommer-/Winterzeit
 return [st,en];
}

function ft_planCheck_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_company_(actor,p.companyId||actor.companyId),m=ft_month_(p.month);if(!ft_enabled_(c,'STANDBY'))throw Error('Bereitschaftsdienst ist bei dieser Firma nicht aktiviert.');return {c,m};}

function ft_planSuggest_(actor,p){const {c,m}=ft_planCheck_(actor,p),users=ft_get_('Users').filter(x=>x.companyId===c.id&&x.status==='ACTIVE'),all=ft_get_('Availability').filter(x=>x.companyId===c.id&&x.month===m&&x.answer==='YES'),sub=ft_get_('AvailabilitySubmissions').filter(x=>x.companyId===c.id&&x.month===m),submitted=new Set(sub.map(x=>x.userId)),shifts=ft_get_('Shifts').filter(x=>x.companyId===c.id&&x.day.startsWith(m));const scores={};users.forEach(u=>scores[u.id]=shifts.filter(s=>s.userId===u.id&&s.status==='PUBLISHED').length*4);let assigned=0,gaps=[];
 for(let d=1;d<=ft_days_(m);d++){const day=m+'-'+String(d).padStart(2,'0'),existing=shifts.find(s=>s.day===day);if(existing&&existing.userId)continue;const avail=users.filter(u=>submitted.has(u.id)&&all.some(a=>a.userId===u.id&&Number(a.day)===d));avail.sort((a,b)=>scores[a.id]-scores[b.id]||a.name.localeCompare(b.name));if(!avail.length){gaps.push(day);continue;}const u=avail[0],range=ft_shiftRange_(day,c),before=existing?ft_publicRow_(existing):{};const row=existing||{id:ft_uuid_(),companyId:c.id,day,status:'DRAFT',eventId:''};row.userId=u.id;row.start=range[0].toISOString();row.end=range[1].toISOString();row.updatedAt=ft_now_();row.status='DRAFT';row.actualStatus='PLANNED';row.confirmedAt='';if(existing)ft_save_('Shifts',row);else ft_add_('Shifts',row);ft_audit_(actor,'SUGGEST','Shifts',row.id,before,row);scores[u.id]=(scores[u.id]||0)+1+(ft_holiday_(day)||[6,7].includes(Number(Utilities.formatDate(new Date(day+'T12:00'),FT_TZ,'u')))?1:0);assigned++;}
 return {assigned,gaps};}

function ft_planAssign_(actor,p){const {c,m}=ft_planCheck_(actor,p),day=ft_str_(p.day,10);if(!day.startsWith(m)||ft_localDate_(ft_date_(day))!==day)throw Error('Tag nicht im Monat');const uid=String(p.userId||''),u=uid?ft_user_(actor,uid):null;if(u&&u.companyId!==c.id)throw Error('Mitarbeiter gehört nicht zur Firma');if(u){const available=ft_get_('Availability').some(x=>x.companyId===c.id&&x.userId===uid&&x.month===m&&Number(x.day)===Number(day.slice(-2))&&x.answer==='YES');const submitted=ft_get_('AvailabilitySubmissions').some(x=>x.companyId===c.id&&x.userId===uid&&x.month===m);if((!available||!submitted)&&!p.confirmAvailability)throw Error('Keine bestätigte Verfügbarkeit. Ausnahme ausdrücklich bestätigen.');}const prev=ft_get_('Shifts').find(s=>s.companyId===c.id&&s.day===day),old=prev?ft_publicRow_(prev):{};if(prev&&ft_get_('ShiftSegments').some(x=>x.shiftId===prev.id))throw Error('Geteilten Dienst bitte ueber die Uebergabefunktion bearbeiten.');if(prev&&prev.status==='PUBLISHED'&&!p.confirmChange)throw Error('Veröffentlichter Dienst: Änderung ausdrücklich bestätigen.');const bounds=ft_shiftRange_(day,c),r=prev||{id:ft_uuid_(),companyId:c.id,day,eventId:'',status:'DRAFT'};if(uid&&ft_sickOverlap_(c.id,uid,bounds[0].toISOString(),bounds[1].toISOString()))
 throw Error('Mitarbeiter ist fuer diesen Bereitschaftszeitraum krank gemeldet.');
 if(prev&&prev.userId!==uid){r.actualStatus='PLANNED';r.confirmedAt='';}
 r.userId=uid;r.start=bounds[0].toISOString();r.end=bounds[1].toISOString();r.updatedAt=ft_now_();if(!prev)ft_add_('Shifts',r);else ft_save_('Shifts',r);ft_audit_(actor,'ASSIGN','Shifts',r.id,old,r);return {row:r,calendarNeedsShare:prev&&prev.status==='PUBLISHED'};}

function ft_planPublish_(actor,p){const {c,m}=ft_planCheck_(actor,p),all=ft_get_('Shifts').filter(x=>x.companyId===c.id&&x.day.startsWith(m)),gaps=[];for(let d=1;d<=ft_days_(m);d++){const day=m+'-'+String(d).padStart(2,'0');if(!all.some(x=>x.day===day&&x.userId))gaps.push(day);}if(gaps.length)throw Error('Noch unbesetzte Tage: '+gaps.join(', '));if(ft_bool_(c.calendarOn))ft_calendar_(c);let published=0,warnings=[];
 all.forEach(row=>{if(row.status==='PUBLISHED'&&(!ft_bool_(c.calendarOn)||row.eventId))return;const prev=ft_publicRow_(row);row.status='PUBLISHED';row.updatedAt=ft_now_();ft_save_('Shifts',row);ft_audit_(actor,'PUBLISH','Shifts',row.id,prev,row);published++;if(ft_bool_(c.calendarOn)){try{ft_syncShift_(c,row,prev);}catch(e){warnings.push(row.day+': '+e.message);}}});return {published,warnings,calendarEnabled:ft_bool_(c.calendarOn)};}

/** Bestätigung der tatsächlich geleisteten Bereitschaft durch Mitarbeiter/Administrator. */

function ft_shiftConfirm_(actor,p){const s=ft_one_('Shifts',p.id);if(!s)throw Error('Dienst nicht gefunden');if(ft_get_('ShiftSegments').some(x=>x.shiftId===s.id))throw Error('Dieser Dienst ist geteilt. Bitte eigene Dienstabschnitte bestaetigen.');ft_scope_(actor,s.companyId);if(actor.role==='STAFF'&&s.userId!==actor.id)throw Error('Nur den eigenen Dienst bestätigen.');if(s.status!=='PUBLISHED'||!s.userId)throw Error('Nur veröffentlichte, besetzte Dienste sind bestätigbar.');if(ft_sickOverlap_(s.companyId,s.userId,s.start,s.end))throw Error('Krankenstand ueberschneidet den Dienst; erst klaeren.');if(new Date(s.end)>new Date())throw Error('Dienst ist noch nicht beendet.');const before=ft_publicRow_(s);s.actualStatus='DONE';s.confirmedAt=ft_now_();ft_save_('Shifts',s);ft_audit_(actor,'CONFIRM','Shifts',s.id,before,s);return {ok:true};}

// -----------------------------------------------------------------
// 08_Kalender
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 08_Kalender.gs */
function ft_calendarTest_(u,companyId){ft_allowed_(u,['SYSADMIN','ADMIN']);const c=ft_company_(u,companyId),cal=c.calendarId?CalendarApp.getCalendarById(c.calendarId):null;if(!cal)throw Error('Kalender nicht gefunden oder nicht freigegeben.');return {name:cal.getName(),readable:true,writeAccessNotVerified:true,id:c.calendarId,note:'Kalender gefunden. Schreibzugriff wird beim ersten echten Terminanlegen geprüft.'};}

function ft_calendar_(c){if(!c.calendarId)throw Error('Kalender-ID fehlt. Unter Firmeneinstellungen eintragen.');const cal=CalendarApp.getCalendarById(c.calendarId);if(!cal)throw Error('Google-Kalender nicht verfügbar. firetime.pro@gmail.com als Bearbeiter freigeben.');return cal;}

function ft_syncShift_(c,s,previous){if(!ft_bool_(c.calendarOn))return;const cal=ft_calendar_(c),old=previous||s;let oldEvent=old.eventId?cal.getEventById(old.eventId):null;if(!s.userId){if(oldEvent){oldEvent.deleteEvent();s.eventId='';ft_save_('Shifts',s);}return;}
 const u=ft_one_('Users',s.userId);if(!u)throw Error('Mitarbeiter nicht gefunden');const name=c.name+' – Bereitschaftsdienst ('+u.name+')',details='Bereitschaft von 07:00 bis 07:00 am Folgetag.\nErfasst über FireTime Pro.\nÄnderungen nur über die FireTime-Pro-Dienstplanung.';
 if(oldEvent&&old.userId===s.userId){oldEvent.setTitle(name).setTime(new Date(s.start),new Date(s.end)).setDescription(details);oldEvent.removeAllReminders();oldEvent.addPopupReminder(1440);return;}
 if(oldEvent)oldEvent.deleteEvent();const event=cal.createEvent(name,new Date(s.start),new Date(s.end),{description:details,guests:u.email,sendInvites:true});event.removeAllReminders();event.addPopupReminder(1440);s.eventId=event.getId();ft_save_('Shifts',s);}

// -----------------------------------------------------------------
// 09_Automation
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 09_Automation.gs */
function ft_sendMail_(o){if(MailApp.getRemainingDailyQuota()<1)throw Error('Tägliches E-Mail-Limit erreicht');MailApp.sendEmail(o);}

function ft_notification_(c,u,kind,reference,subject,body){const key=ft_sha_(c.id+'|'+u.id+'|'+kind+'|'+reference);if(ft_get_('Notifications').some(n=>n.id===key&&n.status==='SENT'))return false;
 try{ft_sendMail_({to:u.email,subject,body,name:'Bereitschaftsdienste '+c.name});const old=ft_one_('Notifications',key);if(old){old.sentAt=ft_now_();old.status='SENT';old.error='';ft_save_('Notifications',old);}else ft_add_('Notifications',{id:key,companyId:c.id,userId:u.id,kind,reference,sentAt:ft_now_(),status:'SENT',error:''});return true;}catch(err){const failure=ft_one_('Notifications',key);if(failure){failure.sentAt=ft_now_();failure.error=String(err.message).slice(0,500);ft_save_('Notifications',failure);}else ft_add_('Notifications',{id:key,companyId:c.id,userId:u.id,kind,reference,sentAt:ft_now_(),status:'ERROR',error:String(err.message).slice(0,500)});return false;}}

function ft_tick(){const tickResult=ft_lock_(()=>{const now=new Date(),day=Number(Utilities.formatDate(now,FT_TZ,'d')),hour=Number(Utilities.formatDate(now,FT_TZ,'H')),month=ft_localMonth_(now),[y,m]=month.split('-').map(Number),next=Utilities.formatDate(new Date(y,m,1,12),FT_TZ,'yyyy-MM'),last=new Date(y,m,0).getDate();const web=ft_publicGithubUrl_();const companies=ft_get_('Companies').filter(c=>ft_bool_(c.active)),users=ft_get_('Users').filter(x=>x.status==='ACTIVE'&&x.role!=='SYSADMIN');let count=0;
 for(const c of companies){const us=users.filter(u=>u.companyId===c.id);
  if(ft_bool_(c.remindAvailability)&&day===Number(c.availabilityDay||20)&&hour>=9&&hour<=23){const completed=new Set(ft_get_('AvailabilitySubmissions').filter(s=>s.companyId===c.id&&s.month===next).map(s=>s.userId));for(const u of us)if(!completed.has(u.id)){if(ft_notification_(c,u,'AVAILABILITY',next,'Bereitschaft '+next+' noch nicht eingetragen','Hallo '+u.name+'!\n\nBitte gib deine Verfügbarkeit für '+next+' in FireTime Pro bekannt. Auch wenn du nicht verfügbar bist, schließe die Monatsmeldung ab.\n\n'+web+'\n\nBereitschaftsplanung '+c.name))count++;}}
  if(ft_bool_(c.remindHours)&&day===last&&hour>=19){const completed=new Set(ft_get_('Months').filter(r=>r.companyId===c.id&&r.month===month&&['SUBMITTED','APPROVED','FINAL'].includes(r.status)).map(r=>r.userId));for(const u of us)if(!completed.has(u.id)){if(ft_notification_(c,u,'HOURS',month,'FireTime Pro – Stunden '+month+' noch nicht abgeschlossen','Hallo '+u.name+'!\n\nBitte kontrolliere deine Stunden für '+month+' und reiche den Monat in FireTime Pro ein, sobald alle Tätigkeiten vollständig sind.\n\n'+web+'\n\n'+c.name))count++;}}
  if(ft_bool_(c.remindShift)){const shifts=ft_get_('Shifts').filter(s=>s.companyId===c.id&&s.status==='PUBLISHED'&&s.userId&&new Date(s.start)>now&&new Date(s.start).getTime()-now.getTime()<=24*3600000);for(const s of shifts){const u=us.find(z=>z.id===s.userId);if(u&&ft_notification_(c,u,'SHIFT',s.id+'-'+s.start,'Erinnerung: Bereitschaftsdienst morgen – '+c.name,'Hallo '+u.name+'!\n\nDein Bereitschaftsdienst beginnt am '+Utilities.formatDate(new Date(s.start),FT_TZ,'dd.MM.yyyy HH:mm')+' Uhr und endet am '+Utilities.formatDate(new Date(s.end),FT_TZ,'dd.MM.yyyy HH:mm')+' Uhr.\n\n'+web+'\n\n'+c.name))count++;}}
 }
 // Abgelaufene Sitzungen und alte Einladungen gelegentlich bereinigen, rückwärts wegen Zeilenverschiebung.
 if(hour===3){for(const tab of ['Sessions','Invites'])ft_get_(tab).filter(x=>tab==='Sessions'?new Date(x.expiresAt)<now:(x.usedAt||new Date(x.expiresAt)<now)).sort((a,b)=>b.__row-a.__row).forEach(x=>ft_sheet_(tab).deleteRow(x.__row));}
 return {sent:count,checked:ft_now_()};});
 // Urlaubsjahresgutschrift separat mit Sperre; niemals im Erinnerungs-Lock.
 try{if(Number(Utilities.formatDate(new Date(),FT_TZ,'H'))===4)ft_leaveAnnualTick_();}
 catch(e){console.warn('Urlaubskonto Jahreslauf:',e);}
 // PDF-Warteschlange NACH dem Erinnerungs-Lock reparieren, niemals darin.
 try{ft_pdfRecoverApproved_();}catch(e){console.warn('PDF-Wiederaufnahme:',e);}
 return tickResult;
}

function ft_remindOne_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const u=ft_user_(actor,p.userId),c=ft_company_(actor,u.companyId),m=ft_month_(p.month),kind=String(p.kind);if(u.status!=='ACTIVE')throw Error('Nur aktive Mitarbeiter können erinnert werden.');if(!['AVAILABILITY','HOURS'].includes(kind))throw Error('Ungültige Erinnerung');if(kind==='AVAILABILITY'&&ft_get_('AvailabilitySubmissions').some(s=>s.userId===u.id&&s.month===m))throw Error('Verfügbarkeit wurde bereits abgegeben.');if(kind==='HOURS'&&ft_get_('Months').some(s=>s.userId===u.id&&s.month===m&&['SUBMITTED','APPROVED','FINAL'].includes(s.status)))throw Error('Stunden sind bereits eingereicht.');const body='Hallo '+u.name+'!\n\nBitte vervollständige deine '+(kind==='HOURS'?'Stunden':'Verfügbarkeitsmeldung')+' für '+m+' in FireTime Pro.\n\n'+ft_publicGithubUrl_()+'\n\n'+c.name;return {sent:ft_notification_(c,u,kind+'-MANUAL',m+'-'+Utilities.formatDate(new Date(),FT_TZ,'yyyyMMddHHmm'), 'FireTime Pro – Erinnerung '+m,body)};}


/** Nachrichten und Aufgaben: mandantengetrennt, privat; bei erster Verwendung
 * drei zusätzliche Tabellen und bei Bedarf ein privater Drive-Ordner.
 * Keine Veränderung an den vorhandenen Arbeits- oder Urlaubsdaten.
 */
const FT_COMM_THREAD_COLS_=['id','companyId','kind','titleEncoded','bodyEncoded','createdBy','recipientId','dueDate','status','createdAt','updatedAt','attachmentId'];
const FT_COMM_REPLY_COLS_=['id','companyId','threadId','authorId','bodyEncoded','createdAt','attachmentId'];
const FT_COMM_READ_COLS_=['id','companyId','threadId','userId','seenAt'];
function ft_commThreads_(){return ft_absenceRows_('CommThreads',FT_COMM_THREAD_COLS_,false);}
function ft_commReplies_(){return ft_absenceRows_('CommReplies',FT_COMM_REPLY_COLS_,false);}
function ft_commReads_(){return ft_absenceRows_('CommReads',FT_COMM_READ_COLS_,false);}
function ft_commEncode_(s){return Utilities.base64EncodeWebSafe(String(s||''),Utilities.Charset.UTF_8);}
function ft_commDecode_(s){return Utilities.newBlob(Utilities.base64DecodeWebSafe(String(s||''))).getDataAsString('UTF-8');}
function ft_commCompany_(actor,p){
 const c=ft_company_(actor,p.companyId||actor.companyId);
 if(actor.role==='STAFF'&&c.id!==actor.companyId)throw Error('Keine Berechtigung für diese Firma.');
 return c;
}
function ft_commAccessible_(actor,thread){
 if(!thread||thread.companyId!==(actor.companyId||thread.companyId))return false;
 return actor.role!=='STAFF'||String(thread.createdBy)===String(actor.id)||String(thread.recipientId)===String(actor.id);
}
function ft_commThread_(actor,id){
 const row=ft_commThreads_().find(x=>String(x.id)===String(id));
 if(!row||!ft_commAccessible_(actor,row))throw Error('Nachricht nicht gefunden oder keine Berechtigung.');
 ft_scope_(actor,row.companyId);
 return row;
}
function ft_commPublic_(x){
 return {id:x.id,companyId:x.companyId,kind:x.kind,title:ft_commDecode_(x.titleEncoded),
 body:ft_commDecode_(x.bodyEncoded),createdBy:x.createdBy,recipientId:x.recipientId,
 dueDate:x.dueDate||'',status:x.status,createdAt:x.createdAt,updatedAt:x.updatedAt,
 hasPhoto:Boolean(x.attachmentId)};
}
function ft_commRecipients_(actor,c){
 return ft_get_('Users').filter(x=>x.companyId===c.id&&x.status==='ACTIVE'&&x.id!==actor.id&&
 (actor.role==='STAFF'?x.role==='ADMIN':x.role==='STAFF')).map(x=>({id:x.id,name:x.name}));
}
function ft_commVisible_(actor,c){
 return ft_commThreads_().filter(x=>x.companyId===c.id&&ft_commAccessible_(actor,x));
}
function ft_commUnread_(actor,c){
 const reads=ft_commReads_(),rows=ft_commVisible_(actor,c);
 return rows.filter(t=>{
  const read=reads.find(r=>r.companyId===c.id&&r.threadId===t.id&&r.userId===actor.id);
  return !read||Date.parse(read.seenAt)<Date.parse(t.updatedAt);
 }).length;
}
function ft_commRead_(actor,t){
 const rows=ft_commReads_(),existing=rows.find(x=>x.companyId===t.companyId&&x.threadId===t.id&&x.userId===actor.id);
 const row=existing||{id:ft_uuid_(),companyId:t.companyId,threadId:t.id,userId:actor.id};
 row.seenAt=ft_now_();
 if(existing)ft_absenceSave_('CommReads',FT_COMM_READ_COLS_,row);
 else ft_absenceAdd_('CommReads',FT_COMM_READ_COLS_,row);
 return true;
}
function ft_commPhotoSave_(actor,c,picture){
 if(!picture)return '';
 const data=String(picture.data||'');
 const mime=String(picture.mime||'');
 if(!['image/jpeg','image/png'].includes(mime)||data.length>950000||data.length<20||
   !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
  throw Error('Bitte ein JPG- oder PNG-Foto bis ca. 650 KB auswählen.');
 const bytes=Utilities.base64Decode(data);
 if(bytes.length>700000)throw Error('Foto zu groß (maximal 650 KB).');
 const signature=bytes.map(x=>x&255);
 if((mime==='image/png'&&!(signature[0]===137&&signature[1]===80&&signature[2]===78&&signature[3]===71))||
    (mime==='image/jpeg'&&!(signature[0]===255&&signature[1]===216&&signature[2]===255)))
   throw Error('Das Fotoformat stimmt nicht mit der Datei überein.');
 const root=DriveApp.getFolderById(ft_prop_('FT_ROOT_ID'));
 const iter=root.getFoldersByName('FireTime Pro – Nachrichtenbilder (privat)');
 const folder=iter.hasNext()?iter.next():root.createFolder('FireTime Pro – Nachrichtenbilder (privat)');
 const blob=Utilities.newBlob(bytes,mime,ft_uuid_()+(mime==='image/png'?'.png':'.jpg'));
 const file=folder.createFile(blob);return file.getId();
}
function ft_commPhoto_(actor,p){
 const t=ft_commThread_(actor,p.threadId),attachmentId=String(p.attachmentId||'');
 const allowed=[t.attachmentId,...ft_commReplies_().filter(r=>r.threadId===t.id&&r.companyId===t.companyId).map(r=>r.attachmentId)];
 if(!attachmentId||!allowed.includes(attachmentId))throw Error('Foto gehört nicht zu dieser Nachricht.');
 const file=DriveApp.getFileById(attachmentId),blob=file.getBlob(),type=blob.getContentType();
 if(!['image/jpeg','image/png'].includes(type)||blob.getSize()>700000)throw Error('Dieses Fotoformat kann nicht geöffnet werden.');
 return {mime:type,data:Utilities.base64Encode(blob.getBytes())};
}
function ft_commList_(actor,p){
 const c=ft_commCompany_(actor,p);
 const threads=ft_commVisible_(actor,c).slice().sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,100);
 const ids=new Set(threads.map(x=>x.id)),read=ft_commReads_(),replies=ft_commReplies_().filter(x=>x.companyId===c.id&&ids.has(x.threadId));
 const users=ft_get_('Users').filter(x=>x.companyId===c.id).map(x=>({id:x.id,name:x.name,role:x.role}));
 return {threads:threads.map(x=>({...ft_commPublic_(x),
  unread:!(read.some(z=>z.threadId===x.id&&z.userId===actor.id&&Date.parse(z.seenAt)>=Date.parse(x.updatedAt)))})),
  replies:replies.map(x=>({id:x.id,threadId:x.threadId,authorId:x.authorId,body:ft_commDecode_(x.bodyEncoded),
  createdAt:x.createdAt,hasPhoto:Boolean(x.attachmentId)})),
  recipients:ft_commRecipients_(actor,c),users,unread:ft_commUnread_(actor,c)};
}
function ft_commMail_(c,recipient,sender,thread,eventId,activity){
 const url=ft_clientUrl_(c);
 return ft_notification_(c,recipient,'COMM_'+activity,eventId,'FireTime Pro – '+(thread.kind==='TASK'?'Aufgabe: ':'Nachricht: ')+
  ft_commDecode_(thread.titleEncoded),
  'Hallo '+recipient.name+'!\n\n'+sender.name+' hat dir in FireTime Pro '+
  (activity==='REPLY'?'geantwortet.':thread.kind==='TASK'?'eine Aufgabe erteilt.':'eine Nachricht gesendet.')+
  '\n\n'+ft_commDecode_(thread.titleEncoded)+
  (thread.dueDate?'\nFrist: '+thread.dueDate.slice(8,10)+'.'+thread.dueDate.slice(5,7)+'.'+thread.dueDate.slice(0,4):'')+
  '\n\nBitte öffne FireTime Pro → Nachrichten & Aufgaben:\n'+url);
}
function ft_commCreate_(actor,p){
 const c=ft_commCompany_(actor,p),kind=String(p.kind||'MESSAGE');
 if(!['MESSAGE','TASK'].includes(kind))throw Error('Unbekannte Nachrichtenart.');
 if(kind==='TASK'&&actor.role==='STAFF')throw Error('Aufgaben werden vom Firmenadministrator vergeben.');
 const recipient=ft_user_(actor,String(p.recipientId||''));
 if(recipient.companyId!==c.id||recipient.id===actor.id||recipient.status!=='ACTIVE'||
   !(actor.role==='STAFF'?recipient.role==='ADMIN':recipient.role==='STAFF'))
  throw Error('Der Empfänger ist für diese Firma nicht erlaubt.');
 const title=ft_str_(p.title||'',120).trim(),body=ft_str_(p.body||'',3000).trim();
 if(title.length<3||body.length<1)throw Error('Bitte Betreff und Nachrichtentext eingeben.');
 const dueDate=kind==='TASK'?String(p.dueDate||''):'';
 if(dueDate)ft_date_(dueDate);
 const now=ft_now_(),row={id:ft_uuid_(),companyId:c.id,kind,titleEncoded:ft_commEncode_(title),
  bodyEncoded:ft_commEncode_(body),createdBy:actor.id,recipientId:recipient.id,dueDate,
  status:kind==='TASK'?'OPEN':'MESSAGE',createdAt:now,updatedAt:now,
  attachmentId:ft_commPhotoSave_(actor,c,p.photo)};
 ft_absenceAdd_('CommThreads',FT_COMM_THREAD_COLS_,row);
 ft_commRead_(actor,row);
 ft_audit_(actor,'COMM_CREATE','CommThreads',row.id,{}, {companyId:c.id,kind,recipientId:recipient.id,dueDate});
 return {thread:ft_commPublic_(row),mailSent:ft_commMail_(c,recipient,actor,row,row.id,'NEW')};
}
function ft_commReply_(actor,p){
 const thread=ft_commThread_(actor,p.threadId),c=ft_commCompany_(actor,{companyId:thread.companyId});
 const body=ft_str_(p.body||'',3000).trim();
 if(!body)throw Error('Bitte eine Antwort eingeben.');
 const reply={id:ft_uuid_(),companyId:c.id,threadId:thread.id,authorId:actor.id,
  bodyEncoded:ft_commEncode_(body),createdAt:ft_now_(),attachmentId:ft_commPhotoSave_(actor,c,p.photo)};
 ft_absenceAdd_('CommReplies',FT_COMM_REPLY_COLS_,reply);
 thread.updatedAt=reply.createdAt;ft_absenceSave_('CommThreads',FT_COMM_THREAD_COLS_,thread);
 ft_commRead_(actor,thread);
 const recipientId=thread.createdBy===actor.id?thread.recipientId:thread.createdBy;
 const recipient=ft_one_('Users',recipientId);
 const sent=recipient&&recipient.status==='ACTIVE'?ft_commMail_(c,recipient,actor,thread,reply.id,'REPLY'):false;
 ft_audit_(actor,'COMM_REPLY','CommReplies',reply.id,{}, {companyId:c.id,threadId:thread.id});
 return {ok:true,mailSent:sent};
}
function ft_commMark_(actor,p){
 const thread=ft_commThread_(actor,p.threadId);
 ft_commRead_(actor,thread);return {ok:true};
}
function ft_commTaskStatus_(actor,p){
 const thread=ft_commThread_(actor,p.threadId);
 if(thread.kind!=='TASK')throw Error('Das ist keine Aufgabe.');
 const next=String(p.status||'');
 if(!['OPEN','DONE'].includes(next))throw Error('Unbekannter Aufgabenstatus.');
 if(actor.role==='STAFF'&&(next!=='DONE'||thread.recipientId!==actor.id))
  throw Error('Du kannst nur deine eigenen Aufgaben als erledigt melden.');
 if(thread.status===next)return {ok:true};
 const before=thread.status;thread.status=next;thread.updatedAt=ft_now_();
 ft_absenceSave_('CommThreads',FT_COMM_THREAD_COLS_,thread);ft_commRead_(actor,thread);
 const c=ft_company_(actor,thread.companyId),other=ft_one_('Users',thread.createdBy===actor.id?thread.recipientId:thread.createdBy);
 if(other&&other.status==='ACTIVE')ft_commMail_(c,other,actor,thread,thread.id+'-'+next+'-'+thread.updatedAt,'REPLY');
 ft_audit_(actor,'COMM_TASK_STATUS','CommThreads',thread.id,{status:before},{status:next});
 return {ok:true};
}

// -----------------------------------------------------------------
// 10_API
// -----------------------------------------------------------------
/** FireTime Pro V1.4 | zentrales Rollen- und Lizenz-Gateway */
function ft_api(token,action,p){
 const u=ft_auth_(token);p=p||{};
 ft_requireAction_(u,action,p);
 switch(action){
  case 'home':return ft_home_(u,p);
  case 'onboard':return ft_lock_(()=>ft_customerOnboard_(u,p));
  case 'companyCreate':return ft_lock_(()=>ft_companyCreate_(u,p));
  case 'companyUpdate':return ft_lock_(()=>{
   const c=ft_company_(u,p.id);
   if(ft_bool_(p.remindAvailability)&&!ft_enabled_(c,'AVAILABILITY'))throw Error('Verfügbarkeit ist kein freigeschaltetes Modul.');
   if(ft_bool_(p.remindShift)&&!ft_enabled_(c,'STANDBY'))throw Error('Bereitschaft ist kein freigeschaltetes Modul.');
   if(ft_bool_(p.remindHours)&&!ft_enabled_(c,'REPORTS'))throw Error('Monatsberichte sind kein freigeschaltetes Modul.');
   if(ft_bool_(p.calendarOn)&&!ft_enabled_(c,'CALENDAR'))
    throw Error('Kalender wurde nicht als gekauftes Modul freigeschaltet.');
   return ft_companyUpdate_(u,p);
  });
  case 'logoUpload':return ft_lock_(()=>ft_logo_(u,p));
  case 'profileSave':return ft_lock_(()=>ft_profileSave_(u,p));
  case 'profileGet':return ft_companyProfile_(u,p);
  case 'licenseGet':return ft_licApi_(u,p);
  case 'licenseSave':return ft_lock_(()=>ft_licenseSave_(u,p));
  case 'userCreate':
   if(u.role==='ADMIN'&&p.role==='ADMIN')throw Error('Weitere Firmenadministratoren kann nur der Systemadministrator bestimmen.');
   return ft_lock_(()=>ft_userCreate_(u,p));
  case 'userUpdate':
   if(u.role==='ADMIN'&&p.role==='ADMIN')throw Error('Administratorrechte vergibt nur der Systemadministrator.');
   return ft_lock_(()=>ft_userUpdate_(u,p));
  case 'userInvite':
   ft_allowed_(u,['SYSADMIN','ADMIN']);
   return ft_lock_(()=>ft_invite_(u,ft_user_(u,p.id)));
  case 'activityTypesGet':return ft_activityTypesGet_(u,p);
  case 'activityTypesSave':return ft_lock_(()=>ft_activityTypesSave_(u,p));
  case 'timerStart':return ft_lock_(()=>ft_timerStart_(u,p));
  case 'timerStop':return ft_lock_(()=>ft_timerStop_(u,p));
  case 'timerStatus':return ft_timerStatus_(u,p);
  case 'timerPauseStart':return ft_lock_(()=>ft_timerPauseAction_(u,'start'));
  case 'timerPauseStop':return ft_lock_(()=>ft_timerPauseAction_(u,'stop'));
  case 'commList':return ft_commList_(u,p);
  case 'commCreate':return ft_lock_(()=>ft_commCreate_(u,p));
  case 'commReply':return ft_lock_(()=>ft_commReply_(u,p));
  case 'commRead':return ft_lock_(()=>ft_commMark_(u,p));
  case 'commTaskStatus':return ft_lock_(()=>ft_commTaskStatus_(u,p));
  case 'commPhoto':return ft_commPhoto_(u,p);
  case 'activitySave':return ft_lock_(()=>ft_activitySave_(u,p));
  case 'activityDelete':return ft_lock_(()=>ft_activityDelete_(u,p));
  case 'availabilitySave':return ft_lock_(()=>ft_availabilitySave_(u,p));
  case 'availabilitySubmit':return ft_lock_(()=>ft_availabilitySubmit_(u,p));
  case 'planWorkflow':return ft_planWorkflow_(u,p);
  case 'planFinalize':return ft_lock_(()=>ft_planFinalize_(u,p));
  case 'planCalendarShare':return ft_lock_(()=>ft_planCalendarShare_(u,p));
  case 'planSuggest':return ft_lock_(()=>ft_planSuggest_(u,p));
  case 'planAssign':return ft_lock_(()=>ft_planAssign_(u,p));
  case 'planPublish':return ft_lock_(()=>ft_planPublishOnly_(u,p));
  case 'shiftConfirm':return ft_lock_(()=>ft_shiftConfirm_(u,p));
  case 'workSave':return ft_lock_(()=>ft_workSave_(u,p));
  case 'workDelete':return ft_lock_(()=>ft_workDelete_(u,p));
  case 'workPublish':return ft_lock_(()=>ft_workPublish_(u,p));
  case 'leaveRequest':return ft_lock_(()=>ft_leaveRequest_(u,p));
  case 'leaveUpdate':return ft_lock_(()=>ft_leaveUpdate_(u,p));
  case 'leaveWithdraw':return ft_lock_(()=>ft_leaveWithdraw_(u,p));
  case 'leaveReview':return ft_lock_(()=>ft_leaveReview_(u,p));
  case 'leaveAccount':return ft_absenceHistory_(u,p);
  case 'leavePolicyGet':return ft_leavePolicyGet_(u,p);
  case 'leavePolicySave':return ft_lock_(()=>ft_leavePolicySave_(u,p));
  case 'absenceHistory':return ft_absenceHistory_(u,p);
  case 'absencePdfCreate':return ft_absencePdfCreate_(u,p);
  case 'absencePdfArchive':return ft_absencePdfArchive_(u,p);
  case 'absencePdfChunk':return ft_absencePdfChunk_(u,p);
  case 'monthSubmit':return ft_lock_(()=>ft_monthSubmit_(u,p));
  case 'monthReview':{
   const reviewed=ft_lock_(()=>ft_monthReview_(u,p));
   if(String(reviewed.status)==='APPROVED'){
    // Approval is permanent even when a Google trigger is temporarily unavailable.
    try{reviewed.pdfArchive=ft_pdfAutoQueueApproved_(u,reviewed);}
    catch(e){console.error('PDF-Automatik nach Freigabe:',e);
      reviewed.pdfArchive={status:'ERROR',error:String(e.message||e)};}
   }
   return reviewed;
  }
  case 'report':return ft_reportApi_(u,p);
  case 'pdf':return ft_reportPdf_(u,p);
  case 'pdfStore':return ft_pdfStore_(u,p);
  case 'pdfPrepare':return ft_pdfPrepare_(u,p);
  case 'pdfJobStatus':return ft_pdfJobStatus_(u,p);
  case 'pdfArchive':return ft_pdfArchive_(u,p);
  case 'pdfChunk':return ft_pdfChunk_(u,p);
  case 'pdfBatchStore':return ft_pdfBatchStore_(u,p);
  case 'pdfBatchArchive':return ft_pdfBatchArchive_(u,p);
  case 'pdfBatchChunk':return ft_pdfBatchChunk_(u,p);
  case 'rulesGet':return ft_rulesApi_(u,p);
  case 'rulesSave':return ft_lock_(()=>ft_rulesSave_(u,p));
  case 'calendarTest':return ft_calendarTest_(u,p.companyId||u.companyId);
  case 'audit':return ft_auditApi_(u,p);
  case 'remindOne':return ft_lock_(()=>ft_remindOne_(u,p));
  case 'handoverRequest':return ft_lock_(()=>ft_handoverRequest_(u,p));
  case 'handoverRespond':return ft_lock_(()=>ft_handoverRespond_(u,p));
  case 'segmentConfirm':return ft_lock_(()=>ft_segmentConfirm_(u,p));
  case 'sickReport':return ft_lock_(()=>ft_sickReport_(u,p));
  case 'sickReview':return ft_lock_(()=>ft_sickReview_(u,p));
  case 'shiftPeriodSummary':return ft_shiftPeriodSummary_(u,p);
  case 'calendarResync':return ft_lock_(()=>ft_calendarResync_(u,p));
  default:throw Error('Unbekannte Funktion: '+action);
 }
}
function ft_home_(u,p){
 const cid=u.role==='SYSADMIN'?String(p.companyId||''):u.companyId;
 const month=ft_month_(p.month||ft_localMonth_(new Date()));
 const companies=u.role==='SYSADMIN'?ft_get_('Companies').map(ft_companyData_):[];
 const c=cid?ft_company_(u,cid):null;
 if(u.role!=='SYSADMIN'&&!c)throw Error('Firma nicht zugeordnet.');
 const mods=c?ft_license_(c):[],isAdmin=u.role!=='STAFF';
 const access=(m)=>mods.includes(m);
 // Keep old API clients compatible: without view, provide every section.
 const requested=String(p.view||'all');
 const need=(...names)=>requested==='all'||names.includes(requested);
 const directory=c?ft_get_('Users').filter(x=>x.companyId===c.id&&x.status==='ACTIVE').map(x=>({id:x.id,name:x.name})):[];
 const users=c?ft_get_('Users').filter(x=>x.companyId===c.id&&(isAdmin||x.id===u.id)).map(ft_safe_):[];
 const within=x=>x.companyId===c.id&&(isAdmin||x.userId===u.id);
 const activities=c&&access('TIME')&&need('time')?ft_get_('Activities').filter(x=>within(x)&&(String(x.start||'').slice(0,7)===month||String(x.end||'').slice(0,7)===month)).map(ft_publicRow_):[];
 const availability=c&&access('AVAILABILITY')&&need('availability','standby')?ft_get_('Availability').filter(x=>within(x)&&x.month===month).map(ft_publicRow_):[];
 const availSubmissions=c&&access('AVAILABILITY')&&need('availability','standby')?ft_get_('AvailabilitySubmissions').filter(x=>within(x)&&x.month===month).map(ft_publicRow_):[];
 const shifts=c&&access('STANDBY')&&need('dashboard','standby')?ft_get_('Shifts').filter(x=>x.companyId===c.id&&x.day.startsWith(month)&&(isAdmin||x.status==='PUBLISHED')).map(ft_publicRow_):[];
 // Standby-Abschnitte/Übergaben werden nur im Bereitschaftsplan gebraucht.
 // Krankenstand nur in der Krankenstands- und Bereitschaftsansicht.
 const loadStandby=c&&need('standby')&&access('STANDBY');
 const loadSick=c&&access('SICK')&&need('standby','sick');
 const extra={
   segments:loadStandby?ft_get_('ShiftSegments').filter(x=>x.companyId===c.id&&ft_localMonth_(new Date(x.start))===month).map(ft_publicRow_):[],
   changes:loadStandby?ft_get_('ShiftChanges').filter(x=>x.companyId===c.id&&(x.status==='PENDING'||ft_localMonth_(new Date(x.start))===month)&&(isAdmin||x.fromUserId===u.id||x.toUserId===u.id)).map(ft_publicRow_):[],
   sick:loadSick?ft_get_('SickLeaves').filter(x=>x.companyId===c.id&&(x.status==='PENDING'||ft_localMonth_(new Date(x.from))===month||ft_localMonth_(new Date(x.to))===month)&&(isAdmin||x.userId===u.id)).map(ft_publicRow_):[]
 };
 const workShifts=c&&access('WORKPLAN')&&need('dashboard','work')?ft_workRows_().filter(x=>within(x)&&
  (x.start.slice(0,7)===month||x.end.slice(0,7)===month)&&
  (isAdmin||x.status==='PUBLISHED')).map(ft_publicRow_):[];
 const leaves=c&&access('LEAVE')&&need('leave')?ft_get_('Leaves').filter(within).map(ft_publicRow_):[];
 const months=c&&access('REPORTS')&&need('reports')?ft_get_('Months').filter(x=>within(x)&&x.month===month).map(ft_publicRow_):[];
 const reports={};
 // Teure Monatsberechnungen nur auf Uebersicht oder Monatsbericht ausfuehren.
 // Ohne reportsMode bleibt die alte API rueckwaertskompatibel (alle Berichte).
 const reportsMode=['none','self','all','selected'].includes(String(p.reportsMode||''))?String(p.reportsMode):'all';
 if(c&&access('REPORTS')&&reportsMode!=='none'){
  const source={Activities:ft_get_('Activities'),Shifts:ft_get_('Shifts'),ShiftSegments:ft_get_('ShiftSegments'),SickLeaves:ft_get_('SickLeaves'),
   Leaves:ft_get_('Leaves'),Months:ft_get_('Months')};
  const reportUsers=reportsMode==='self'?users.filter(x=>x.id===u.id):reportsMode==='selected'?users.filter(x=>x.id===String(p.userId||users[0]?.id||u.id)):users;
  reportUsers.forEach(x=>reports[x.id]=ft_publicReport_(c,ft_report_(c,x,month,false,source)));
 }
 return {me:ft_safe_(u),month,company:c?ft_companyData_(c):null,
  logo:c&&need('dashboard','settings')?ft_logoData_(c):'',companies,modules:mods,profile:c?ft_profileFor_(c):null,
  loginUrl:c?ft_clientUrl_(c):'',directory,users,activities,availability,
  availSubmissions,shifts,workShifts,leaves,months,reports,...extra,
  standbyWorkflow:c&&need('standby')&&access('STANDBY')&&isAdmin?ft_planWorkflow_(u,{companyId:c.id,month}):null,
  workflowReady:Boolean(c&&ft_db_().getSheetByName('ActivityTimers')&&ft_db_().getSheetByName('ActivityTypes')&&ft_db_().getSheetByName('PlanMonths')),
  balanceCutoverSupported:true,
  activityDefaultsSupported:true,
  commSupported:true,
  pauseClockSupported:true,
  commUnread:c?ft_commUnread_(u,c):0,
  activityTypes:c&&need('time','settings')&&access('TIME')?ft_activityTypesFor_(c):[],
  runningTimer:c&&need('time')&&access('TIME')?ft_timerActive_(c.id,u.id):null};
}
function ft_auditApi_(u,p){
 ft_allowed_(u,['SYSADMIN','ADMIN']);
 const cid=p.companyId||u.companyId;
 if(u.role==='ADMIN')ft_scope_(u,cid);
 return ft_get_('Audit').filter(x=>u.role==='SYSADMIN'?(cid?x.companyId===cid:true):x.companyId===cid)
  .slice(-150).reverse().map(x=>({at:x.at,actorId:x.actorId,action:x.action,
   entity:x.entity,entityId:x.entityId,previous:x.previous,next:x.next}));
}

// -----------------------------------------------------------------
// 11_Wartung
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 11_Wartung.gs */
function ft_setup(){
 const p=PropertiesService.getScriptProperties();if(p.getProperty('FT_DB_ID'))throw Error('Bereits eingerichtet; keine zweite Datenbank erstellen.');
 const pw=p.getProperty('FIRETIME_SETUP_PASSWORD'),email=ft_email_(p.getProperty('FIRETIME_SETUP_EMAIL')||'firetime.pro@gmail.com');
 if(!pw||pw.length<14)throw Error('In Skripteigenschaften FIRETIME_SETUP_PASSWORD mit mindestens 14 Zeichen hinterlegen.');
 const root=DriveApp.createFolder('FireTime Pro – Systemdaten');
 const ss=SpreadsheetApp.create('FireTime Pro – Datenbank');const initial=ss.getSheets()[0];initial.setName('Companies');
 Object.keys(FT_HEADERS).forEach(name=>{const sh=name==='Companies'?initial:ss.insertSheet(name);sh.getRange(1,1,1,FT_HEADERS[name].length).setValues([FT_HEADERS[name]]);sh.setFrozenRows(1);sh.getRange(1,1,1,FT_HEADERS[name].length).setFontWeight('bold').setBackground('#173251').setFontColor('#ffffff');});
 p.setProperties({FT_DB_ID:ss.getId(),FT_ROOT_ID:root.getId(),FT_PEPPER:ft_rand_()},false);
 const salt=ft_rand_();const admin={id:ft_uuid_(),companyId:'',role:'SYSADMIN',name:'Michael Mejtsky',email,status:'ACTIVE',passwordHash:ft_password_(pw,salt),salt,monthlyHours:0,hourlyRate:0,leaveEntitlement:0,leaveBalance:0,openingHours:0,startDate:'',workdays:'1,2,3,4,5',mustChange:false,createdAt:ft_now_()};
 ft_add_('Users',admin);const c=ft_companyCreate_(admin,{name:'BSB3100',slug:'bsb3100',color:'#ff784f'});
 p.deleteProperty('FIRETIME_SETUP_PASSWORD');ft_installTriggers();
 Logger.log('Fertig. Datenbank: '+ss.getUrl()+' | Ordner: '+root.getUrl()+' | Erste Firma: '+c.id);
 return {database:ss.getUrl(),folder:root.getUrl(),companyId:c.id};
}

function ft_installTriggers(){ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='ft_tick').forEach(t=>ScriptApp.deleteTrigger(t));ScriptApp.newTrigger('ft_tick').timeBased().everyMinutes(15).create();return 'Automatisierung eingerichtet.';}

/** Nur Kontrolle, keine Neuanlage und keine Aenderung bestehender Daten! */
function ft_upgradeCheck(){
  const dbId=ft_prop_('FT_DB_ID');
  if(!dbId)throw Error('Keine vorhandene FireTime-Pro-Datenbank. Erstinstallation ist nicht erforderlich!');
  const companies=ft_get_('Companies');
  const existing=companies.find(c=>String(c.slug).toLowerCase()==='bsb3100');
  if(!existing)throw Error('Kunde BSB3100 wurde in dieser Datenbank nicht gefunden. Bitte nicht neu anlegen, sondern Einstellungen prüfen.');
  const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='ft_tick');
  return {ok:true,version:FT_VERSION,databaseId:dbId,customer:{id:existing.id,name:existing.name,slug:existing.slug},triggers:triggers.length,message:'Vorhandene Datenbank und Kunde BSB3100 erfolgreich erkannt. Keine Daten wurden verändert.'};
}

// -----------------------------------------------------------------
// 12_Lizenzen
// -----------------------------------------------------------------
/** FireTime Pro V1.4 | Lizenzmodule – nur SYSADMIN darf Pakete freischalten */
const FT_MODULES_=['TIME','REPORTS','LEAVE','WORKPLAN','STANDBY','AVAILABILITY','CALENDAR','PAY_PREVIEW','SICK'];
const FT_LICENSE_COLS_=['id','companyId','modules','updatedBy','updatedAt'];
function ft_licSheet_(create){
 const db=ft_db_();let sh=db.getSheetByName('CompanyLicenses');
 if(!sh&&create){sh=db.insertSheet('CompanyLicenses');sh.appendRow(FT_LICENSE_COLS_);sh.setFrozenRows(1);}
 return sh;
}
function ft_licRows_(){
 const sh=ft_licSheet_(false);if(!sh||sh.getLastRow()<2)return [];
 return sh.getRange(2,1,sh.getLastRow()-1,FT_LICENSE_COLS_.length).getValues().map((a,i)=>{
  const row={__row:i+2};FT_LICENSE_COLS_.forEach((k,j)=>row[k]=a[j]);return row;
 });
}
function ft_license_(c){
 const r=ft_licRows_().find(x=>String(x.companyId)===String(c.id));
 // Bestehender Erstkunde bleibt ohne Migration funktionstüchtig.
 if(!r)return c.slug==='bsb3100'?FT_MODULES_.filter(m=>!['PAY_PREVIEW','SICK'].includes(m)):['TIME','REPORTS','LEAVE'];
 try{const arr=JSON.parse(String(r.modules||'[]'));return FT_MODULES_.filter(x=>arr.includes(x));}
 catch(e){throw Error('Modulfreigabe beschädigt: '+c.name);}
}
function ft_enabled_(c,module){return ft_license_(c).includes(module);}
function ft_need_(actor,c,module){
 ft_scope_(actor,c.id);
 if(!ft_enabled_(c,module))throw Error('Das Modul „'+module+'“ wurde für '+c.name+' nicht freigeschaltet. Bitte FireTime-Pro-Systemadministrator kontaktieren.');
}
function ft_licenseSave_(actor,p){
 ft_allowed_(actor,['SYSADMIN']);
 const c=ft_company_(actor,p.companyId);
 const mods=Array.isArray(p.modules)?p.modules:[];
 if(mods.some(x=>!FT_MODULES_.includes(x)))throw Error('Unbekanntes Modul.');
 const modules=FT_MODULES_.filter(x=>mods.includes(x));
 // Kalender erfordert ein Dienstplan-Modul.
 if(modules.includes('CALENDAR')&&!modules.some(x=>x==='WORKPLAN'||x==='STANDBY'))
  throw Error('Kalender nur gemeinsam mit Dienstplanung oder Bereitschaft freischalten.');
 if(modules.includes('AVAILABILITY')&&!modules.includes('STANDBY'))
  throw Error('Verfügbarkeitsmeldung erfordert Bereitschaft.');
 const old=ft_licRows_().find(x=>x.companyId===c.id);
 const row={id:old?old.id:ft_uuid_(),companyId:c.id,
  modules:JSON.stringify(modules),updatedBy:actor.id,updatedAt:ft_now_()};
 const sh=ft_licSheet_(true);
 if(old)sh.getRange(old.__row,1,1,FT_LICENSE_COLS_.length).setValues([FT_LICENSE_COLS_.map(k=>row[k])]);
 else sh.appendRow(FT_LICENSE_COLS_.map(k=>row[k]));
 ft_audit_(actor,'MODULES','CompanyLicenses',row.id,old||{},row);
 return modules;
}
function ft_licApi_(actor,p){
 const c=ft_company_(actor,p.companyId||actor.companyId);
 return {modules:ft_license_(c),available:FT_MODULES_.slice()};
}
function ft_requireAction_(actor,action,p){
 const dict={
  activitySave:'TIME',activityDelete:'TIME',activityTypesGet:'TIME',activityTypesSave:'TIME',timerStart:'TIME',timerStop:'TIME',timerStatus:'TIME',timerPauseStart:'TIME',timerPauseStop:'TIME',
  monthSubmit:'REPORTS',monthReview:'REPORTS',report:'REPORTS',pdf:'REPORTS',pdfPrepare:'REPORTS',pdfJobStatus:'REPORTS',pdfArchive:'REPORTS',pdfChunk:'REPORTS',pdfStore:'REPORTS',pdfBatchStore:'REPORTS',pdfBatchArchive:'REPORTS',pdfBatchChunk:'REPORTS',
  leaveRequest:'LEAVE',leaveUpdate:'LEAVE',leaveWithdraw:'LEAVE',leaveReview:'LEAVE',
  leaveAccount:'LEAVE',leavePolicyGet:'LEAVE',leavePolicySave:'LEAVE',
  absenceHistory:'LEAVE',absencePdfCreate:'LEAVE',absencePdfArchive:'LEAVE',absencePdfChunk:'LEAVE',
  availabilitySave:'AVAILABILITY',availabilitySubmit:'AVAILABILITY',
  planSuggest:'STANDBY',planAssign:'STANDBY',planPublish:'STANDBY',planFinalize:'STANDBY',planWorkflow:'STANDBY',planCalendarShare:'STANDBY',shiftConfirm:'STANDBY',
  handoverRequest:'STANDBY',handoverRespond:'STANDBY',segmentConfirm:'STANDBY',shiftPeriodSummary:'STANDBY',
  workSave:'WORKPLAN',workPublish:'WORKPLAN',workDelete:'WORKPLAN',
  rulesGet:'REPORTS',rulesSave:'REPORTS',
  calendarTest:'CALENDAR',calendarResync:'CALENDAR'
 };
 const mod=dict[action];if(!mod)return;
 let companyId=actor.companyId;
 if(actor.role==='SYSADMIN'){
  companyId=p.companyId||'';
  if(p.userId){const user=ft_one_('Users',p.userId);if(user)companyId=user.companyId;}
  if(p.id){
   const tab=action.startsWith('work')?'WorkShifts':
    action==='shiftConfirm'?'Shifts':action==='leaveReview'?'Leaves':
    action==='monthReview'?'Months':action.includes('activity')?'Activities':'';
   if(tab&&tab!=='WorkShifts'){const found=ft_one_(tab,p.id);if(found)companyId=found.companyId;}
   if(tab==='WorkShifts'){const found=ft_workOne_(p.id);if(found)companyId=found.companyId;}
  }
 }
 if(!companyId)throw Error('Bitte zuerst eine Kundenfirma öffnen.');
 const c=ft_company_(actor,companyId);
 ft_need_(actor,c,mod);
}

// -----------------------------------------------------------------
// 13_Firmenprofile
// -----------------------------------------------------------------
/** FireTime Pro V1.4 | Allgemeine Firmenprofile – keine Objektzuweisung */
const FT_PROFILE_COLS_=['id','companyId','workModel','workStart','workHours','workdays','standbyEnabled','standbyStart','standbyHours','availabilityEnabled','plannerEnabled','secondaryColor','welcomeText','updatedBy','updatedAt'];
const FT_WORK_MODELS_=['OFFICE','SHIFT12','SHIFT24','FLEX'];
function ft_profileSheet_(create){
 const db=ft_db_();let s=db.getSheetByName('CompanyProfiles');
 if(!s&&create){s=db.insertSheet('CompanyProfiles');s.appendRow(FT_PROFILE_COLS_);s.setFrozenRows(1);}
 return s;
}
function ft_profileRows_(){
 if(FT_REQUEST_CACHE?.profiles)return FT_REQUEST_CACHE.profiles;
 const sh=ft_profileSheet_(false);
 if(!sh||sh.getLastRow()<2)return [];
 const rows=sh.getRange(2,1,sh.getLastRow()-1,FT_PROFILE_COLS_.length).getValues().map((v,i)=>{
  const o={__row:i+2};FT_PROFILE_COLS_.forEach((k,j)=>o[k]=v[j]);return o;
 });
 if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.profiles=rows;
 return rows;
}
function ft_profileTime_(value, fallback){
  if(value instanceof Date&&Number.isFinite(value.getTime())){
    const zone=ft_db_().getSpreadsheetTimeZone()||FT_TZ;
    return Utilities.formatDate(value,zone,'HH:mm');
  }
  const text=String(value||'').trim();
  if(/^([01]\d|2[0-3]):[0-5]\d$/.test(text))return text;
  return fallback;
}
function ft_profileFor_(c){
 const r=ft_profileRows_().find(x=>String(x.companyId)===String(c.id));
 const def={companyId:c.id,workModel:c.slug==='bsb3100'?'FLEX':'OFFICE',
  workStart:'08:00',workHours:8,workdays:'1,2,3,4,5',
  standbyStart:'07:00',standbyHours:24,secondaryColor:'#19354d',welcomeText:''};
 return Object.assign(def,r?{
  id:r.id,workModel:r.workModel,workStart:ft_profileTime_(r.workStart,'08:00'),workHours:Number(r.workHours)||8,
  workdays:r.workdays,standbyStart:ft_profileTime_(r.standbyStart,'07:00'),standbyHours:Number(r.standbyHours)||24,
  secondaryColor:r.secondaryColor,welcomeText:r.welcomeText
 }:{});
}
function ft_profileValidate_(p){
 const model=String(p.workModel||'OFFICE');
 if(!FT_WORK_MODELS_.includes(model))throw Error('Arbeitszeitmodell ungültig.');
 const time=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''));
 if(!time(p.workStart)||!time(p.standbyStart))throw Error('Uhrzeit muss HH:MM sein.');
 const days=String(p.workdays||'1,2,3,4,5');
 if(!/^[1-7](,[1-7])*$/.test(days)||new Set(days.split(',')).size!==days.split(',').length)
  throw Error('Arbeitstage z. B. 1,2,3,4,5 für Montag–Freitag.');
 const secondary=String(p.secondaryColor||'#19354d');
 if(!/^#[\da-f]{6}$/i.test(secondary))throw Error('Ungültige zweite Firmenfarbe.');
 return {workModel:model,workStart:String(p.workStart),workHours:ft_number_(p.workHours,0.25,24,'Schichtstunden'),
  workdays:days,standbyStart:String(p.standbyStart),standbyHours:ft_number_(p.standbyHours,1,48,'Bereitschaftsstunden'),
  secondaryColor:secondary,welcomeText:ft_str_(p.welcomeText,180)};
}
function ft_profileSave_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_company_(actor,p.companyId||actor.companyId);
 const vals=ft_profileValidate_(p),old=ft_profileRows_().find(x=>x.companyId===c.id);
 const row={id:old?old.id:ft_uuid_(),companyId:c.id,...vals,
  standbyEnabled:ft_enabled_(c,'STANDBY'),availabilityEnabled:ft_enabled_(c,'AVAILABILITY'),
  plannerEnabled:ft_enabled_(c,'WORKPLAN'),updatedBy:actor.id,updatedAt:ft_now_()};
 const sh=ft_profileSheet_(true);
 if(old)sh.getRange(old.__row,1,1,FT_PROFILE_COLS_.length).setValues([FT_PROFILE_COLS_.map(k=>row[k]||'')]);
 else sh.appendRow(FT_PROFILE_COLS_.map(k=>row[k]||''));
 if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.profiles=null;
 ft_audit_(actor,'PROFILE','CompanyProfiles',row.id,old||{},row);
 return ft_profileFor_(c);
}
function ft_publicGithubUrl_(){
 const url=String(PropertiesService.getScriptProperties()
  .getProperty('FT_PUBLIC_GITHUB_URL')||'').trim().replace(/\/+$/,'');
 // Erlaubt die Cloudflare-Stammadresse ebenso wie eine GitHub-Pages-Unteradresse.
 if(!/^https:\/\/[^/?#\s]+(?:\/[^?#\s]*)?$/.test(url))
  throw Error('FT_PUBLIC_GITHUB_URL in Skripteigenschaften eintragen.');
 return url+'/';
}
function ft_clientUrl_(c){
 return ft_publicGithubUrl_()+'?firm='+encodeURIComponent(c.slug);
}
function ft_customerOnboard_(actor,p){
 ft_allowed_(actor,['SYSADMIN']);
 ft_profileValidate_(p);
 const name=ft_str_(p.adminName,100),email=ft_email_(p.adminEmail);
 if(!name)throw Error('Name des ersten Firmenadministrators fehlt.');
 const mods=Array.isArray(p.modules)?p.modules:['TIME','REPORTS','LEAVE'];
 if(mods.some(x=>!FT_MODULES_.includes(x)))throw Error('Unbekanntes Firmenmodul.');
 if(mods.includes('CALENDAR')&&!mods.some(x=>x==='WORKPLAN'||x==='STANDBY'))throw Error('Kalender erfordert einen Dienstplan oder Bereitschaft.');
 if(mods.includes('AVAILABILITY')&&!mods.includes('STANDBY'))throw Error('Verfügbarkeit erfordert Bereitschaft.');
 if(ft_get_('Users').some(u=>u.email===email))throw Error('E-Mail des Firmenadministrators bereits vergeben.');
 // Erst alle einfachen Daten prüfen, dann vorhandene Datenbank erweitern.
 const c=ft_companyCreate_(actor,p);
 ft_licenseSave_(actor,{companyId:c.id,modules:mods});
 ft_companyUpdate_(actor,{id:c.id,remindAvailability:mods.includes('AVAILABILITY'),
  remindShift:mods.includes('STANDBY'),remindHours:mods.includes('REPORTS')});
 ft_profileSave_(actor,{...p,companyId:c.id});
 const warnings=[];
 if(p.logoData){try{ft_logo_(actor,{companyId:c.id,data:p.logoData});}catch(e){warnings.push('Logo: '+e.message);}}
 const admin=ft_userCreate_(actor,{companyId:c.id,name,email,role:'ADMIN',
  monthlyHours:0,hourlyRate:0,leaveEntitlement:0,leaveBalance:0});
 if(/nicht verschickt/.test(admin.message))warnings.push(admin.message);
 return {company:ft_companyData_(ft_one_('Companies',c.id)),admin:admin.user,
  loginUrl:ft_clientUrl_(c),warnings};
}
function ft_companyProfile_(actor,p){
 const c=ft_company_(actor,p.companyId||actor.companyId);
 return {profile:ft_profileFor_(c),loginUrl:ft_clientUrl_(c)};
}
function ft_brandForLogin(slug){
 const c=ft_get_('Companies').find(x=>x.slug===String(slug||'')&&ft_bool_(x.active));
 if(!c)return null;
 const p=ft_profileFor_(c);
 return {name:c.name,logo:ft_logoData_(c),color:c.color,
  secondaryColor:p.secondaryColor,welcomeText:p.welcomeText};
}

// -----------------------------------------------------------------
// 14_Firmenregeln
// -----------------------------------------------------------------
/** FireTime Pro V1.2 – mandantenbezogene Abrechnungsregeln.
 *  Developed by Michael Mejtsky.
 *  Erstellt die Zusatz-Tabelle erst beim ersten Speichern, niemals eine neue Datenbank.
 */
const FT_RULE_HEADERS_ = [
  'id','companyId','effectiveMonth','nightTypes','sundayTypes',
  'holidayTypes','nightPct','sundayPct','holidayPct','standbyRate',
  'holidayCalendar','extraHolidays','note','createdBy','createdAt'
];
const FT_RULE_TYPES_ = ['STANDBY','OBJECT','INCIDENT','OTHER'];

function ft_ruleSheet_(create) {
  const db = ft_db_();
  let s = db.getSheetByName('CompanyRules');
  if (!s && create) {
    s = db.insertSheet('CompanyRules');
    s.getRange(1,1,1,FT_RULE_HEADERS_.length).setValues([FT_RULE_HEADERS_]);
    s.setFrozenRows(1);
    s.getRange(1,1,1,FT_RULE_HEADERS_.length).setBackground('#173251').setFontColor('#ffffff').setFontWeight('bold');
  }
  return s;
}
function ft_ruleRows_() {
  if(FT_REQUEST_CACHE?.rules)return FT_REQUEST_CACHE.rules;
  const s=ft_ruleSheet_(false);
  if(!s||s.getLastRow()<2)return [];
  const rows=s.getRange(2,1,s.getLastRow()-1,FT_RULE_HEADERS_.length).getValues()
    .map((row,i)=>Object.fromEntries([['__row',i+2],...FT_RULE_HEADERS_.map((k,j)=>[k,(k==='effectiveMonth'&&row[j] instanceof Date)?Utilities.formatDate(row[j],FT_TZ,'yyyy-MM'):(row[j] instanceof Date?row[j].toISOString():row[j])])]));
  if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.rules=rows;
  return rows;
}
function ft_ruleTypeArray_(val,def) {
  if (val===undefined || val===null || val==='') return def.slice();
  const arr=Array.isArray(val)?val:String(val).split(',');
  const a=[...new Set(arr.map(x=>String(x).trim().toUpperCase()))].filter(Boolean);
  if(a.some(x=>!FT_RULE_TYPES_.includes(x))) throw Error('Unbekannte Tätigkeitsart in der Zuschlagsregel.');
  return a;
}
/** BSB3100: Bereitschaft hat immer denselben Stundensatz, auch nachts, sonn- und feiertags.
 * Alte CompanyRules-Datensätze bleiben unangetastet; ihre STANDBY-Auswahl ist für
 * die Berechnung ab diesem Code-Stand jedoch nicht mehr zuschlagsberechtigt.
 * Andere Mandanten behalten ihre frei konfigurierbaren Zuschlagsarten.
 */
function ft_rulePremiumTypes_(c,types){
 const items=Array.isArray(types)?types:[];
 return String(c?.slug||'').toLowerCase()==='bsb3100'
  ?items.filter(x=>x!=='STANDBY'):items;
}
function ft_ruleDefault_(c) {
  // BSB3100: freiwillige Objektkontrolle erhält keinen freiwilligen Sonn-/Feiertagszuschlag.
  // Gesetzliche/KV-Zahlungen werden dadurch NICHT aufgehoben.
  const bsb=String(c.slug||'').toLowerCase()==='bsb3100';
  return {
    companyId:c.id,effectiveMonth:'2026-01',
    nightTypes:['OBJECT','INCIDENT','OTHER'],
    sundayTypes:bsb?['INCIDENT','OTHER']:['STANDBY','OBJECT','INCIDENT','OTHER'],
    holidayTypes:bsb?['INCIDENT','OTHER']:['STANDBY','OBJECT','INCIDENT','OTHER'],
    nightPct:Number(c.nightPct)||0,
    sundayPct:Number(c.sundayPct)||0,
    holidayPct:Number(c.holidayPct)||0,
    standbyRate:Number(c.standbyRate)||0,
    holidayCalendar:'AT',extraHolidays:[],
    note:bsb?'BSB3100: Bereitschaft ohne Nacht-, Sonn- oder Feiertagszuschlag. Firmeneigene Zuschläge nur für ausgewählte aktive Arbeitszeiten; gesetzliche/KV-Ansprüche separat prüfen.':'Firmenregel bitte mit Vertrag und Kollektivvertrag abgleichen.',
    source:'STANDARD'
  };
}
function ft_rulesFor_(c,month) {
  const m=ft_month_(month);
  const rows=ft_ruleRows_().filter(x=>String(x.companyId)===String(c.id) && String(x.effectiveMonth)<=m)
    .sort((a,b)=>String(a.effectiveMonth).localeCompare(String(b.effectiveMonth))||a.__row-b.__row);
  if(!rows.length)return ft_ruleDefault_(c);
  const r=rows[rows.length-1];
  let extra=[];
  try {extra=JSON.parse(String(r.extraHolidays||'[]'));} catch(e){extra=[];}
  return {
    companyId:c.id,effectiveMonth:String(r.effectiveMonth),
    nightTypes:ft_rulePremiumTypes_(c,ft_ruleTypeArray_(r.nightTypes,[])),
    sundayTypes:ft_rulePremiumTypes_(c,ft_ruleTypeArray_(r.sundayTypes,[])),
    holidayTypes:ft_rulePremiumTypes_(c,ft_ruleTypeArray_(r.holidayTypes,[])),
    nightPct:Number(r.nightPct)||0,sundayPct:Number(r.sundayPct)||0,
    holidayPct:Number(r.holidayPct)||0,standbyRate:Number(r.standbyRate)||0,
    holidayCalendar:String(r.holidayCalendar||'AT'),
    extraHolidays:extra, note:String(r.note||''),source:'SAVED',id:r.id
  };
}
function ft_ruleValidate_(c,p,u){
  const effectiveMonth=ft_month_(String(p.effectiveMonth||''));
  const extra=String(p.extraHolidays||'').split(/[;,\n\s]+/).map(x=>x.trim()).filter(Boolean);
  if(extra.length>50)throw Error('Maximal 50 zusätzliche Sondertage.');
  extra.forEach(x=>ft_date_(x));
  const holidayCalendar=String(p.holidayCalendar||'AT').toUpperCase();
  if(!['AT','NONE'].includes(holidayCalendar))throw Error('Derzeit sind AT und NONE unterstützt.');
  const selected={night:ft_ruleTypeArray_(p.nightTypes,[]),
    sunday:ft_ruleTypeArray_(p.sundayTypes,[]),holiday:ft_ruleTypeArray_(p.holidayTypes,[])};
  if(String(c.slug||'').toLowerCase()==='bsb3100'&&
     Object.values(selected).some(types=>types.includes('STANDBY')))
   throw Error('BSB3100: Bereitschaft wird ohne Nacht-, Sonn- und Feiertagszuschlag bezahlt. Bitte nur aktive Arbeit auswählen.');
  return {
    id:ft_uuid_(),companyId:c.id,effectiveMonth,
    nightTypes:selected.night.join(','),
    sundayTypes:selected.sunday.join(','),
    holidayTypes:selected.holiday.join(','),
    nightPct:ft_number_(p.nightPct,0,1000,'Nachtzuschlag'),
    sundayPct:ft_number_(p.sundayPct,0,1000,'Sonntagszuschlag'),
    holidayPct:ft_number_(p.holidayPct,0,1000,'Feiertagszuschlag'),
    standbyRate:ft_number_(p.standbyRate,0,10000,'Bereitschaftsstundensatz'),
    holidayCalendar,extraHolidays:JSON.stringify([...new Set(extra)].sort()),
    note:ft_str_(p.note,1000),createdBy:u.id,createdAt:ft_now_()
  };
}
function ft_rulesSave_(u,p){
  ft_allowed_(u,['SYSADMIN','ADMIN']);
  const c=ft_company_(u,p.companyId||u.companyId);
  const r=ft_ruleValidate_(c,p,u);
  // Keine bereits freigegebenen Berichte rückwirkend verändern.
  const s=ft_ruleSheet_(true);
  s.appendRow(FT_RULE_HEADERS_.map(k=>r[k]));
  if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.rules=null;
  ft_audit_(u,'CREATE_VERSION','CompanyRules',r.id,{},r);
  return ft_rulesFor_(c,r.effectiveMonth);
}
function ft_rulesApi_(u,p){
  ft_allowed_(u,['SYSADMIN','ADMIN']);
  const c=ft_company_(u,p.companyId||u.companyId);
  return {
    current:ft_rulesFor_(c,ft_month_(p.month||ft_localMonth_(new Date()))),
    history:ft_ruleRows_().filter(x=>x.companyId===c.id)
      .map(x=>({effectiveMonth:x.effectiveMonth,createdAt:x.createdAt,note:x.note}))
      .reverse().slice(0,15)
  };
}
function ft_ruleHoliday_(date,rule){
  return (rule.holidayCalendar==='AT'&&ft_holiday_(date)) ||
    rule.extraHolidays.includes(date);
}
function ft_ruleBuckets_(start,end,c,rule){
  const r={night:0,sunday:0,holiday:0};
  let t=+new Date(start),stop=+new Date(end),loops=0;
  while(t<stop && loops++<10000){
    const next=Math.min(stop,(Math.floor(t/3600000)+1)*3600000);
    const mid=new Date((t+next)/2),hours=(next-t)/3600000;
    const date=Utilities.formatDate(mid,FT_TZ,'yyyy-MM-dd');
    const hr=Number(Utilities.formatDate(mid,FT_TZ,'H'));
    const weekday=Number(Utilities.formatDate(mid,FT_TZ,'u'));
    const ns=Number(c.nightStart===undefined?22:c.nightStart);
    const ne=Number(c.nightEnd===undefined?6:c.nightEnd);
    if(ns<=ne?(hr>=ns&&hr<ne):(hr>=ns||hr<ne))r.night+=hours;
    if(weekday===7)r.sunday+=hours;
    if(ft_ruleHoliday_(date,rule))r.holiday+=hours;
    t=next;
  }
  if(t<stop)throw Error('Zeitraum für Zuschläge zu lang.');
  return r;
}
function ft_ruleSegments_(start,end,incidents){
  let segments=[[+new Date(start),+new Date(end)]];
  for(const a of incidents){
    const as=+new Date(a.start),ae=+new Date(a.end);
    const next=[];
    for(const [s,e] of segments){
      if(ae<=s||as>=e){next.push([s,e]);continue;}
      if(as>s)next.push([s,Math.min(as,e)]);
      if(ae<e)next.push([Math.max(ae,s),e]);
    }
    segments=next;
  }
  return segments;
}

// -----------------------------------------------------------------
// 15_Arbeitsdienste
// -----------------------------------------------------------------
/** FireTime Pro V1.4 | Arbeitsdienstplan (unabhängig von Bereitschaft) */
const FT_WORK_COLS_=['id','companyId','userId','start','end','title','status','eventId','createdAt','updatedAt'];
function ft_workSheet_(create){
 const db=ft_db_();let sh=db.getSheetByName('WorkShifts');
 if(!sh&&create){sh=db.insertSheet('WorkShifts');sh.appendRow(FT_WORK_COLS_);sh.setFrozenRows(1);}
 return sh;
}
function ft_workRows_(){
 const sh=ft_workSheet_(false);if(!sh||sh.getLastRow()<2)return [];
 return sh.getRange(2,1,sh.getLastRow()-1,FT_WORK_COLS_.length).getValues().map((r,i)=>{
  const x={__row:i+2};FT_WORK_COLS_.forEach((k,j)=>x[k]=r[j] instanceof Date?r[j].toISOString():r[j]);return x;
 });
}
function ft_workOne_(id){return ft_workRows_().find(x=>x.id===id);}
function ft_workSave_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);
 const c=ft_company_(actor,p.companyId||actor.companyId);ft_need_(actor,c,'WORKPLAN');
 const u=ft_user_(actor,p.userId);
 if(u.companyId!==c.id)throw Error('Mitarbeiter gehört nicht zu dieser Firma.');
 const start=ft_datetime_(p.start),end=ft_datetime_(p.end);
 if(end<=start||(end-start)>48*3600000)throw Error('Schichtdauer muss über 0 und maximal 48 Stunden sein.');
 if(ft_workRows_().some(x=>x.id!==p.id&&x.companyId===c.id&&x.userId===u.id&&
  +new Date(x.start)<+end&&+new Date(x.end)>+start))throw Error('Schicht überschneidet einen bestehenden Arbeitsdienst.');
 const old=p.id?ft_workOne_(p.id):null;
 if(p.id&&(!old||old.companyId!==c.id))throw Error('Schicht nicht gefunden.');
 if(old&&old.status==='PUBLISHED')throw Error('Veröffentlichte Schichten können nicht stillschweigend bearbeitet werden. Bitte erst eine Korrekturfunktion ergänzen.');
 const row={id:old?old.id:ft_uuid_(),companyId:c.id,userId:u.id,
  start:start.toISOString(),end:end.toISOString(),title:ft_str_(p.title||'Arbeitsdienst',100),
  status:'DRAFT',eventId:'',createdAt:old?old.createdAt:ft_now_(),updatedAt:ft_now_()};
 const sh=ft_workSheet_(true);
 if(old)sh.getRange(old.__row,1,1,FT_WORK_COLS_.length).setValues([FT_WORK_COLS_.map(k=>row[k])]);
 else sh.appendRow(FT_WORK_COLS_.map(k=>row[k]));
 ft_audit_(actor,'WORK_SAVE','WorkShifts',row.id,old||{},row);
 return row;
}
function ft_workDelete_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);
 const row=ft_workOne_(p.id);if(!row)throw Error('Schicht nicht gefunden.');
 const c=ft_company_(actor,row.companyId);ft_need_(actor,c,'WORKPLAN');
 if(row.status==='PUBLISHED')throw Error('Veröffentlichter Dienst muss dokumentiert storniert werden.');
 ft_workSheet_(false).deleteRow(row.__row);
 ft_audit_(actor,'WORK_DELETE','WorkShifts',row.id,row,{});return true;
}
function ft_workPublish_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);
 const c=ft_company_(actor,p.companyId||actor.companyId);ft_need_(actor,c,'WORKPLAN');
 const month=ft_month_(p.month),all=ft_workRows_().filter(x=>x.companyId===c.id&&x.start.slice(0,7)===month&&x.status==='DRAFT');
 let published=0;const warnings=[];
 const calendarEnabled=ft_enabled_(c,'CALENDAR')&&ft_bool_(c.calendarOn);
 const cal=calendarEnabled?ft_calendar_(c):null;
 for(const s of all){
  const u=ft_one_('Users',s.userId);
  if(!u||u.status!=='ACTIVE'){warnings.push(s.title+': Mitarbeiter nicht aktiv');continue;}
  s.status='PUBLISHED';s.updatedAt=ft_now_();
  ft_workSheet_(false).getRange(s.__row,1,1,FT_WORK_COLS_.length).setValues([FT_WORK_COLS_.map(k=>s[k])]);
  ft_audit_(actor,'WORK_PUBLISH','WorkShifts',s.id,{},s);published++;
  try{
   if(cal){
    const event=cal.createEvent(c.name+' – '+s.title,new Date(s.start),new Date(s.end),
     {description:'Arbeitsdienstplan aus FireTime Pro',guests:u.email,sendInvites:true});
    event.addPopupReminder(1440);s.eventId=event.getId();
    ft_workSheet_(false).getRange(s.__row,8).setValue(s.eventId);
   }else{
    const ok=ft_notification_(c,u,'WORK_INVITE',s.id,
     'Diensteinteilung: '+s.title+' – '+c.name,
     'Hallo '+u.name+'!\n\nDu bist zum Arbeitsdienst eingeteilt:\n'+
     Utilities.formatDate(new Date(s.start),FT_TZ,'dd.MM.yyyy HH:mm')+' bis '+
     Utilities.formatDate(new Date(s.end),FT_TZ,'dd.MM.yyyy HH:mm')+
     '\n\nDeinen Dienstplan findest du in FireTime Pro.\n'+ft_clientUrl_(c));
    if(!ok)warnings.push(s.title+': E-Mail konnte nicht versendet werden.');
   }
  }catch(e){warnings.push(s.title+': '+e.message);}
 }
 return {published,warnings};
}
function ft_publishStandby_(actor,p){
 const c=ft_company_(actor,p.companyId||actor.companyId);ft_need_(actor,c,'STANDBY');
 const out=ft_planPublish_(actor,p),month=ft_month_(p.month);
 const shifts=ft_get_('Shifts').filter(s=>s.companyId===c.id&&s.status==='PUBLISHED'&&s.userId&&s.day.startsWith(month));
 for(const s of shifts){
  const u=ft_one_('Users',s.userId);if(!u||u.status!=='ACTIVE')continue;
  // Bei aktivem Google-Kalender wurde schon eine echte Kalendereinladung geschickt.
  if(ft_enabled_(c,'CALENDAR')&&ft_bool_(c.calendarOn)&&s.eventId)continue;
  const ok=ft_notification_(c,u,'STANDBY_INVITE',s.id+'-'+s.start,
   'Bereitschaftseinteilung – '+c.name,
   'Hallo '+u.name+'!\n\nDu bist zur Bereitschaft eingeteilt:\n'+
   Utilities.formatDate(new Date(s.start),FT_TZ,'dd.MM.yyyy HH:mm')+' bis '+
   Utilities.formatDate(new Date(s.end),FT_TZ,'dd.MM.yyyy HH:mm')+
   '\n\nDetails im FireTime-Pro-Dienstplan:\n'+ft_clientUrl_(c));
  if(!ok)out.warnings.push(s.day+': E-Mail nicht versendet.');
 }
 return out;
}

// -----------------------------------------------------------------
// 16_Gateway
// -----------------------------------------------------------------
/**
 * FireTime Pro – GitHub/Cloudflare -> Google Apps Script gateway
 * Existing FireTime V1.4 auth, rights and Sheets functions remain in place.
 * Install in THE EXISTING FireTime Apps Script project. Do not run ft_setup().
 * Configure script property FT_GATEWAY_KEY (same 48+ char secret as Worker).
 */

// -----------------------------------------------------------------
// 17_Dienstuebergabe und Krankenstand | additive Datenbankerweiterung
// -----------------------------------------------------------------
/** Einmalig NACH dem Code-Update in Apps Script ausfuehren.
 *  Schreibt KEINE bestehenden Daten um und fuehrt ft_setup nicht aus.
 */
function ft_featureInstall(){
 const db=ft_db_();let created=[];
 for(const name of ['ShiftSegments','ShiftChanges','SickLeaves']){
  let sh=db.getSheetByName(name);
  if(!sh){sh=db.insertSheet(name);sh.getRange(1,1,1,FT_HEADERS[name].length)
    .setValues([FT_HEADERS[name]]);sh.setFrozenRows(1);created.push(name);}
  else {const actual=sh.getRange(1,1,1,FT_HEADERS[name].length).getValues()[0];
   if(actual.join('|')!==FT_HEADERS[name].join('|'))throw Error('Tabellenspalten passen nicht: '+name);}
 }
 return {ok:true,newTables:created};
}
function ft_featureReady_(){
 for(const name of ['ShiftSegments','ShiftChanges','SickLeaves'])
  if(!ft_db_().getSheetByName(name))throw Error('Neue Funktionen noch nicht eingerichtet: ft_featureInstall einmal ausfuehren.');
}
function ft_isoInput_(value){
 const str=String(value||'');
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str))throw Error('Datum und Uhrzeit fehlen.');
 // Apps Script timezone should be Europe/Vienna, configured in appsscript.json.
 return ft_datetime_(str).toISOString();
}
function ft_segmentRows_(s){
 return ft_get_('ShiftSegments').filter(x=>x.shiftId===s.id).sort((a,b)=>String(a.start).localeCompare(String(b.start)));
}
function ft_segmentEnsure_(s){
 let rows=ft_segmentRows_(s);
 if(!rows.length){
  const r={id:ft_uuid_(),companyId:s.companyId,shiftId:s.id,userId:s.userId,
   start:s.start,end:s.end,actualStatus:s.actualStatus==='DONE'?'DONE':'PLANNED',
   confirmedAt:s.confirmedAt||'',calendarEventId:'',updatedAt:ft_now_()};
  ft_add_('ShiftSegments',r);rows=[ft_one_('ShiftSegments',r.id)];
  if(!rows[0]||!rows[0].__row)throw Error('Dienstabschnitt wurde nicht korrekt gespeichert.');
 }
 return rows;
}
function ft_monthIsFinal_(cid,uid,date){
 return ft_get_('Months').some(x=>x.companyId===cid&&x.userId===uid&&
   x.month===ft_localMonth_(new Date(date))&&['APPROVED','FINAL'].includes(x.status));
}
function ft_monthEditableRange_(cid,uid,start,end){
 const endD=new Date(new Date(end).getTime()-1);
 for(const month of new Set([ft_localMonth_(new Date(start)),ft_localMonth_(endD)]))
  ft_requireMonthOpen_(cid,uid,month);
}
function ft_sickOverlap_(cid,uid,start,end){
 return ft_get_('SickLeaves').some(x=>x.companyId===cid&&x.userId===uid&&x.status!=='REJECTED'&&
   ft_overlap_(start,end,x.from,x.to)>0);
}
function ft_handoverRequest_(actor,p){
 ft_featureReady_();
 const s=ft_one_('Shifts',p.shiftId);
 if(!s||s.status!=='PUBLISHED')throw Error('Nur veroeffentlichte Bereitschaften koennen uebergeben werden.');
 const c=ft_company_(actor,s.companyId);ft_need_(actor,c,'STANDBY');
 const to=ft_user_(actor,p.toUserId);
 if(to.companyId!==c.id||to.status!=='ACTIVE'||to.id===actor.id&&actor.role==='STAFF')
  throw Error('Aktiven anderen Mitarbeiter aus derselben Firma waehlen.');
 const fromId=actor.role==='STAFF'?actor.id:String(p.fromUserId||actor.id);
 const from=ft_user_(actor,fromId);
 if(from.companyId!==c.id||from.id===to.id)throw Error('Uebergabe an dieselbe Person ist nicht moeglich.');
 const start=ft_isoInput_(p.start),end=ft_isoInput_(p.end);
 if(new Date(end)<=new Date(start)||+new Date(end)-new Date(start)>48*3600000)throw Error('Ungueltiger Uebergabezeitraum.');
 if(new Date(start)<new Date(s.start)||new Date(end)>new Date(s.end))throw Error('Uebergabe muss innerhalb des geplanten Dienstes liegen.');
 // Unbestaetigte, noch nicht abgeschlossene Dienste sind tauschbar; rueckwirkend erlaubt fuer Monatskorrekturen.
 ft_monthEditableRange_(c.id,from.id,start,end);ft_monthEditableRange_(c.id,to.id,start,end);
 if(ft_sickOverlap_(c.id,to.id,start,end))throw Error('Uebernehmende Person ist in diesem Zeitraum krank gemeldet.');
 const segments=ft_segmentRows_(s);
 const own=segments.length?segments: [{userId:s.userId,start:s.start,end:s.end,actualStatus:s.actualStatus||'PLANNED'}];
 if(!own.some(x=>x.userId===from.id&&new Date(start)>=new Date(x.start)&&new Date(end)<=new Date(x.end)&&x.actualStatus!=='DONE'))
  throw Error('Du kannst nur einen eigenen, noch nicht bestaetigten Dienstabschnitt uebergeben.');
 if(ft_get_('ShiftChanges').some(x=>x.shiftId===s.id&&x.status==='PENDING'&&ft_overlap_(x.start,x.end,start,end)>0))
  throw Error('Fuer diesen Zeitraum gibt es bereits eine offene Uebergabe.');
 const row={id:ft_uuid_(),companyId:c.id,shiftId:s.id,fromUserId:from.id,toUserId:to.id,
  start,end,reason:ft_str_(p.reason,200),status:'PENDING',createdAt:ft_now_(),
  respondedAt:'',reviewedAt:'',reviewerId:''};
 ft_add_('ShiftChanges',row);ft_audit_(actor,'REQUEST','ShiftChanges',row.id,{},row);
 try{ft_notification_(c,to,'HANDOVER_REQUEST',row.id,'FireTime Pro – Anfrage zur Bereitschaftsuebernahme',
  'Du hast eine Bereitschaftsanfrage erhalten. Bitte in FireTime Pro zustimmen oder ablehnen. '+ft_publicGithubUrl_());}
 catch(e){Logger.log('Uebergabe gespeichert, E-Mail ausstehend: '+e.message);}
 return ft_publicRow_(row);
}
function ft_handoverRespond_(actor,p){
 ft_featureReady_();
 const req=ft_one_('ShiftChanges',p.id);
 if(!req||req.status!=='PENDING')throw Error('Anfrage nicht gefunden oder bereits bearbeitet.');
 const c=ft_company_(actor,req.companyId);ft_need_(actor,c,'STANDBY');
 if(actor.id!==req.toUserId)throw Error('Nur der angefragte Kollege kann zustimmen oder ablehnen.');
 const accept=String(p.status)==='ACCEPTED';
 if(!accept&&String(p.status)!=='DECLINED')throw Error('Bitte zustimmen oder ablehnen.');
 const s=ft_one_('Shifts',req.shiftId);
 if(!s||s.status!=='PUBLISHED')throw Error('Der Dienst ist nicht mehr gueltig.');
 let warning='';
 if(accept){
  if(ft_sickOverlap_(c.id,req.toUserId,req.start,req.end))throw Error('Uebernahme waehrend Krankenstand nicht moeglich.');
  ft_monthEditableRange_(c.id,req.fromUserId,req.start,req.end);
  ft_monthEditableRange_(c.id,req.toUserId,req.start,req.end);
  const segs=ft_segmentEnsure_(s);
  const old=segs.find(x=>x.userId===req.fromUserId&&x.actualStatus!=='DONE'&&
   new Date(req.start)>=new Date(x.start)&&new Date(req.end)<=new Date(x.end));
  if(!old)throw Error('Der Dienst wurde mittlerweile veraendert. Neue Anfrage erforderlich.');
  // Save original segment as left side or switch to right side, then add remaining segments.
  const before=ft_publicRow_(old),a=+new Date(old.start),b=+new Date(old.end),lo=+new Date(req.start),hi=+new Date(req.end);
  const parts=[];
  if(a<lo)parts.push({userId:old.userId,start:old.start,end:req.start});
  parts.push({userId:req.toUserId,start:req.start,end:req.end});
  if(hi<b)parts.push({userId:old.userId,start:req.end,end:old.end});
  // Preserve old segment event ID so calendar sync can delete/update correctly.
  if(old.userId!==parts[0].userId&&old.calendarEventId&&ft_enabled_(c,'CALENDAR')&&ft_bool_(c.calendarOn)){
  try{const cal=ft_calendar_(c),ev=cal.getEventById(old.calendarEventId);if(ev)ev.deleteEvent();old.calendarEventId='';}
  catch(ex){throw Error('Alter Kalendereintrag konnte nicht entfernt werden: '+ex.message);}
 }
 old.userId=parts[0].userId;old.start=parts[0].start;old.end=parts[0].end;
  old.actualStatus='PLANNED';old.confirmedAt='';old.updatedAt=ft_now_();ft_save_('ShiftSegments',old);
  for(const part of parts.slice(1))ft_add_('ShiftSegments',{id:ft_uuid_(),companyId:c.id,shiftId:s.id,
    ...part,actualStatus:'PLANNED',confirmedAt:'',calendarEventId:'',updatedAt:ft_now_()});
  // Legacy Shifts is still the plan parent but must no longer be counted for reports.
  s.actualStatus='PLANNED';s.confirmedAt='';s.updatedAt=ft_now_();ft_save_('Shifts',s);
  ft_audit_(actor,'HANDOVER_SPLIT','ShiftSegments',old.id,before,{parts});
 }
 const prev=ft_publicRow_(req);req.status=accept?'ACCEPTED':'DECLINED';req.respondedAt=ft_now_();ft_save_('ShiftChanges',req);
 ft_audit_(actor,accept?'ACCEPT':'DECLINE','ShiftChanges',req.id,prev,req);
 if(accept)warning='Einteilung geändert: Kalenderabgleich über den separaten Button erforderlich.';
 try{const source=ft_one_('Users',req.fromUserId);if(source)ft_notification_(c,source,'HANDOVER_ANSWER',req.id+'-'+req.status,
   'FireTime Pro – Bereitschaftsuebergabe '+(accept?'angenommen':'abgelehnt'),
   'Deine Anfrage wurde '+(accept?'angenommen':'abgelehnt')+'. '+ft_publicGithubUrl_());}
 catch(e){Logger.log('Benachrichtigung ausstehend: '+e.message);}
 return {ok:true,warning,request:ft_publicRow_(req)};
}
function ft_segmentConfirm_(actor,p){
 ft_featureReady_();
 const s=ft_one_('ShiftSegments',p.id);if(!s)throw Error('Dienstabschnitt nicht gefunden.');
 const c=ft_company_(actor,s.companyId);ft_need_(actor,c,'STANDBY');
 if(actor.role==='STAFF'&&s.userId!==actor.id)throw Error('Nur eigenen Abschnitt bestaetigen.');
 if(s.actualStatus==='DONE')return {ok:true,unchanged:true};
 if(+new Date(s.end)>Date.now())throw Error('Dienstabschnitt ist noch nicht beendet.');
 if(ft_sickOverlap_(c.id,s.userId,s.start,s.end))throw Error('Krankenstand ueberschneidet diesen Dienst. Bitte erst klaeren.');
 ft_monthEditableRange_(c.id,s.userId,s.start,s.end);
 const before=ft_publicRow_(s);s.actualStatus='DONE';s.confirmedAt=ft_now_();ft_save_('ShiftSegments',s);
 ft_audit_(actor,'CONFIRM','ShiftSegments',s.id,before,s);return {ok:true};
}
function ft_sickReport_(actor,p){
 ft_featureReady_();
 const id=actor.role==='STAFF'?actor.id:String(p.userId||actor.id);
 const u=ft_user_(actor,id),c=ft_company_(actor,u.companyId);
 ft_need_(actor,c,'SICK');
 if(!ft_enabled_(c,'TIME')&&!ft_enabled_(c,'STANDBY'))throw Error('Kein Zeit- oder Bereitschaftsmodul freigeschaltet.');
 const from=ft_isoInput_(p.from),to=ft_isoInput_(p.to);
 if(new Date(to)<=new Date(from)||+new Date(to)-new Date(from)>31*86400000)
  throw Error('Ungueltiger Krankenstandszeitraum (maximal 31 Tage je Meldung).');
 ft_monthEditableRange_(c.id,u.id,from,to);
 if(ft_get_('SickLeaves').some(x=>x.companyId===c.id&&x.userId===u.id&&x.status!=='REJECTED'&&ft_overlap_(from,to,x.from,x.to)>0))
  throw Error('Ueberlappender Krankenstand vorhanden.');
 const row={id:ft_uuid_(),companyId:c.id,userId:u.id,from,to,note:ft_str_(p.note,250),
  status:'PENDING',reportedBy:actor.id,createdAt:ft_now_(),reviewerId:'',reviewedAt:'',
  creditMode:'NONE',creditHours:0,standbyCreditHours:0,reviewNote:''};
 ft_add_('SickLeaves',row);ft_audit_(actor,'SICK_REPORT','SickLeaves',row.id,{},row);
 let warning='';if(ft_bool_(c.calendarOn))warning='Krankenstand aktualisiert: Kalenderhinweise über den separaten Kalender-Button aktualisieren.';
 return {row:ft_publicRow_(row),message:'Krankenstand gemeldet; betroffene Bereitschaftsdienste bitte neu besetzen.',warning};
}
function ft_sickReview_(actor,p){
 ft_featureReady_();ft_allowed_(actor,['SYSADMIN','ADMIN']);
 const row=ft_one_('SickLeaves',p.id);if(!row)throw Error('Krankenstand nicht gefunden.');
 const c=ft_company_(actor,row.companyId);
 ft_need_(actor,c,'SICK');
 const status=String(p.status||'APPROVED');if(!['APPROVED','REJECTED'].includes(status))throw Error('Ungueltiger Status.');
 if(row.status!=='PENDING')throw Error('Bereits bearbeitet. Korrekturen ueber Monatsfreigabe mit Protokoll.');
 const mode=status==='REJECTED'?'NONE':String(p.creditMode||'NONE');
 if(!['NONE','WORK','STANDBY','BOTH'].includes(mode))throw Error('Anrechnungsart ungueltig.');
 const credit=mode==='WORK'||mode==='BOTH'?ft_number_(p.creditHours,0,300,'Arbeitszeitgutschrift'):0;
 const standby=mode==='STANDBY'||mode==='BOTH'?ft_number_(p.standbyCreditHours,0,744,'Bereitschaftsgutschrift'):0;
 const duration=ft_hours_(row.from,row.to);
 if(credit>duration+0.01||standby>duration+0.01)throw Error('Mehr Stunden als der gemeldete Zeitraum.');
 for(const uid of [row.userId])ft_monthEditableRange_(c.id,uid,row.from,row.to);
 const prev=ft_publicRow_(row);Object.assign(row,{status,creditMode:mode,creditHours:credit,
  standbyCreditHours:standby,reviewerId:actor.id,reviewedAt:ft_now_(),reviewNote:ft_str_(p.reviewNote,500)});
 ft_save_('SickLeaves',row);ft_audit_(actor,'SICK_REVIEW','SickLeaves',row.id,prev,row);
 // Kalender wird nur auf ausdrückliche Freigabe des Administrators aktualisiert.
 return ft_publicRow_(row);
}
function ft_shiftPeriodSummary_(actor,p){
 ft_featureReady_();const c=ft_company_(actor,p.companyId||actor.companyId);
 const month=ft_month_(p.month||ft_localMonth_(new Date()));
 const admin=actor.role!=='STAFF';
 const shifts=ft_get_('Shifts').filter(x=>x.companyId===c.id&&x.status==='PUBLISHED'&&x.day.slice(0,7)===month);
 const ids=new Set(shifts.map(x=>x.id));
 const segments=ft_get_('ShiftSegments').filter(x=>ids.has(x.shiftId)&&(admin||x.userId===actor.id)).map(ft_publicRow_);
 const changes=ft_get_('ShiftChanges').filter(x=>x.companyId===c.id&&(
    (String(x.start).slice(0,7)===month)||(String(x.end).slice(0,7)===month)||
    x.status==='PENDING')&&(admin||x.fromUserId===actor.id||x.toUserId===actor.id)).map(ft_publicRow_);
 const sick=ft_get_('SickLeaves').filter(x=>x.companyId===c.id&&(
    ft_localMonth_(new Date(x.from))===month||ft_localMonth_(new Date(x.to))===month||x.status==='PENDING')&&
    (admin||x.userId===actor.id)).map(ft_publicRow_);
 return {segments,changes,sick};
}
/** Legacy Shifts remain for untouched days. Modified days are counted ONLY via confirmed segments. */
function ft_accountableShifts_(source){
 const parts=source.ShiftSegments||ft_get_('ShiftSegments');
 const modified=new Set(parts.map(x=>x.shiftId));
 return source.Shifts.filter(s=>!modified.has(s.id)).concat(parts.map(x=>({
  companyId:x.companyId,userId:x.userId,start:x.start,end:x.end,
  status:'PUBLISHED',actualStatus:x.actualStatus,shiftId:x.shiftId
 })));
}
function ft_calendarUpdateSick_(c,row){
 if(!ft_enabled_(c,'CALENDAR')||!ft_bool_(c.calendarOn))return;
 const cal=ft_calendar_(c),shifts=ft_get_('Shifts').filter(s=>s.companyId===c.id&&s.status==='PUBLISHED'&&ft_overlap_(s.start,s.end,row.from,row.to)>0);
 for(const s of shifts){
  const parts=ft_segmentRows_(s);
  if(parts.length){ft_syncShiftParts_(c,s);continue;}
  if(s.userId!==row.userId||!s.eventId)continue;
  const event=cal.getEventById(s.eventId);if(!event)continue;
  const u=ft_one_('Users',s.userId);if(!u)continue;
  event.setTitle((ft_sickOverlap_(c.id,u.id,s.start,s.end)?'⚠ Vertretung offen · ':'')+c.name+' – Bereitschaft ('+u.name+')');
 }
}
function ft_calendarResync_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_company_(actor,p.companyId||actor.companyId);
 ft_need_(actor,c,'CALENDAR');const month=ft_month_(p.month);if(!ft_bool_(c.calendarOn))throw Error('Firmenkalender ist nicht aktiviert.');
 const list=ft_get_('Shifts').filter(x=>x.companyId===c.id&&x.status==='PUBLISHED'&&x.day.startsWith(month)&&ft_segmentRows_(x).length);
 let count=0,warnings=[];
 for(const s of list){try{ft_syncShiftParts_(c,s);count++;}catch(e){warnings.push(s.day+': '+e.message);}}
 return {count,warnings};
}
function ft_calendarSyncParts_(c,s){
 // Intentionally separate event ID per segment; original event is obsolete.
 return ft_syncShiftParts_(c,s);
}
function ft_syncShiftParts_(c,s){
 if(!ft_enabled_(c,'CALENDAR')||!ft_bool_(c.calendarOn))return;
 const cal=ft_calendar_(c),parts=ft_segmentRows_(s);
 if(s.eventId){const old=cal.getEventById(s.eventId);if(old)old.deleteEvent();s.eventId='';ft_save_('Shifts',s);}
 for(const part of parts){
  let ev=part.calendarEventId?cal.getEventById(part.calendarEventId):null;
  const u=ft_one_('Users',part.userId);if(!u)continue;
  const title=(ft_sickOverlap_(c.id,part.userId,part.start,part.end)?'⚠ Vertretung offen · ':'')+c.name+' – Bereitschaft ('+u.name+')';
  const details='Dienstabschnitt ueber FireTime Pro. '+Utilities.formatDate(new Date(part.start),FT_TZ,'dd.MM.yyyy HH:mm')+' – '+Utilities.formatDate(new Date(part.end),FT_TZ,'dd.MM.yyyy HH:mm');
  if(ev){ev.setTitle(title);ev.setTime(new Date(part.start),new Date(part.end));ev.setDescription(details);}
  else {ev=cal.createEvent(title,new Date(part.start),new Date(part.end),{description:details,guests:u.email,sendInvites:true});
   ev.addPopupReminder(1440);part.calendarEventId=ev.getId();ft_save_('ShiftSegments',part);}
 }
}

function doPost(e) {
  // Bei jeder signierten Anfrage einen frischen, mandantenunabhaengigen Lesecache beginnen.
  FT_REQUEST_CACHE={db:null,sheets:Object.create(null),tables:Object.create(null),profiles:null,rules:null};
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Leere Anfrage.');
    }
    const body = e.postData.contents;
    if (body.length > 3900000) throw new Error('Anfrage zu groß.');
    const envelope = JSON.parse(body);
    if (!envelope || typeof envelope !== 'object') {
      throw new Error('Anfrage ungültig.');
    }
    const ts = Number(envelope.ts);
    const nonce = String(envelope.nonce || '');
    const payload = String(envelope.payload || '');
    const signature = String(envelope.signature || '').toLowerCase();
    if (!Number.isSafeInteger(ts) || Math.abs(Math.floor(Date.now()/1000)-ts)>300 ||
        !/^[a-f0-9]{32}$/.test(nonce) ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        payload.length > 3650000) {
      throw new Error('Signatur oder Zeitstempel ungültig.');
    }
    const secret = PropertiesService.getScriptProperties().getProperty('FT_GATEWAY_KEY') || '';
    if (secret.length < 48) throw new Error('Gateway-Schlüssel fehlt.');
    const expected = Utilities.computeHmacSha256Signature(
      ts+'.'+nonce+'.'+payload,secret,Utilities.Charset.UTF_8
    ).map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
    // No early exit on individual mismatches; do not log secrets or passwords.
    let diff=0;
    for (let i=0;i<64;i++) diff |= expected.charCodeAt(i)^signature.charCodeAt(i);
    if (diff!==0) throw new Error('Signatur ungültig.');
    const lock=LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const cache=CacheService.getScriptCache();
      const nonceKey='ftgw_'+nonce;
      if (cache.get(nonceKey)) throw new Error('Anfrage bereits verarbeitet.');
      cache.put(nonceKey,'1',360);
    } finally {lock.releaseLock();}
    const req=JSON.parse(payload);
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      throw new Error('Anfrage ungültig.');
    }
    let result;
    switch(String(req.type||'')) {
      case 'login':
        result=ft_login(req.email,req.password);
        break;
      case 'activate':
        result=ft_activate(req.invite,req.password);
        break;
      case 'logout':
        result=ft_logout(req.token);
        break;
      case 'password':
        result=ft_changePassword(req.token,req.current,req.next);
        break;
      case 'brand':
        result=ft_brandForLogin(req.slug);
        break;
      case 'api':
        // The existing ft_api() authenticates the opaque session token,
        // checks tenant scope, role and purchased company modules.
        result=ft_api(req.token,req.action,req.data||{});
        break;
      default:
        throw new Error('Unbekannte Anfragetyp.');
    }
    return ft_gatewayResponse_({ok:true,data:result});
  } catch(err) {
    const msg=String(err && err.message || 'Unbekannter Fehler').slice(0,350);
    const status=/Sitzung|anmelden|Passwort|E-Mail-Adresse oder Passwort|Zugang/.test(msg)
      ? 401 : /Berechtigung|Kein Zugriff|freigeschaltet/.test(msg) ? 403 : 400;
    return ft_gatewayResponse_({ok:false,error:msg,status:status});
  }
}
function ft_gatewayResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}


// -----------------------------------------------------------------
// 18_URLaubskonto_und_Abwesenheitsarchiv
// -----------------------------------------------------------------
/** FireTime Pro | Urlaubsjahre, revisionsfeste Buchungen, Abwesenheitsauszuege.
 *  Altbestände werden nie neu gutgeschrieben. Vor Aktivierung gespeicherte
 *  Urlaubstage bleiben im bisherigen Gesamtsaldo und heißen LEGACY.
 *  Keine automatische Verjährung, keine unbelegte Rückrechnung alter Jahre.
 */
const FT_LEAVE_LEDGER_COLS_=['id','companyId','userId','kind','days','effectiveDate','periodStart','referenceId','carryoverBefore','note','actorId','createdAt'];
const FT_LEAVE_POLICY_COLS_=['id','companyId','yearMode','autoGrant','activationDate','updatedBy','updatedAt'];
// Per-employee agreement. Dedicated table avoids changing historical Users columns.
const FT_LEAVE_STAFF_RULE_COLS_=['id','companyId','userId','yearMode','ruleType','legalBasis','note','updatedBy','updatedAt'];
const FT_LEAVE_FLEX_COLS_=['id','companyId','userId','mode','referenceDays','basis','balanceReviewed','updatedBy','updatedAt'];
const FT_LEAVE_FLEX_APPROVAL_COLS_=['id','companyId','userId','leaveId','days','creditHours','referenceDays','basis','reviewerId','reviewedAt'];
const FT_ABSENCE_PDF_COLS_=['id','companyId','userId','fromYear','toYear','fileId','name','createdAt','version','requestId'];
function ft_absenceSheet_(name,cols,create){
 const db=ft_db_();let sheet=db.getSheetByName(name);
 if(!sheet&&create){sheet=db.insertSheet(name);sheet.getRange(1,1,1,cols.length).setValues([cols]);sheet.setFrozenRows(1);}
 if(sheet){const actual=sheet.getRange(1,1,1,cols.length).getValues()[0];
  if(actual.join('|')!==cols.join('|'))throw Error('Spalten von '+name+' stimmen nicht; bitte nicht automatisch überschreiben.');}
 return sheet;
}
function ft_absenceRows_(name,cols,create){
 const sh=ft_absenceSheet_(name,cols,create);
 if(!sh||sh.getLastRow()<2)return [];
 const vals=sh.getRange(2,1,sh.getLastRow()-1,cols.length).getValues();
 return vals.map((cells,i)=>{const out={__row:i+2};cols.forEach((k,j)=>{
  let v=cells[j];if(v instanceof Date)v=k==='effectiveDate'||k==='periodStart'||k==='activationDate'?Utilities.formatDate(v,FT_TZ,'yyyy-MM-dd'):v.toISOString();
  out[k]=v;});return out;
 }).filter(r=>r.id!=='');
}
function ft_absenceAdd_(name,cols,row){
 ft_absenceSheet_(name,cols,true).appendRow(cols.map(k=>row[k]===undefined?'':row[k]));
 if(FT_REQUEST_CACHE){delete FT_REQUEST_CACHE.tables.FT_LEAVE_POLICY_CACHE;delete FT_REQUEST_CACHE.tables.FT_LEAVE_STAFF_RULES;}
 return row;
}
function ft_absenceSave_(name,cols,row){
 if(!row.__row)throw Error('Archivzeile fehlt.');
 ft_absenceSheet_(name,cols,true).getRange(row.__row,1,1,cols.length).setValues([cols.map(k=>row[k]===undefined?'':row[k])]);
 if(FT_REQUEST_CACHE){delete FT_REQUEST_CACHE.tables.FT_LEAVE_POLICY_CACHE;delete FT_REQUEST_CACHE.tables.FT_LEAVE_STAFF_RULES;}
 return row;
}

function ft_leaveStaffRules_(create){
 const key='FT_LEAVE_STAFF_RULES';
 if(FT_REQUEST_CACHE&&FT_REQUEST_CACHE.tables[key])return FT_REQUEST_CACHE.tables[key];
 const rows=ft_absenceRows_('LeaveStaffRules',FT_LEAVE_STAFF_RULE_COLS_,create);
 if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.tables[key]=rows;
 return rows;
}
function ft_leaveFlexRules_(create){
 const key='FT_LEAVE_FLEX_RULES';
 if(FT_REQUEST_CACHE&&FT_REQUEST_CACHE.tables[key])return FT_REQUEST_CACHE.tables[key];
 const rows=ft_absenceRows_('LeaveFlexRules',FT_LEAVE_FLEX_COLS_,create);
 if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.tables[key]=rows;
 return rows;
}
function ft_leaveFlexFor_(user){
 const rule=ft_leaveFlexRules_(false).find(r=>r.companyId===user.companyId&&r.userId===user.id);
 const days=Number(rule?.referenceDays)||0;
 return {leaveWorkModel:rule?.mode==='FLEX'?'FLEX':'FIXED',leaveFlexReferenceDays:days,
  leaveFlexBasis:String(rule?.basis||''),leaveFlexBalanceReviewed:ft_bool_(rule?.balanceReviewed),leaveFlexConfigured:rule?.mode==='FLEX'&&days>0&&String(rule.basis||'').length>=12&&ft_bool_(rule?.balanceReviewed)};
}
function ft_leaveFlexValidate_(p,user,existing){
 const prior=existing?ft_leaveFlexFor_(user):{leaveWorkModel:'FIXED',leaveFlexReferenceDays:0,leaveFlexBasis:'',leaveFlexBalanceReviewed:false};
 const mode=p.leaveWorkModel===undefined?prior.leaveWorkModel:String(p.leaveWorkModel);
 if(!['FLEX','FIXED'].includes(mode))throw Error('Ungültiges Urlaubs-Arbeitszeitmodell.');
 const reference=p.leaveFlexReferenceDays===undefined?Number(prior.leaveFlexReferenceDays||0):Number(p.leaveFlexReferenceDays);
 if(!Number.isInteger(reference)||reference<0||reference>6)throw Error('Rechnerische Urlaubstage/Woche müssen ganzzahlig zwischen 0 und 6 liegen.');
 const basis=ft_str_(p.leaveFlexBasis===undefined?prior.leaveFlexBasis:p.leaveFlexBasis,300);
 const reviewed=p.leaveFlexBalanceReviewed===undefined?Boolean(prior.leaveFlexBalanceReviewed):p.leaveFlexBalanceReviewed===true||p.leaveFlexBalanceReviewed==='YES';
 if(mode==='FLEX'&&reference>0&&basis.length<12)throw Error('Bitte dokumentierte Bewertungsgrundlage für flexible Urlaubstage angeben (mindestens 12 Zeichen).');
 if(mode==='FLEX'&&reviewed&&reference===0)throw Error('Vor einer Saldenbestätigung müssen die rechnerischen Urlaubstage/Woche vereinbart sein.');
 if(existing){
  const changes=mode!==prior.leaveWorkModel||(mode==='FLEX'&&reference!==prior.leaveFlexReferenceDays);
  if(changes&&(ft_get_('Leaves').some(l=>l.companyId===user.companyId&&l.userId===user.id&&['APPROVED','CANCEL_PENDING'].includes(l.status))||
    ft_leaveLedgerRows_(false).some(l=>l.companyId===user.companyId&&l.userId===user.id&&l.kind==='GRANT')))
   throw Error('Urlaubsmodell nach bestehenden Freigaben/Gutschriften nicht automatisch ändern. Bitte kontrollierte Umstellung durchführen.');
 }
 return {mode,referenceDays:mode==='FLEX'?reference:0,basis:mode==='FLEX'?basis:'',balanceReviewed:mode==='FLEX'&&reviewed};
}
function ft_leaveFlexSave_(actor,user,config){
 const all=ft_leaveFlexRules_(true),old=all.find(r=>r.companyId===user.companyId&&r.userId===user.id);
 const row={id:old?.id||'flex_'+ft_sha_(user.companyId+'|'+user.id),companyId:user.companyId,userId:user.id,
  ...config,updatedBy:actor.id,updatedAt:ft_now_()};
 if(old){Object.assign(old,row);ft_absenceSave_('LeaveFlexRules',FT_LEAVE_FLEX_COLS_,old);}
 else ft_absenceAdd_('LeaveFlexRules',FT_LEAVE_FLEX_COLS_,row);
 if(FT_REQUEST_CACHE)delete FT_REQUEST_CACHE.tables.FT_LEAVE_FLEX_RULES;
 ft_audit_(actor,'LEAVE_WORKMODEL','Users',user.id,old||{},row);
 return row;
}
function ft_flexibleLeaveUpgrade(){
 if(!ft_prop_('FT_DB_ID'))throw Error('FireTime-Pro-Datenbank nicht gefunden.');
 const names=['LeaveFlexRules','LeaveFlexApprovals'],db=ft_db_();
 const existing=names.filter(x=>!!db.getSheetByName(x));
 ft_absenceSheet_('LeaveFlexRules',FT_LEAVE_FLEX_COLS_,true);
 ft_absenceSheet_('LeaveFlexApprovals',FT_LEAVE_FLEX_APPROVAL_COLS_,true);
 return {ok:true,version:FT_VERSION,created:names.filter(x=>!existing.includes(x)),
  message:'Flex-Urlaubsmodell bereit. Bestehende Salden und Urlaube unverändert; automatische Bewertung zunächst gesperrt.'};
}
function ft_flexLeaveDaysForMonth_(leave,from,to){
 // Credit-hour allocation only: proportion by calendar days when a leave crosses a month.
 // Vacation-day debit is NEVER derived from these calendar days.
 const all=Math.round((ft_date_(leave.to)-ft_date_(leave.from))/86400000)+1;
 const span=Math.round((ft_date_(to)-ft_date_(from))/86400000)+1;
 return all>0?span/all:0;
}
function ft_leaveWeekdays_(workdays){
 const days=String(workdays||'1,2,3,4,5').split(',').map(Number);
 if(!days.length||days.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(days).size!==days.length)
  throw Error('Arbeitstage von 1 bis 7 ohne Wiederholung eingeben (z. B. 1,2,3,4,5).');
 return days.length;
}
function ft_leaveStaffPublic_(user){
 const rule=ft_leaveStaffRules_(false).find(x=>String(x.companyId)===String(user.companyId)&&String(x.userId)===String(user.id));
 const company=ft_leavePolicyFor_(user.companyId);
 const defaultMode=['CALENDAR','ANNIVERSARY'].includes(company.yearMode)?company.yearMode:'ANNIVERSARY';
 const entitlement=Number(user.leaveEntitlement)||0;
 const standard=ft_leaveWeekdays_(user.workdays||'1,2,3,4,5')*5;
 return {...ft_leaveFlexFor_(user),leaveYearMode:rule?.yearMode||defaultMode,
  leaveRuleType:rule?.ruleType||'LEGACY',
  leaveRuleLegalBasis:rule?.legalBasis||'',
  leaveRuleNote:rule?.note||'',
  leaveRulePersonal:Boolean(rule),
  leaveLegalMinimumDays:ft_leaveFlexFor_(user).leaveWorkModel==='FLEX'?null:standard};
}
function ft_leaveStaffCheck_(payload,user,existing){
 const desired=String(payload.leaveYearMode||'ANNIVERSARY');
 if(!['ANNIVERSARY','CALENDAR'].includes(desired))throw Error('Urlaubsjahr: Eintrittsdatum oder 1. Jänner auswählen.');
 const type=String(payload.leaveRuleType||'STANDARD_5');
 if(!['STANDARD_5','STANDARD_6','SPECIAL','LEGACY'].includes(type))throw Error('Ungültige Urlaubsregelung.');
 if(!existing&&type==='LEGACY')throw Error('Bei neuen Mitarbeitern bitte die Urlaubsregel festlegen.');
 const flex=ft_leaveFlexValidate_(payload,user,existing);
 const min=flex.mode==='FLEX'?flex.referenceDays*5:ft_leaveWeekdays_(user.workdays)*5;
 const expected=flex.mode==='FLEX'&&!flex.referenceDays?null:type==='STANDARD_5'?min:type==='STANDARD_6'?min/5*6:null;
 if(expected!==null&&Math.abs(Number(user.leaveEntitlement)-expected)>.01)
  throw Error('Urlaubsanspruch stimmt nicht mit '+(type==='STANDARD_5'?'fünf':'sechs')+' Wochen bei '+ft_leaveWeekdays_(user.workdays)+' Arbeitstagen überein.');
 if(type==='SPECIAL'&&min>0&&Number(user.leaveEntitlement)<min)
  throw Error('Sonderanspruch unterschreitet den gesetzlichen Mindesturlaub von fünf Wochen.');
 const note=ft_str_(payload.leaveRuleNote||'',250);
 if(type==='SPECIAL'&&note.length<5)throw Error('Bitte den Sonderanspruch und seine Grundlage beschreiben.');
 const basis=String(payload.leaveRuleLegalBasis||'');
 if(desired==='CALENDAR'&&!['KV','BETRIEBSVEREINBARUNG','SCHRIFTLICHE_EINZELVEREINBARUNG'].includes(basis))
  throw Error('Für das Kalenderjahr bitte die Grundlage (KV, Betriebsvereinbarung oder schriftliche Einzelvereinbarung) angeben.');
 if(existing&&ft_leaveLedgerRows_(false).some(x=>x.companyId===user.companyId&&x.userId===user.id&&x.kind==='GRANT')){
  const old=ft_leaveStaffPublic_(user);
  if(old.leaveYearMode!==desired)throw Error('Für diesen Mitarbeiter wurden bereits Jahresgutschriften verbucht. Wechsel des Urlaubsjahres nur mit geprüfter Umstellung.');
 }
 return {yearMode:desired,ruleType:type,legalBasis:desired==='CALENDAR'?basis:'GESETZ',note};
}
function ft_leaveStaffSave_(actor,user,rule){
 const existing=ft_leaveStaffRules_(true).find(x=>x.companyId===user.companyId&&x.userId===user.id);
 const before=existing?{yearMode:existing.yearMode,ruleType:existing.ruleType,legalBasis:existing.legalBasis,note:existing.note}:{};
 const now={id:existing?.id||'staff_leave_'+ft_sha_(user.companyId+'|'+user.id),
   companyId:user.companyId,userId:user.id,...rule,updatedBy:actor.id,updatedAt:ft_now_()};
 if(existing){Object.assign(existing,now);ft_absenceSave_('LeaveStaffRules',FT_LEAVE_STAFF_RULE_COLS_,existing);}
 else ft_absenceAdd_('LeaveStaffRules',FT_LEAVE_STAFF_RULE_COLS_,now);
 if(FT_REQUEST_CACHE)delete FT_REQUEST_CACHE.tables.FT_LEAVE_STAFF_RULES;
 ft_audit_(actor,'LEAVE_STAFF_RULE','Users',user.id,before,now);
 return now;
}
function ft_employeeLeaveRulesUpgrade(){
 if(!ft_prop_('FT_DB_ID'))throw Error('Bestehende FireTime-Pro-Datenbank fehlt.');
 const existed=Boolean(ft_db_().getSheetByName('LeaveStaffRules'));
 ft_absenceSheet_('LeaveStaffRules',FT_LEAVE_STAFF_RULE_COLS_,true);
 return {ok:true,version:FT_VERSION,existing:existed,
  message:'Mitarbeiter-Urlaubsregeln sind bereit. Bestehende Salden, Ansprüche und Gutschriften wurden nicht verändert.'};
}
function ft_leaveLedgerRows_(create){return ft_absenceRows_('LeaveLedger',FT_LEAVE_LEDGER_COLS_,create);}
function ft_leavePolicyRows_(create){
 const key='FT_LEAVE_POLICY_CACHE';
 if(FT_REQUEST_CACHE&&FT_REQUEST_CACHE.tables[key])return FT_REQUEST_CACHE.tables[key];
 const rows=ft_absenceRows_('LeavePolicies',FT_LEAVE_POLICY_COLS_,create);
 if(FT_REQUEST_CACHE)FT_REQUEST_CACHE.tables[key]=rows;
 return rows;
}
function ft_leavePolicyFor_(cid){const row=ft_leavePolicyRows_(false).find(r=>String(r.companyId)===String(cid));
 return row?{yearMode:String(row.yearMode),autoGrant:ft_bool_(row.autoGrant),activationDate:String(row.activationDate||''),updatedAt:String(row.updatedAt||'')}:
  {yearMode:'NOT_CONFIGURED',autoGrant:false,activationDate:'',updatedAt:''};}
function ft_leaveYearDate_(year,month,day){
 const m=Number(month),y=Number(year),d=Number(day),last=new Date(Date.UTC(y,m,0)).getUTCDate();
 return String(y)+'-'+String(m).padStart(2,'0')+'-'+String(Math.min(d,last)).padStart(2,'0');
}
function ft_leavePeriod_(user,mode,year){
 if(mode==='CALENDAR')return ft_leaveYearDate_(year,1,1);
 if(mode!=='ANNIVERSARY'||!/^\d{4}-\d\d-\d\d$/.test(String(user.startDate||'')))return '';
 return ft_leaveYearDate_(year,Number(user.startDate.slice(5,7)),Number(user.startDate.slice(8,10)));
}
function ft_leaveEnsureOpening_(user,actor){
 const all=ft_leaveLedgerRows_(true);
 if(all.some(r=>String(r.companyId)===String(user.companyId)&&String(r.userId)===String(user.id)))return false;
 ft_absenceAdd_('LeaveLedger',FT_LEAVE_LEDGER_COLS_,{id:'opening_'+ft_sha_(user.companyId+'|'+user.id),
  companyId:user.companyId,userId:user.id,kind:'OPENING',days:ft_2_(user.leaveBalance),
  effectiveDate:ft_localDate_(new Date()),periodStart:'LEGACY',referenceId:'OPENING',
  carryoverBefore:'',note:'Übernommener Gesamtrest aus altem System; Anspruchsjahr nicht feststellbar',
  actorId:actor?.id||'SYSTEM',createdAt:ft_now_()});
 return true;
}
function ft_leaveLedgerRecord_(actor,user,kind,days,referenceId,note){
 // Calls must be inside the same script lock as the existing leave approval.
 ft_leaveEnsureOpening_(user,actor);
 const id='ledger_'+ft_sha_(user.companyId+'|'+user.id+'|'+kind+'|'+referenceId);
 if(ft_leaveLedgerRows_(false).some(row=>String(row.id)===id))return false;
 ft_absenceAdd_('LeaveLedger',FT_LEAVE_LEDGER_COLS_,{id,companyId:user.companyId,userId:user.id,
  kind,days:ft_2_(days),effectiveDate:ft_localDate_(new Date()),periodStart:'',
  referenceId:String(referenceId),carryoverBefore:'',note:ft_str_(note,200),
  actorId:actor?.id||'SYSTEM',createdAt:ft_now_()});return true;
}
function ft_leavePolicySave_(actor,p){
 ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_company_(actor,p.companyId||actor.companyId);
 const mode=String(p.yearMode||'');if(!['CALENDAR','ANNIVERSARY'].includes(mode))throw Error('Urlaubsjahr: CALENDAR oder ANNIVERSARY auswählen.');
 if(p.confirmExistingBalance!==true)throw Error('Bitte ausdrücklich bestätigen, dass der bisherige Resturlaub nicht neu gutgeschrieben werden darf.');
 const enabled=ft_bool_(p.autoGrant);const old=ft_leavePolicyRows_(true).find(x=>String(x.companyId)===String(c.id));
 if(old&&mode!==String(old.yearMode)&&ft_leaveLedgerRows_(false).some(x=>x.companyId===c.id&&x.kind==='GRANT'))
  throw Error('Aktives Urlaubsjahr-Modell darf nicht stillschweigend geändert werden. Bitte eine kontrollierte Umstellung veranlassen.');
 if(enabled&&mode==='ANNIVERSARY'&&ft_get_('Users').some(u=>u.companyId===c.id&&u.status==='ACTIVE'&&!/^\d{4}-\d\d-\d\d$/.test(String(u.startDate||''))))
  throw Error('Bei Eintrittsdatum-Urlaubsjahr müssen bei allen aktiven Mitarbeitern Eintrittsdaten erfasst sein.');
 const today=ft_localDate_(new Date()),date=old?.activationDate||today;
 const beforePolicy=old?{yearMode:old.yearMode,autoGrant:ft_bool_(old.autoGrant)}:{};
 const row={id:old?.id||'policy_'+c.id,companyId:c.id,yearMode:mode,autoGrant:enabled,
  activationDate:date,updatedBy:actor.id,updatedAt:ft_now_()};
 // Bootstrap each existing balance BEFORE any future grant; never backfill a current-year entitlement.
 for(const u of ft_get_('Users').filter(u=>u.companyId===c.id&&u.role!=='SYSADMIN'))ft_leaveEnsureOpening_(u,actor);
 if(old){Object.assign(old,row);ft_absenceSave_('LeavePolicies',FT_LEAVE_POLICY_COLS_,old);}
 else ft_absenceAdd_('LeavePolicies',FT_LEAVE_POLICY_COLS_,row);
 ft_audit_(actor,'LEAVE_POLICY','Companies',c.id,beforePolicy,row);
 return {...ft_leavePolicyFor_(c.id),message:enabled?
  'Aktiv. Frühestens ab dem nächsten Kalenderjahr werden neue Ansprüche einmalig gebucht. Der Altbestand bleibt erhalten.':
  'Urlaubsjahr gewählt, automatische Gutschrift vorerst deaktiviert.'};
}
function ft_leaveAnnualTick_(){
 // Called after the regular ft_tick lock. Idempotent per company/user/period.
 return ft_lock_(()=>{
  const today=ft_localDate_(new Date()),year=Number(today.slice(0,4));let granted=0;
  const policies=ft_leavePolicyRows_(false).filter(x=>ft_bool_(x.autoGrant));
  if(!policies.length)return {granted,checked:today};
  const users=ft_get_('Users').filter(x=>x.status==='ACTIVE'&&x.role!=='SYSADMIN');
  const ledger=ft_leaveLedgerRows_(true),done=new Set(ledger.filter(x=>x.kind==='GRANT').map(x=>String(x.id)));
  for(const policy of policies){
   const companyMode=String(policy.yearMode),activation=String(policy.activationDate||today),firstYear=Number(activation.slice(0,4))+1;
   if(!['CALENDAR','ANNIVERSARY'].includes(companyMode))continue;
   for(const u of users.filter(x=>x.companyId===policy.companyId)){
    const personal=ft_leaveStaffPublic_(u);
    if(personal.leaveWorkModel==='FLEX'&&!personal.leaveFlexConfigured)continue;
    const mode=personal.leaveYearMode;
    const entitlement=Number(u.leaveEntitlement)||0;
    if(entitlement<=0)continue;
    ft_leaveEnsureOpening_(u,{id:'SYSTEM'});
    // Do not silently grant if a partial failed write has left the account discrepant.
    const accountRows=ft_leaveLedgerRows_(false).filter(r=>r.companyId===u.companyId&&r.userId===u.id);
    const recorded=ft_2_(accountRows.reduce((sum,r)=>sum+(Number(r.days)||0),0));
    if(Math.abs(recorded-(Number(u.leaveBalance)||0))>.01){
      console.warn('Urlaubskonto prüfen; keine automatische Gutschrift für '+u.id);continue;
    }
    // Intentional: never grant the year in which the existing balance was adopted.
    for(let y=Math.max(firstYear,year-8,(/^[0-9]{4}-/.test(String(u.startDate||''))?Number(String(u.startDate).slice(0,4))+1:firstYear));y<=year;y++){
     const period=ft_leavePeriod_(u,mode,y);
     if(!period||period>today)continue;
     const id='grant_'+ft_sha_(u.companyId+'|'+u.id+'|'+period);
     if(done.has(id)||ft_leaveLedgerRows_(false).some(x=>x.id===id))continue;
     // Entry first. If the execution aborts before Users was updated, flag the
     // discrepancy in leaveAccount instead of ever double-granting the leave.
     const old=Number(u.leaveBalance)||0;
     ft_absenceAdd_('LeaveLedger',FT_LEAVE_LEDGER_COLS_,{id,companyId:u.companyId,userId:u.id,
      kind:'GRANT',days:ft_2_(entitlement),effectiveDate:period,periodStart:period,
      referenceId:'YEAR_'+period,carryoverBefore:ft_2_(old),
      note:'Jahresanspruch; automatische Gutschrift nach freigegebenem Urlaubsjahr-Modell',
      actorId:'SYSTEM',createdAt:ft_now_()});done.add(id);
     const before={leaveBalance:old};u.leaveBalance=ft_2_(old+entitlement);ft_save_('Users',u);
     ft_audit_(null,'LEAVE_ANNUAL_GRANT','Users',u.id,before,{leaveBalance:u.leaveBalance,period,entitlement});
     granted++;
    }
   }
  }
  return {granted,checked:today};
 });
}
function ft_leaveAccount_(user){
 const all=ft_leaveLedgerRows_(false).filter(x=>String(x.companyId)===String(user.companyId)&&String(x.userId)===String(user.id));
 const grants=all.filter(x=>x.kind==='GRANT').sort((a,b)=>String(a.periodStart).localeCompare(String(b.periodStart)));
 const total=ft_2_(user.leaveBalance),recorded=ft_2_(all.reduce((sum,row)=>sum+(Number(row.days)||0),0));
 const policy=ft_leavePolicyFor_(user.companyId);
 const personalRule=ft_leaveStaffPublic_(user);
 const currentYear=Number(ft_localDate_(new Date()).slice(0,4));
 const currentGrant=grants.filter(x=>String(x.periodStart).slice(0,4)===String(currentYear));
 return {totalBalance:total,annualEntitlement:ft_2_(user.leaveEntitlement),
  policy,personalRule,legacyOpening:all.some(x=>x.kind==='OPENING')?Number(all.find(x=>x.kind==='OPENING').days)||0:null,
  provenanceNote:'Altbestände vor Aktivierung lassen sich nicht nach Anspruchsjahren aufteilen.',
  currentYearGrant:ft_2_(currentGrant.reduce((sum,r)=>sum+(Number(r.days)||0),0)),
  grants:grants.map(x=>({year:String(x.periodStart||'').slice(0,4),periodStart:x.periodStart,
   days:ft_2_(x.days),carryoverBefore:ft_2_(x.carryoverBefore)})),
  ledgerStatus:all.length===0?'NOT_INITIALIZED':Math.abs(total-recorded)>.01?'RECONCILIATION_REQUIRED':'OK',
  difference:ft_2_(total-recorded)};
}
function ft_leavePolicyGet_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_company_(actor,p.companyId||actor.companyId);
 return ft_leavePolicyFor_(c.id);}
function ft_absenceYears_(p){
 const current=Number(ft_localDate_(new Date()).slice(0,4));
 if(p.year==='all'&&p.fromYear===undefined)throw Error('Für alle Jahre bitte ein Startjahr und Endjahr auswählen.');
 const from=p.fromYear!==undefined?Number(p.fromYear):p.year&&p.year!=='all'?Number(p.year):current;
 const to=p.toYear!==undefined?Number(p.toYear):from;
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<2000||to>2100||from>to||to-from>15)
  throw Error('Bitte gültigen Zeitraum von maximal 16 Jahren auswählen.');
 return {from,to};
}
function ft_absenceHistory_(actor,p){
 const id=actor.role==='STAFF'?actor.id:String(p.userId||actor.id),user=ft_user_(actor,id);
 const company=ft_company_(actor,user.companyId),period=ft_absenceYears_(p);
 const from=String(period.from)+'-01-01',end=String(period.to)+'-12-31';
 const leaves=ft_enabled_(company,'LEAVE')?ft_get_('Leaves').filter(r=>String(r.userId)===String(id)&&String(r.companyId)===String(company.id)&&
  String(r.to||'')>=from&&String(r.from||'')<=end).map(r=>({id:r.id,from:r.from,to:r.to,days:Number(r.days)||0,
   status:r.status,reason:actor.role==='STAFF'||actor.id===id?String(r.reason||''):'',
   reviewedAt:r.reviewedAt||'',createdAt:r.createdAt||''})).sort((a,b)=>String(b.from).localeCompare(String(a.from))):[];
 const sick=ft_enabled_(company,'SICK')?ft_get_('SickLeaves').filter(r=>String(r.userId)===String(id)&&String(r.companyId)===String(company.id)&&
  String(r.to||'').slice(0,10)>=from&&String(r.from||'').slice(0,10)<=end)
  .map(r=>({id:r.id,from:r.from,to:r.to,status:r.status,
    creditMode:r.creditMode||'NONE',creditHours:Number(r.creditHours)||0,
    standbyCreditHours:Number(r.standbyCreditHours)||0,reviewedAt:r.reviewedAt||'',createdAt:r.createdAt||''}))
  .sort((a,b)=>String(b.from).localeCompare(String(a.from))):[];
 const today=ft_localDate_(new Date());
 const account=ft_leaveAccount_(user);
 const years=[];
 for(let year=period.from;year<=period.to;year++){
  const s=String(year)+'-01-01',e=String(year)+'-12-31';
  let approvedDays=0,takenDays=0,plannedDays=0,pendingDays=0,partialEstimates=0;
  for(const leave of leaves){
   if(leave.to<s||leave.from>e)continue;
   const a=leave.from>s?leave.from:s,b=leave.to<e?leave.to:e;
   const credited=leave.status==='APPROVED'||leave.status==='CANCEL_PENDING';
   // If a leave spans years, only allocate the matching dates to each year.
   // It is a historical estimate using the current workday setup.
   const divided=a!==leave.from||b!==leave.to;
   const days=divided?(account.personalRule.leaveWorkModel==='FLEX'?ft_2_((Number(leave.days)||0)*ft_flexLeaveDaysForMonth_(leave,a,b)):ft_leaveDays_(user,a,b)):Number(leave.days)||0;
   if(divided)partialEstimates++;
   if(credited){approvedDays+=days;
    if(b<today)takenDays+=days;
    else if(a>today)plannedDays+=days;
   }else if(leave.status==='PENDING')pendingDays+=days;
  }
  const grant=account.grants.filter(g=>g.year===String(year));
  years.push({year,approvedDays:ft_2_(approvedDays),takenDays:ft_2_(takenDays),
   plannedDays:ft_2_(plannedDays),pendingDays:ft_2_(pendingDays),
   sickReports:sick.filter(r=>String(r.to).slice(0,10)>=s&&String(r.from).slice(0,10)<=e).length,
   granted:ft_2_(grant.reduce((total,g)=>total+Number(g.days||0),0)),
   carryoverBefore:grant.length?Number(grant[0].carryoverBefore):null,
   crossYearEstimated:partialEstimates>0});
 }
 return {user:{id:user.id,name:user.name,companyId:user.companyId},company:{id:company.id,name:company.name},period,
  generatedAt:ft_now_(),account,years,leaves,sick,
  note:'Zeitspannen nach den gespeicherten Meldungen; Altbestände ohne belegtes Anspruchsjahr. Keine medizinischen Diagnosen im Export.'};
}
function ft_absencePdfRows_(){return ft_absenceRows_('AbsencePdfArchive',FT_ABSENCE_PDF_COLS_,false);}
function ft_absencePdfCreate_(actor,p){
 const data=ft_absenceHistory_(actor,p),u=data.user,c=data.company,period=data.period;
 const key=String(p.requestId||'');if(!/^[A-Za-z0-9_-]{12,100}$/.test(key))throw Error('Eindeutige PDF-Anfragekennung erforderlich.');
 const id='absence_'+ft_sha_(c.id+'|'+u.id+'|'+period.from+'|'+period.to+'|'+key);
 const existing=ft_absencePdfRows_().find(x=>String(x.id)===id&&String(x.companyId)===c.id);
 if(existing)return {id:existing.id,name:existing.name,createdAt:existing.createdAt,version:Number(existing.version)||1};
 if(data.leaves.length>250||data.sick.length>250)throw Error('Zu viele Datensätze; bitte kleinere Jahresauswahl treffen.');
 let doc=null,file=null;
 try{
  doc=DocumentApp.create('FireTime Pro Abwesenheitsauszug '+u.name+' '+period.from+'-'+period.to);
  const body=doc.getBody();
  body.appendParagraph('FIRETIME PRO – ABWESENHEITSAUSZUG').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(c.name+' · '+u.name);
  body.appendParagraph('Zeitraum: '+period.from+' bis '+period.to+' · Erstellt: '+Utilities.formatDate(new Date(),FT_TZ,'dd.MM.yyyy HH:mm')+' Uhr (Österreich)');
  const balance=data.account;
  body.appendParagraph('Aktueller Resturlaub: '+balance.totalBalance+' Tage; jährlicher Anspruch laut Stammdaten: '+balance.annualEntitlement+' Tage.');
  body.appendParagraph('Arbeitszeitmodell Urlaub: '+(balance.personalRule.leaveWorkModel==='FLEX'?'Flexible Monatseinteilung, manuell bestätigte Urlaubstage':'Feste Arbeitstage')+'.');
  body.appendParagraph('Urlaubsjahr (Mitarbeiter): '+(balance.personalRule.leaveYearMode==='ANNIVERSARY'?'Eintrittsdatum':'Kalenderjahr')+'; automatische Jahresgutschrift: '+(balance.policy.autoGrant?'aktiv':'nicht aktiv'));
  body.appendParagraph('Historischer Altbestand: Nach Anspruchsjahren nicht vollständig rekonstruierbar.').setItalic(true);
  body.appendParagraph('URLAUB').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const table1=[['Von','Bis','Tage gesamt','Status']].concat(data.leaves.map(r=>[r.from,r.to,String(r.days),String(r.status)]));
  body.appendTable(table1.length>1?table1:[['Von','Bis','Tage gesamt','Status'],['Keine Einträge','','','']]);
  body.appendParagraph('KRANKENSTÄNDE').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const formatStamp=stamp=>{const x=String(stamp||'');const d=new Date(x);
   return Number.isFinite(d.getTime())?Utilities.formatDate(d,FT_TZ,'dd.MM.yyyy HH:mm'):x;};
  const table2=[['Von','Bis','Status','Sollgutschrift','Bereitschaftsgutschrift']].concat(data.sick.map(r=>[
   formatStamp(r.from),formatStamp(r.to),String(r.status),String(r.creditHours)+' h',String(r.standbyCreditHours)+' h']));
  body.appendTable(table2.length>1?table2:[['Von','Bis','Status','Sollgutschrift','Bereitschaftsgutschrift'],['Keine Einträge','','','','']]);
  body.appendParagraph('Keine Diagnosen oder vertraulichen Krankheitsgründe enthalten. Keine Lohnabrechnung.');
  doc.saveAndClose();
  const pdf=DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF);
  const name='FireTimePro_'+String(c.name).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,35)+'_'+
   String(u.name).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,35)+'_Abwesenheiten_'+period.from+'-'+period.to+'.pdf';
  pdf.setName(name);
  const root=DriveApp.getFolderById(ft_prop_('FT_ROOT_ID'));
  file=root.createFile(pdf);
  const version=1+Math.max(0,...ft_absencePdfRows_().filter(x=>String(x.companyId)===c.id&&String(x.userId)===u.id&&
   Number(x.fromYear)===period.from&&Number(x.toYear)===period.to).map(x=>Number(x.version)||0));
  const row={id,companyId:c.id,userId:u.id,fromYear:period.from,toYear:period.to,fileId:file.getId(),name,createdAt:ft_now_(),version,requestId:key};
  ft_absenceAdd_('AbsencePdfArchive',FT_ABSENCE_PDF_COLS_,row);
  return {id,name,createdAt:row.createdAt,version};
 }catch(err){if(file)try{file.setTrashed(true);}catch(_){ }throw err;}
 finally{if(doc)try{DriveApp.getFileById(doc.getId()).setTrashed(true);}catch(_){ }}
}
function ft_absencePdfArchive_(actor,p){
 const id=actor.role==='STAFF'?actor.id:String(p.userId||actor.id),u=ft_user_(actor,id),period=ft_absenceYears_(p);
 return ft_absencePdfRows_().filter(r=>String(r.companyId)===String(u.companyId)&&String(r.userId)===String(id)&&
   Number(r.fromYear)>=period.from&&Number(r.toYear)<=period.to)
  .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
  .map(r=>({id:r.id,name:r.name,createdAt:r.createdAt,version:Number(r.version)||1,
   fromYear:Number(r.fromYear),toYear:Number(r.toYear)}));
}
function ft_absencePdfChunk_(actor,p){
 const id=actor.role==='STAFF'?actor.id:String(p.userId||actor.id),u=ft_user_(actor,id);
 const row=ft_absencePdfRows_().find(r=>String(r.id)===String(p.id)&&String(r.companyId)===String(u.companyId)&&String(r.userId)===String(id));
 if(!row)throw Error('Abwesenheits-PDF nicht gefunden oder kein Zugriff.');
 const file=DriveApp.getFileById(String(row.fileId));
 if(file.isTrashed()||file.getMimeType()!==MimeType.PDF)throw Error('PDF-Datei ist nicht verfügbar.');
 const bytes=file.getBlob().getBytes(),index=Number(p.index),size=65536,total=Math.ceil(bytes.length/size);
 if(!Number.isSafeInteger(index)||index<0||index>=total)throw Error('Ungültiger PDF-Abschnitt.');
 return {id:String(row.id),index,total,size:bytes.length,name:String(row.name),
  base64:Utilities.base64Encode(bytes.slice(index*size,(index+1)*size))};
}
/** Sichere einmalige Ergänzung bestehender Google Sheets – niemals ft_setup()! */
function ft_absenceUpgrade(){
 if(!ft_prop_('FT_DB_ID'))throw Error('Bestehende Datenbank nicht gefunden.');
 const data=[['LeaveLedger',FT_LEAVE_LEDGER_COLS_],['LeavePolicies',FT_LEAVE_POLICY_COLS_],['AbsencePdfArchive',FT_ABSENCE_PDF_COLS_],['LeaveStaffRules',FT_LEAVE_STAFF_RULE_COLS_]];
 const existing=data.filter(x=>ft_db_().getSheetByName(x[0])).map(x=>x[0]);
 data.forEach(x=>ft_absenceSheet_(x[0],x[1],true));
 return {ok:true,version:FT_VERSION,existing,newTables:data.map(x=>x[0]).filter(x=>!existing.includes(x)),
  policy:'Automatische Jahresgutschrift bleibt deaktiviert, bis die Firma das Urlaubsjahr explizit freigibt.',
  note:'Keine bestehenden Urlaubssalden oder Anträge wurden verändert.'};
}

