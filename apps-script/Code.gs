// -----------------------------------------------------------------
// 00_BOOT
// -----------------------------------------------------------------
/** FireTime Pro · Developed by Michael Mejtsky
 * Nur API, kein Google-HTML-WebApp-Frontend.
 * Öffentlicher Zugriff führt nicht zu google.script.run.
 */
const FT_VERSION='1.5.0-github-google';
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
 Activities:['id','companyId','userId','type','start','end','breakMinutes','object','description','createdAt','updatedAt'],
 Availability:['id','companyId','userId','month','day','answer','updatedAt'],
 AvailabilitySubmissions:['id','companyId','userId','month','submittedAt'],
 Shifts:['id','companyId','userId','day','start','end','status','eventId','actualStatus','confirmedAt','updatedAt'],
 Leaves:['id','companyId','userId','from','to','days','creditHours','reason','status','reviewerId','reviewedAt','createdAt'],
 Months:['id','companyId','userId','month','status','submittedAt','reviewerId','reviewedAt','note','pdfId','snapshot','snapshotHash'],
 Notifications:['id','companyId','userId','kind','reference','sentAt','status','error'],
 Audit:['id','at','actorId','companyId','action','entity','entityId','previous','next']
};
const FT_ROLES=['SYSADMIN','ADMIN','STAFF'];

function ft_prop_(k){return PropertiesService.getScriptProperties().getProperty(k);}

function ft_now_(){return new Date().toISOString();}

function ft_uuid_(){return Utilities.getUuid();}

function ft_db_(){const id=ft_prop_('FT_DB_ID');if(!id)throw Error('FireTime Pro ist noch nicht eingerichtet. ft_setup() ausführen.');return SpreadsheetApp.openById(id);}

function ft_sheet_(name){const s=ft_db_().getSheetByName(name);if(!s)throw Error('Fehlende Datenbanktabelle: '+name);return s;}

function ft_get_(name){const sheet=ft_sheet_(name), values=sheet.getDataRange().getValues(),head=FT_HEADERS[name];return values.slice(1).map((r,i)=>{const o={__row:i+2};head.forEach((h,j)=>o[h]=r[j] instanceof Date?r[j].toISOString():r[j]);return o;}).filter(x=>x.id!=='');}

function ft_pick_(name,o){return FT_HEADERS[name].map(h=>{const v=o[h];if(v===undefined||v===null)return '';if(typeof v==='string'&&/^[\s]*[=+@-]/.test(v))return '\''+v;return v;});}

function ft_add_(name,o){ft_sheet_(name).appendRow(ft_pick_(name,o));return o;}

function ft_save_(name,o){if(!o.__row)throw Error('Fehlende Tabellenzeile');ft_sheet_(name).getRange(o.__row,1,1,FT_HEADERS[name].length).setValues([ft_pick_(name,o)]);return o;}

function ft_one_(name,id){return ft_get_(name).find(r=>String(r.id)===String(id));}

function ft_lock_(fn){const l=LockService.getScriptLock();l.waitLock(20000);try{return fn();}finally{l.releaseLock();}}

function ft_hex_(bytes){return bytes.map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}

function ft_sha_(s){return ft_hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8));}

function ft_rand_(){return ft_sha_(ft_uuid_()+ft_uuid_()+ft_now_());}

function ft_password_(password,salt){let v=salt+'|'+password+'|'+ft_prop_('FT_PEPPER');for(let i=0;i<1500;i++)v=ft_sha_(v+salt);return v;}

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

function ft_safe_(u){return {id:u.id,companyId:u.companyId,role:u.role,name:u.name,email:u.email,monthlyHours:Number(u.monthlyHours)||0,hourlyRate:Number(u.hourlyRate)||0,leaveEntitlement:Number(u.leaveEntitlement)||0,leaveBalance:Number(u.leaveBalance)||0,openingHours:Number(u.openingHours)||0,startDate:u.startDate,workdays:u.workdays||'1,2,3,4,5',status:u.status,mustChange:ft_bool_(u.mustChange)};}

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

// -----------------------------------------------------------------
// 04_Mitarbeiter
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 04_Mitarbeiter.gs */
function ft_userCreate_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const c=ft_company_(actor,p.companyId||actor.companyId),role=String(p.role||'STAFF');if(!['STAFF','ADMIN'].includes(role))throw Error('Ungültige Rolle');const email=ft_email_(p.email),name=ft_str_(p.name,100);if(!name)throw Error('Name fehlt');if(ft_get_('Users').some(x=>x.email===email))throw Error('E-Mail ist bereits im System vergeben');const u={id:ft_uuid_(),companyId:c.id,role,name,email,passwordHash:'',salt:'',status:'INVITED',monthlyHours:ft_number_(p.monthlyHours||0,0,300,'Monatssoll'),hourlyRate:ft_number_(p.hourlyRate||0,0,10000,'Stundensatz'),leaveEntitlement:ft_number_(p.leaveEntitlement||0,0,366,'Urlaubsanspruch'),leaveBalance:ft_number_(p.leaveBalance||0,0,1000,'Resturlaub'),openingHours:ft_number_(p.openingHours||0,-10000,10000,'Startsaldo'),startDate:p.startDate||ft_localDate_(new Date()),workdays:ft_str_(p.workdays||'1,2,3,4,5',30),mustChange:false,createdAt:ft_now_()};ft_date_(u.startDate);ft_add_('Users',u);ft_audit_(actor,'CREATE','Users',u.id,{},ft_safe_(u));let message='Mitarbeiter angelegt. ';try{message+=ft_invite_(actor,u);}catch(e){message+='Einladung noch nicht verschickt: '+e.message;}return {user:ft_safe_(u),message};}

