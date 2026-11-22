import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {Runtime,digest} from '../dist/runtime.mjs';
import {createCore} from '../dist/core.mjs';
import schemas from '../src/schema.json' with {type:'json'};
export function d1(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../migrations/0001_native.sql',import.meta.url),'utf8'));
 const api={sqlite,prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async first(){const row=sqlite.prepare(sql).get(...this.args);return row?{...row}:null;},async all(){return {results:sqlite.prepare(sql).all(...this.args).map(x=>({...x})),success:true};},async run(){const result=sqlite.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(result.changes)}};},sql};},async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>{const stmt=sqlite.prepare(s.sql);let results=[],changes=0;if(stmt.columns().length)results=stmt.all(...s.args).map(x=>({...x}));else changes=Number(stmt.run(...s.args).changes);return {results,success:true,meta:{changes}};});sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};return api;
}
export function r2(){const objects=new Map();return {objects,async put(id,bytes){objects.set(id,new Uint8Array(bytes));},async get(id){const bytes=objects.get(id);return bytes?{arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}:null;},async delete(id){objects.delete(id);}};}
export function row(table,data){const full=Object.fromEntries(schemas[table].map(k=>[k,'']));Object.assign(full,data);return full;}
export function seed(env,table,data){const full=row(table,data),ordinal=Number(env.DB.sqlite.prepare('SELECT coalesce(max(ordinal),0)+1 n FROM records WHERE table_name=?').get(table).n);env.DB.sqlite.prepare('INSERT INTO records(table_name,record_id,ordinal,data) VALUES(?,?,?,?)').run(table,full.id,ordinal,JSON.stringify(full));return full;}
export function record(env,table,id){const r=env.DB.sqlite.prepare('SELECT data FROM records WHERE table_name=? AND record_id=?').get(table,id);return r?JSON.parse(r.data):null;}
export function testEnv(){
 const env={DB:d1(),FILES:r2(),MIGRATION_MODE:'staging',STAGING_ACCESS_KEY:'only-a-synthetic-staging-key-123456789',WRITE_ENABLED:'true',FT_PEPPER:'synthetic-pepper',MAIL_ENABLED:'false',PUSH_ENABLED:'false',CALENDAR_ENABLED:'false',AUTOMATION_ENABLED:'false',FT_PUBLIC_GITHUB_URL:'https://firetime-preview.example.test/'};
 const core=createCore(new Runtime({env}));
 seed(env,'Companies',{id:'c1',name:'BSB3100 Test',slug:'bsb3100',active:true,calendarOn:false,nightStart:22,nightEnd:6,nightPct:50,sundayPct:100,holidayPct:100,standbyRate:1});
 seed(env,'Companies',{id:'c2',name:'Andere Firma',slug:'other',active:true});
 for(const [id,role,cid] of [['u1','STAFF','c1'],['u2','STAFF','c1'],['a1','ADMIN','c1'],['s1','SYSADMIN',''],['x1','STAFF','c2']]){
  seed(env,'Users',{id,companyId:cid,role,name:'Test '+id,email:id+'@example.test',status:'ACTIVE',salt:'salt-'+id,passwordHash:core.ft_password_('long-test-password', 'salt-'+id),monthlyHours:25,openingHours:0,leaveBalance:20,leaveEntitlement:25,startDate:'2026-01-01',createdAt:'2026-10-01T10:00:00.000Z',workdays:'1,2,3,4,5'});
  const token=(id==='u1'?'1':id==='u2'?'2':id==='a1'?'a':id==='s1'?'b':'c').repeat(64);seed(env,'Sessions',{id:digest(token),userId:id,expiresAt:'2035-01-01T00:00:00.000Z'});
 }
 return env;
}
export const call=(token,action,data={})=>({type:'api',token:token.repeat(64),action,data});
