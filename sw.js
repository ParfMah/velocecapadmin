/* ============================================================
   sw.js — Service Worker Veloce Capital Admin PWA
   ============================================================ */

const CACHE_NAME = 'vc-admin-v1.0';
const STATIC_ASSETS = [
  './index.html',
  './css/app.css',
  './js/api.js',
  './js/app.js',
  './icons/icon-192.svg',
  './manifest.json',
];

/* ── Install : mise en cache des ressources statiques ─── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

/* ── Activate : nettoyage des anciens caches ─────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch : Network First pour l'API, Cache First pour les assets ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Requêtes API → toujours network (pas de cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() =>
      new Response(JSON.stringify({ message: 'Hors ligne – connexion requise' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } })
    ));
    return;
  }

  // Assets statiques → Cache First
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      return response;
    })).catch(() => caches.match('/admin-mobile/index.html'))
  );
});

/* ── Push Notifications (si activées côté serveur) ────── */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Veloce Capital Admin', {
      body:    data.body  || '',
      icon:    '/admin-mobile/icons/icon-192.svg',
      badge:   '/admin-mobile/icons/icon-192.svg',
      vibrate: [200, 100, 200],
      data:    data,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/admin-mobile/index.html'));
});
