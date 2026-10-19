// FireTime Pro: API- und Sitzungsdaten werden niemals offline zwischengespeichert.
const FT_SHELL_CACHE='firetime-shell-20261019-install-v1';
const FT_SHELL_URLS=['/','/index.html','/manifest.webmanifest','/assets/firetime-192.png','/assets/firetime-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(FT_SHELL_CACHE).then(cache=>cache.addAll(FT_SHELL_URLS)));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('firetime-shell-')&&key!==FT_SHELL_CACHE).map(key=>caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname==='/config.js')return; // immer aktuelle öffentliche Konfiguration
  if(req.mode==='navigate'){
    // Einladungstoken/Benutzerinformationen nie mit voller URL im Cache ablegen.
    event.respondWith(fetch(req).catch(()=>caches.match('/index.html')));
    return;
  }
  if(FT_SHELL_URLS.includes(url.pathname))event.respondWith(fetch(req).catch(()=>caches.match(url.pathname)));
});
