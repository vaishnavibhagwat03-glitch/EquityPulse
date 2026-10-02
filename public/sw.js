/* EquityPulse service worker: offline app shell + last-known API data.
 * - /_next/static/*: cache-first (content-hashed, immutable).
 * - pages and GET /api/*: network-first, falling back to the last cached copy,
 *   so the screener opens and filters offline with the last universe.
 * The universe itself is also persisted to IndexedDB by TanStack Query. */
const CACHE = 'ep-v1';
const SHELL = ['/', '/screener', '/watchlist', '/heatmap'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        hit =>
          hit ||
          fetch(request).then(res => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then(c => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate' || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(request, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(request)
            .then(hit => hit || (request.mode === 'navigate' ? caches.match('/screener') : undefined))
            .then(hit => hit || Response.error()),
        ),
    );
  }
});