function ft_userUpdate_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const u=ft_user_(actor,p.id);if(u.role==='SYSADMIN')throw Error('Systemadmin nicht über Firmenverwaltung ändern');const before=ft_safe_(u);const fields=['name','monthlyHours','hourlyRate','leaveEntitlement','leaveBalance','openingHours','startDate','workdays','status'];fields.forEach(k=>{if(p[k]===undefined)return;if(['monthlyHours','hourlyRate','leaveEntitlement','leaveBalance','openingHours'].includes(k))u[k]=ft_number_(p[k],k==='openingHours'?-10000:0,k==='openingHours'?10000:k==='monthlyHours'?300:k==='hourlyRate'?10000:1000,k);else u[k]=ft_str_(p[k],100);});if(p.role&&['ADMIN','STAFF'].includes(p.role))u.role=p.role;if(!['ACTIVE','DISABLED','INVITED'].includes(u.status))throw Error('Ungültiger Status');if(!/^[1-7](,[1-7])*$/.test(u.workdays)||new Set(u.workdays.split(',')).size!==u.workdays.split(',').length)throw Error('Arbeitstage im Format 1,2,3,4,5 eingeben, ohne Duplikate.');if(u.startDate)ft_date_(u.startDate);ft_save_('Users',u);ft_audit_(actor,'UPDATE','Users',u.id,before,ft_safe_(u));return ft_safe_(u);}

// -----------------------------------------------------------------
// 05_Zeiterfassung
// -----------------------------------------------------------------
/** FireTime Pro 1.1 | Developed by Michael Mejtsky | 05_Zeiterfassung.gs */
function ft_monthBounds_(m){ft_month_(m);const [y,n]=m.split('-').map(Number);return [new Date(y,n-1,1,0,0),new Date(y,n,1,0,0)];}

function ft_hours_(a,b){return Math.max(0,(new Date(b)-new Date(a))/3600000);}

function ft_overlap_(a,b,c,d){return Math.max(0,Math.min(+new Date(b),+new Date(d))-Math.max(+new Date(a),+new Date(c)))/3600000;}

function ft_2_(v){return Math.round((Number(v)||0)*100)/100;}

function ft_easter_(year){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;return new Date(year,mo-1,day,12);}

function ft_dayShift_(date,days){const d=new Date(date);d.setDate(d.getDate()+days);return ft_localDate_(d);}

function ft_holiday_(str){const y=Number(str.slice(0,4)),fixed=['01-01','01-06','05-01','08-15','10-26','11-01','12-08','12-25','12-26'];if(fixed.includes(str.slice(5)))return true;const easter=ft_easter_(y);return [1,39,50,60].some(d=>ft_dayShift_(easter,d)===str);}

function ft_categoryHours_(start,end,c){const result={night:0,sunday:0,holiday:0};let t=+new Date(start),stop=+new Date(end);let guard=0;while(t<stop&&guard++<1000){const next=Math.min(stop,Math.floor(t/3600000+1)*3600000),mid=new Date((t+next)/2),hours=(next-t)/3600000;const local=ft_localDate_(mid),hour=Number(Utilities.formatDate(mid,FT_TZ,'H')),weekday=Number(Utilities.formatDate(mid,FT_TZ,'u'));const ns=Number(c.nightStart||22),ne=Number(c.nightEnd===0?0:c.nightEnd||6);if(ns<=ne?(hour>=ns&&hour<ne):(hour>=ns||hour<ne))result.night+=hours;if(weekday===7)result.sunday+=hours;if(ft_holiday_(local))result.holiday+=hours;t=next;}return result;}

function ft_activitySave_(actor,p){const uid=actor.role==='STAFF'?actor.id:p.userId||actor.id,u=ft_user_(actor,uid),c=ft_company_(actor,u.companyId);const type=String(p.type||'OBJECT');if(!['OBJECT','INCIDENT','OTHER'].includes(type))throw Error('Ungültige Tätigkeit');const start=ft_datetime_(p.start),end=ft_datetime_(p.end);if(end<=start||ft_hours_(start,end)>48)throw Error('Ende muss nach Beginn liegen; maximal 48 Stunden.');const br=ft_number_(p.breakMinutes||0,0,1440,'Pausen');if(br>=ft_hours_(start,end)*60)throw Error('Pause darf nicht die ganze Schicht umfassen.');const dates=[ft_localMonth_(start),ft_localMonth_(new Date(end.getTime()-1))];dates.forEach(m=>ft_requireMonthOpen_(c.id,u.id,m));const entries=ft_get_('Activities').filter(x=>x.companyId===c.id&&x.userId===u.id&&x.id!==p.id);if(entries.some(x=>ft_overlap_(start,end,x.start,x.end)>0))throw Error('Aktive Arbeitszeiten dürfen sich nicht überschneiden. Objektkontrollen während Bereitschaft sind erlaubt.');let row=p.id?ft_one_('Activities',p.id):null;if(p.id&&(!row||row.userId!==u.id||row.companyId!==c.id))throw Error('Zeiteintrag nicht gefunden');const before=row?ft_publicRow_(row):{};row=row||{id:ft_uuid_(),companyId:c.id,userId:u.id,createdAt:ft_now_()};Object.assign(row,{type,start:start.toISOString(),end:end.toISOString(),breakMinutes:br,object:ft_str_(p.object,150),description:ft_str_(p.description,1000),updatedAt:ft_now_()});if(row.__row)ft_save_('Activities',row);else ft_add_('Activities',row);ft_audit_(actor,p.id?'UPDATE':'CREATE','Activities',row.id,before,ft_publicRow_(row));return ft_publicRow_(row);}

