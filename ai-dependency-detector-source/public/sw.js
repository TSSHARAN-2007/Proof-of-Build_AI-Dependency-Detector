const CACHE_NAME = 'proof-of-build-shell-v5';
const SHELL = [
  '/', '/index.html', '/challenge-sandbox.html', '/styles.css', '/src/main.js', '/src/github.js',
  '/src/assessment.js', '/src/voice-input.js', '/src/sound-effects.js', '/src/intro-animation.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('proof-of-build-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname === '/api/github') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(async () => (await caches.match(request)) || new Response(JSON.stringify({ message: 'Offline: this repository data has not been cached on this device yet.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
