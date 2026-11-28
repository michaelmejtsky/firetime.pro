import {spawn} from 'node:child_process';
const args=process.argv.slice(2).filter(x=>!['--strictPort','--strict-port'].includes(x)).map(x=>x==='--host'?'--ip':x);
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev',...args],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code||0));
