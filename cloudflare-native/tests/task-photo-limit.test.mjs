import test from 'node:test';
import assert from 'node:assert/strict';
import {testEnv,call} from './helpers.mjs';
import {execute} from '../dist/worker.js';

test('task photos over 2 MiB upload and download intact, while over 10 MiB is rejected',async()=>{
 const env=testEnv(),bytes=Buffer.alloc(3*1024*1024);bytes.set([137,80,78,71,13,10,26,10]);
 const photo={mime:'image/png',name:'large-photo.png',data:bytes.toString('base64')};
 const result=await execute(env,call('a','tasksCreate',{companyId:'c1',recipientIds:['u1'],title:'Fotodokumentation',body:'Bitte prüfen',photo}));
 const t=result.data.threads[0];
 const download=await execute(env,call('1','commPhoto',{threadId:t.id,attachmentId:t.attachmentId}));
 assert.equal(download.data.data,photo.data);
 await assert.rejects(()=>execute(env,call('2','commPhoto',{threadId:t.id,attachmentId:t.attachmentId})),/Berechtigung/);
 const oversized=Buffer.alloc(10*1024*1024+1);oversized.set(bytes.subarray(0,8));
 await assert.rejects(()=>execute(env,call('a','tasksCreate',{companyId:'c1',recipientIds:['u1'],title:'Zu großes Foto',body:'Test',photo:{...photo,data:oversized.toString('base64')}})),/10 MB|zu groß/);
});
