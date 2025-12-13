const CACHE_NAME = 'analizetchat-v6'; // Incrementamos versión
const DB_NAME = 'WAAnalyzerV4_Media'; // Mismo nombre que en app.js
const urlsToCache = [
  './',
  './index.html',
  './style.css', // Agregamos el nuevo archivo CSS
  './app.js',    // Agregamos el nuevo archivo JS
  './manifest.json',
  './parser.worker.js', // Importante cachear el worker
  'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg',
  'https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&family=Roboto:wght@200;300&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// --- FUNCIONES DE BASE DE DATOS (IDB) ---
// Necesarias para guardar el archivo compartido de forma persistente
function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 4);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('slots')) {
        db.createObjectStore('slots', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('shared_files')) {
        db.createObjectStore('shared_files');
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e);
  });
}

async function saveSharedFile(file) {
  try {
    const db = await getDB();
    const tx = db.transaction('shared_files', 'readwrite');
    // Guardamos con la clave 'latest' para que app.js lo encuentre
    tx.objectStore('shared_files').put(file, 'latest');
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    console.error('Error guardando en IDB desde SW:', error);
  }
}

// --- INSTALACIÓN ---
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache abierto');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); 
});

// --- ACTIVACIÓN ---
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); 
});

// --- INTERCEPCIÓN DE RED (FETCH) ---
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Manejo de Share Target (Exportación desde WhatsApp)
  if (event.request.method === 'POST' && url.pathname.includes('share-target-handler')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const clientFile = formData.get('file'); 
          
          if (clientFile) {
            console.log('Archivo recibido en SW (Persistiendo en IDB)...');
            // GUARDADO SEGURO EN DISCO (IndexedDB)
            await saveSharedFile(clientFile);
          }

          // Redirigimos a la app con el parámetro action=share
          return Response.redirect('./index.html?action=share', 303);
        } catch (err) {
          console.error('Error al recibir archivo compartido:', err);
          return Response.redirect('./index.html?error=share_failed', 303);
        }
      })()
    );
    return;
  }

  // 2. Estrategia de Caché Predeterminada (Cache First)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// Sincronización de Fondo (Opcional, mantenida de tu código original)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-for-updates') {
    // Lógica placeholder
    console.log('Periodic sync disparado');
  }
});