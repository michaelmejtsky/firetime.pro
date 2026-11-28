// Authenticated Wrangler CLI uploads; credentials stay in Wrangler's credential store.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateExport} from './migrate.mjs';
const [file,bucket,confirm]=process.argv.slice(2);
if(!file||!bucket||confirm!=='--staging-only'||!/^firetime-native-staging[-a-z0-9]*$/.test(bucket))throw Error('Aufruf: node tools/upload-files.mjs private/export/data.json firetime-native-staging-files --staging-only');
const input=JSON.parse(fs.readFileSync(file));validateExport(input,{baseDir:path.dirname(file)});
const wrangler=path.resolve(import.meta.dirname,'../node_modules/wrangler/bin/wrangler.js');
for(const asset of input.files){const result=spawnSync(process.execPath,[wrangler,'r2','object','put',bucket+'/'+asset.id,'--file',path.join(path.dirname(file),'files',asset.id),'--content-type',asset.mime,'--remote'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
console.log('Alle geprüften Dateien in den privaten Staging-Bucket übertragen.');
