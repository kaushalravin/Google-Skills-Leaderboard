const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const SHELL_PREFIX = 'gdg-lb-shell-'
const SHELL_CACHE = `${SHELL_PREFIX}${VERSION}`
// Kept across builds so the last leaderboard stays available offline after a deploy.
const API_CACHE = 'gdg-lb-api'
const CACHED_AT_HEADER = 'X-SW-Cached-At'
const SHELL_URL = '/'
const CDN_HOST = 'cdn.jsdelivr.net'
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

function isLeaderboardApi(url) {
  return /^\/api\/leaderboard(\/|$)/.test(url.pathname)
}

// The first page load happens before this worker controls it, so the shell's assets are read from index.html.
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE)
  const response = await fetch(SHELL_URL, { cache: 'reload' })
  if (!response.ok) return
  const html = await response.clone().text()
  await cache.put(SHELL_URL, response)
  const urls = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => (url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
      || url.hostname === CDN_HOST)
  await Promise.all(urls.map((url) => {
    const request = new Request(url.href, { mode: url.origin === self.location.origin ? 'same-origin' : 'cors' })
    // One missing asset must not fail the install
    return cache.add(request).catch(() => {})
  }))
}

self.addEventListener('install', (event) => {
  // Install even if precaching fails; navigation falls back to the network
  event.waitUntil(precacheShell().catch(() => {}).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter((name) => name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

// index.html is network-first so a deploy is picked up on the next load, never pinned by an old worker.
async function navigation(event) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(event.request)
    if (response.ok && !response.redirected) event.waitUntil(cache.put(SHELL_URL, response.clone()))
    return response
  } catch (error) {
    const cached = await cache.match(SHELL_URL)
    if (cached) return cached
    throw error
  }
}

// Hashed assets, the version-pinned Bootstrap file and the font files never change under the same URL.
async function cacheFirst(event) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(event.request)
  if (cached) return cached
  const response = await fetch(event.request)
  if (response.ok) event.waitUntil(cache.put(event.request, response.clone()))
  return response
}

async function leaderboardApi(event) {
  const cache = await caches.open(API_CACHE)
  try {
    // Skip the HTTP cache: the API allows 30 s of caching, which would hide an offline state behind stale data with no notice
    const response = await fetch(event.request, { cache: 'no-cache' })
    if (response.ok) {
      const headers = new Headers(response.headers)
      headers.set(CACHED_AT_HEADER, new Date().toISOString())
      const copy = new Response(await response.clone().blob(), { status: response.status, statusText: response.statusText, headers })
      event.waitUntil(cache.put(event.request, copy))
    }
    return response
  } catch (error) {
    const cached = await cache.match(event.request)
    if (cached) return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Searches are not stored: every typed query would otherwise add a cache entry.
  if (isLeaderboardApi(url)) {
    if (!url.searchParams.has('search')) event.respondWith(leaderboardApi(event))
    return
  }
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(navigation(event))
    return
  }
  if ((url.origin === self.location.origin && url.pathname.startsWith('/assets/')) || url.hostname === CDN_HOST || FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(event))
  }
})
