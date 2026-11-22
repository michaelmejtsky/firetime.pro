// Synthetic local data only. Never runs a remote command or modifies a real database.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {testEnv,seed} from '../tests/helpers.mjs';
import {digest} from '../dist/runtime.mjs';
const env=testEnv(),db=env.DB.sqlite,names={u1:'Anna Berger',u2:'Lukas Mayer',a1:'Demo Administration',s1:'Demo Systemadmin',x1:'Andere Testfirma'};
for(const [id,name] of Object.entries(names)){const row=JSON.parse(db.prepare("SELECT data FROM records WHERE table_name='Users' AND record_id=?").get(id).data);row.name=name;db.prepare("UPDATE records SET data=? WHERE table_name='Users' AND record_id=?").run(JSON.stringify(row),id);}
for(const [id,status,title,recipientId] of [['task-new','OPEN','RWA Wartung dokumentieren','u1'],['task-accepted','ACCEPTED','Feuerlöscher kontrollieren','u2'],['task-done','DONE','Wartungsbericht prüfen','u1'],['task-returned','RETURNED','Dokumentation ergänzen','u1'],['task-closed','CLOSED','Abgeschlossene Objektkontrolle','u2']])seed(env,'CommThreads',{id,companyId:'c1',kind:'TASK',createdBy:'a1',recipientId,titleEncoded:Buffer.from(title).toString('base64url'),bodyEncoded:Buffer.from('Synthetische Testaufgabe. Bitte kontrollieren und die Durchführung dokumentieren.').toString('base64url'),status,dueDate:'2026-12-15',createdAt:'2026-11-20T10:00:00Z',updatedAt:'2026-11-20T10:00:00Z'});
seed(env,'Activities',{id:'demo-work',companyId:'c1',userId:'u1',type:'OTHER',activityOptionId:'rwa',start:'2026-11-10T07:00:00Z',end:'2026-11-10T11:00:00Z',breakMinutes:0,object:'Demogebäude',description:'Wartung RWA – synthetische Vorschau'});
seed(env,'ActivityTypes',{id:'rwa',companyId:'c1',type:'OTHER',label:'Wartung RWA',active:true,sort:1});
seed(env,'Leaves',{id:'demo-leave',companyId:'c1',userId:'u1',from:'2026-12-15',to:'2026-12-18',days:4,status:'PENDING',createdAt:'2026-11-20T09:00:00Z'});
seed(env,'Months',{id:'demo-month',companyId:'c1',userId:'u2',month:'2026-10',status:'SUBMITTED'});
seed(env,'EmployeePreferences',{id:'pref-u1',companyId:'c1',userId:'u1',leaveHoursPerDay:5,calendarId:'anna-demo@example.test'});
fs.mkdirSync('private',{recursive:true});const quote=x=>"'"+String(x).replaceAll("'","''")+"'";let sql=fs.readFileSync('migrations/0001_native.sql','utf8');
sql+='\nDELETE FROM records;DELETE FROM objects;DELETE FROM cache;DELETE FROM outbox;DELETE FROM request_receipts;\n';
for(const r of db.prepare('SELECT * FROM records').all())sql+=`INSERT INTO records(table_name,record_id,ordinal,data) VALUES(${quote(r.table_name)},${quote(r.record_id)},${r.ordinal},${quote(r.data)});\n`;
fs.writeFileSync('private/demo.sql',sql,{mode:0o600});fs.writeFileSync('.dev.vars',`STAGING_ACCESS_KEY=${env.STAGING_ACCESS_KEY}\nFT_PEPPER=${env.FT_PEPPER}\nWRITE_ENABLED=true\nFT_PUBLIC_GITHUB_URL=https://example.test/\n`,{mode:0o600});
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','firetime-native-staging','--local','--file','private/demo.sql'],{stdio:'inherit'});if(result.status)process.exit(result.status);console.log('Lokale synthetische Vorschau vorbereitet. Konten: a1@example.test / u1@example.test. Testpasswort: long-test-password. Keine echten Personen oder Versanddaten.');
