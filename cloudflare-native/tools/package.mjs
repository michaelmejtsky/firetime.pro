import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),release=path.join(root,'dist/release');fs.mkdirSync(release,{recursive:true});
await build({entryPoints:[path.join(root,'dist/worker.js')],outfile:path.join(release,'FireTime_Cloudflare_Worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],minify:false,logLevel:'info'});
fs.cpSync(path.join(root,'dist/public'),path.join(release,'public'),{recursive:true});
for(const [source,target] of [['tools/FireTime_Cloudflare_Export.gs','FireTime_Cloudflare_Export.gs'],['dist/Code_Freeze_Vorbereitung.gs','Code_Freeze_Vorbereitung.gs'],['migrations/0001_native.sql','D1_Schema.sql'],['README.md','START_HIER.md'],['docs/ABNAHME.md','ABNAHME.md'],['docs/UMSCHALTUNG.md','UMSCHALTUNG.md']])fs.copyFileSync(path.join(root,source),path.join(release,target));
console.log('Worker, Oberfläche, Exportscript, optionale Freeze-Code.gs und Anleitungen unter dist/release erstellt. Keine Kundendaten/Secrets enthalten.');

const repo=path.resolve(root,'..'),source=path.join(release,'source');
for(const dir of ['apps-script','cloudflare','assets'])fs.cpSync(path.join(repo,dir),path.join(source,dir),{recursive:true});
for(const file of ['index.html','sw.js','manifest.webmanifest','config.js','.nojekyll'])fs.copyFileSync(path.join(repo,file),path.join(source,file));
const nativeSource=path.join(source,'cloudflare-native');fs.mkdirSync(nativeSource,{recursive:true});
for(const dir of ['src','tools','tests','migrations','docs'])fs.cpSync(path.join(root,dir),path.join(nativeSource,dir),{recursive:true});
for(const file of ['README.md','package.json','package-lock.json','wrangler.jsonc','.gitignore'])fs.copyFileSync(path.join(root,file),path.join(nativeSource,file));
const start=path.join(release,'START_HIER.md');fs.writeFileSync(start,'# Dieses Paket verwenden\n\nDer vollständige Quellcode liegt unter `source/`. Für die unten stehenden Befehle zuerst in `source/cloudflare-native` wechseln. Der Worker und die Oberfläche liegen zusätzlich fertig gebaut im Hauptordner und unter `public/`. Keine produktive Konfiguration überschreiben.\n\n'+fs.readFileSync(start,'utf8'));
