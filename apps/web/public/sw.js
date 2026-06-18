const CACHE_VERSION = "v2";
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const STATIC_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => !name.endsWith(CACHE_VERSION))
              .map((name) => caches.delete(name)),
          ),
        ),
    ]),
  );
});

function isCacheableResponse(response) {
  return response && response.status === 200 && response.type !== "opaque";
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    const fetchedAt = cached.headers.get("x-sw-fetched-at");
    if (fetchedAt && Date.now() - Number(fetchedAt) < STATIC_MAX_AGE_MS) {
      return cached;
    }
  }

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    const responseForCache = response.clone();
    const headers = new Headers(responseForCache.headers);
    headers.set("x-sw-fetched-at", String(Date.now()));
    await cache
      .put(
        request,
        new Response(responseForCache.body, {
          status: responseForCache.status,
          statusText: responseForCache.statusText,
          headers,
        }),
      )
      .catch(() => undefined);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/assets/")
  ) {
    event.respondWith(cacheFirst(request));
  }
});
