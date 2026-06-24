const CACHE_NAME = 'streampulse-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com'
];

// Installs and caches the visual assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Cleans up any outdated cache files
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Intercepts requests and serves cached files, but ignores live API requests
self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  
  // Do not try to cache external API network calls
  if (
    url.includes('api.spotify.com') || 
    url.includes('accounts.spotify.com') || 
    url.includes('googleapis.com') || 
    url.includes('openai.com')
  ) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});
