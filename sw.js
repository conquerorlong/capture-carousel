// Çevrimdışı çalışma: uygulama dosyaları (yazı tipleri dahil) önbellekten.
const V = 'capture-v3';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/stage.js', 'js/render.js', 'js/store.js',
  'js/templates.js', 'js/zip.js', 'js/video.js', 'fonts/fonts.css',
  'fonts/bebas-neue-latin-995908.woff2', 'fonts/bebas-neue-latin-ext-768b53.woff2', 'fonts/caveat-latin-4230ff.woff2', 'fonts/caveat-latin-ext-6b2267.woff2', 'fonts/dm-serif-display-latin-ext-108856.woff2', 'fonts/dm-serif-display-latin-f5a250.woff2', 'fonts/inter-latin-1ab1ad.woff2', 'fonts/inter-latin-ext-749a30.woff2', 'fonts/montserrat-latin-2f5adf.woff2', 'fonts/montserrat-latin-ext-de38a2.woff2', 'fonts/playfair-display-latin-0f6fcd.woff2', 'fonts/playfair-display-latin-9deeae.woff2', 'fonts/playfair-display-latin-ext-3a90cf.woff2', 'fonts/playfair-display-latin-ext-f556cd.woff2', 'fonts/space-mono-latin-391873.woff2', 'fonts/space-mono-latin-df899b.woff2', 'fonts/space-mono-latin-ext-8a2467.woff2', 'fonts/space-mono-latin-ext-d4ba38.woff2', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png'];

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
  }
});
