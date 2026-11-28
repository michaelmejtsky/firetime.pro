import test from 'node:test';
import assert from 'node:assert/strict';
import {testEnv,record,call} from './helpers.mjs';
import {Runtime} from '../dist/runtime.mjs';
import {createCore} from '../dist/core.mjs';
import {loadSnapshot,commit} from '../dist/store.mjs';
import {ViennaDate} from '../dist/time.mjs';

async function at(env,stamp,action,data={}){
 const input=call('1',action,data),snapshot=await loadSnapshot(env,input),runtime=new Runtime(snapshot),fixed=Date.parse(stamp);
 runtime.globals.Date=class extends ViennaDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
 const core=createCore(runtime),result=action==='sweep'?core.ft_timerTick_():core.ft_api(input.token,action,data);
 await commit(env,snapshot,runtime);return result;
}
for(const [start,end] of [['2026-11-02T19:16:00Z','2026-11-02T21:00:00Z'],['2026-11-02T22:50:00Z','2026-11-03T00:20:00Z'],['2026-11-02T17:30:00Z','2026-11-02T19:30:00Z']])test('incident clock survives 19:00 and midnight: '+start,async()=>{
 const env=testEnv();try{
  const started=await at(env,start,'timerStart',{type:'INCIDENT'});assert.ok(started.running);
  const sweep=await at(env,end,'sweep');assert.equal(sweep.closed,0);assert.ok(record(env,'ActivityTimers',started.running.id));
  const result=await at(env,end,'timerStop');assert.equal(result.activity.type,'INCIDENT');assert.equal(result.activity.end,new Date(end).toISOString());assert.equal(result.autoClosed,false);assert.equal(record(env,'ActivityTimers',started.running.id),null);
 }finally{env.DB.sqlite.close();}
});
test('ordinary work still rejects a start after 19:00',async()=>{
 const env=testEnv();try{await assert.rejects(()=>at(env,'2026-11-02T19:16:00Z','timerStart',{type:'OBJECT'}),/Nach 19:00/);}finally{env.DB.sqlite.close();}
});
test('incident pauses remain usable after 19:00 and stop records their actual minutes',async()=>{
 const env=testEnv();try{
  await at(env,'2026-11-02T20:00:00Z','timerStart',{type:'INCIDENT'});
  await at(env,'2026-11-02T20:15:00Z','timerPauseStart');
  await at(env,'2026-11-02T20:25:00Z','timerPauseStop');
  const result=await at(env,'2026-11-02T21:00:00Z','timerStop');assert.equal(result.activity.breakMinutes,10);assert.equal(result.activity.end,'2026-11-02T21:00:00.000Z');
 }finally{env.DB.sqlite.close();}
});
