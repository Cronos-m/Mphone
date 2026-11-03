/* Mental Picture · Service Worker minimalista
   Cachea los recursos estáticos para funcionar offline.
   Si editas algo, cambia CACHE_VERSION para forzar actualización. */

const CACHE_VERSION = 'mp-v4.0.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './i18n.js',
  './manifest.webmanifest',
  './assets/icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/demo.jpg',
  './assets/lock_bg.png',
  './assets/handwriting.ttf',
  './assets/cards.ttf',
  './img/battery-ios.png',
  './img/battery-android.png',
  './img/signal-ios.png',
  './img/signal-android.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('SW install cache failed:', err))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Solo cachear GET requests del mismo origen
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // No cachear respuestas con error o de otros orígenes
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(e.request, clone));
        return response;
      });
    })
  );
});