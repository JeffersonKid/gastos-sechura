// Service Worker: deja la app (y el motor OCR, tras su primer uso) disponible sin conexion.
// Para publicar una version nueva, cambie VERSION.
const VERSION = 'v4';
const CACHE = 'sechura-' + VERSION;
const BASE = new URL('./', self.location).href;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let files = [];
    try { files = await (await fetch(BASE + 'precache.json', { cache: 'no-store' })).json(); } catch { /* modo desarrollo */ }
    const urls = [BASE, ...files.map((f) => BASE + f), BASE + 'manifest.webmanifest', BASE + 'icon.svg', BASE + 'icon-192.png', BASE + 'icon-512.png', BASE + 'ocr/worker.min.js'];
    await Promise.all(urls.map((u) => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('sechura-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(BASE)) return;
  const isNav = req.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isNav) {
      try { const r = await fetch(req); if (r.ok) cache.put(BASE, r.clone()); return r; } catch { return (await cache.match(BASE)) || Response.error(); }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    try { const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r; } catch { return Response.error(); }
  })());
});



