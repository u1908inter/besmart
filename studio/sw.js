// BeSmart Studio のオフライン対応（一度開いたページと素材を端末に保存しておく）
const V = 'bss-v1';
const CORE = ['./', './index.html', './about.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable.png', './apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('bss-') && k !== V && k !== 'bss-fonts').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (r.mode === 'navigate') {
      // ページはまずネットから（更新を早く届ける）、つながらなければ保存した版
      e.respondWith(fetch(r).then(res => {
        if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
        return res;
      }).catch(() => caches.match(r).then(m => m || caches.match('./index.html'))));
      return;
    }
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
      return res;
    })));
    return;
  }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    // フォントは保存した版をすぐ使い、裏で新しいものに入れ替える
    e.respondWith(caches.open('bss-fonts').then(async c => {
      const m = await c.match(r);
      const f = fetch(r).then(res => { c.put(r, res.clone()); return res; }).catch(() => m);
      return m || f;
    }));
  }
});
