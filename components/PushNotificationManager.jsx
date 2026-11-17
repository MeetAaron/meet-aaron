// components/PushNotificationManager.jsx
// Widget « Activer les notifications push sur cet appareil », affiché dans la
// checklist « Mise en route » de Mon compte > Connexion (docx Modifs Aaron
// 30/08/2026 — auparavant dans l'onglet Préférences). Gère tout le cycle :
// enregistrement du service worker, demande de permission navigateur,
// création de l'abonnement Web Push, et envoi au serveur
// (app/api/push/subscribe).
//
// Ce composant ne fait AUCUN appel à un service tiers (pas de SDK Firebase/
// OneSignal) : tout passe par l'API Push standard du navigateur + notre propre
// backend (lib/push.ts), donc aucune donnée du commercial ne transite ailleurs.

'use client';

import { useEffect, useState } from 'react';
import { t, useLocale } from '@/lib/i18n';
import Ic from '@/components/UiIcon';
import { nativePushPlugin, requestNativePushToken, nativePushBody, nativePushEndpoint } from '@/lib/native-app';

// Application iOS (coque Capacitor, 07/11/2026) : la WKWebView n'a pas de
// PushManager, Apple ne donne le Web Push qu'à Safari et aux PWA. Dans la
// coque, le plugin natif fournit un jeton APNs ; on l'envoie à la même route
// (/api/push/subscribe, champ apns_token) et lib/push.ts choisit le canal.
const APNS_TOKEN_KEY = 'meetaaron_apns_token';

