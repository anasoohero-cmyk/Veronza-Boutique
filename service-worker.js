const CACHE = 'veronza-v113';
// Product photos live on Supabase Storage, a different origin than the
// site itself - the app-shell cache below only ever handles same-origin
// requests, so every visit re-downloaded every product image from
// scratch regardless of how many times it had already been seen. Each
// uploaded file gets a unique, unchanging filename, so once fetched it's
// safe to keep indefinitely in its own cache that survives app deploys
// (only CACHE above gets wiped on each release).
const IMAGE_CACHE = 'veronza-images-v1';
const IMAGE_HOST = 'kahbxvbirsjmednkybse.supabase.co';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/links.html',
  '/admin-home.html',
  '/admin-home.js',
  '/admin-home.css',
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
  '/admin-users.html',
  '/admin-users.js',
  '/admin-users.css',
  '/admin-inventory.html',
  '/admin-inventory.js',
  '/admin-inventory.css',
  '/product-categories.js',
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
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== IMAGE_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname === IMAGE_HOST && url.pathname.startsWith('/storage/v1/object/public/')) {
    e.respondWith(
      caches.open(IMAGE_CACHE).then((cache) =>
        cache.match(e.request).then(
          (cached) =>
            cached ||
            fetch(e.request).then((response) => {
              if (response && response.ok) cache.put(e.request, response.clone());
              return response;
            }),
        ),
      ),
    );
    return;
  }
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
