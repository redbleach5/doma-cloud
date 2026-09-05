// Doma Cloud Service Worker — minimal offline shell.
//
// SECURITY: /s/<token> share pages are NEVER cached. They may contain
// sensitive file metadata that shouldn't persist on a shared device.
// Only the app shell (/) and static assets are cached.
//
// Improvements over the previous version:
//   - Per-URL caching on install (was `cache.addAll(SHELL).catch(() => {})`
//     which silently dropped the ENTIRE shell if any single URL 404'd).
//   - `res.ok && res.type === 'basic'` guard on fetch responses so we
//     never cache 4xx/5xx or opaque cross-origin responses.
//   - Offline fallback: navigation requests that fail network AND miss
//     the cache fall back to the cached shell (was `caches.match("/")`
//     which only worked if `/` had been previously visited).

const CACHE = "doma-shell-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Per-URL caching: a single 404 no longer drops the whole shell.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch(() => {
            // Best-effort — log but don't fail install.
            console.warn(`[sw] failed to cache shell URL: ${url}`);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache API or share pages — they need to be fresh and may be sensitive.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/s/")) return;

  // Navigation requests → network-first with cache fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache successful, same-origin responses.
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match("/") || new Response(
            "<!doctype html><meta charset=utf-8><title>Офлайн</title><body style='font-family:system-ui;padding:2rem;text-align:center'>«Doma Cloud» сейчас офлайн. Подключитесь к сети и обновите страницу.</body>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          ))
        )
    );
    return;
  }

  // Static assets → cache-first.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      // Only cache successful, same-origin responses. Previously a 404 or
      // 500 on a static asset would get cached permanently, and after a
      // deploy with a broken asset the user would be stuck with the broken
      // version even after the deploy was fixed.
      if (res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
