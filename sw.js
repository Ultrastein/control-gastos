// Service Worker para Control de gastos
// Al agregar archivos nuevos, sumarlos a ASSETS y subir VERSION

const VERSION = '1.2.0';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/analisis.css',
  'css/app.css',
  'css/base.css',
  'css/presupuestos.css',
  'css/reportes.css',
  'css/resumen.css',
  'css/tokens.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon.svg',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'js/app.js',
  'js/db.js',
  'js/io/backup.js',
  'js/io/csv.js',
  'js/io/biometric.js',
  'js/io/receipt.js',
  'js/io/native.js',
  'js/ui/ajustes.js',
  'js/ui/analisis.js',
  'js/ui/categorias.js',
  'js/ui/charts.js',
  'js/ui/dom.js',
  'js/ui/fijos.js',
  'js/ui/historial.js',
  'js/ui/keypad.js',
  'js/ui/lock.js',
  'js/ui/pinpad.js',
  'js/ui/theme.js',
  'js/ui/modal.js',
  'js/ui/presupuestos.js',
  'js/ui/reportes.js',
  'js/ui/resumen.js',
  'js/ui/router.js',
  'js/ui/sheet.js',
  'js/ui/snackbar.js',
  'js/utils/analysis.js',
  'js/utils/analysisConfig.js',
  'js/utils/budget.js',
  'js/utils/dates.js',
  'js/utils/dumpValidation.js',
  'js/utils/lock.js',
  'js/utils/money.js',
  'js/utils/installments.js',
  'js/utils/quickAdd.js',
  'js/utils/pin.js',
  'js/utils/receipt.js',
  'js/utils/reports.js',
  'js/utils/widgetData.js',
  'js/utils/recurring.js',
  'js/utils/summary.js',
];

const CACHE_NAME = `gastos-${VERSION}`;

// Precache todos los assets en install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Limpiar cachés viejos en activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
});

// Cache-first: devolver del cache, si no disponible fallback a index.html
self.addEventListener('fetch', (event) => {
  // Solo GET
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }

      // Fallback a index.html para navegación
      const url = new URL(event.request.url);
      if (event.request.mode === 'navigate' || url.pathname.endsWith('/')) {
        return caches.match('index.html').then((indexResponse) => {
          return indexResponse || new Response('Not found', { status: 404 });
        });
      }

      return new Response('Not found', { status: 404 });
    })
  );
});

// Escuchar SKIP_WAITING desde app.js
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
