import test from 'node:test';
import assert from 'node:assert/strict';
import {testEnv,call,record} from './helpers.mjs';
import {execute} from '../dist/worker.js';

test('native logo upload accepts images over 2 MiB and rejects images over 10 MiB',async()=>{
 const env=testEnv(),bytes=Buffer.alloc(3*1024*1024);
 bytes.set([137,80,78,71,13,10,26,10]);
 const uploaded=await execute(env,call('a','logoUpload',{companyId:'c1',data:'data:image/png;base64,'+bytes.toString('base64')}));
 assert.ok(record(env,'Companies','c1').logoId);
 assert.ok(uploaded.data.logo.startsWith('data:image/png;base64,'));
 const oversized=Buffer.alloc(10*1024*1024+1);oversized.set(bytes.subarray(0,8));
 await assert.rejects(()=>execute(env,call('a','logoUpload',{companyId:'c1',data:'data:image/png;base64,'+oversized.toString('base64')})),/maximal 10 MB/);
});
