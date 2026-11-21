/* BeSmart service worker: offline cache + Android share target */
const CACHE = 'besmart-v6';
const SHELL = ['./', './index.html', './unrar.js', './unrar.wasm', './unrar-worker.js', './vendor/sql-wasm.js', './vendor/sql-wasm.wasm', './la/libarchive.js', './la/worker-bundle.js', './la/libarchive.wasm',
  './vendor/ogg-vorbis-decoder.min.js', './songs/BeSmartPV.zip', './songs/PQ2_Grass.zip', './songs/PQ2_Desert.zip', './songs/PQ2_Boss1.zip', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' bypasses the browser HTTP cache so a new version is really fetched
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
  if (url.pathname.includes('/media/') || url.pathname.includes('/tables/')) return; // promo video and table mirrors: always from the network
  // pages: network first, fall back to cache (so updates arrive quickly)
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { const cp = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  // other files: cache first, refresh in the background
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

/* "まとめて追加" (collect.html): downloads handed to the browser keep going with the screen off.
   Each finished file goes into the same inbox as the share target; BeSmart imports it on its next start. */
function bfKind(u8) {
  if (u8[0] === 0x50 && u8[1] === 0x4B) return 'zip';
  if (u8[0] === 0x52 && u8[1] === 0x61 && u8[2] === 0x72 && u8[3] === 0x21) return 'rar';
  if (u8[0] === 0x37 && u8[1] === 0x7A && u8[2] === 0xBC && u8[3] === 0xAF) return '7z';
  if (u8[2] === 0x2D && u8[3] === 0x6C && (u8[4] === 0x68 || u8[4] === 0x7A) && u8[6] === 0x2D) return 'lzh';
  return null;
}
function bfName(res, src, kind) {
  let n = ''; const cd = res.headers.get('content-disposition') || '';
  let m = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i); if (m) { try { n = decodeURIComponent(m[1]); } catch (e) {} }
  if (!n) { m = cd.match(/filename\s*=\s*"?([^";]+)"?/i); if (m) n = m[1]; }
  if (!n) { try { n = decodeURIComponent(new URL(res.headers.get('x-final-url') || src).pathname.split('/').pop().replace(/\+/g, ' ')); } catch (e) {} }
  n = (n || 'download').replace(/[\\/:*?"<>|]/g, '_');
  if (!/\.(zip|rar|7z|lzh|lha)$/i.test(n)) n += '.' + kind;
  return n;
}
async function bfCollect(e) {
  const reg = e.registration, out = [];
  const inbox = await caches.open('besmart-share');
  for (const rec of await reg.matchAll()) {
    let src = rec.request.url; try { src = new URL(rec.request.url).searchParams.get('url') || src; } catch (err) {}
    try {
      const res = await rec.responseReady;
      if (!res.ok || res.headers.get('x-collect-error')) { let why = ''; try { why = (await res.text()).slice(0, 200); } catch (err) {} out.push({ url: src, ok: false, msg: '中継：' + (why || 'HTTP ' + res.status) }); continue; }
      const blob = await res.blob();
      const kind = bfKind(new Uint8Array(await blob.slice(0, 8).arrayBuffer()));
      if (!kind) { out.push({ url: src, ok: false, msg: 'BMSの書庫ではないようです（Webページが返ってきた可能性）' }); continue; }
      const name = bfName(res, src, kind);
      await inbox.put(new Request(`./shared/collect-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`), new Response(blob, { headers: { 'X-Name': encodeURIComponent(name) } }));
      out.push({ url: src, ok: true, name, size: blob.size });
    } catch (err) { out.push({ url: src, ok: false, msg: e.type === 'backgroundfetchabort' ? '取得し終わる前にキャンセルされました' : '中継に接続できませんでした' }); }
  }
  const box = await caches.open('besmart-collect');
  await box.put(new Request(`./collect-result/${encodeURIComponent(reg.id)}`), new Response(JSON.stringify({ id: reg.id, t: Date.now(), items: out }), { headers: { 'Content-Type': 'application/json' } }));
  const ok = out.filter(x => x.ok).length;
  if (e.updateUI) try { await e.updateUI({ title: `BeSmart：${ok}件取得${out.length - ok ? `・${out.length - ok}件失敗` : ''}（次にBeSmartを開くと取り込みます）` }); } catch (err) {}
}
self.addEventListener('backgroundfetchsuccess', e => e.waitUntil(bfCollect(e)));
self.addEventListener('backgroundfetchfail', e => e.waitUntil(bfCollect(e)));
// cancelled from the notification (e.g. stuck at 99%): keep the files that did finish
self.addEventListener('backgroundfetchabort', e => e.waitUntil(bfCollect(e)));
self.addEventListener('backgroundfetchclick', e => e.waitUntil(clients.openWindow('./collect.html')));
