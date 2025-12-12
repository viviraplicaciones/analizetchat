const CACHE_NAME = 'analizetchat-v5'; // Incrementado para asegurar actualización
const SHARED_DB_NAME = 'WAAnalyzerV4_Media'; // Nombre exacto usado en el index.html

const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg',
  'https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&family=Roboto:wght@200;300&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// --- EVENTO INSTALL ---
self.addEventListener('install', event => {
  self.skipWaiting(); // Forzar activación inmediata
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache abierto');
        return cache.addAll(urlsToCache);
      })
  );
});

// --- EVENTO ACTIVATE ---
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(), // Tomar control de inmediato
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// --- EVENTO FETCH (INTERCEPTOR DE RED) ---
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. LÓGICA WEB SHARE TARGET (Recibir archivo de WhatsApp)
  // Intercepta la ruta virtual definida en manifest.json
  if (event.request.method === 'POST' && url.pathname.endsWith('/_share-target')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get('file'); // 'file' coincide con el name en manifest

          if (file) {
            // Guardar en IndexedDB para que el index.html lo lea
            await saveSharedFileToDB(file);
          }
          // Redirigir al usuario a la app (index.html) indicando acción de compartir
          return Response.redirect('./index.html?action=share', 303);
        } catch (err) {
          console.error('Error al recibir archivo compartido:', err);
          return Response.redirect('./index.html?error=share_failed', 303);
        }
      })()
    );
    return; // Detener aquí para no ejecutar caché
  }

  // 2. LÓGICA DE CACHÉ HABITUAL (Tu código original)
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

// --- FUNCIONES AUXILIARES (DB) ---

function saveSharedFileToDB(file) {
  return new Promise((resolve, reject) => {
    // Abrir la misma DB que usa la app principal (versión 4)
    const req = indexedDB.open(SHARED_DB_NAME, 4); 
    
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // Asegurar almacenes necesarios
      if (!db.objectStoreNames.contains('shared_files')) {
        db.createObjectStore('shared_files');
      }
      if (!db.objectStoreNames.contains('slots')) {
        db.createObjectStore('slots', { keyPath: 'id' });
      }
    };

    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('shared_files', 'readwrite');
      const store = tx.objectStore('shared_files');
      // Guardar con clave fija 'latest'
      store.put(file, 'latest');
      
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };

    req.onerror = () => reject(req.error);
  });
}

// --- SINCRONIZACIÓN EN SEGUNDO PLANO (TU CÓDIGO ORIGINAL) ---

self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-for-updates') {
    event.waitUntil(checkForUpdates());
  }
});

async function checkForUpdates() {
  try {
    const response = await fetch('/version.json');
    if (!response.ok) return;
    const remoteVersion = await response.json();
    
    console.log('Buscando actualizaciones en segundo plano. Versión remota:', remoteVersion.version);

    self.registration.showNotification('Aplicación actualizada', {
      body: 'Se han descargado nuevas mejoras. La próxima vez que abras la app, verás la última versión.',
      icon: 'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg'
    });
  } catch (error) {
    console.error('Fallo al buscar actualizaciones:', error);
  }
}

self.addEventListener('sync', event => {
  if (event.tag === 'send-bug-report') {
    event.waitUntil(sendQueuedBugReports());
  }
});

async function sendQueuedBugReports() {
    console.log('Conexión recuperada. Enviando informe de fallo...');
    // Aquí iría el fetch real
    self.registration.showNotification('Informe de fallo enviado', {
      body: 'Gracias por tu ayuda. Hemos recibido tu informe correctamente.',
      icon: 'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg'
    });
}