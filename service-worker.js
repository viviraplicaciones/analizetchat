const CACHE_NAME = 'analizetchat-v7'; // Incrementamos versión
const DB_NAME = 'WAAnalyzerV4_Media';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './parser.worker.js',
  'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg',
  'https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&family=Roboto:wght@200;300&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// --- IDB HELPER (Self Contained) ---
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 4);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('shared_files')) db.createObjectStore('shared_files');
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e);
    });
}

// --- INSTALL & ACTIVATE ---
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.map(name => {
      if (name !== CACHE_NAME) return caches.delete(name);
  }))));
  self.clients.claim();
});

// --- FETCH & SHARE TARGET ---
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Manejo Share Target
  if (event.request.method === 'POST' && url.pathname.includes('share-target-handler')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const clientFile = formData.get('file');
          
          if (clientFile) {
            // Guardar en IDB
            const db = await openDB();
            const tx = db.transaction('shared_files', 'readwrite');
            tx.objectStore('shared_files').put(clientFile, 'latest');
            await new Promise(resolve => tx.oncomplete = resolve);
          }
          // Redirigir SIEMPRE, incluso si falla algo, para no dejar al usuario en blanco
          return Response.redirect('./index.html?action=share', 303);
        } catch (err) {
          console.error('Share error:', err);
          return Response.redirect('./index.html?error=share_failed', 303);
        }
      })()
    );
    return;
  }

  // Cache Strategy
  event.respondWith(
    caches.match(event.request).then(res => res || fetch(event.request))
  );
});