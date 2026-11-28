import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {Runtime} from '../dist/runtime.mjs';
import {createCore} from '../dist/core.mjs';
import {validateExport} from './migrate.mjs';
export function reconcile(input,checked){
 const env={FT_PEPPER:'unused-for-accounting',FT_PUBLIC_GITHUB_URL:'https://comparison.invalid/'};
 const records=checked.records.map(r=>({table_name:r.table,record_id:r.id,ordinal:r.ordinal,data:JSON.stringify(r.data)}));
 const runtime=new Runtime({records,env}),native=createCore(runtime);
 // Independent execution of the original source, not the generated native module.
 // Legacy DB reads are backed by the identical immutable export; no Google account access.
 const legacyContext=vm.createContext({...runtime.globals,console:{log(){},warn(){},info(){},error(){}}});
 const source=fs.readFileSync(new URL('../../apps-script/Code.gs',import.meta.url),'utf8');
 vm.runInContext(source,legacyContext);
 legacyContext.ft_db_=()=>runtime.db;
 const users=records.filter(r=>r.table_name==='Users').map(r=>JSON.parse(r.data)).filter(u=>u.role!=='SYSADMIN');
 const companies=new Map(records.filter(r=>r.table_name==='Companies').map(r=>[r.record_id,JSON.parse(r.data)]));
 const periods=new Set(records.filter(r=>r.table_name==='Months').map(r=>JSON.parse(r.data).month));
 for(const r of records.filter(r=>['Activities','Shifts'].includes(r.table_name))){const d=JSON.parse(r.data);for(const k of ['start','end'])if(/^20\d\d-\d\d/.test(String(d[k])))periods.add(String(d[k]).slice(0,7));}
 const results=[],failures=[];
 for(const u of users)for(const month of [...periods].sort()){
  const c=companies.get(u.companyId);if(!c)continue;
  let left,right;try{left=JSON.parse(JSON.stringify(legacyContext.ft_report_(structuredClone(c),structuredClone(u),month)));right=native.ft_report_(structuredClone(c),structuredClone(u),month);}catch(e){failures.push({userId:u.id,month,error:String(e.message).slice(0,150)});continue;}
  if(JSON.stringify(left)!==JSON.stringify(right))failures.push({userId:u.id,month,error:'Abrechnungswerte weichen ab'});
  else results.push({userId:u.id,month,matched:true});
 }
 return {ok:failures.length===0&&results.length>0,compared:results.length,failures,sourceExportedAt:input.exportedAt,scope:'Originale Fachlogik gegen native Fachlogik auf demselben Export; kein Live-Sheet-/Deployment-Nachweis.'};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{const file=process.argv[2];if(!file)throw Error('Aufruf: node tools/reconcile.mjs private/export/data.json');const input=JSON.parse(fs.readFileSync(file)),checked=validateExport(input,{baseDir:path.dirname(file)}),report=reconcile(input,checked);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
