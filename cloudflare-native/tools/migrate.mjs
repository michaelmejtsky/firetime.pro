import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import schemas from '../src/schema.json' with {type:'json'};
const sha=b=>createHash('sha256').update(b).digest('hex');
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
export function validateExport(input,{allowMissingFiles=false,baseDir='.'}={}){
 if(input.format!=='firetime-native-export-v1'||!input.tables||!Array.isArray(input.files))throw Error('Kein FireTime-Export V1.');
 const records=[],counts={},errors=[];
 for(const name of Object.keys(input.tables))if(!schemas[name])errors.push('Unbekannte Tabelle: '+name);
 const ids=new Map();
 for(const [name,cols] of Object.entries(schemas)){
  const table=input.tables[name];counts[name]=0;if(!table)continue;
  if(!Array.isArray(table.headers)||!Array.isArray(table.rows)){errors.push('Tabellenformat '+name);continue;}
  const unknown=table.headers.filter(h=>!cols.includes(h));
  if(unknown.length||new Set(table.headers).size!==table.headers.length||!table.headers.includes('id'))errors.push('Unerwartete Spalten in '+name+': '+unknown.join(','));
  for(let i=0;i<table.rows.length;i++){
   const values=table.rows[i];if(!Array.isArray(values)){errors.push('Zeile in '+name+' ist kein Array');continue;}
   const row=Object.fromEntries(cols.map(c=>[c,'']));for(let j=0;j<table.headers.length;j++)row[table.headers[j]]=values[j]??'';
   if(!row.id)continue;
   if(typeof row.id!=='string'){errors.push('ID ist kein Text in '+name);continue;}
   if(ids.has(name+'\0'+row.id)){errors.push('Doppelte ID in '+name);continue;}ids.set(name+'\0'+row.id,row);
   if(Object.values(row).some(v=>typeof v==='object'&&v!==null))errors.push('Verschachtelter Zellwert in '+name);
   records.push({table:name,id:row.id,ordinal:i+1,data:row});counts[name]++;
  }
 }
 const users=new Map(records.filter(r=>r.table==='Users').map(r=>[r.id,r.data])),companies=new Set(records.filter(r=>r.table==='Companies').map(r=>r.id));
 const emails=new Set();for(const u of users.values()){
  if(u.role!=='SYSADMIN'&&!companies.has(u.companyId))errors.push('Benutzer ohne Firma');
  const email=String(u.email||'').toLowerCase();if(emails.has(email))errors.push('Doppelte Benutzer-E-Mail');emails.add(email);
  if(u.status==='ACTIVE'&&(!/^[a-f0-9]{64}$/.test(u.passwordHash)||!u.salt))errors.push('Aktiver Benutzer ohne gültigen Passworthash');
 }
 for(const r of records){
  const d=r.data;if(d.companyId&&!companies.has(d.companyId))errors.push('Ungültige Firmenreferenz in '+r.table);
  if(d.userId&&!users.has(d.userId))errors.push('Ungültige Benutzerreferenz in '+r.table);
  if(r.table==='Months'&&['APPROVED','FINAL'].includes(d.status)){
   if(!d.snapshot)errors.push('Freigegebener Monat ohne Snapshot');
   else {try{JSON.parse(d.snapshot);}catch{errors.push('Monats-Snapshot ist kein JSON');}if(d.snapshotHash&&sha(d.snapshot)!==d.snapshotHash)errors.push('Monats-Snapshot-Prüfsumme weicht ab');}
  }
 }
 const references=new Set(records.flatMap(r=>['logoId','fileId','pdfId','attachmentId'].map(k=>r.data[k]).filter(Boolean)));
 const fileIds=new Set();
 for(const file of input.files){
  if(!/^[A-Za-z0-9_-]+$/.test(file.id)||fileIds.has(file.id)){errors.push('Ungültige oder doppelte Datei-ID');continue;}fileIds.add(file.id);
  if(!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0)errors.push('Dateimetadaten unvollständig');
  const location=path.join(baseDir,'files',file.id);
  if(!fs.existsSync(location)){if(!allowMissingFiles)errors.push('Datei fehlt: '+file.id);continue;}
  const bytes=fs.readFileSync(location);if(bytes.length!==file.size||sha(bytes)!==file.sha256)errors.push('Dateiprüfsumme falsch: '+file.id);
 }
 for(const id of references)if(!fileIds.has(id))errors.push('Referenzierte Datei fehlt im Export: '+id);
 if(input.missingFiles?.length)errors.push('Quellexport enthält nicht lesbare Dateien');
 if(errors.length)throw Error([...new Set(errors)].join('\n'));
 return {records,counts,files:input.files};
}
export function buildSql(checked,sourceHash){
 const lines=['-- Private migration data. Never commit or upload publicly.'];
 // New staging DB only; no destructive SQL and no upsert over existing domain rows.
 for(const r of checked.records)lines.push(`INSERT INTO records(table_name,record_id,ordinal,data) VALUES(${literal(r.table)},${literal(r.id)},${r.ordinal},${literal(JSON.stringify(r.data))});`);
 for(const f of checked.files)lines.push(`INSERT INTO objects(id,name,mime,size,sha256,trashed) VALUES(${literal(f.id)},${literal(f.name)},${literal(f.mime)},${f.size},${literal(f.sha256)},${f.trashed?1:0});`);
 lines.push(`INSERT INTO migrations(id,source_sha256,imported_at,counts) VALUES(${literal('export-'+sourceHash)},${literal(sourceHash)},${literal(new Date().toISOString())},${literal(JSON.stringify(checked.counts))});`);
 return lines.join('\n')+'\n';
}
export function verifyDatabase(sqlite,checked){
 const actual=sqlite.prepare('SELECT table_name,record_id,data FROM records ORDER BY table_name,ordinal').all(),expected=new Map(checked.records.map(r=>[r.table+'\0'+r.id,r.data]));
 const mismatches=[];for(const r of actual){const key=r.table_name+'\0'+r.record_id,want=expected.get(key);if(!want||JSON.stringify(JSON.parse(r.data))!==JSON.stringify(want))mismatches.push(key);expected.delete(key);}
 if(expected.size||mismatches.length)throw Error(`Datenvergleich fehlgeschlagen: ${expected.size} fehlen, ${mismatches.length} abweichend/zusätzlich.`);
 return {records:actual.length,unchanged:true};
}
function main(){
 const [command,file,out]=process.argv.slice(2);if(!['check','sql','verify'].includes(command)||!file)throw Error('Aufruf: node tools/migrate.mjs check|sql export/data.json [private/import.sql] oder verify export/data.json private/d1-export.sqlite');
 const raw=fs.readFileSync(file),input=JSON.parse(raw),checked=validateExport(input,{baseDir:path.dirname(file)});
 if(command==='sql'){
  if(!out)throw Error('Privaten SQL-Ausgabepfad angeben.');const absolute=path.resolve(out);if(!absolute.includes(path.sep+'private'+path.sep))throw Error('SQL muss unter einem ausgeschlossenen private/-Ordner liegen.');
  fs.mkdirSync(path.dirname(absolute),{recursive:true,mode:0o700});fs.writeFileSync(absolute,buildSql(checked,sha(raw)),{mode:0o600,flag:'wx'});console.log('Geprüfte SQL-Datei erstellt; nur in eine neue leere Staging-Datenbank importieren.');
 }else if(command==='verify'){
  if(!out)throw Error('SQLite-Datenbank fehlt.');const db=out.endsWith('.sql')?new DatabaseSync(':memory:'):new DatabaseSync(out,{readOnly:true});if(out.endsWith('.sql'))db.exec(fs.readFileSync(out,'utf8'));console.log(JSON.stringify(verifyDatabase(db,checked)));db.close();
 }else console.log(JSON.stringify({ok:true,counts:checked.counts,files:checked.files.length,sourceSha256:sha(raw)},null,2));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
