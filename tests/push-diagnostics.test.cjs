'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const backend=fs.readFileSync(path.join(__dirname,'..','apps-script','Code.gs'),'utf8');
const a=backend.indexOf('function ft_pushFailureReason_(');
const b=backend.indexOf('\nfunction ft_pushDispatch_(',a);
assert.ok(a>0&&b>a,'Push diagnostic function exists');
const reason=vm.runInNewContext(backend.slice(a,b)+';ft_pushFailureReason_', {String,Number});

test('Cloudflare worker status zero returns actionable but safe failure details',()=>{
 assert.match(reason([{ok:false,status:0,error:'Network connection lost.'}]),/Netzwerk\/TLS/);
 assert.match(reason([{ok:false,status:0,error:'AbortSignal.timeout is not a function'}]),/nicht/);
 assert.match(reason([{ok:false,status:403,error:'Apple token fake'}]),/HTTP 403/);
 const exception='Unexpected failure https://web.push.apple.com/Q-Abcdefghijklmnopqrstuvwxyz01234567890 sender@example.test';
 const redacted=reason([{ok:false,status:0,error:exception}]);
 assert.match(redacted,/Status 0/);
 assert.doesNotMatch(redacted,/web\.push\.apple|sender@example|abcdefghijklmnopqrstuvwxyz0/);
});
