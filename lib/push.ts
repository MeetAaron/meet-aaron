// lib/push.ts
// Envoi de notifications push web (protocole Web Push, norme W3C — aucun compte
// tiers requis, ni Firebase ni OneSignal). Fonctionne sur Chrome/Edge/Firefox
// desktop + Android nativement ; sur iOS/Safari, seulement si la PWA a été
// "ajoutée à l'écran d'accueil" (limitation d'Apple, pas de la lib).
//
// Le commercial autorise les notifications depuis /app/preferences (voir
// components/PushNotificationManager.jsx), ce qui crée un "abonnement" push
// (endpoint + clés de chiffrement) stocké dans push_subscriptions. On envoie
// ensuite en chiffrant le message avec ces clés — le navigateur/OS du
// commercial se charge de le livrer, sans jamais transiter par un tiers qui
// verrait le contenu en clair.

import webpush from 'web-push';
import { supabaseAdmin } from './supabase-admin';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:aaron@meetaaron.app';

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY manquantes — notifications push désactivées.');
    return false;
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  configured = true;
  return true;
}

type PushPayload = {
  title: string;
  body: string;
  url?: string; // page à ouvrir au clic (ex: /app/agenda?user_id=...)
};

// Envoie une notification push à TOUS les appareils abonnés d'un utilisateur
// (un commercial peut être abonné depuis son téléphone ET son ordinateur).
// Best-effort : un échec sur un abonnement (navigateur désinstallé, permission
// retirée, etc.) ne bloque ni les autres abonnements ni l'appelant — cette
// fonction n'est jamais dans le chemin critique d'un cron ou d'une route API.
export async function sendPushNotification(userId: string, payload: PushPayload) {
  if (!ensureConfigured()) return;

  const { data: subscriptions } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subscriptions || subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body
        );
      } catch (err: any) {
        // 404/410 = abonnement expiré ou révoqué côté navigateur : on le
        // supprime pour ne pas réessayer indéfiniment un endpoint mort.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error(`Erreur envoi push (subscription ${sub.id}):`, err.message);
        }
      }
    })
  );
}