function ft_activityDelete_(actor,p){const r=ft_one_('Activities',p.id);if(!r)throw Error('Eintrag nicht gefunden');ft_scope_(actor,r.companyId);if(actor.role==='STAFF'&&r.userId!==actor.id)throw Error('Keine Berechtigung');[ft_localMonth_(new Date(r.start)),ft_localMonth_(new Date(new Date(r.end).getTime()-1))].forEach(m=>ft_requireMonthOpen_(r.companyId,r.userId,m));ft_sheet_('Activities').deleteRow(r.__row);ft_audit_(actor,'DELETE','Activities',r.id,r,{});return true;}

function ft_leaveDays_(u,start,end){const work=String(u.workdays||'1,2,3,4,5').split(',').map(Number);const s=ft_date_(start),e=ft_date_(end);if(s>e||Math.round((e-s)/86400000)>100)throw Error('Ungültiger Urlaubszeitraum');let count=0;for(let d=new Date(s);d<=e;d.setDate(d.getDate()+1)){const weekday=Number(Utilities.formatDate(d,FT_TZ,'u'));if(work.includes(weekday)&&!ft_holiday_(ft_localDate_(d)))count++;}return count;}

function ft_leaveRequest_(actor,p){const u=actor.role==='STAFF'?actor:ft_user_(actor,p.userId||actor.id);ft_scope_(actor,u.companyId);const days=ft_leaveDays_(u,p.from,p.to);if(!days)throw Error('Der Zeitraum enthält keine konfigurierten Arbeitstage.');if(ft_get_('Leaves').some(x=>x.companyId===u.companyId&&x.userId===u.id&&x.status!=='REJECTED'&&!(p.to<x.from||p.from>x.to)))throw Error('Überlappender Urlaubsantrag vorhanden.');const row={id:ft_uuid_(),companyId:u.companyId,userId:u.id,from:p.from,to:p.to,days,creditHours:0,reason:ft_str_(p.reason,300),status:'PENDING',reviewerId:'',reviewedAt:'',createdAt:ft_now_()};ft_add_('Leaves',row);ft_audit_(actor,'REQUEST','Leaves',row.id,{},row);return row;}

function ft_leaveReview_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const l=ft_one_('Leaves',p.id);if(!l)throw Error('Antrag nicht gefunden');ft_scope_(actor,l.companyId);if(l.status!=='PENDING')throw Error('Dieser Antrag wurde bereits bearbeitet.');const u=ft_user_(actor,l.userId),before=ft_publicRow_(l),approve=p.status==='APPROVED';if(!approve&&p.status!=='REJECTED')throw Error('Ungültiger Status');if(approve){if(Number(u.leaveBalance)<Number(l.days))throw Error('Resturlaub reicht nicht aus');u.leaveBalance=ft_2_(Number(u.leaveBalance)-Number(l.days));l.creditHours=ft_number_(p.creditHours||0,0,300,'Urlaubs-Zeitgutschrift');ft_save_('Users',u);ft_audit_(actor,'LEAVE_BALANCE','Users',u.id,{leaveBalance:Number(u.leaveBalance)+Number(l.days)},{leaveBalance:u.leaveBalance});}l.status=p.status;l.reviewerId=actor.id;l.reviewedAt=ft_now_();ft_save_('Leaves',l);ft_audit_(actor,'REVIEW','Leaves',l.id,before,l);return l;}

// -----------------------------------------------------------------
// 06_Abrechnung
// -----------------------------------------------------------------
/** FireTime Pro V1.2 | Abrechnung mit firmenspezifischen Zuschlagsregeln.
 *  Ist-Arbeitszeiten und Bereitschaft werden getrennt ausgewiesen.
 */
