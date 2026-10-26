// Service worker i SuperPool: aplikacioni hapet edhe pa internet (terreni).
// - Faqet: rrjeti në radhë të parë, përndryshe index.html nga memoria.
// - Skedarët e ndërtimit (/assets/…), logot dhe fontet: nga memoria, pastaj rrjeti.
// Të dhënat (Firestore) ruhen më vete nga Firebase në IndexedDB; dokumentet pa internet i mban radha e dërgimit.

const CACHE = 'superpool-v1';
const SHELL = ['/', '/index.html', '/logo-superpool.jpg', '/icon-192.png', '/icon-64.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Të gjitha faqet e aplikacionit (edhe ato që s'janë hapur ende), që të punojnë pa internet.
    try {
      const files = await (await fetch('/precache.json', { cache: 'no-store' })).json();
      const keep = new Set(files.map((f) => new URL(f, self.location.origin).href));
      for (const req of await cache.keys()) {
        if (new URL(req.url).pathname.startsWith('/assets/') && !keep.has(req.url)) await cache.delete(req);
      }
      await cache.addAll(files.filter((f) => !/\/(excel|pdf)-/.test(f))); // Excel/PDF ngarkohen kur përdoren
    } catch { /* pa listë — skedarët ruhen kur hapen */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !STATIC_HOSTS.includes(url.hostname)) return; // Firebase, Storage etj. — pa ndërhyrje

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html', { ignoreVary: true })),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreVary: true, ignoreSearch: url.pathname.startsWith('/assets/') }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
