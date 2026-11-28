import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPdf} from '../dist/pdf.mjs';

test('PDF wrapping keeps long wide words inside paragraph and table cell margins',()=>{
 const pdf=renderPdf([{kind:'paragraph',text:'W'.repeat(200),size:12},
  {kind:'table',header:true,rows:[[{text:'Text'},{text:'Stunden'}],[{text:'W'.repeat(150)},{text:'12,50 h'}]]}]).toString('latin1');
 const text=[...pdf.matchAll(/BT \/F[12] ([\d.]+) Tf [^\n]*?([\d.]+) ([\d.]+) Td \((W+)\) Tj ET/g)];
 assert.ok(text.length>1);
 for(const [,size,x,,words] of text){
  // Standard Helvetica advance width of W is 944/1000 em.
  const right=Number(x)+words.length*Number(size)*0.944;
  assert.ok(right<=(Number(x)===49?290:552)+0.01,'Text overflows its PDF column: '+right);
 }
 assert.equal(text.reduce((sum,r)=>sum+r[4].length,0),350,'No characters may be lost');
});
test('PDF tables with many rows repeat their header and keep notes on valid pages',()=>{
 const rows=[[{text:'DATUM'},{text:'STUNDEN'}],...Array.from({length:90},(_,i)=>[{text:String(i+1)+'. November'},{text:'7,50 h'}])];
 const pdf=renderPdf([{kind:'table',header:true,rows}]).toString('latin1');
 const count=Number(pdf.match(/\/Type \/Pages \/Count (\d+)/)[1]);assert.ok(count>=3);
 assert.equal([...pdf.matchAll(/\(DATUM\) Tj/g)].length,count);
 assert.equal([...pdf.matchAll(/\(7,50 h\) Tj/g)].length,90);
});
