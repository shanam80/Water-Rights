// AcreFoot service worker.
//
// The brief suggested Workbox "unless there's a reason not to." There is
// one: this project has no build step at all — it's static HTML served by
// Express, edited directly. Workbox means either adding a bundler, or
// importScripts from a third-party CDN inside the worker, which makes the
// offline layer depend on a network fetch from someone else's server. The
// strategies below are the four the brief specifies and each is a dozen
// lines, so the dependency buys nothing here.
//
// Version the cache names to ship an update. Bump SW_VERSION and old caches
// are dropped on activate.
const SW_VERSION = 'v1';
const SHELL_CACHE = `acrefoot-shell-${SW_VERSION}`;
const PAGE_CACHE = `acrefoot-pages-${SW_VERSION}`;
const API_CACHE = `acrefoot-api-${SW_VERSION}`;
const TILE_CACHE = `acrefoot-tiles-${SW_VERSION}`;
const LOG_TILE_CACHE = `acrefoot-logtiles-${SW_VERSION}`;

const CURRENT_CACHES = new Set([SHELL_CACHE, PAGE_CACHE, API_CACHE, TILE_CACHE, LOG_TILE_CACHE]);

// Cache-first, so a returning visitor paints instantly. This also masks the
// host's cold start for returning visitors — but only for them, so it is
// not a substitute for fixing the hosting.
const SHELL_ASSETS = [
  '/',
  '/offline.html',
  '/basemaps.js',
  '/coords.js',
  '/radius.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon-180.png',
];

const MAP_TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];

// Map tiles are immutable and large, so they're capped by count and evicted
// oldest-first rather than allowed to grow without limit.
const TILE_CACHE_LIMIT = 220;
const LOG_TILE_CACHE_LIMIT = 400;
const API_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll fails the whole install if any single asset 404s, which would
      // leave the site with no worker at all. Individual puts degrade instead.
      .then((cache) => Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !CURRENT_CACHES.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  // Cache keys come back in insertion order, so the oldest are at the front.
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

// Correctness first, offline second. A 3s timeout means a phone on one bar
// falls back to cached data rather than hanging, but a working connection
// always wins.
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response && response.ok) {
      // The date is stored alongside the body so the page can say how old a
      // cached answer is. Serving a stale water right with no date is a real
      // risk for a legal-adjacent product.
      const copy = new Response(response.clone().body, response);
      copy.headers.append('x-acrefoot-cached-at', new Date().toISOString());
      cache.put(request, copy).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline and not cached');
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone()).catch(() => {});
    if (limit) trimCache(cacheName, limit);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  return cached || (await network) || caches.match('/offline.html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Never cache anything user-specific. Marketplace listings, contact and
  // the professional-tier form are all either personal or state-changing,
  // and a stale marketplace listing is worse than no listing.
  const NEVER_CACHE = ['/marketplace', '/contact', '/professional', '/api/marketplace', '/api/contact', '/api/professional-interest'];
  if (NEVER_CACHE.some((p) => url.pathname.startsWith(p))) return;

  // Map tiles — immutable, large, capped.
  if (MAP_TILE_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(cacheFirst(request, TILE_CACHE, TILE_CACHE_LIMIT).catch(() => fetch(request)));
    return;
  }

  // Well log document tiles — same reasoning, separate budget so a big log
  // can't evict the map a reader is standing on.
  if (url.pathname.startsWith('/api/well-logs/document/')) {
    event.respondWith(cacheFirst(request, LOG_TILE_CACHE, LOG_TILE_CACHE_LIMIT).catch(() => fetch(request)));
    return;
  }

  // Live records — network wins, cache is the fallback.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      networkFirst(request, API_CACHE).catch(
        () => new Response(JSON.stringify({ error: 'You appear to be offline, and this area has not been saved.', offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  if (SHELL_ASSETS.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE).catch(() => fetch(request)));
    return;
  }

  // Pages — fast from cache, refreshed in the background.
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(staleWhileRevalidate(request, PAGE_CACHE));
  }
});
