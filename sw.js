/**
 * Pantry Snap: service worker.
 *
 * Makes the app open offline. Strategy for our own files is "network first":
 * when online you always get the latest version (so updates show up straight away);
 * when offline, or the network takes too long, the cached copy is used.
 *
 * Calls to api.anthropic.com are never touched or cached. They need a connection.
 *
 * When you change the list of files below, bump CACHE_VERSION.
 */
const CACHE_VERSION = 'v1';
const CACHE = `pantry-snap-${CACHE_VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;

const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/api.js',
  'js/backup.js',
  'js/config.js',
  'js/dates.js',
  'js/identify.js',
  'js/image.js',
  'js/keyscreen.js',
  'js/merge.js',
  'js/pantry.js',
  'js/recipes.js',
  'js/scan.js',
  'js/settings.js',
  'js/storage.js',
  'js/suggest.js',
  'js/ui.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_SHELL.map(p => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('pantry-snap-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only handle our own GET requests. Everything else (including the Anthropic API) goes straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then(res => {
    if (res.ok && res.type === 'basic') cache.put(stripQuery(req), res.clone());
    return res;
  });
  network.catch(() => {}); // handled below; avoid "unhandled rejection" noise

  try {
    return await withTimeout(network, NETWORK_TIMEOUT_MS);
  } catch {
    const cached = await cache.match(stripQuery(req)) ||
      // Page navigations (e.g. /#pantry) fall back to the app shell.
      (req.mode === 'navigate' ? (await cache.match('index.html')) || (await cache.match('./')) : null);
    if (cached) return cached;
    // Nothing cached: if the network was just slow, keep waiting for it.
    try { return await network; } catch { return new Response('Offline', { status: 503, statusText: 'Offline' }); }
  }
}

function stripQuery(req) {
  const url = new URL(req.url);
  url.search = '';
  return url.toString();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
