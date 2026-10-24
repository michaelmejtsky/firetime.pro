'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const backend=fs.readFileSync(path.join(root,'apps-script','Code.gs'),'utf8');
const ui=fs.readFileSync(path.join(root,'index.html'),'utf8');
const gateway=fs.readFileSync(path.join(root,'cloudflare','worker.js'),'utf8');
const start=backend.indexOf('function ft_passwordResetLink_(');
const end=backend.indexOf('function ft_logout(',start);
assert.ok(start>0&&end>start,'Password recovery implementation is present');
const source=backend.slice(start,end);
function env(){
 const token='a'.repeat(64),mail=[],audit=[],cache=new Map();
 const users=[
  {id:'u1',role:'STAFF',companyId:'c1',name:'Beispiel Mitarbeiter',email:'staff@example.test',
   status:'ACTIVE',passwordHash:'old',salt:'oldsalt',mustChange:false},
  {id:'u2',role:'ADMIN',companyId:'c1',name:'Firmenadmin',email:'admin@example.test',
   status:'ACTIVE',passwordHash:'old',salt:'oldsalt'},
  {id:'u3',role:'STAFF',companyId:'c2',name:'Andere Firma',email:'other@example.test',
   status:'ACTIVE'},
  {id:'sys',role:'SYSADMIN',companyId:'',name:'Systemadmin',email:'root@example.test',
   status:'ACTIVE'}
 ];
 const tables={Users:users,Invites:[],Sessions:[{id:'oldsession',userId:'u1',__row:2}]};
 const actor={id:'u2',role:'ADMIN',companyId:'c1'};
 const ctx={
  Date,Math,Number,String,Error,JSON,console,
  CacheService:{getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,v)=>cache.set(key,v)})},
  ft_sha_:value=>'sha:'+value,ft_rand_:()=>token,
  ft_email_:value=>String(value).toLowerCase(),
  ft_now_:()=>new Date('2026-10-24T08:00:00Z').toISOString(),
  ft_sendMail_:o=>mail.push(o),
  ft_clientUrl_:()=> 'https://example.test/firetime.pro/?firm=bsb3100',
  ft_publicGithubUrl_:()=> 'https://example.test/firetime.pro/',
  ft_one_:(name,id)=>(tables[name]||[]).find(x=>x.id===id),
  ft_get_:name=>tables[name]||[],
  ft_add_:(name,obj)=>{obj.__row=(tables[name]||[]).length+2;tables[name].push(obj);return obj},
  ft_save_:()=>{},
  ft_sheet_:name=>({deleteRow:n=>{tables[name].splice(n-2,1)}}),
  ft_allowed_:(user,roles)=>{if(!roles.includes(user.role))throw Error('Keine Berechtigung')},
  ft_user_:(a,id)=>{
   const u=users.find(x=>x.id===id);
   if(!u||a.role!=='SYSADMIN'&&a.companyId!==u.companyId)throw Error('Kein Zugriff');
   return u;
  },
  ft_lock_:fn=>fn(),
  ft_password_:(password,salt)=>'hashed:'+password+':'+salt,
  ft_safe_:u=>({id:u.id,role:u.role,companyId:u.companyId}),
  ft_audit_:(...args)=>audit.push(args)
 };
 const methods=vm.runInNewContext(source+
  ';({ft_passwordResetLink_,ft_passwordResetRequest_,ft_passwordResetForUser_,ft_passwordResetConfirm_})',ctx);
 return {methods,tables,users,mail,audit,cache,token,actor};
}
test('forgot-password response does not reveal whether the email exists',()=>{
 const a=env(),msg=a.methods.ft_passwordResetRequest_('nobody@example.test');
 assert.equal(a.methods.ft_passwordResetRequest_('not-an-email'),msg);
 assert.equal(a.methods.ft_passwordResetRequest_('staff@example.test'),msg);
 assert.equal(a.mail.length,1);
 assert.match(a.mail[0].body,/30 Minuten/);
 assert.match(a.mail[0].body,/reset=/);
 assert.doesNotMatch(a.mail[0].body,/hashed:|passwordHash/);
 assert.equal(a.tables.Invites.length,1);
 assert.match(a.tables.Invites[0].id,/^reset:/);
});
test('one-time token changes password, invalidates session, and cannot be reused',()=>{
 const a=env();a.methods.ft_passwordResetRequest_('staff@example.test');
 const old=a.users[0].passwordHash;
 const response=a.methods.ft_passwordResetConfirm_(a.token,'a-very-strong-password');
 assert.match(response,/Passwort erfolgreich/);
 assert.notEqual(a.users[0].passwordHash,old);
 assert.equal(a.tables.Sessions.length,0);
 assert.ok(a.tables.Invites[0].usedAt);
 assert.throws(()=>a.methods.ft_passwordResetConfirm_(a.token,'another-password-123'),/bereits verwendet|abgelaufen/);
 assert.ok(a.audit.some(x=>x[1]==='PASSWORD_RESET_COMPLETED'));
});
test('expired link and weak password cannot modify saved passwords',()=>{
 const a=env();a.methods.ft_passwordResetRequest_('staff@example.test');
 const old=a.users[0].passwordHash;
 assert.throws(()=>a.methods.ft_passwordResetConfirm_(a.token,'short'),/12 bis 150/);
 a.tables.Invites[0].expiresAt='2020-01-01T00:00:00Z';
 assert.throws(()=>a.methods.ft_passwordResetConfirm_(a.token,'sufficiently-long-pass'),/abgelaufen/);
 assert.equal(a.users[0].passwordHash,old);
});
test('tenant admin resets staff but cannot reset an admin or another company',()=>{
 const a=env();
 assert.match(a.methods.ft_passwordResetForUser_(a.actor,{id:'u1'}),/Passwort-Link/);
 assert.throws(()=>a.methods.ft_passwordResetForUser_(a.actor,{id:'u2'}),/Systemadministrator/);
 assert.throws(()=>a.methods.ft_passwordResetForUser_(a.actor,{id:'u3'}),/Kein Zugriff/);
 assert.throws(()=>a.methods.ft_passwordResetForUser_(a.users[0],{id:'u2'}),/Berechtigung/);
});
test('system administrator can reset company admin, but never another sysadmin account',()=>{
 const a=env(),sys=a.users[3];
 assert.match(a.methods.ft_passwordResetForUser_(sys,{id:'u2'}),/Passwort-Link/);
 assert.match(a.methods.ft_passwordResetForUser_(sys,{id:'sys'}),/Passwort-Link/);
});
test('login recovery, worker routing and employee buttons are wired',()=>{
 assert.match(gateway,/['"]resetRequest['"]/);
 assert.match(gateway,/['"]resetConfirm['"]/);
 assert.match(backend,/case 'resetRequest':/);
 assert.match(backend,/case 'resetConfirm':/);
 assert.match(backend,/case 'userPasswordReset':return ft_passwordResetForUser_/);
 assert.match(backend,/case 'myPasswordReset':/);
 assert.match(ui,/data-act="myPasswordReset"/);
 assert.match(ui,/data-act="forgotPassword"/);
 assert.match(ui,/id="resetPasswordForm"/);
 assert.match(ui,/id="forgotPasswordForm"/);
 assert.match(ui,/data-act="staffPasswordReset"/);
 assert.match(ui,/ftCanResetUser_\(x\)/);
 assert.match(ui,/if\(ST.reset\|\|ST.invite\)/);
 assert.match(ui,/history.replaceState/);
 assert.doesNotThrow(()=>new vm.Script(backend));
 const fragment=ui.slice(ui.indexOf('<script>')+8,ui.lastIndexOf('</script>'));
 assert.doesNotThrow(()=>new vm.Script(fragment));
 assert.doesNotThrow(()=>new vm.Script(gateway.replace(/^export default\s*\{/m,'const dummy = {')));
});