function ft_report_(c,u,month,skipCumulative,source){
  source=source||{
    Activities:ft_get_('Activities'),Shifts:ft_get_('Shifts'),
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
  const shifts=source.Shifts.filter(s=>s.companyId===c.id&&s.userId===u.id&&
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
    const included=rule[k+'Types'];
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
        ft_leaveDays_(u,fromD,endD)/all;
    });
  const wage=Number(u.hourlyRate)||0;
  const rate=Number(rule.standbyRate)||0;
  t.basePay=t.worked*wage;
  t.standbyPay=t.standby*rate;
  // Zuschlagsbasis ist bei Bereitschaft der Bereitschaftssatz,
  // bei Tätigkeiten der Mitarbeiter-Stundensatz.
  for(const k of ['night','sunday','holiday']){
    const types=rule[k+'Types'];
    const base=types.reduce((sum,type)=>sum+
      hoursByType[type][k]*(type==='STANDBY'?rate:wage),0);
    t[k+'Pay']=base*(Number(rule[k+'Pct'])||0)/100;
  }
  t.leavePay=t.leaveCredit*wage;
  t.estimatedGross=t.basePay+t.standbyPay+t.nightPay+t.sundayPay+
    t.holidayPay+t.leavePay;
  t.saldo=t.worked+t.leaveCredit-t.target;
  // Keine Behauptung, dass gesetzliches Feiertagsarbeitsentgelt
  // damit bereits vollständig berechnet wäre.
  t.needsHolidayPayReview=t.statutoryHolidayWorkHours>0;
  if(!skipCumulative){
    let cur=ft_month_(u.startDate?u.startDate.slice(0,7):month);
    let balance=t.opening,n=0;
    while(cur<=month && n++<60){
      balance+=cur===month?t.saldo:ft_report_(c,u,cur,true,source).saldo;
      const [y,m]=cur.split('-').map(Number);
      cur=Utilities.formatDate(new Date(y,m,1,12),FT_TZ,'yyyy-MM');
    }
    t.runningBalance=balance;
    t.balanceLimited=n>=60;
  }
  for(const k of Object.keys(t))if(typeof t[k]==='number')t[k]=ft_2_(t[k]);
  return t;
}

function ft_monthSubmit_(actor,p){
 const uid=actor.role==='STAFF'?actor.id:p.userId||actor.id;
 const u=ft_user_(actor,uid),c=ft_company_(actor,u.companyId),month=ft_month_(p.month);
 if(month>ft_localMonth_(new Date()))throw Error('Zukünftige Monate können nicht eingereicht werden.');
 const pending=ft_get_('Shifts').find(s=>s.companyId===c.id&&s.userId===u.id&&
  s.status==='PUBLISHED'&&s.day.slice(0,7)===month&&s.actualStatus!=='DONE');
 if(pending)throw Error('Bereitschaft ist noch nicht bestätigt: '+pending.day);
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
  const c=ft_company_(actor,r.companyId),u=ft_user_(actor,r.userId);
  const snap=JSON.stringify(ft_report_(c,u,r.month));
  r.snapshot=snap;r.snapshotHash=ft_sha_(snap);
 }else{r.snapshot='';r.snapshotHash='';}
 r.status=p.status;r.note=ft_str_(p.note,500);
 r.reviewerId=actor.id;r.reviewedAt=ft_now_();
 ft_save_('Months',r);
 ft_audit_(actor,'REVIEW','Months',r.id,before,r);
 return r;
}
function ft_reportApi_(actor,p){
 const uid=actor.role==='STAFF'?actor.id:p.userId||actor.id;
 const u=ft_user_(actor,uid),c=ft_company_(actor,u.companyId),m=ft_month_(p.month);
 return {user:ft_safe_(u),company:ft_companyData_(c),report:ft_report_(c,u,m),
  entries:ft_get_('Activities').filter(a=>a.companyId===c.id&&a.userId===u.id&&
   ft_overlap_(a.start,a.end,...ft_monthBounds_(m))>0).map(ft_publicRow_)};
}
function ft_reportPdf_(actor,p){
 const {user,company,report:r,entries}=ft_reportApi_(actor,p);
 const doc=DocumentApp.create('FireTime Pro '+company.name+' '+user.name+' '+r.month);
 const body=doc.getBody();
 body.appendParagraph(company.name+' | FireTime Pro').setHeading(DocumentApp.ParagraphHeading.HEADING1);
 if(company.logoId){try{
  const blob=DriveApp.getFileById(company.logoId).getBlob();
  const img=body.insertImage(0,blob);
  if(img.getWidth()>170){const ratio=170/img.getWidth();img.setWidth(170);img.setHeight(Math.round(img.getHeight()*ratio));}
 }catch(e){Logger.log('Logo konnte nicht eingefügt werden: '+e);}}
 body.appendParagraph('Monatsbericht '+r.month).setHeading(DocumentApp.ParagraphHeading.HEADING2);
 body.appendParagraph('Mitarbeiter: '+user.name+' | '+user.email);
 const items=[
  ['Sollstunden',r.target+' h'],['Arbeit gesamt',r.worked+' h'],
  ['Objektkontrollen',r.object+' h'],['Bereitschaftseinsätze',r.incident+' h'],
  ['Bereitschaft netto',r.standby+' h'],
  ['Sonntagsarbeit (tatsächlich)',r.sunday+' h'],
  ['Feiertagsarbeit (tatsächlich)',r.holiday+' h'],
  ['Bereitschaft am Sonntag',r.standbySunday+' h'],
  ['Bereitschaft am Feiertag',r.standbyHoliday+' h'],
  ['Zuschlagsrelevante Sonntagsstunden (Firmenregel)',r.sundayPremiumHours+' h'],
  ['Zuschlagsrelevante Feiertagsstunden (Firmenregel)',r.holidayPremiumHours+' h'],
  ['Nachtarbeit',r.night+' h'],['Bereitschaft nachts',r.standbyNight+' h'],
  ['Sonntagszuschlag laut Firmenregel',r.sundayPay.toFixed(2)+' EUR'],
  ['Feiertagszuschlag laut Firmenregel',r.holidayPay.toFixed(2)+' EUR'],
  ['Nachtzuschlag laut Firmenregel',r.nightPay.toFixed(2)+' EUR'],
  ['Bereitschaftsentgelt',r.standbyPay.toFixed(2)+' EUR'],
  ['Monatssaldo',(r.saldo>=0?'+':'')+r.saldo+' h'],
  ['Geschätzte Summe',r.estimatedGross.toFixed(2)+' EUR']
 ];
 body.appendTable([['Position','Wert'],...items]);
 if(r.needsHolidayPayReview)body.appendParagraph(
  'ACHTUNG: Tatsächliche Arbeit an gesetzlichen Feiertagen erfasst. Feiertagsarbeitsentgelt, Feiertagsentgelt und kollektivvertragliche Ansprüche gesondert prüfen.');
 body.appendParagraph('Tätigkeitsnachweise').setHeading(DocumentApp.ParagraphHeading.HEADING2);
 const rows=entries.map(a=>[
  Utilities.formatDate(new Date(a.start),FT_TZ,'dd.MM.yyyy HH:mm'),
  Utilities.formatDate(new Date(a.end),FT_TZ,'dd.MM.yyyy HH:mm'),
  a.type,a.object||'',a.description||''
 ]);
 body.appendTable([['Beginn','Ende','Art','Objekt','Beschreibung'],...(rows.length?rows:[['–','–','–','–','Keine Einträge']])]);
 body.appendParagraph('Schätzung, keine rechtsverbindliche Lohnabrechnung. Sonderzahlungen und KV gesondert prüfen.');
 body.appendParagraph('Erstellt mit FireTime Pro · Developed by Michael Mejtsky');
 doc.saveAndClose();
 const folder=DriveApp.getFolderById(ft_prop_('FT_ROOT_ID'));
 const pdf=folder.createFile(DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF)
  .setName('FireTimePro_'+company.slug+'_'+user.name.replace(/[^a-z0-9äöü -]/gi,'_')+'_'+r.month+'.pdf'));
 DriveApp.getFileById(doc.getId()).setTrashed(true);
 ft_audit_(actor,'PDF','Reports',pdf.getId(),{}, {companyId:company.id,userId:user.id,month:r.month});
 const b=pdf.getBlob();
 if(b.getSize()>6*1024*1024)throw Error('PDF gespeichert, aber für Direktdownload zu groß.');
 return {name:pdf.getName(),data:'data:application/pdf;base64,'+Utilities.base64Encode(b.getBytes()),id:pdf.getId()};
}

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

