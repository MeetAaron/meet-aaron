// public/sw.js
// Service worker minimal — nécessaire pour l'installabilité PWA (Chrome/Edge desktop et Android)
// et pour recevoir les notifications push à l'avenir.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Passe-plat simple : laisse le navigateur gérer les requêtes normalement.
  // (nécessaire pour que Chrome considère le site comme une PWA installable)
});
