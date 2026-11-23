import {createCore} from './core.mjs';
import {Runtime,digest} from './runtime.mjs';
import {loadSnapshot,commit,statement,Conflict} from './store.mjs';
import schemaSql from './first-start-schema.mjs';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export async function initializeFresh(env,p){
 if(env.FIRST_START_ENABLED!=='true')throw fail('Ersteinrichtung ist deaktiviert.',404);
 const key=String(env.FIRST_START_KEY||'');
 if(key.length<32||digest(p.key||'')!==digest(key))throw fail('Einrichtungsschlüssel ungültig.',403);
 if(!env.DB||!env.FILES||String(env.FT_PEPPER||'').length<32)throw fail('Datenbank, Dateiablage oder Passwortschlüssel fehlen.',503);
 if(env.WRITE_ENABLED!=='true')throw fail('Schreibzugriff ist noch nicht aktiviert.',503);
 if(env.MIGRATION_MODE==='production'&&env.CUTOVER_CONFIRMED!=='true')throw fail('Neustart wurde noch nicht freigegeben.',503);
 const email=String(p.email||'').trim().toLowerCase(),password=String(p.password||'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200)throw fail('Gültige E-Mail-Adresse eingeben.');
 if(password.length<14||password.length>200||password!==p.confirm)throw fail('Passwörter müssen übereinstimmen und 14 bis 200 Zeichen lang sein.');
 const known=new Set(['records','metadata','commit_guards','cache','objects','properties','outbox','request_receipts','migrations','d1_migrations']);
 const tables=(await statement(env.DB,"SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r=>r.name);
 if(tables.some(name=>!known.has(name)&&!name.startsWith('sqlite_')&&!name.startsWith('_cf_')))throw fail('Diese Datenbank gehört bereits zu einem anderen System.',409);
 for(const name of ['records','objects','properties','outbox','migrations'])if(tables.includes(name)&&await statement(env.DB,'SELECT 1 AS present FROM '+name+' LIMIT 1').first())throw fail('Datenbank enthält bereits Daten. Ersteinrichtung bleibt gesperrt.',409);
 // DDL is idempotent and is reached only after the private key and inputs passed.
 await env.DB.exec(schemaSql.replace(/--[^\n]*/g,'').replace(/\n/g,' '));
 const snapshot=await loadSnapshot(env,{},{system:true});
 if(snapshot.records.length||snapshot.properties.length)throw fail('System wurde bereits eingerichtet.',409);
 const runtime=new Runtime(snapshot),core=createCore(runtime);
 const result=core.ft_nativeInitialize_({email,password});
 try{await commit(env,snapshot,runtime);}catch(err){if(err instanceof Conflict)throw fail('Einrichtung wurde gleichzeitig abgeschlossen. Bitte anmelden.',409);throw err;}
 return result;
}
export function firstStartPage(){
 const nonce=crypto.randomUUID();
 const html=`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FireTime Pro · Ersteinrichtung</title><style>body{font:16px system-ui;background:#12263e;color:#183247;margin:0;padding:7vh 20px}main{max-width:520px;margin:auto;background:white;padding:32px;border-radius:18px}h1{margin-top:0}label{display:block;margin:18px 0}input{display:block;box-sizing:border-box;width:100%;padding:13px;margin-top:6px;border:1px solid #b9c8d6;border-radius:8px;font:inherit}button,a{font:inherit}button{padding:14px 20px;background:#177a76;color:white;border:0;border-radius:8px;cursor:pointer}p{line-height:1.5}#status{white-space:pre-wrap}small{color:#526c80}</style><main><h1>FireTime Pro einrichten</h1><p>Leerer Neustart mit BSB3100. Du legst deinen Systemadmin-Zugang an. Bestehende Datenbanken werden nicht überschrieben.</p><form id="setup"><label>Privater Einrichtungsschlüssel<input name="key" type="password" autocomplete="off" required minlength="32"></label><label>Systemadmin E-Mail<input name="email" type="email" autocomplete="username" required></label><label>Neues FireTime-Passwort<input name="password" type="password" autocomplete="new-password" minlength="14" maxlength="200" required></label><label>Passwort wiederholen<input name="confirm" type="password" autocomplete="new-password" minlength="14" maxlength="200" required></label><button>FireTime einrichten</button></form><p id="status" role="status"></p><small>Danach wird die Einrichtung dauerhaft gesperrt. Keine Testmitarbeiter, Teststunden oder Kalendertermine werden angelegt.</small></main><script nonce="${nonce}">document.getElementById('setup').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,b=f.querySelector('button'),s=document.getElementById('status');b.disabled=true;s.textContent='Einrichtung läuft …';try{const r=await fetch('/first-start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f))),credentials:'same-origin'});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Einrichtung fehlgeschlagen.');f.reset();f.hidden=true;s.textContent='Eingerichtet. Du kannst dich jetzt mit deinem neuen FireTime-Passwort anmelden.';const a=document.createElement('a');a.href='/';a.textContent='Zur Anmeldung';s.append(document.createElement('br'),a);}catch(err){s.textContent=err.message;}finally{b.disabled=false;}});</script></html>`;
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"}});
}