function ft_planAssign_(actor,p){const {c,m}=ft_planCheck_(actor,p),day=ft_str_(p.day,10);if(!day.startsWith(m)||ft_localDate_(ft_date_(day))!==day)throw Error('Tag nicht im Monat');const uid=String(p.userId||''),u=uid?ft_user_(actor,uid):null;if(u&&u.companyId!==c.id)throw Error('Mitarbeiter gehört nicht zur Firma');if(u){const available=ft_get_('Availability').some(x=>x.companyId===c.id&&x.userId===uid&&x.month===m&&Number(x.day)===Number(day.slice(-2))&&x.answer==='YES');const submitted=ft_get_('AvailabilitySubmissions').some(x=>x.companyId===c.id&&x.userId===uid&&x.month===m);if((!available||!submitted)&&!p.confirmAvailability)throw Error('Keine bestätigte Verfügbarkeit. Ausnahme ausdrücklich bestätigen.');}const prev=ft_get_('Shifts').find(s=>s.companyId===c.id&&s.day===day),old=prev?ft_publicRow_(prev):{};if(prev&&prev.status==='PUBLISHED'&&!p.confirmChange)throw Error('Veröffentlichter Dienst: Änderung ausdrücklich bestätigen.');const bounds=ft_shiftRange_(day,c),r=prev||{id:ft_uuid_(),companyId:c.id,day,eventId:'',status:'DRAFT'};r.userId=uid;r.start=bounds[0].toISOString();r.end=bounds[1].toISOString();r.updatedAt=ft_now_();if(!prev)ft_add_('Shifts',r);else ft_save_('Shifts',r);ft_audit_(actor,'ASSIGN','Shifts',r.id,old,r);if(prev&&prev.status==='PUBLISHED'&&ft_bool_(c.calendarOn)){try{ft_syncShift_(c,r,old);}catch(e){return {row:r,warning:'Kalenderaktualisierung fehlgeschlagen: '+e.message};}}return {row:r};}

function ft_planPublish_(actor,p){const {c,m}=ft_planCheck_(actor,p),all=ft_get_('Shifts').filter(x=>x.companyId===c.id&&x.day.startsWith(m)),gaps=[];for(let d=1;d<=ft_days_(m);d++){const day=m+'-'+String(d).padStart(2,'0');if(!all.some(x=>x.day===day&&x.userId))gaps.push(day);}if(gaps.length)throw Error('Noch unbesetzte Tage: '+gaps.join(', '));if(ft_bool_(c.calendarOn))ft_calendar_(c);let published=0,warnings=[];
 all.forEach(row=>{if(row.status==='PUBLISHED'&&(!ft_bool_(c.calendarOn)||row.eventId))return;const prev=ft_publicRow_(row);row.status='PUBLISHED';row.updatedAt=ft_now_();ft_save_('Shifts',row);ft_audit_(actor,'PUBLISH','Shifts',row.id,prev,row);published++;if(ft_bool_(c.calendarOn)){try{ft_syncShift_(c,row,prev);}catch(e){warnings.push(row.day+': '+e.message);}}});return {published,warnings,calendarEnabled:ft_bool_(c.calendarOn)};}

