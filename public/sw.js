const CACHE_NAME = 'cronotempo-shell-v11'
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/cronotempo.svg',
  '/icons/cronotempo.svg?v=10',
  '/icons/icon-192.png?v=10',
  '/icons/icon-512.png?v=10',
  '/icons/apple-touch-icon.png?v=10',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(async (cache) => {
        const response = await fetch('/')
        const html = await response.text()
        const assetPaths = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)]
          .map((match) => match[1])
          .filter((path) => new URL(path, self.location.origin).origin === self.location.origin)
        if (assetPaths.length > 0) await cache.addAll(assetPaths)
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => (key.startsWith('crono-shell-') || key.startsWith('cronotempo-shell-')) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const requestUrl = new URL(request.url)
  if (request.method !== 'GET' || requestUrl.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/index.html')),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
