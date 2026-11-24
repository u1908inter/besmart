// BeSmart Studio は https://u1908inter.github.io/besmart-studio/ に移転しました。
// 旧アドレスに残ったオフライン用の保存を消して、この仕組み自体も止めます。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('bss-')).map(k => caches.delete(k))))
    .then(() => self.registration.unregister()));
});
