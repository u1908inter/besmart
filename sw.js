/* BeSmart service worker: offline cache + Android share target */
const CACHE = 'besmart-v2';
const SHELL = ['./', './index.html', './unrar.js', './unrar.wasm', './la/libarchive.js', './la/worker-bundle.js', './la/libarchive.wasm',
  './vendor/ogg-vorbis-decoder.min.js', './songs/BeSmartPV.zip', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('besmart-v') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // Android share target: keep the shared files, then open the app
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await req.formData();
        const c = await caches.open('besmart-share');
        let i = 0;
        for (const f of fd.getAll('files')) {
          if (!f || typeof f === 'string') continue;
          await c.put(new Request(`./shared/${Date.now()}-${i++}`), new Response(f, { headers: { 'X-Name': encodeURIComponent(f.name || 'shared.zip') } }));
        }
      } catch (err) {}
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/media/')) return; // the promo video is not cached
  // pages: network first, fall back to cache (so updates arrive quickly)
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  // other files: cache first, refresh in the background
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
