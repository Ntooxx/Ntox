const CACHE_NAME = "ntox-static-v1";
const PRECACHE = [
  "/app.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];
const STATIC_EXT = /\.(?:css|js|svg|png|ico|webmanifest|json)$/;

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: "reload" }));
        if (res.ok) await cache.put(url, res);
      } catch {
        /* offline install or auth-gated asset — skip */
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/socket.io/")) return;
  if (url.pathname.startsWith("/status.json")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put("/", fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          const cached = await caches.match("/");
          if (cached) return cached;
          return new Response("NTOX is offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone())).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })(),
    );
  }
});
