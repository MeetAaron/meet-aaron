// components/PushNotificationManager.jsx
// Petit widget affiché dans /app/preferences quand le commercial choisit un
// canal de notification incluant "push". Gère tout le cycle : enregistrement
// du service worker, demande de permission navigateur, création de
// l'abonnement Web Push, et envoi au serveur (app/api/push/subscribe).
//
// Ce composant ne fait AUCUN appel à un service tiers (pas de SDK Firebase/
// OneSignal) : tout passe par l'API Push standard du navigateur + notre propre
// backend (lib/push.ts), donc aucune donnée du commercial ne transite ailleurs.

'use client';

import { useEffect, useState } from 'react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function PushNotificationManager() {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setSupported(false);
      return;
    }
    setPermission(Notification.permission);

    navigator.serviceWorker.register('/sw.js').then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      setSubscribed(!!existing);
    });
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      if (!VAPID_PUBLIC_KEY) {
        throw new Error('Notifications push pas encore configurées côté serveur.');
      }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        throw new Error("Permission refusée — active les notifications dans les réglages du navigateur.");
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!res.ok) throw new Error("Échec de l'enregistrement côté serveur.");

      setSubscribed(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="push-hint">
        Ton navigateur ne supporte pas les notifications push (sur iPhone : ajoute Meet Aaron à l'écran
        d'accueil depuis Safari, puis réessaie depuis l'app installée).
      </p>
    );
  }

  return (
    <div className="push-manager">
      {subscribed ? (
        <button type="button" className="push-btn active" onClick={disable} disabled={busy}>
          {busy ? '…' : '✓ Notifications push activées sur cet appareil'}
        </button>
      ) : (
        <button type="button" className="push-btn" onClick={enable} disabled={busy}>
          {busy ? 'Activation…' : 'Activer les notifications push sur cet appareil'}
        </button>
      )}
      {permission === 'denied' && (
        <p className="push-error">
          Les notifications sont bloquées pour ce site dans ton navigateur — débloque-les dans les réglages
          du site puis réessaie.
        </p>
      )}
      {error && <p className="push-error">{error}</p>}
      <style jsx>{`
        .push-manager {
          margin-top: 0.6rem;
        }
        .push-btn {
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 8px;
          padding: 0.55rem 0.9rem;
          font-size: 0.84rem;
          cursor: pointer;
        }
        .push-btn.active {
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .push-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .push-error {
          color: #e5484d;
          font-size: 0.78rem;
          margin-top: 0.4rem;
        }
        .push-hint {
          color: var(--muted);
          font-size: 0.78rem;
          margin-top: 0.4rem;
        }
      `}</style>
    </div>
  );
}
