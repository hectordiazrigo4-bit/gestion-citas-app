// Servicio de caché de la app. Guarda solo los archivos de la web (no los datos).
// Las peticiones a /api/ nunca se guardan: siempre van al servidor.
const CACHE = "gestion-citas-v1";
const ARCHIVOS = [
  "./",
  "./index.html",
  "./reservar.html",
  "./unirse.html",
  "./styles.css",
  "./app.js",
  "./reservar.js",
  "./unirse.js",
  "./registro-sw.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Primero la red (versión actual); sin conexión, la copia guardada.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
