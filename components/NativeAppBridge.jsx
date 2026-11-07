// components/NativeAppBridge.jsx
// Pont avec l'application iOS (coque Capacitor, dossier ios-app/). Monté une
// fois pour toutes dans app/layout.jsx ; ne rend rien et ne fait rien hors de
// la coque (voir lib/native-app.js).
//
// Deux rôles :
//   1. marquer le document (`html.native-app`, `data-native-platform`) pour
//      que le CSS et les composants sachent qu'ils tournent dans l'app ;
//   2. ouvrir la bonne page quand le commercial touche une notification
//      (lib/apns.ts met l'URL cible dans le champ `url` de la charge utile),
//      ou un lien universel https://meetaaron.app/… reçu par l'app.

'use client';

import { useEffect } from 'react';
import { getCapacitor, nativePlatform, nativePushPlugin } from '@/lib/native-app';

function openInternalUrl(raw) {
  if (!raw || typeof raw !== 'string') return;
  let path = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      if (u.hostname !== 'meetaaron.app' && u.hostname !== 'www.meetaaron.app') return;
      path = u.pathname + u.search + u.hash;
    }
  } catch {
    return;
  }
  // Uniquement des chemins internes : jamais un site tiers depuis une
  // notification (un jeton volé ne doit pas pouvoir faire ouvrir n'importe quoi).
  if (!path.startsWith('/') || path.startsWith('//')) return;
  window.location.assign(path);
}

export default function NativeAppBridge() {
  useEffect(() => {
    const cap = getCapacitor();
    if (!cap) return;

    const platform = nativePlatform() || 'native';
    document.documentElement.classList.add('native-app');
    document.documentElement.dataset.nativePlatform = platform;

    const handles = [];
    const push = nativePushPlugin();
    if (push) {
      handles.push(
        push.addListener('pushNotificationActionPerformed', (action) => {
          const data = action && action.notification && action.notification.data;
          openInternalUrl(data && data.url);
        })
      );
    }
    // Retour de Safari (consentement Gmail/Outlook, voir lib/native-app.js
    // openExternal) : la page Connexions se recharge pour afficher la boîte
    // tout juste reliée.
    const browser = cap.Plugins && cap.Plugins.Browser;
    if (browser && typeof browser.addListener === 'function') {
      handles.push(
        browser.addListener('browserFinished', () => {
          if (window.location.pathname.startsWith('/app/connexions')) window.location.reload();
        })
      );
    }
    const app = cap.Plugins && cap.Plugins.App;
    if (app && typeof app.addListener === 'function') {
      handles.push(app.addListener('appUrlOpen', (event) => openInternalUrl(event && event.url)));
    }

    return () => {
      handles.forEach((h) => {
        Promise.resolve(h)
          .then((x) => x && typeof x.remove === 'function' && x.remove())
          .catch(() => {});
      });
    };
  }, []);

  return null;
}
