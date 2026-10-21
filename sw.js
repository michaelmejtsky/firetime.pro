// FireTime Pro V1.8.7: keine Sitzungsdaten oder API-Ergebnisse offline zwischenspeichern.
// Die PWA darf sowohl unter / als auch unter /firetime.pro/ (GitHub Pages) laufen.
const FT_SHELL_CACHE='firetime-shell-20261021-v188';
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
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 if(/\/config\.js$/.test(url.pathname))return;
 const isPage=req.mode==='navigate';
 const shell=FT_SHELL_URLS.includes(url.href.split('?')[0]);
 if(!isPage&&!shell)return;
 event.respondWith(
  fetch(req,{cache:'no-store'}).catch(async()=>{
   if(isPage)return (await caches.match(new URL('index.html',FT_BASE).href))||
    Response.error();
   return (await caches.match(req,{ignoreSearch:true}))||Response.error();
  })
 );
});


// Echte Hintergrund-Push-Mitteilungen, auch wenn die Web-App geschlossen ist.
// Keine Zugangstoken oder vertraulichen Nachrichtentexte im Payload.
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
   data:{url:new URL('?tab=messages',self.registration.scope).href},
   actions:[{action:'open',title:'Nachrichten öffnen'}]
  };
  await self.registration.showNotification(title,options);
  // Der exakte Ungelesenzähler wird bei der nächsten App-Aktualisierung gesetzt.
  if(typeof self.registration.setAppBadge==='function'){
   try{await self.registration.setAppBadge();}catch{}
  }
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const target=new URL('?tab=messages',self.registration.scope).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(c=>new URL(c.url).origin===new URL(target).origin);
  if(existing){
   if('navigate' in existing)await existing.navigate(target);
   return existing.focus();
  }
  return self.clients.openWindow(target);
 })());
});