/** Bestätigung der tatsächlich geleisteten Bereitschaft durch Mitarbeiter/Administrator. */

function ft_shiftConfirm_(actor,p){const s=ft_one_('Shifts',p.id);if(!s)throw Error('Dienst nicht gefunden');ft_scope_(actor,s.companyId);if(actor.role==='STAFF'&&s.userId!==actor.id)throw Error('Nur den eigenen Dienst bestätigen.');if(s.status!=='PUBLISHED'||!s.userId)throw Error('Nur veröffentlichte, besetzte Dienste sind bestätigbar.');if(new Date(s.end)>new Date())throw Error('Dienst ist noch nicht beendet.');const before=ft_publicRow_(s);s.actualStatus='DONE';s.confirmedAt=ft_now_();ft_save_('Shifts',s);ft_audit_(actor,'CONFIRM','Shifts',s.id,before,s);return {ok:true};}

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

function ft_tick(){return ft_lock_(()=>{const now=new Date(),day=Number(Utilities.formatDate(now,FT_TZ,'d')),hour=Number(Utilities.formatDate(now,FT_TZ,'H')),month=ft_localMonth_(now),[y,m]=month.split('-').map(Number),next=Utilities.formatDate(new Date(y,m,1,12),FT_TZ,'yyyy-MM'),last=new Date(y,m,0).getDate();const web=ft_publicGithubUrl_();const companies=ft_get_('Companies').filter(c=>ft_bool_(c.active)),users=ft_get_('Users').filter(x=>x.status==='ACTIVE'&&x.role!=='SYSADMIN');let count=0;
 for(const c of companies){const us=users.filter(u=>u.companyId===c.id);
  if(ft_bool_(c.remindAvailability)&&day===Number(c.availabilityDay||20)&&hour>=9&&hour<=23){const completed=new Set(ft_get_('AvailabilitySubmissions').filter(s=>s.companyId===c.id&&s.month===next).map(s=>s.userId));for(const u of us)if(!completed.has(u.id)){if(ft_notification_(c,u,'AVAILABILITY',next,'Bereitschaft '+next+' noch nicht eingetragen','Hallo '+u.name+'!\n\nBitte gib deine Verfügbarkeit für '+next+' in FireTime Pro bekannt. Auch wenn du nicht verfügbar bist, schließe die Monatsmeldung ab.\n\n'+web+'\n\nBereitschaftsplanung '+c.name))count++;}}
  if(ft_bool_(c.remindHours)&&day===last&&hour>=19){const completed=new Set(ft_get_('Months').filter(r=>r.companyId===c.id&&r.month===month&&['SUBMITTED','APPROVED','FINAL'].includes(r.status)).map(r=>r.userId));for(const u of us)if(!completed.has(u.id)){if(ft_notification_(c,u,'HOURS',month,'FireTime Pro – Stunden '+month+' noch nicht abgeschlossen','Hallo '+u.name+'!\n\nBitte kontrolliere deine Stunden für '+month+' und reiche den Monat in FireTime Pro ein, sobald alle Tätigkeiten vollständig sind.\n\n'+web+'\n\n'+c.name))count++;}}
  if(ft_bool_(c.remindShift)){const shifts=ft_get_('Shifts').filter(s=>s.companyId===c.id&&s.status==='PUBLISHED'&&s.userId&&new Date(s.start)>now&&new Date(s.start).getTime()-now.getTime()<=24*3600000);for(const s of shifts){const u=us.find(z=>z.id===s.userId);if(u&&ft_notification_(c,u,'SHIFT',s.id+'-'+s.start,'Erinnerung: Bereitschaftsdienst morgen – '+c.name,'Hallo '+u.name+'!\n\nDein Bereitschaftsdienst beginnt am '+Utilities.formatDate(new Date(s.start),FT_TZ,'dd.MM.yyyy HH:mm')+' Uhr und endet am '+Utilities.formatDate(new Date(s.end),FT_TZ,'dd.MM.yyyy HH:mm')+' Uhr.\n\n'+web+'\n\n'+c.name))count++;}}
 }
 // Abgelaufene Sitzungen und alte Einladungen gelegentlich bereinigen, rückwärts wegen Zeilenverschiebung.
 if(hour===3){for(const tab of ['Sessions','Invites'])ft_get_(tab).filter(x=>tab==='Sessions'?new Date(x.expiresAt)<now:(x.usedAt||new Date(x.expiresAt)<now)).sort((a,b)=>b.__row-a.__row).forEach(x=>ft_sheet_(tab).deleteRow(x.__row));}
 return {sent:count,checked:ft_now_()};});}

