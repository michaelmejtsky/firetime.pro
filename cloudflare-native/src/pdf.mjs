import {Buffer} from 'node:buffer';
// Small, synchronous PDF renderer: A4, wrapping, page breaks, WinAnsi German text.
// Every numeric report value still originates from the unchanged accounting core.
function win(s){return String(s).replace(/€/g,'\x80').replace(/[–—]/g,'-').replace(/…/g,'...').replace(/[^\x20-\xFF\n]/g,'?');}
function literal(s){return win(s).replace(/[\\()]/g,'\\$&').replace(/[\r\n]/g,' ');}
function wrap(text,width){const words=String(text).split(/\s+/),lines=[];let line='';for(let word of words){while(word.length>width){if(line){lines.push(line);line='';}lines.push(word.slice(0,width));word=word.slice(width);}if((line+' '+word).length>width&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line||!lines.length)lines.push(line);return lines;}
export function renderPdf(blocks){
 const pages=[];let commands=[],y=798;
 const page=()=>{if(commands.length)pages.push(commands.join('\n'));commands=[];y=798;};
 const line=(text,x=42,size=9,bold=false)=>{if(y<45)page();commands.push(`BT /${bold?'F2':'F1'} ${size} Tf 0.08 0.15 0.24 rg ${x} ${y} Td (${literal(text)}) Tj ET`);};
 for(const block of blocks){
  if(block.kind==='table'){
   const n=Math.max(1,...block.rows.map(x=>x.length)),width=510/n,chars=Math.max(7,Math.floor(width/4.6)-3);
   for(const row of block.rows){const cells=row.map(c=>wrap(c.text,chars)),count=Math.max(...cells.map(c=>c.length));
    for(let i=0;i<count;i++){if(y<45)page();for(let c=0;c<cells.length;c++)if(cells[c][i])line(cells[c][i],42+c*width,8.2,row[c].bold);y-=12;}y-=5;
   }
  }else{const size=block.size||9;for(const text of String(block.text).split('\n'))for(const ln of wrap(text,Math.floor(510/(size*.53)))){line(ln,42,size,block.bold);y-=size+4;}y-=5;}
 }
 page();if(!pages.length)pages.push('');
 const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
 const kids=[];for(const content of pages){const id=objects.length;kids.push(`${id} 0 R`);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id+1} 0 R >>`);objects.push(`<< /Length ${Buffer.byteLength(content,'latin1')} >>\nstream\n${content}\nendstream`);}
 objects[2]=`<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
 let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';const offsets=[0];for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,'latin1'));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf,'latin1');pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(pdf,'latin1');
}
export function documentModel(){
 const blocks=[];
 const style=target=>{
  for(const k of ['setForegroundColor','setFontFamily','setBackgroundColor','setSpacingBefore','setSpacingAfter','setPaddingTop','setPaddingBottom','setPaddingLeft','setPaddingRight','setBorderWidth','setBorderColor','setMarginTop','setMarginBottom','setMarginLeft','setMarginRight','setItalic'])target[k]=()=>target;
  target.setFontSize=n=>{target.size=n;return target;};target.setBold=b=>{target.bold=b;return target;};target.setHeading=h=>{target.size=h==='HEADING1'?16:12;target.bold=true;return target;};target.editAsText=()=>target;target.getText=()=>target.text;return target;
 };
 const paragraph=text=>style({kind:'paragraph',text:String(text),size:9});
 const cell=text=>{const c=style({text:String(text)});c.appendParagraph=s=>{c.text+=(c.text?'\n':'')+s;return c;};c.appendImage=()=>{throw Error('Logo im nativen Server-PDF noch nicht verfügbar; Browser-PDF enthält das Logo.');};return c;};
 const body=style({appendParagraph:text=>{const p=paragraph(text);blocks.push(p);return p;},appendTable:data=>{const t=style({kind:'table',rows:data.map(row=>row.map(cell))});t.getRow=i=>({getCell:j=>t.rows[i][j]});blocks.push(t);return t;}});
 return {blocks,body,bytes:()=>renderPdf(blocks)};
}
