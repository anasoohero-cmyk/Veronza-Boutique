const CACHE='veronza-v4';
const CORE_ASSETS=['/','/index.html','/styles.css','/app.js','/auth.js','/product-quantity.js','/product-links.js','/pull-to-refresh.js','/app-update.js','/notifications.js','/manifest.webmanifest','/icons/veronza-icon.svg','/icons/veronza-icon-192.png','/icons/veronza-icon-512.png','/icons/apple-touch-icon.png','/admin.html','/admin.js','/admin.css','/admin-products.html','/admin-products.js','/admin-products.css','/manifest-admin.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE_ASSETS).catch(()=>{})));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{if(e.data==='skipWaiting')self.skipWaiting()});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/api/'))return;
  const isAppShell=e.request.mode==='navigate'||CORE_ASSETS.includes(url.pathname);
  if(isAppShell){
    e.respondWith(
      fetch(e.request,{cache:'no-store'}).then(response=>{
        if(response&&response.status===200){const clone=response.clone();caches.open(CACHE).then(c=>c.put(e.request,clone)).catch(()=>{})}
        return response;
      }).catch(()=>caches.match(e.request).then(cached=>cached||caches.match('/index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const network=fetch(e.request).then(response=>{
        if(response&&response.status===200&&response.type==='basic'){
          const clone=response.clone();
          caches.open(CACHE).then(c=>c.put(e.request,clone)).catch(()=>{});
        }
        return response;
      }).catch(()=>cached);
      return cached||network;
    })
  );
});
self.addEventListener('push',e=>{let data={title:'طلب جديد في VERONZA',body:'وصل طلب جديد إلى المتجر.',url:'/'};try{data={...data,...(e.data?.json()||{})}}catch(_){}e.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icons/veronza-icon.svg',badge:'/icons/veronza-icon.svg',data:{url:data.url||'/'},dir:'rtl'}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus' in c)return c.focus()}return clients.openWindow(e.notification.data?.url||'/')}))});
