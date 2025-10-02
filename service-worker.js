const CACHE_NAME = 'analizetchat-v3';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './version.json', // Añadido para la comprobación de actualizaciones
  'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg',
  'https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&family=Roboto:wght@200;300&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// --- CÓDIGO EXISTENTE (SIN ALTERAR) ---

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache abierto');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
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
});

// --- NUEVO CÓDIGO AÑADIDO ---

// 1. Sincronización Periódica para buscar actualizaciones (Sugerencia 1)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-for-updates') {
    event.waitUntil(checkForUpdates());
  }
});

async function checkForUpdates() {
  try {
    const response = await fetch('/version.json');
    const remoteVersion = await response.json();
    
    // Aquí, una lógica más compleja compararía la versión remota
    // con una versión local. Por ahora, simularemos la notificación.
    console.log('Buscando actualizaciones en segundo plano. Versión remota encontrada:', remoteVersion.version);

    // Si hay una nueva versión, se notifica al usuario.
    // La lógica para mostrar el aviso en la app se maneja en index.html
    self.registration.showNotification('Aplicación actualizada', {
      body: 'Se han descargado nuevas mejoras. La próxima vez que abras la app, verás la última versión.',
      icon: 'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg'
    });
  } catch (error) {
    console.error('Fallo al buscar actualizaciones en segundo plano:', error);
  }
}


// 2. Sincronización de Fondo para enviar informes de fallos (Sugerencia 2)
self.addEventListener('sync', event => {
  if (event.tag === 'send-bug-report') {
    event.waitUntil(sendQueuedBugReports());
  }
});

async function sendQueuedBugReports() {
    // Esta función normalmente leería los informes guardados en IndexedDB
    // y los enviaría a un servidor.
    // Como ejemplo, simulamos el proceso.
    console.log('Conexión recuperada. Enviando informe de fallo en segundo plano...');

    // Aquí iría la lógica de `fetch` para enviar los datos.
    // const response = await fetch('URL_DEL_SERVIDOR', { ... });

    // Si el envío es exitoso, se notifica al usuario.
    self.registration.showNotification('Informe de fallo enviado', {
      body: 'Gracias por tu ayuda. Hemos recibido tu informe correctamente.',
      icon: 'https://raw.githubusercontent.com/viviraplicaciones/analizetchat/refs/heads/main/logo.jpeg'
    });
}
