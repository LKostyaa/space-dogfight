// Minimal service worker: makes the game installable and the shell load offline.
// Strategy: network-first for everything (always fresh after a deploy), cache as fallback.
// API, health and the WebSocket are never cached.
const CACHE = 'dogfight-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/assets/manifest.json', '/assets/sprites.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (/^\/(api|ws|health|ready|metrics)/.test(url.pathname)) return
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy))
        }
        return res
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match('/'))),
  )
})
