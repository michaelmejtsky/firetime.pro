import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.js';

test('Google branding pages are public without database or session access, while the app stays protected',async()=>{
 const env={MIGRATION_MODE:'staging',STAGING_ACCESS_KEY:'a-private-key-for-staging-at-least-32-characters',GOOGLE_SITE_VERIFICATION:'test-token"/><script>bad()</script>'};
 for(const path of ['/info','/datenschutz','/impressum']){
  const r=await worker.fetch(new Request('https://firetime.example.test'+path),env,{});assert.equal(r.status,200);const html=await r.text();assert.match(html,/Michael Mejtsky/);assert.match(html,/firetime.pro@gmail.com/);assert.match(html,/href="\/datenschutz"/);assert.ok(!html.includes('<script>bad()'));
  assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 }
 assert.equal((await worker.fetch(new Request('https://firetime.example.test/'),env,{})).status,401);
 const head=await worker.fetch(new Request('https://firetime.example.test/datenschutz',{method:'HEAD'}),env,{});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