function rememberedApnsToken() {
  try {
    return window.localStorage.getItem(APNS_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}
function rememberApnsToken(token) {
  try {
    if (token) window.localStorage.setItem(APNS_TOKEN_KEY, token);
    else window.localStorage.removeItem(APNS_TOKEN_KEY);
  } catch {
    /* stockage indisponible : on fonctionne sans mémoire */
  }
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Demande Alex (28/08/2026) : quand les push sont activés, expliquer pas à
// pas que connecter sa boîte email rend l'agenda encore plus fonctionnel
// (synchro RDV Aaron <-> calendrier iPhone/Google/Outlook). `emailConnected`
// est passé par la page appelante (app/app/connexions/page.jsx, qui connaît
// déjà googleConnection/microsoftConnection) — par défaut à true pour ne
// jamais afficher le conseil à tort si un appelant futur oublie de le passer.
//
// `onStatusChange(subscribed)` (31/08/2026) : remonte l'état réel de CET
// appareil à la checklist « Mise en route », qui affiche la coche verte de
// la ligne « Sur cet ordinateur / ce téléphone » et rafraîchit la liste des
// appareils (GET /api/push/subscribe) après chaque activation/désactivation.
// Notification d'essai (17/11/2026) : textes locaux, 7 langues.
const TEST_TEXT = {
  fr: { send: "Envoyer une notification d'essai", sending: 'Envoi…', none: 'Aucun appareil inscrit pour le moment.', sent: 'Envoyée à {n} appareil(s) : {list}. Elle doit arriver dans quelques secondes.', failed: 'Échec sur : {list}.', ios: 'iPhone', android: 'Android', web: 'navigateur' },
  en: { send: 'Send a test notification', sending: 'Sending…', none: 'No device registered yet.', sent: 'Sent to {n} device(s): {list}. It should arrive within a few seconds.', failed: 'Failed on: {list}.', ios: 'iPhone', android: 'Android', web: 'browser' },
  de: { send: 'Testbenachrichtigung senden', sending: 'Wird gesendet…', none: 'Noch kein Gerät registriert.', sent: 'An {n} Gerät(e) gesendet: {list}. Sie sollte in wenigen Sekunden ankommen.', failed: 'Fehlgeschlagen auf: {list}.', ios: 'iPhone', android: 'Android', web: 'Browser' },
  it: { send: 'Invia una notifica di prova', sending: 'Invio…', none: 'Nessun dispositivo registrato per ora.', sent: 'Inviata a {n} dispositivo/i: {list}. Dovrebbe arrivare tra pochi secondi.', failed: 'Non riuscita su: {list}.', ios: 'iPhone', android: 'Android', web: 'browser' },
  es: { send: 'Enviar una notificación de prueba', sending: 'Enviando…', none: 'Ningún dispositivo registrado por ahora.', sent: 'Enviada a {n} dispositivo(s): {list}. Debería llegar en unos segundos.', failed: 'Error en: {list}.', ios: 'iPhone', android: 'Android', web: 'navegador' },
  pt: { send: 'Enviar uma notificação de teste', sending: 'A enviar…', none: 'Nenhum dispositivo registado por agora.', sent: 'Enviada para {n} dispositivo(s): {list}. Deve chegar dentro de alguns segundos.', failed: 'Falhou em: {list}.', ios: 'iPhone', android: 'Android', web: 'navegador' },
  nl: { send: 'Testmelding versturen', sending: 'Bezig met versturen…', none: 'Nog geen apparaat geregistreerd.', sent: 'Verstuurd naar {n} apparaat/apparaten: {list}. Hij komt binnen enkele seconden aan.', failed: 'Mislukt op: {list}.', ios: 'iPhone', android: 'Android', web: 'browser' },
};
const tt = (key, locale) => (TEST_TEXT[locale] || TEST_TEXT.fr)[key] ?? TEST_TEXT.fr[key];

export default function PushNotificationManager({ emailConnected = true, onStatusChange }) {
  const [locale] = useLocale();
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);

  async function sendTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestMsg(body.error || t('common.error', locale));
      } else if (!body.devices) {
        setTestMsg(tt('none', locale));
      } else {
        const ok = (body.results || []).filter((r) => r.ok).map((r) => tt(r.channel, locale));
        const ko = (body.results || []).filter((r) => !r.ok).map((r) => `${tt(r.channel, locale)} (${r.reason || '?'})`);
        const parts = [];
        if (ok.length) parts.push(tt('sent', locale).replace('{n}', String(ok.length)).replace('{list}', ok.join(', ')));
        if (ko.length) parts.push(tt('failed', locale).replace('{list}', ko.join(', ')));
        setTestMsg(parts.join(' '));
      }
    } catch {
      setTestMsg(t('common.error', locale));
    }
    setTesting(false);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const native = nativePushPlugin();
    if (native) {
      // Dans l'app iOS : « abonné » = permission accordée ET jeton connu du
      // serveur. On ré-envoie le jeton à chaque passage ici — Apple peut le
      // changer, et l'upsert côté serveur est sans effet s'il est identique.
      (async () => {
        try {
          const perm = await native.checkPermissions();
          const state = perm && perm.receive;
          setPermission(state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'default');
          if (state !== 'granted') {
            setSubscribed(false);
            return;
          }
          const token = await requestNativePushToken(native);
          if (!token) return;
          const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nativePushBody(token)),
          });
          if (res.ok) {
            rememberApnsToken(token);
            setSubscribed(true);
          }
        } catch {
          setSubscribed(!!rememberedApnsToken());
        }
      })();
      return;
    }

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

  useEffect(() => {
    if (typeof onStatusChange === 'function') onStatusChange(subscribed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribed]);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const native = nativePushPlugin();
      if (native) {
        const perm = await native.requestPermissions();
        const state = perm && perm.receive;
        setPermission(state === 'granted' ? 'granted' : 'denied');
        if (state !== 'granted') {
          throw new Error(t('push.permissionRefused', locale));
        }
        const token = await requestNativePushToken(native);
        if (!token) throw new Error(t('push.serverError', locale));
        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nativePushBody(token)),
        });
        if (!res.ok) throw new Error(t('push.serverError', locale));
        rememberApnsToken(token);
        setSubscribed(true);
        return;
      }

      if (!VAPID_PUBLIC_KEY) {
        throw new Error(t('push.notConfigured', locale));
      }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        throw new Error(t('push.permissionRefused', locale));
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
      if (!res.ok) throw new Error(t('push.serverError', locale));

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
      const native = nativePushPlugin();
      if (native) {
        const token = rememberedApnsToken();
        if (token) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: nativePushEndpoint(token) }),
          });
        }
        if (typeof native.unregister === 'function') {
          await native.unregister().catch(() => {});
        }
        rememberApnsToken(null);
        setSubscribed(false);
        return;
      }

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
    // Cas typique : Safari iPhone hors app installée — les notifications
    // web n'y existent QUE depuis l'écran d'accueil (iOS 16.4+). Pas à pas
    // plutôt qu'une phrase vague : c'est l'étape où les commerciaux
    // abandonnent le plus souvent.
    return (
      <div className="push-manager">
        <p className="push-hint">{t('push.unsupportedIntro', locale)}</p>
        <ol className="push-steps">
          <li>{t('push.unsupportedStep1', locale)}</li>
          <li>{t('push.unsupportedStep2', locale)}</li>
          <li>{t('push.unsupportedStep3', locale)}</li>
        </ol>
        <style jsx>{`
          .push-manager {
            margin-top: 0.4rem;
          }
          .push-hint {
            color: var(--muted);
            font-size: 0.78rem;
            margin: 0 0 0.3rem;
          }
          .push-steps {
            margin: 0;
            padding-left: 1.1rem;
            color: var(--muted);
            font-size: 0.78rem;
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="push-manager">
      {subscribed ? (
        <button type="button" className="push-btn active" onClick={disable} disabled={busy}>
          {busy ? '…' : <><Ic name="check" /> {t('push.enabledOnDevice', locale)}</>}
        </button>
      ) : (
        <button type="button" className="push-btn" onClick={enable} disabled={busy}>
          {busy ? t('push.enabling', locale) : t('push.enableOnDevice', locale)}
        </button>
      )}
      {subscribed && (
        <button type="button" className="push-test" onClick={sendTest} disabled={testing}>
          {testing ? tt('sending', locale) : tt('send', locale)}
        </button>
      )}
      {testMsg && <p className="push-hint">{testMsg}</p>}
      {permission === 'denied' && <p className="push-error">{t('push.blockedInBrowser', locale)}</p>}
      {subscribed && !emailConnected && <p className="push-hint">{t('push.emailTip', locale)}</p>}
      {error && <p className="push-error">{error}</p>}
      <style jsx>{`
        .push-manager {
          margin-top: 0.4rem;
        }
        .push-btn {
          background: var(--accent);
          border: 1px solid var(--accent);
          color: #fff;
          border-radius: 8px;
          padding: 0.55rem 0.9rem;
          font-size: 0.84rem;
          font-weight: 600;
          cursor: pointer;
          max-width: 100%;
          white-space: normal;
          text-align: left;
        }
        .push-test {
          display: block;
          margin-top: 0.45rem;
          background: none;
          border: none;
          padding: 0;
          color: var(--muted);
          text-decoration: underline;
          font-size: 0.8rem;
          cursor: pointer;
          font-family: inherit;
        }
        .push-btn.active {
          background: transparent;
          border-color: var(--accent-green);
          color: var(--accent-green);
          font-weight: 500;
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
