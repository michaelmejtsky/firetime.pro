import fs from 'node:fs';
import schemas from '../src/schema.json' with {type:'json'};
const header=`/** Additive, read-only database export. No setup, migration or recalculation.\n * Creates ONLY a new private export folder and export progress properties.\n * Do not share its data: contains password hashes, sessions and private staff records.\n */\nconst FT_CF_EXPORT_SCHEMAS=${JSON.stringify(schemas)};\n`;
const body=String.raw`
function ft_cloudflareExportManifest(){
 const lock=LockService.getScriptLock();lock.waitLock(20000);
 try{
  const db=ft_db_(),tables={},refs=new Set();
  const actual=db.getSheets().map(s=>s.getName()),unknown=actual.filter(n=>!FT_CF_EXPORT_SCHEMAS[n]);
  if(unknown.length)throw Error('Unbekannte Tabellen vor Export prüfen: '+unknown.join(', '));
  for(const name of Object.keys(FT_CF_EXPORT_SCHEMAS)){
   const sh=db.getSheetByName(name);if(!sh)continue;
   const values=sh.getDataRange().getValues(),headers=values.shift().map(String),expected=FT_CF_EXPORT_SCHEMAS[name];
   if(headers.some(h=>!expected.includes(h))||!headers.includes('id'))throw Error('Unerwartete Spalten: '+name);
   const rows=values.map(row=>headers.map((key,i)=>{
    let v=row[i];if(v instanceof Date){
     if(key==='month'||key==='effectiveMonth'||key==='startMonth')return Utilities.formatDate(v,'Europe/Vienna','yyyy-MM');
     if(['day','startDate','effectiveDate','periodStart','activationDate','dueDate'].includes(key)||(name==='Leaves'&&['from','to'].includes(key)))return Utilities.formatDate(v,'Europe/Vienna','yyyy-MM-dd');
     if(name==='CompanyProfiles'&&['workStart','standbyStart'].includes(key))return Utilities.formatDate(v,'Europe/Vienna','HH:mm');
     return v.toISOString();
    }return v===null||v===undefined?'':v;
   })).filter(row=>row[headers.indexOf('id')]!=='');
   for(const row of rows)for(const key of ['logoId','pdfId','fileId','attachmentId']){const i=headers.indexOf(key);if(i>=0&&row[i])refs.add(String(row[i]));}
   tables[name]={headers,rows};
  }
  const manifest={format:'firetime-native-export-v1',exportedAt:new Date().toISOString(),sourceVersion:FT_VERSION,tables,files:[],pendingFiles:[...refs],missingFiles:[]};
  const folder=DriveApp.createFolder('FireTime_Cloudflare_Export_'+Utilities.formatDate(new Date(),'Europe/Vienna','yyyyMMdd_HHmmss'));
  const file=folder.createFile(Utilities.newBlob(JSON.stringify(manifest),'application/json','data.json'));
  folder.createFolder('files');
  PropertiesService.getScriptProperties().setProperty('FT_CF_EXPORT_FOLDER',folder.getId()).setProperty('FT_CF_EXPORT_MANIFEST',file.getId());
  Logger.log('Privater Exportordner: '+folder.getUrl());Logger.log('Nun ft_cloudflareExportFilesNext wiederholt ausführen, bis pendingFiles = 0.');
  return {folderUrl:folder.getUrl(),tables:Object.keys(tables).length,pendingFiles:refs.size};
 }finally{lock.releaseLock();}
}
function ft_cloudflareExportFilesNext(){
 const properties=PropertiesService.getScriptProperties(),folder=DriveApp.getFolderById(properties.getProperty('FT_CF_EXPORT_FOLDER'));
 const manifestFile=DriveApp.getFileById(properties.getProperty('FT_CF_EXPORT_MANIFEST')),data=JSON.parse(manifestFile.getBlob().getDataAsString());
 const files=folder.getFoldersByName('files').next(),started=Date.now();let count=0;
 while(data.pendingFiles.length&&count<10&&Date.now()-started<180000){
  const id=data.pendingFiles.shift();
  try{
   const original=DriveApp.getFileById(id),blob=original.getBlob(),bytes=blob.getBytes();
   const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>((b+256)%256).toString(16).padStart(2,'0')).join('');
   const duplicate=files.getFilesByName(id);if(!duplicate.hasNext())files.createFile(blob.setName(id));
   data.files.push({id,name:original.getName(),mime:original.getMimeType(),size:bytes.length,sha256:hash,trashed:original.isTrashed()});
  }catch(e){data.missingFiles.push(id);Logger.log('Nicht lesbare Datei: '+id);}
  count++;
 }
 manifestFile.setContent(JSON.stringify(data));
 const result={remaining:data.pendingFiles.length,exported:data.files.length,missing:data.missingFiles.length,folderUrl:folder.getUrl()};Logger.log(JSON.stringify(result));return result;
}
`;
fs.writeFileSync(new URL('../tools/FireTime_Cloudflare_Export.gs',import.meta.url),header+body);
