const CACHE = 'interest-pro-v3';
const ASSETS = [
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  // DO NOT call self.clients.claim() — it causes existing tabs to reload/freeze
  // when a new client (PDF tab) is opened and the SW tries to claim it
});

self.addEventListener('fetch', e => {
  // Only intercept same-origin navigations and assets — never blob: or data: URLs
  const url = new URL(e.request.url);
  if (url.protocol === 'blob:' || url.protocol === 'data:') return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});
