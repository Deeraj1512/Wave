/* eslint-disable */
/**
 * Wave service worker — minimal, music-app aware.
 *
 * Strategy:
 *  - cross-origin requests (ytimg, googlevideo, identity) → untouched
 *  - /api/*                → network only (fresh search, expiring stream URLs)
 *  - /_next/static, /icons → cache-first (immutable, hashed or static)
 *  - navigations           → network-first → cache → /offline.html
 *  - other same-origin GET → stale-while-revalidate
 *
 * Bump VERSION on meaningful changes to invalidate old caches.
 */
const VERSION = "wave-v1";
const STATIC_CACHE = `wave-static-${VERSION}`;
const PAGE_CACHE = `wave-pages-${VERSION}`;
const PRECACHE_URLS = ["/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((c) => c.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // POST /api/thumbs etc. — never intercepted

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // audio, covers, identity — untouched

  // API: always live network. Search must be fresh; stream URLs expire.
  if (url.pathname.startsWith("/api/")) return;

  // Immutable assets: cache-first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            return res;
          })
      )
    );
    return;
  }

  // Page navigations: network-first so deploys appear immediately
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/offline.html")))
    );
    return;
  }

  // Everything else same-origin: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
