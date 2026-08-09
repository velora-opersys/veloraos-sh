const VERSION = '1.10.55';
const CACHE_NAME = 'veloraos-shell-' + VERSION;
const SHELL_ASSETS = [
  '/app',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/static/style-110550.css',
  '/static/app-110550.js',
  '/static/velora-favicon.png',
  '/static/pwa-icon-192.png',
  '/static/pwa-icon-512.png',
  '/static/pwa-icon-maskable-512.png',
  '/static/apple-touch-icon.png'
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('veloraos-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
function excluded(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/backups/') || url.pathname.startsWith('/recovery/');
}
self.addEventListener('fetch', (event) => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || excluded(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, {cache:'no-store'}).then((response) => { if (response && response.ok) { const copy=response.clone(); caches.open(CACHE_NAME).then((cache)=>cache.put('/app',copy)); } return response; }).catch(() => caches.match('/app')));
    return;
  }
  if (url.pathname.startsWith('/static/') || url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/apple-touch-icon')) {
    event.respondWith(caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => { if (response && response.ok) { const copy=response.clone(); caches.open(CACHE_NAME).then((cache)=>cache.put(request,copy)); } return response; }).catch(() => cached);
      return cached || network;
    }));
  }
});
