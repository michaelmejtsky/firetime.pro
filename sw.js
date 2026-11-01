// FireTime Pro V1.8.7: keine Sitzungsdaten oder API-Ergebnisse offline zwischenspeichern.
// Die PWA darf sowohl unter / als auch unter /firetime.pro/ (GitHub Pages) laufen.
const FT_SHELL_CACHE='firetime-shell-20261101-v1828';
const FT_BASE=new URL('./',self.registration.scope);
const FT_PATHS=['','index.html','manifest.webmanifest','assets/firetime-192.png','assets/firetime-512.png'];
const FT_SHELL_URLS=FT_PATHS.map(part=>new URL(part,FT_BASE).href);
self.addEventListener('install',event=>{
 event.waitUntil(
  caches.open(FT_SHELL_CACHE)
   .then(cache=>cache.addAll(FT_SHELL_URLS.map(url=>new Request(url,{cache:'reload'}))))
   .then(()=>self.skipWaiting())
 );
});
self.addEventListener('activate',event=>{
 event.waitUntil(
  caches.keys().then(keys=>Promise.all(
   keys.filter(key=>key.startsWith('firetime-shell-')&&key!==FT_SHELL_CACHE)
    .map(key=>caches.delete(key))
  )).then(()=>self.clients.claim())
 );
});
// An installed PWA must never keep serving stale HTML while online.
// Only root and index.html are app-shell navigations; diagnostics and other
// HTML pages must be fetched normally. API and config.js are never cached.
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 if(/\/config\.js$/.test(url.pathname))return;
 const isPage=req.mode==='navigate';
 const rootPath=FT_BASE.pathname;
 const isAppPage=isPage&&(url.pathname===rootPath||
  url.pathname===rootPath+'index.html');
 if(isPage&&!isAppPage)return; // E.g. /firetime.pro/diagnose.html
 const shell=FT_SHELL_URLS.includes(url.href.split('?')[0]);
 if(!isAppPage&&!shell)return;
 const cacheKey=isAppPage?new URL('index.html',FT_BASE).href:req;
 event.respondWith((async()=>{
  if(isAppPage){
   // Network-first fixes the "browser works / installed app fails" mismatch.
   // Previously stale HTML was returned first even when online.
   try{
    const response=await fetch(req,{cache:'no-store'});
    if(response.ok&&response.type==='basic'){
     const cache=await caches.open(FT_SHELL_CACHE);
     event.waitUntil(cache.put(cacheKey,response.clone()));
    }
    return response;
   }catch{
    return (await caches.match(cacheKey,{ignoreSearch:true}))||Response.error();
   }
  }
  // Static icons/manifest remain cache-first for fast repeat launches.
  const saved=await caches.match(cacheKey,{ignoreSearch:true});
  if(saved){
   event.waitUntil(fetch(req,{cache:'no-store'}).then(async response=>{
    if(response.ok&&response.type==='basic'){
     const cache=await caches.open(FT_SHELL_CACHE);
     await cache.put(cacheKey,response.clone());
    }
   }).catch(()=>{}));
   return saved;
  }
  try{
   const response=await fetch(req,{cache:'no-store'});
   if(response.ok&&response.type==='basic'){
    const cache=await caches.open(FT_SHELL_CACHE);
    event.waitUntil(cache.put(cacheKey,response.clone()));
   }
   return response;
  }catch{return Response.error();}
 })());
});

// Echte Hintergrund-Push-Mitteilungen, auch wenn die Web-App geschlossen ist.
// Keine Zugangstoken oder vertraulichen Nachrichtentexte im Payload.
// Keep push navigation inside this PWA and only to known application tabs.
const FT_PUSH_TABS=new Set(['messages','availability','standby','leave','time','reports','sick','work']);
function ftPushSafeUrl_(value){
 const root=new URL('./',self.registration.scope);
 let proposed;
 try{proposed=new URL(value||'',root);}catch{return new URL('?tab=messages',root).href;}
 if(proposed.origin!==root.origin||proposed.pathname!==root.pathname)
  return new URL('?tab=messages',root).href;
 const tab=proposed.searchParams.get('tab');
 return new URL('?tab='+(FT_PUSH_TABS.has(tab)?tab:'messages'),root).href;
}
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  let info={};
  try{info=event.data?.json()||{};}catch{}
  const title=String(info.title||'FireTime Pro').slice(0,90);
  const options={
   body:String(info.body||'Du hast eine neue Mitteilung.').slice(0,180),
   icon:new URL('assets/firetime-192.png',self.registration.scope).href,
   badge:new URL('assets/firetime-192.png',self.registration.scope).href,
   tag:String(info.tag||'firetime-neu').slice(0,80),
   renotify:true,
   timestamp:Date.now(),
   data:{url:ftPushSafeUrl_(info.url)},
   actions:[{action:'open',title:'In FireTime Pro öffnen'}]
  };
  await self.registration.showNotification(title,options);
  // Apple Home Screen web apps expose badges on WorkerNavigator, NOT on
  // ServiceWorkerRegistration. The trusted unread total arrives with each push,
  // so it can update even while all FireTime windows are closed.
  const unread=info.unreadCount;
  if(Number.isSafeInteger(unread)&&unread>=0&&unread<=999){
   try{
    if(unread>0&&typeof self.navigator?.setAppBadge==='function')
     await self.navigator.setAppBadge(unread);
    else if(unread===0&&typeof self.navigator?.clearAppBadge==='function')
     await self.navigator.clearAppBadge();
    else if(unread===0&&typeof self.navigator?.setAppBadge==='function')
     await self.navigator.setAppBadge(0);
   }catch(err){console.warn('Badge konnte nicht aktualisiert werden.');}
  }
  // Tell existing visible FireTime windows that fresh data is available.
  // No message content, access token or personal data is passed to the page.
  try{
   const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
   for(const client of windows){
    if(client.url.startsWith(self.registration.scope))
     client.postMessage({type:'FT_PUSH_RECEIVED',kind:String(info.kind||'COMM').slice(0,50)});
   }
  }catch(err){console.warn('Client-Aktualisierung nicht möglich.');}
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const target=ftPushSafeUrl_(event.notification?.data?.url);
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(c=>new URL(c.url).origin===new URL(target).origin);
  if(existing){
   if('navigate' in existing)await existing.navigate(target);
   return existing.focus();
  }
  return self.clients.openWindow(target);
 })());
});
