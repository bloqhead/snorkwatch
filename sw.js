// SnorkWatch Service Worker
// Network-first for app shell so updates are always picked up.
// Posts a message to the page when a new version is waiting,
// then waits for the page to confirm before activating.

const CACHE = 'snorkwatch-v2';
const SHELL = ['/', '/index.html', '/style.css', '/main.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  // Don't skipWaiting — let the update banner handle it
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Page sends 'SKIP_WAITING' when user taps the update banner
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Network-only for live API data
  if (url.includes('open-meteo') || url.includes('nominatim') || url.includes('fonts.')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match(e.request).then(c =>
          c || new Response('{}', { headers: { 'Content-Type': 'application/json' } })
        )
      )
    );
    return;
  }

  // Network-first for app shell — always fetch fresh, update cache, fall back offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
