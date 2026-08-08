const CACHE_NAME = "rally-point-v9";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css?v=9",
  "/app.js?v=9",
  "/manifest.json?v=9",
  "/images/brand-card.jpg",
  "/images/icon-192.png",
  "/images/icon-512.png",
  "/images/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/pay")
  ) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);

      const network = fetch(event.request)
        .then(response => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }

      return (await network) || Response.error();
    })
  );
});
