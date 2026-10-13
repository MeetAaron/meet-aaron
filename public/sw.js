// public/sw.js
// Service worker : installabilité PWA (Chrome/Edge desktop et Android) et
// réception des notifications push (voir lib/push.ts côté serveur et
// components/PushNotificationManager.jsx côté client pour l'abonnement).

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

// Reçoit la notification envoyée par lib/push.ts (payload JSON : { title, body, url }).
self.addEventListener('push', (event) => {
  let data = { title: 'Meet Aaron', body: 'Nouvelle notification.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (err) {
    // Payload non-JSON inattendu : on garde le titre/texte par défaut plutôt
    // que de faire échouer l'affichage de la notification.
  }

  // `tag` regroupe : une notification portant le même tag qu'une précédente la
  // REMPLACE au lieu de s'empiler dessous (voir PushPayload dans lib/push.ts).
  // `renotify` reste à false : le remplacement est silencieux, il ne refait
  // pas vibrer le téléphone pour la même information.
  const options = {
    body: data.body,
    icon: '/icon.png',
    badge: '/icon.png',
    data: { url: data.url || '/app/dashboard' },
  };
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = false;
  }

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Au clic sur la notification : ramène au premier plan un onglet Meet Aaron
// déjà ouvert s'il y en a un, sinon en ouvre un nouveau sur la bonne page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/app/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
