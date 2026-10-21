#!/usr/bin/env node
/**
 * FireTime Pro – VAPID Schlüsselpaar lokal generieren.
 * Aufruf: node tools/generate-vapid.mjs deine-email@firma.at
 * Privat-Schlüssel NIEMALS im Repository, GitHub-Issues oder Chat posten.
 */
import { webcrypto } from 'node:crypto';
const email=String(process.argv[2]||'').trim();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
 console.error('Aufruf: node tools/generate-vapid.mjs deine-email@firma.at');
 process.exitCode=1;
}else{
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await webcrypto.subtle.exportKey('jwk',pair.privateKey);
 const pub=new Uint8Array(await webcrypto.subtle.exportKey('raw',pair.publicKey));
 const encoded=Buffer.from(pub).toString('base64url');
 const privateOnly={kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y,d:jwk.d};
 console.log('\nCloudflare Worker → Settings → Variables and Secrets\n');
 console.log('VAPID_PUBLIC_KEY (öffentlicher Text):\n'+encoded+'\n');
 console.log('VAPID_SUBJECT (Text):\nmailto:'+email+'\n');
 console.log('VAPID_PRIVATE_JWK (VERSCHLÜSSELTES CLOUDFlARE SECRET – niemals weitergeben!):\n'+JSON.stringify(privateOnly)+'\n');
 console.log('Die drei Werte beim Cloudflare Worker hinterlegen. Private JWK nur als SECRET.');
 console.log('Keine Schlüssel in GitHub, Google Sheets oder Apps Script hinterlegen.');
}
