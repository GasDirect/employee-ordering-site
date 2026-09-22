const VERSION = 'store-order-v3-2026-09-22-aldi';
const SHELL = [
  './', './index.html', './assets/styles.css', './assets/app.js',
  './data/config.json', './data/products.json', './manifest.webmanifest',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  const isProductImage = url.pathname.includes('/assets/products/');
  const shouldRefresh = event.request.mode === 'navigate' ||
    /\/(data\/[^/]+\.json|assets\/[^/]+\.(?:js|css)|index\.html)$/.test(url.pathname);

  if (shouldRefresh) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) caches.open(VERSION).then(cache => cache.put(event.request, response.clone()));
        return response;
      }).catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  if (isProductImage) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) caches.open(VERSION).then(cache => cache.put(event.request, response.clone()));
      return response;
    })));
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
