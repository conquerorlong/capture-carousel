// Çevrimdışı çalışma: uygulama dosyaları önbellekten, yazı tipleri ilk yüklemeden sonra önbellekten.
const V = 'kaydir-v3';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/stage.js', 'js/render.js', 'js/store.js',
  'js/templates.js', 'js/zip.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // önce ağ (güncelleme hemen gelsin), ağ yoksa önbellek
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
      const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)); return r;
    })));
  }
});
