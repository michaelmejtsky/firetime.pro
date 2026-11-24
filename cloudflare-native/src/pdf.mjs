import {Buffer} from 'node:buffer';
// Small, synchronous PDF renderer: A4, wrapping, page breaks, WinAnsi German text.
// Every numeric report value still originates from the unchanged accounting core.
function win(s){return String(s).replace(/€/g,'\x80').replace(/[–—]/g,'-').replace(/…/g,'...').replace(/[^\x20-\xFF\n]/g,'?');}
function literal(s){return win(s).replace(/[\\()]/g,'\\$&').replace(/[\r\n]/g,' ');}
// Standard Helvetica WinAnsi advance widths, in thousandths of an em.
const REGULAR_WIDTHS=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const BOLD_WIDTHS=[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
function textWidth(text,size,bold){const widths=bold?BOLD_WIDTHS:REGULAR_WIDTHS;let units=0;for(const c of text)units+=widths[c.charCodeAt(0)-32]??556;return units*size/1000;}
function wrap(text,width,size=9,bold=false){
 const words=win(text).split(/\s+/),lines=[];let line='';
 for(let word of words){
  if(textWidth(word,size,bold)>width){
   if(line){lines.push(line);line='';}
   let chunk='';for(const c of word){if(chunk&&textWidth(chunk+c,size,bold)>width){lines.push(chunk);chunk='';}chunk+=c;}word=chunk;
  }
  const next=line+(line?' ':'')+word;
  if(line&&textWidth(next,size,bold)>width){lines.push(line);line=word;}else line=next;
 }
 if(line||!lines.length)lines.push(line);return lines;
}
export function renderPdf(blocks){
 const pages=[];let commands=[],y=798;
 const page=()=>{if(commands.length){commands.push(`BT /F1 8 Tf 0.35 0.42 0.50 rg 42 24 Td (FireTime Pro - Seite ${pages.length+1}) Tj ET`);pages.push(commands.join('\n'));}commands=[];y=798;};
 const line=(text,x=42,size=9,bold=false)=>{if(y<45)page();commands.push(`BT /${bold?'F2':'F1'} ${size} Tf 0.08 0.15 0.24 rg ${x} ${y} Td (${literal(text)}) Tj ET`);};
 for(const block of blocks){
  if(block.kind==='pagebreak'){page();continue;}
  if(block.kind==='table'){
   const span=c=>Math.max(1,Number(c.colspan)||1),n=Math.max(1,...block.rows.map(row=>row.reduce((sum,c)=>sum+span(c),0))),width=510/n;
   const measure=(row,header=false)=>row.map(c=>({cell:c,width:width*span(c),lines:wrap(c.text,Math.max(7,width*span(c)-14),9.2,header||c.bold)}));
   const height=(row,header=false)=>Math.max(...measure(row,header).map(c=>c.lines.length))*13+12;
   const draw=(row,header=false,index=0)=>{
    const cells=measure(row,header),count=Math.max(...cells.map(c=>c.lines.length));
    let offset=0;
    while(offset<count){
     let capacity=Math.floor((y-45-12)/13);
     if(capacity<1){page();if(block.header&&!header)draw(block.rows[0],true);capacity=Math.floor((y-45-12)/13);}
     const take=Math.min(count-offset,Math.max(1,capacity)),partHeight=take*13+12;
     commands.push(`${header?'0.10 0.21 0.31':index%2?'0.96 0.97 0.98':'1 1 1'} rg 42 ${y+3-partHeight} 510 ${partHeight} re f`);
     let x=49;
     for(const c of cells){for(let i=0;i<take;i++)if(c.lines[offset+i])commands.push(`BT /${header||c.cell.bold?'F2':'F1'} 9.2 Tf ${header?'1 1 1':'0.08 0.15 0.24'} rg ${x} ${y-10-i*13} Td (${literal(c.lines[offset+i])}) Tj ET`);x+=c.width;}
     y-=partHeight;commands.push(`0.83 0.87 0.90 RG 0.4 w 42 ${y+3} m 552 ${y+3} l S`);offset+=take;
    }

   };
   const header=block.header?block.rows[0]:null;
   for(let i=0;i<block.rows.length;i++){
    const row=block.rows[i],needed=height(row,Boolean(header&&i===0))+(row[0]?.keepWithNext&&block.rows[i+1]?height(block.rows[i+1]):0);
    if(y-needed<45&&needed<650){page();if(header&&i>0)draw(header,true);}
    draw(row,Boolean(header&&i===0),i);
   }
   y-=12;
  }else{const size=block.size||9;for(const text of String(block.text).split('\n'))for(const ln of wrap(text,510,size,block.bold)){line(ln,42,size,block.bold);y-=size+4;}y-=5;}
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
