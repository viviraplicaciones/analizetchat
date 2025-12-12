const CACHE_NAME = 'analizetchat-v8-final'; // Incrementado para forzar actualización
const SHARED_DB_NAME = 'WAAnalyzerV4_Media'; // DB compartida con index.html

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

// --- INSTALACIÓN Y ACTIVACIÓN ---
self.addEventListener('install', event => {
  // Eliminamos self.skipWaiting() automático para permitir que el usuario decida cuándo actualizar
  // self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache abierto');
        return cache.addAll(urlsToCache);
      })
  );
});

// --- NUEVO: Escuchar mensaje para forzar actualización ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
    return; // Detener aquí para no ejecutar caché estándar
  }

  // 2. LÓGICA DE CACHÉ HABITUAL
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
      // Guardar con clave fija 'latest' para recuperar en index.html
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

// --- TUS FUNCIONES DE FONDO ORIGINALES ---

// 1. Sincronización Periódica para buscar actualizaciones
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

// 2. Sincronización de Fondo para enviar informes de fallos
self.addEventListener('sync', event => {
  if (event.tag === 'send-bug-report') {
    event.waitUntil(sendQueuedBugReports());
  }
});

async function sendQueuedBugReports() {
    console.log('Conexión recuperada. Enviando informe de fallo...');
    // Lógica simulada de envío
    self.registration.showNotification('Informe de fallo enviado', {
      body: 'Gracias por tu ayuda. Hemos recibido tu informe correctamente.',
      icon: 'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg'
    });
}