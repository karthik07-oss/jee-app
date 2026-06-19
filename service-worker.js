// service-worker.js — enables offline use after first load.
//
// Strategy: cache-first for the app shell (HTML/CSS/JS/icons), since this app
// has no server and no live data to fetch — everything the user needs is
// already on their phone via IndexedDB. We just need the CODE to load offline.
//
// CACHE_VERSION must be bumped any time any cached file changes, or the
// browser will keep serving the old cached versions forever.
const CACHE_VERSION = "jee-app-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/app.js",
  "./js/db.js",
  "./js/scoring.js",
  "./js/parser.js",
  "./js/timer.js",
  "./js/screens/setup.js",
  "./js/screens/importPaper.js",
  "./js/screens/exam.js",
  "./js/screens/result.js",
  "./js/screens/progress.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle GET requests for our own origin — everything else (if it
  // ever exists) passes through untouched.
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Opportunistically cache anything new fetched while online, so
          // it's available offline next time too.
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Truly offline and not cached — for navigations, fall back to
          // the cached index.html so the app shell still loads.
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        });
    })
  );
});
