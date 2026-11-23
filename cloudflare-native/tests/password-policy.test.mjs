import test from 'node:test';
import assert from 'node:assert/strict';
import {testEnv,seed,record} from './helpers.mjs';
import {execute} from '../dist/worker.js';
import {digest} from '../dist/runtime.mjs';

test('four-character password change supports login and rejects shorter passwords',async()=>{
 const env=testEnv(),token='1'.repeat(64);
 await assert.rejects(()=>execute(env,{type:'password',token,current:'long-test-password',next:'123'}),/mindestens 4/);
 await execute(env,{type:'password',token,current:'long-test-password',next:'0123'});
 assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM records WHERE table_name='Sessions' AND json_extract(data,'$.userId')='u1'").get().n,0);
 const login=await execute(env,{type:'login',email:'u1@example.test',password:'0123'});
 assert.ok(login.data.token);
});
test('invitation activation accepts four characters and rejects three',async()=>{
 const env=testEnv(),invite='d'.repeat(64);
 seed(env,'Invites',{id:digest(invite),userId:'u2',expiresAt:'2035-01-01T00:00:00Z'});
 await assert.rejects(()=>execute(env,{type:'activate',invite,password:'123'}),/4–150/);
 await execute(env,{type:'activate',invite,password:'abcd'});
 assert.ok(record(env,'Invites',digest(invite)).usedAt);
 assert.ok((await execute(env,{type:'login',email:'u2@example.test',password:'abcd'})).data.token);
});
test('password recovery accepts four characters and consumes its one-time link',async()=>{
 const env=testEnv(),resetToken='e'.repeat(64),id='reset:'+digest(resetToken);
 seed(env,'Invites',{id,userId:'u1',expiresAt:'2035-01-01T00:00:00Z'});
 await assert.rejects(()=>execute(env,{type:'resetConfirm',resetToken,password:'123'}),/4 bis 150/);
 await execute(env,{type:'resetConfirm',resetToken,password:'1234'});
 assert.ok(record(env,'Invites',id).usedAt);
 assert.ok((await execute(env,{type:'login',email:'u1@example.test',password:'1234'})).data.token);
 await assert.rejects(()=>execute(env,{type:'resetConfirm',resetToken,password:'5678'}),/bereits verwendet/);
});
