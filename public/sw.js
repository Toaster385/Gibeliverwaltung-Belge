// Service Worker: macht die App installierbar und lädt sie auch bei schlechtem/keinem Internet.
// Strategie: Netzwerk zuerst (immer die neueste Version), bei Ausfall die zuletzt gespeicherte.
// Daten (/api/...) und Belegfotos (/uploads/...) werden NIE zwischengespeichert (Datenschutz auf geteilten Geräten).
const VERSION = 'gibeli-__BUILD__';
// Nur öffentliche Dateien vorab laden; geschützte (app.js, style.css, …) werden nach der Anmeldung beim ersten Aufruf gespeichert
const HUELLE = ['/login.html', '/login.css', '/excel-ansicht.css', '/excel-ansicht.js', '/belegung-liste.css', '/belegung-liste.js', '/wetter.css', '/wetter.js', '/manifest.webmanifest',
  '/fonts/inter-latin-400-normal.woff2', '/fonts/inter-latin-600-normal.woff2', '/fonts/fraunces-latin-600-normal.woff2', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(HUELLE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname === '/healthz' || url.pathname === '/sw.js') return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const antwort = await fetch(req);
      // Weiterleitungen (z.B. zur Anmeldung) und Fehler nie speichern
      if (antwort.ok && !antwort.redirected && antwort.type === 'basic') cache.put(req, antwort.clone());
      return antwort;
    } catch (err) {
      const treffer = await cache.match(req, { ignoreSearch: true });
      if (treffer) return treffer;
      if (req.mode === 'navigate') {
        const start = await cache.match('/') || await cache.match('/index.html') || await cache.match('/login.html');
        if (start) return start;
      }
      return new Response('Keine Verbindung', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

// Die angemeldete Seite meldet, welche (geschützten) Dateien für den Offline-Start gespeichert werden sollen
self.addEventListener('message', e => {
  if (!e.data || e.data.typ !== 'huelle') return;
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const u of e.data.urls || []) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (r.ok && !r.redirected && r.type === 'basic') await cache.put(u, r);
      } catch (err) {}
    }
  })());
});
