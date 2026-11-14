// lib/fcm.ts
// Notifications de l'application Android (coque Capacitor, ios-app/ +
// .github/workflows/android-capacitor.yml) par Firebase Cloud Messaging,
// API HTTP v1 (14/11/2026).
//
// Pourquoi Firebase ici alors que le reste du site s'en passe (lib/push.ts
// fait du Web Push pur) : sur Android, une application native ne reçoit de
// notifications que par FCM — c'est le seul canal que le système livre quand
// l'app est fermée. Même rôle que lib/apns.ts pour l'iPhone.
//
// Configuration (Vercel) : FCM_SERVICE_ACCOUNT_JSON = le fichier JSON du
// « compte de service » du projet Firebase (Paramètres du projet > Comptes de
// service > Générer une nouvelle clé privée), collé tel quel ou encodé en
// base64. Sans cette variable, les appareils Android restent enregistrés et
// rien n'est envoyé (aucune erreur côté appelant).
//
// Les appareils sont dans push_subscriptions avec un endpoint `fcm://<jeton>`
// (app/api/push/subscribe, champ fcm_token).

import crypto from 'crypto';

export const FCM_ENDPOINT_PREFIX = 'fcm://';

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cachedAccount: ServiceAccount | null | undefined;
function serviceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;
  const raw = (process.env.FCM_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return (cachedAccount = null);
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const json = JSON.parse(text);
    if (!json.project_id || !json.client_email || !json.private_key) throw new Error('champs manquants');
    cachedAccount = {
      project_id: json.project_id,
      client_email: json.client_email,
      // Vercel garde parfois les « \n » sous forme littérale.
      private_key: String(json.private_key).replace(/\\n/g, '\n'),
    };
  } catch (err: any) {
    console.error('FCM_SERVICE_ACCOUNT_JSON illisible — notifications Android désactivées :', err?.message);
    cachedAccount = null;
  }
  return cachedAccount;
}

export function fcmConfigured(): boolean {
  return !!serviceAccount();
}

export function isFcmEndpoint(endpoint: string): boolean {
  return endpoint.startsWith(FCM_ENDPOINT_PREFIX);
}

export function fcmTokenFromEndpoint(endpoint: string): string {
  return endpoint.slice(FCM_ENDPOINT_PREFIX.length);
}

// Jeton d'enregistrement FCM : chaîne opaque, en pratique 140 à 200
// caractères [A-Za-z0-9_:-]. On reste large sur la longueur.
export function isValidFcmToken(token: string): boolean {
  return /^[A-Za-z0-9_:\-]{20,4096}$/.test(token);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Jeton d'accès Google (OAuth 2, flux « compte de service » JWT) valable une
// heure : on le garde 50 minutes.
let cachedAccess: { value: string; expiresAt: number } | null = null;
async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess && cachedAccess.expiresAt > now + 60) return cachedAccess.value;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key);
  const assertion = `${signingInput}.${base64url(signature)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`jeton Google refusé (${res.status})`);
  cachedAccess = { value: json.access_token, expiresAt: now + Math.min(Number(json.expires_in) || 3600, 3000) };
  return cachedAccess.value;
}

export type FcmPayload = { title: string; body: string; url?: string; tag?: string };
export type FcmResult = { ok: boolean; status: number; reason: string | null; gone: boolean };

// Envoie UNE notification à UN appareil. Ne lève jamais : lib/push.ts lit le
// résultat (suppression du jeton si `gone`).
export async function sendFcm(token: string, payload: FcmPayload): Promise<FcmResult> {
  const sa = serviceAccount();
  if (!sa) return { ok: false, status: 0, reason: 'NotConfigured', gone: false };
  if (!isValidFcmToken(token)) return { ok: true, status: 0, reason: 'InvalidTokenFormat', gone: true };
  try {
    const bearer = await accessToken(sa);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          // Lu par components/NativeAppBridge.jsx au toucher de la
          // notification (action.notification.data.url), comme pour APNs.
          data: { url: payload.url || '/app/campaigns' },
          android: {
            priority: 'HIGH',
            // Même rôle que le `tag` Web Push : la nouvelle notification d'un
            // même objet remplace l'ancienne au lieu de s'empiler.
            ...(payload.tag ? { notification: { tag: payload.tag } } : {}),
          },
        },
      }),
    });
    if (res.ok) return { ok: true, status: res.status, reason: null, gone: false };
    const json: any = await res.json().catch(() => ({}));
    const details: any[] = json?.error?.details || [];
    const code = details.map((d) => d?.errorCode).find(Boolean) || json?.error?.status || null;
    // UNREGISTERED (404) : app désinstallée ou jeton renouvelé ;
    // INVALID_ARGUMENT sur le jeton : il ne vaudra jamais rien.
    const gone = res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && /registration token/i.test(String(json?.error?.message || '')));
    return { ok: false, status: res.status, reason: code, gone };
  } catch (err: any) {
    return { ok: false, status: 0, reason: err?.message || 'NetworkError', gone: false };
  }
}
