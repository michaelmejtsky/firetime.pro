'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function ftCommPhotoPreview_(file){');
const end=html.indexOf('function ftCommNotificationState_()',start);
assert.ok(start>=0&&end>start,'attachment viewer function must exist');
const source=html.slice(start,end);

function viewer(userAgent,canShare=false){
 const created=[],revoked=[];
 class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.events={};created.push(this);}
  append(...items){this.children.push(...items);}
  setAttribute(k,v){this[k]=v;}
  addEventListener(k,cb){this.events[k]=cb;}
  showModal(){this.open=true;}
  close(){this.open=false;this.events.close?.();}
  remove(){this.removed=true;}
 }
 const document={createElement:tag=>new Element(tag),body:new Element('body')};
 const navigator={userAgent,platform:'iPhone',maxTouchPoints:5,
  canShare:()=>canShare,share:async()=>{}};
 const url={createObjectURL:()=> 'blob:private-pdf-test',revokeObjectURL:v=>revoked.push(v)};
 const context={document,navigator,URL:url,Blob,File:class File extends Blob{
  constructor(parts,name,opts){super(parts,opts);this.name=name;}
 },Uint8Array,atob};
 const fn=vm.runInNewContext(source+';ftCommPhotoPreview_',context);
 const bytes=Buffer.from('%PDF-1.4\nexample PDF');
 const dialog=fn({data:bytes.toString('base64'),mime:'application/pdf',name:'Schichtplan.pdf'});
 return {created,dialog,revoked};
}
test('mobile PDF does not create a black-screen iframe and offers native file actions',()=>{
 const r=viewer('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',true);
 assert.equal(r.created.filter(x=>x.tagName==='iframe').length,0);
 assert.ok(r.created.some(x=>x.tagName==='a'&&x.download==='Schichtplan.pdf'));
 assert.ok(r.created.some(x=>x.tagName==='a'&&x.target==='_blank'));
 assert.ok(r.created.some(x=>x.tagName==='button'&&x.textContent==='PDF teilen / in Dateien sichern'));
 assert.equal(r.dialog.open,true);
 r.dialog.close();
 assert.deepEqual(r.revoked,['blob:private-pdf-test']);
});
test('desktop retains multi-page PDF preview plus download',()=>{
 const r=viewer('Mozilla/5.0 (Windows NT 10.0; Win64; x64)',false);
 assert.equal(r.created.filter(x=>x.tagName==='iframe').length,1);
 assert.ok(r.created.some(x=>x.tagName==='a'&&x.download==='Schichtplan.pdf'));
});
test('mobile without native share still offers download and external open',()=>{
 const r=viewer('Mozilla/5.0 (Linux; Android 15; Pixel)',false);
 assert.equal(r.created.filter(x=>x.tagName==='iframe').length,0);
 assert.ok(r.created.some(x=>x.tagName==='a'&&x.download==='Schichtplan.pdf'));
 assert.ok(r.created.some(x=>x.tagName==='a'&&x.target==='_blank'));
});
