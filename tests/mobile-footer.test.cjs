'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

test('mobile navigation is fixed to screen bottom and can hide during downward scrolling',()=>{
 assert.match(html,/\.ft-mobile-bar\{[^}]*position:fixed!important;inset:auto 0 0 0!important/);
 assert.match(html,/\.ft-mobile-bar\.ft-nav-scroll-hidden\{[^}]*translate3d\(0,110%,0\)/);
 assert.match(html,/ftMobileNavAutoHide_/);
 assert.match(html,/window\.addEventListener\('scroll'/);
 assert.match(html,/nav\.classList\.toggle\('ft-nav-scroll-hidden',hidden\)/);
 assert.match(html,/nav\.classList\.remove\('ft-nav-scroll-hidden'\)/);
});
test('ios standalone status area uses padding without an opaque overlay',()=>{
 assert.match(html,/display-mode:standalone/);
 assert.match(html,/padding-top:calc\(16px \+ max\(env\(safe-area-inset-top, 0px\), 48px\)\)/);
 assert.doesNotMatch(html,/body::before\s*\{/);
});
