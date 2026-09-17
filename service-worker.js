const CACHE = 'veronza-v13';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/auth.js',
  '/product-quantity.js',
  '/product-links.js',
  '/pull-to-refresh.js',
  '/app-update.js',
  '/notifications.js',
  '/chat-widget.js',
  '/webrtc-call.js',
  '/manifest.webmanifest',
  '/icons/veronza-icon.svg',
  '/icons/veronza-icon-192.png',
  '/icons/veronza-icon-512.png',
  '/icons/apple-touch-icon.png',
  '/admin.html',
  '/admin.js',
  '/admin.css',
  '/admin-menu.js',
  '/admin-chat-widget.js',
  '/admin-products.html',
  '/admin-products.js',
  '/admin-products.css',
  '/admin-pull-refresh.js',
  '/admin-chat.html',
  '/admin-chat.js',
  '/admin-chat.css',
  '/manifest-admin.webmanifest',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE_ASSETS).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  const isAppShell = e.request.mode === 'navigate' || CORE_ASSETS.includes(url.pathname);
  if (isAppShell) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches
              .open(CACHE)
              .then((c) => c.put(e.request, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match(e.request).then((cached) => cached || caches.match('/index.html')),
        ),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches
              .open(CACHE)
              .then((c) => c.put(e.request, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
self.addEventListener('push', (e) => {
  let data = { title: 'طلب جديد في VERONZA', body: 'وصل طلب جديد إلى المتجر.', url: '/' };
  try {
    data = { ...data, ...(e.data?.json() || {}) };
  } catch (_) {}
  const tasks = [
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/veronza-icon.svg',
      badge: '/icons/veronza-icon.svg',
      data: { url: data.url || '/' },
      dir: 'rtl',
      requireInteraction: true,
      vibrate: [200, 100, 200],
      tag: data.url || 'veronza-order',
      renotify: true,
    }),
  ];
  if (typeof data.badgeCount === 'number') {
    tasks.push(
      (async () => {
        try {
          if (data.badgeCount > 0) await self.navigator.setAppBadge(data.badgeCount);
          else await self.navigator.clearAppBadge();
        } catch (_) {}
      })(),
    );
  }
  e.waitUntil(Promise.all(tasks));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const target = new URL(url, self.location.origin).href;
      for (const c of list) {
        if ('focus' in c) {
          if (c.url !== target && 'navigate' in c) {
            try {
              await c.navigate(target);
            } catch (_) {}
          }
          return c.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
