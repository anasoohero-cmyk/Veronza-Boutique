const CACHE='veronza-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))) });
self.addEventListener('push',e=>{let data={title:'طلب جديد في VERONZA',body:'وصل طلب جديد إلى المتجر.',url:'/'};try{data={...data,...(e.data?.json()||{})}}catch(_){}e.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icons/veronza-icon.svg',badge:'/icons/veronza-icon.svg',data:{url:data.url||'/'},dir:'rtl'}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus' in c)return c.focus()}return clients.openWindow(e.notification.data?.url||'/')}))});
