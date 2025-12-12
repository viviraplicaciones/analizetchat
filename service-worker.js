const CACHE_NAME = 'analizetchat-v5'; // Incrementar versión al hacer cambios
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  // './version.json', // Descomentar si implementas el sistema de versiones
  'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg',
  'https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&family=Roboto:wght@200;300&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

let sharedFile = null;

// --- INSTALACIÓN ---
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache abierto');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); // Forzar activación inmediata para que la función de compartir funcione pronto
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
  self.clients.claim(); // Tomar control de todos los clientes inmediatamente
});

// --- INTERCEPCIÓN DE RED (FETCH) ---
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Manejo de Share Target (Exportación desde WhatsApp)
  // Si la petición es POST y va a nuestra ruta "falsa" definida en manifest.json
  if (event.request.method === 'POST' && url.pathname.includes('/share-target-handler/')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const clientFile = formData.get('file'); // 'file' coincide con el nombre en manifest.json
          
          if (clientFile) {
            console.log('Archivo recibido en SW:', clientFile.name);
            sharedFile = clientFile; // Guardamos el archivo en memoria del SW temporalmente
          }

          // Redirigimos al usuario de vuelta a la aplicación (index.html)
          return Response.redirect('./index.html', 303);
        } catch (err) {
          console.error('Error al recibir archivo compartido:', err);
          return Response.redirect('./index.html?error=share_failed', 303);
        }
      })()
    );
    return; // Importante: terminar aquí para esta petición
  }

  // 2. Estrategia de Caché Predeterminada (Cache First, falling back to Network)
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

// --- COMUNICACIÓN CON EL CLIENTE (INDEX.HTML) ---
self.addEventListener('message', event => {
  // Cuando la página carga, pregunta si hay un archivo compartido pendiente
  if (event.data && event.data.action === 'getSharedFile') {
    if (sharedFile) {
      // Si tenemos un archivo guardado, se lo enviamos a la página
      event.source.postMessage({
        action: 'sharedFile',
        file: sharedFile
      });
      sharedFile = null; // Limpiamos la variable para no procesarlo de nuevo accidentalmente
    }
  }
});

// --- FUNCIONES DE FONDO (Tus implementaciones originales) ---

// Sincronización Periódica (Update Check)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-for-updates') {
    event.waitUntil(checkForUpdates());
  }
});

async function checkForUpdates() {
    // ... Tu lógica original ...
    console.log('Verificando actualizaciones...');
}

// Sincronización de Fondo (Bug Reports)
self.addEventListener('sync', event => {
  if (event.tag === 'send-bug-report') {
    event.waitUntil(sendQueuedBugReports());
  }
});

async function sendQueuedBugReports() {
    // ... Tu lógica original ...
    console.log('Enviando reportes de fallo...');
    self.registration.showNotification('Informe de fallo enviado', {
      body: 'Gracias por tu ayuda.',
      icon: 'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg'
    });
}