'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),backend=fs.readFileSync(path.join(root,'apps-script','Code.gs'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const from=backend.indexOf('function ft_commPhotoSave_(actor,c,picture){');
const to=backend.indexOf('function ft_commList_(actor,p){',from);
assert.ok(from>=0&&to>from,'Private attachment functions present');
function testEnv(){
 const saved=[],actor={id:'u1',companyId:'firm1'},thread={id:'thread1',companyId:'firm1',
  createdBy:'u1',recipientId:'u2',attachmentId:'',kind:'MESSAGE'};
 const fileDB=new Map();let next=0;
 const Utilities={
  base64Decode:s=>[...Buffer.from(s,'base64')],
  base64Encode:bytes=>Buffer.from(bytes.map(x=>x&255)).toString('base64'),
  newBlob:(bytes,mime,name)=>({getBytes:()=>bytes,getContentType:()=>mime,getName:()=>name})
 };
 const folder={createFile:blob=>{
  const id='photo_'+(++next);fileDB.set(id,blob);saved.push({id,mime:blob.getContentType(),name:blob.getName()});
  return {getId:()=>id};
 }};
 const ctx={Utilities,DriveApp:{
  getFolderById:()=>({getFoldersByName:()=>({hasNext:()=>true,next:()=>folder})}),
  getFileById:id=>({getBlob:()=>fileDB.get(id),getName:()=>fileDB.get(id)?.getName()})
 },ft_prop_:()=> 'folder',ft_uuid_:()=> 'upload',ft_commThread_:(a,id)=>{
  if(a.id!==actor.id||id!==thread.id)throw Error('Nicht berechtigt');
  return thread;
 },ft_commReplies_:()=>[],String,Math,Number,Date,Error,Boolean,console};
 const api=vm.runInNewContext(backend.slice(from,to)+
  ';({ft_commPhotoSave_,ft_commPhoto_})',ctx);
 return {api,actor,thread,saved};
}
test('private multi-page PDF is uploaded and all original pages survive retrieval',()=>{
 const e=testEnv();
 const bytes=Buffer.concat([
  Buffer.from('%PDF-1.7\n1 0 obj\n/Type /Page\nendobj\n2 0 obj\n/Type /Page\nendobj\n%%EOF\n'),
  Buffer.alloc(2_200_000,32) // Regression: an originally valid PDF over the old 2 MB limit.
 ]);
 const id=e.api.ft_commPhotoSave_(e.actor,{id:'firm1'},
  {mime:'application/pdf',name:'Protokoll zweiseitig.pdf',data:bytes.toString('base64')});
 assert.equal(e.saved[0].mime,'application/pdf');
 e.thread.attachmentId=id;
 const read=e.api.ft_commPhoto_(e.actor,{threadId:'thread1',attachmentId:id});
 assert.equal(read.mime,'application/pdf');
 assert.deepEqual(Buffer.from(read.data,'base64'),bytes);
 assert.equal((Buffer.from(read.data,'base64').toString().match(/\/Type \/Page/g)||[]).length,2);
 assert.match(read.name,/\.pdf$/);
});
test('fake PDF and over-limit payload are rejected server-side',()=>{
 const e=testEnv();
 assert.throws(()=>e.api.ft_commPhotoSave_(e.actor,{id:'firm1'},
  {mime:'application/pdf',data:Buffer.from('this is not a PDF').toString('base64')}),/Dateityp|Format/);
 assert.throws(()=>e.api.ft_commPhotoSave_(e.actor,{id:'firm1'},
  {mime:'application/pdf',data:'A'.repeat(Math.ceil(10*1024*1024*4/3)+16)}),/groß/);
});
test('only the authorized participants can fetch private photos or PDFs',()=>{
 const e=testEnv();
 e.thread.attachmentId='secret';
 assert.throws(()=>e.api.ft_commPhoto_({id:'outsider',companyId:'firm2'},
  {threadId:'thread1',attachmentId:'secret'}),/berechtigt/);
});
test('message and reply accept PDFs, task completion still requires a photo',()=>{
 assert.match(html,/accept="image\/jpeg,image\/png,application\/pdf,\.pdf"/);
 assert.match(html,/Mehrseitiges PDF-Dokument/);
 assert.match(html,/height:min\(73vh,780px\)/);
 assert.match(html,/Abschlussfoto \(Pflicht\)/);
 assert.match(backend,/if\(!p\.photo\)throw Error\('Zum Abschließen der Aufgabe ist ein Foto/);
 assert.match(html,/\.ft-msg-layout\{display:flex;flex-direction:column/);
});
