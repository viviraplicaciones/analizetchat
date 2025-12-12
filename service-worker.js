const CACHE_NAME = 'analizetchat-v9-final'; // Incrementado
const SHARED_DB_NAME = 'WAAnalyzerV4_Media'; // Mismo nombre que en index.html

const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// --- INSTALACIÓN ---
self.addEventListener('install', event => {
  // NO usamos skipWaiting automático para dejar que el usuario decida actualizar
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Cache abierto');
      return cache.addAll(urlsToCache);
    })
  );
});

// --- MENSAJE PARA FORZAR ACTUALIZACIÓN ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- ACTIVACIÓN ---
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys => Promise.all(
        keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)
      ))
    ])
  );
});

// --- FETCH (INTERCEPTOR) ---
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. INTERCEPTOR DE SHARE TARGET (Evita error 404 en exportación directa)
  if (event.request.method === 'POST' && url.pathname.endsWith('/_share-target')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get('file'); // Coincide con manifest

          if (file) {
            await saveSharedFileToDB(file);
          }
          return Response.redirect('./index.html?action=share', 303);
        } catch (err) {
          console.error('Error share target:', err);
          return Response.redirect('./index.html?error=share_failed', 303);
        }
      })()
    );
    return;
  }

  // 2. CACHÉ NORMAL
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

// --- HELPER DB (Guardar archivo compartido) ---
function saveSharedFileToDB(file) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARED_DB_NAME, 4);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('shared_files')) db.createObjectStore('shared_files');
      if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'id' });
    };
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('shared_files', 'readwrite');
      tx.objectStore('shared_files').put(file, 'latest');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(); };
    };
    req.onerror = () => reject();
  });
}

// --- BACKGROUND SYNC (Tus funciones originales) ---
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-for-updates') {
    // Lógica de actualización periódica
  }
});

self.addEventListener('sync', event => {
  if (event.tag === 'send-bug-report') {
    // Lógica de envío de reportes
  }
});