function ft_remindOne_(actor,p){ft_allowed_(actor,['SYSADMIN','ADMIN']);const u=ft_user_(actor,p.userId),c=ft_company_(actor,u.companyId),m=ft_month_(p.month),kind=String(p.kind);if(u.status!=='ACTIVE')throw Error('Nur aktive Mitarbeiter können erinnert werden.');if(!['AVAILABILITY','HOURS'].includes(kind))throw Error('Ungültige Erinnerung');if(kind==='AVAILABILITY'&&ft_get_('AvailabilitySubmissions').some(s=>s.userId===u.id&&s.month===m))throw Error('Verfügbarkeit wurde bereits abgegeben.');if(kind==='HOURS'&&ft_get_('Months').some(s=>s.userId===u.id&&s.month===m&&['SUBMITTED','APPROVED','FINAL'].includes(s.status)))throw Error('Stunden sind bereits eingereicht.');const body='Hallo '+u.name+'!\n\nBitte vervollständige deine '+(kind==='HOURS'?'Stunden':'Verfügbarkeitsmeldung')+' für '+m+' in FireTime Pro.\n\n'+ft_publicGithubUrl_()+'\n\n'+c.name;return {sent:ft_notification_(c,u,kind+'-MANUAL',m+'-'+Utilities.formatDate(new Date(),FT_TZ,'yyyyMMddHHmm'), 'FireTime Pro – Erinnerung '+m,body)};}

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
  case 'activitySave':return ft_lock_(()=>ft_activitySave_(u,p));
  case 'activityDelete':return ft_lock_(()=>ft_activityDelete_(u,p));
  case 'availabilitySave':return ft_lock_(()=>ft_availabilitySave_(u,p));
  case 'availabilitySubmit':return ft_lock_(()=>ft_availabilitySubmit_(u,p));
  case 'planSuggest':return ft_lock_(()=>ft_planSuggest_(u,p));
  case 'planAssign':return ft_lock_(()=>ft_planAssign_(u,p));
  case 'planPublish':return ft_lock_(()=>ft_publishStandby_(u,p));
  case 'shiftConfirm':return ft_lock_(()=>ft_shiftConfirm_(u,p));
  case 'workSave':return ft_lock_(()=>ft_workSave_(u,p));
  case 'workDelete':return ft_lock_(()=>ft_workDelete_(u,p));
  case 'workPublish':return ft_lock_(()=>ft_workPublish_(u,p));
  case 'leaveRequest':return ft_lock_(()=>ft_leaveRequest_(u,p));
  case 'leaveReview':return ft_lock_(()=>ft_leaveReview_(u,p));
  case 'monthSubmit':return ft_lock_(()=>ft_monthSubmit_(u,p));
  case 'monthReview':return ft_lock_(()=>ft_monthReview_(u,p));
  case 'report':return ft_reportApi_(u,p);
  case 'pdf':return ft_reportPdf_(u,p);
  case 'rulesGet':return ft_rulesApi_(u,p);
  case 'rulesSave':return ft_lock_(()=>ft_rulesSave_(u,p));
  case 'calendarTest':return ft_calendarTest_(u,p.companyId||u.companyId);
  case 'audit':return ft_auditApi_(u,p);
  case 'remindOne':return ft_lock_(()=>ft_remindOne_(u,p));
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
 const directory=c?ft_get_('Users').filter(x=>x.companyId===c.id&&x.status==='ACTIVE').map(x=>({id:x.id,name:x.name})):[];
 const users=c?ft_get_('Users').filter(x=>x.companyId===c.id&&(isAdmin||x.id===u.id)).map(ft_safe_):[];
 const within=x=>x.companyId===c.id&&(isAdmin||x.userId===u.id);
 const activities=c&&access('TIME')?ft_get_('Activities').filter(within).map(ft_publicRow_):[];
 const availability=c&&access('AVAILABILITY')?ft_get_('Availability').filter(x=>within(x)&&x.month===month).map(ft_publicRow_):[];
 const availSubmissions=c&&access('AVAILABILITY')?ft_get_('AvailabilitySubmissions').filter(x=>within(x)&&x.month===month).map(ft_publicRow_):[];
 const shifts=c&&access('STANDBY')?ft_get_('Shifts').filter(x=>x.companyId===c.id&&x.day.startsWith(month)&&(isAdmin||x.status==='PUBLISHED')).map(ft_publicRow_):[];
 const workShifts=c&&access('WORKPLAN')?ft_workRows_().filter(x=>within(x)&&
  (x.start.slice(0,7)===month||x.end.slice(0,7)===month)&&
  (isAdmin||x.status==='PUBLISHED')).map(ft_publicRow_):[];
 const leaves=c&&access('LEAVE')?ft_get_('Leaves').filter(within).map(ft_publicRow_):[];
 const months=c&&access('REPORTS')?ft_get_('Months').filter(within).map(ft_publicRow_):[];
 const reports={};
 if(c&&access('REPORTS')){
  const source={Activities:ft_get_('Activities'),Shifts:ft_get_('Shifts'),
   Leaves:ft_get_('Leaves'),Months:ft_get_('Months')};
  users.forEach(x=>reports[x.id]=ft_report_(c,x,month,false,source));
 }
 return {me:ft_safe_(u),month,company:c?ft_companyData_(c):null,
  logo:c?ft_logoData_(c):'',companies,modules:mods,profile:c?ft_profileFor_(c):null,
  loginUrl:c?ft_clientUrl_(c):'',directory,users,activities,availability,
  availSubmissions,shifts,workShifts,leaves,months,reports};
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
const FT_MODULES_=['TIME','REPORTS','LEAVE','WORKPLAN','STANDBY','AVAILABILITY','CALENDAR'];
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
 if(!r)return c.slug==='bsb3100'?FT_MODULES_.slice():['TIME','REPORTS','LEAVE'];
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
  activitySave:'TIME',activityDelete:'TIME',
  monthSubmit:'REPORTS',monthReview:'REPORTS',report:'REPORTS',pdf:'REPORTS',
  leaveRequest:'LEAVE',leaveReview:'LEAVE',
  availabilitySave:'AVAILABILITY',availabilitySubmit:'AVAILABILITY',
  planSuggest:'STANDBY',planAssign:'STANDBY',planPublish:'STANDBY',shiftConfirm:'STANDBY',
  workSave:'WORKPLAN',workPublish:'WORKPLAN',workDelete:'WORKPLAN',
  rulesGet:'REPORTS',rulesSave:'REPORTS',
  calendarTest:'CALENDAR'
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
 const sh=ft_profileSheet_(false);if(!sh||sh.getLastRow()<2)return [];
 return sh.getRange(2,1,sh.getLastRow()-1,FT_PROFILE_COLS_.length).getValues().map((v,i)=>{
  const o={__row:i+2};FT_PROFILE_COLS_.forEach((k,j)=>o[k]=v[j]);return o;
 });
}
function ft_profileFor_(c){
 const r=ft_profileRows_().find(x=>String(x.companyId)===String(c.id));
 const def={companyId:c.id,workModel:c.slug==='bsb3100'?'FLEX':'OFFICE',
  workStart:'08:00',workHours:8,workdays:'1,2,3,4,5',
  standbyStart:'07:00',standbyHours:24,secondaryColor:'#19354d',welcomeText:''};
 return Object.assign(def,r?{
  id:r.id,workModel:r.workModel,workStart:r.workStart,workHours:Number(r.workHours)||8,
  workdays:r.workdays,standbyStart:r.standbyStart,standbyHours:Number(r.standbyHours)||24,
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
 ft_audit_(actor,'PROFILE','CompanyProfiles',row.id,old||{},row);
 return ft_profileFor_(c);
}
function ft_publicGithubUrl_(){
 const url=String(PropertiesService.getScriptProperties()
  .getProperty('FT_PUBLIC_GITHUB_URL')||'').replace(/\/+$/,'');
 if(!/^https:\/\/[^/]+\/[^?#]+$/.test(url))throw Error('FT_PUBLIC_GITHUB_URL in Skripteigenschaften eintragen.');
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
  const s = ft_ruleSheet_(false);
  if (!s || s.getLastRow() < 2) return [];
  return s.getRange(2,1,s.getLastRow()-1,FT_RULE_HEADERS_.length).getValues()
    .map((row,i)=>Object.fromEntries([['__row',i+2],...FT_RULE_HEADERS_.map((k,j)=>[k,row[j] instanceof Date?row[j].toISOString():row[j]])]));
}
function ft_ruleTypeArray_(val,def) {
  if (val===undefined || val===null || val==='') return def.slice();
  const arr=Array.isArray(val)?val:String(val).split(',');
  const a=[...new Set(arr.map(x=>String(x).trim().toUpperCase()))].filter(Boolean);
  if(a.some(x=>!FT_RULE_TYPES_.includes(x))) throw Error('Unbekannte Tätigkeitsart in der Zuschlagsregel.');
  return a;
}
function ft_ruleDefault_(c) {
  // BSB3100: freiwillige Objektkontrolle erhält keinen freiwilligen Sonn-/Feiertagszuschlag.
  // Gesetzliche/KV-Zahlungen werden dadurch NICHT aufgehoben.
  const bsb=String(c.slug||'').toLowerCase()==='bsb3100';
  return {
    companyId:c.id,effectiveMonth:'2026-01',
    nightTypes:['OBJECT','INCIDENT','OTHER'],
    sundayTypes:bsb?['STANDBY']:['STANDBY','OBJECT','INCIDENT','OTHER'],
    holidayTypes:bsb?['STANDBY']:['STANDBY','OBJECT','INCIDENT','OTHER'],
    nightPct:Number(c.nightPct)||0,
    sundayPct:Number(c.sundayPct)||0,
    holidayPct:Number(c.holidayPct)||0,
    standbyRate:Number(c.standbyRate)||0,
    holidayCalendar:'AT',extraHolidays:[],
    note:bsb?'BSB3100: firmeneigene Sonn-/Feiertagszuschläge nur für Bereitschaft. Gesetzliche Feiertagsarbeit gesondert prüfen.':'Firmenregel bitte mit Vertrag und Kollektivvertrag abgleichen.',
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
    nightTypes:ft_ruleTypeArray_(r.nightTypes,[]),
    sundayTypes:ft_ruleTypeArray_(r.sundayTypes,[]),
    holidayTypes:ft_ruleTypeArray_(r.holidayTypes,[]),
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
  return {
    id:ft_uuid_(),companyId:c.id,effectiveMonth,
    nightTypes:ft_ruleTypeArray_(p.nightTypes,[]).join(','),
    sundayTypes:ft_ruleTypeArray_(p.sundayTypes,[]).join(','),
    holidayTypes:ft_ruleTypeArray_(p.holidayTypes,[]).join(','),
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
function doPost(e) {
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
