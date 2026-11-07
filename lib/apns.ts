// lib/apns.ts
// Envoi de notifications à l'APPLICATION iOS (coque Capacitor, dossier
// ios-app/) par le protocole APNs d'Apple — HTTP/2 + jeton JWT signé ES256.
//
// Pourquoi ce fichier existe (07/11/2026) : le Web Push (lib/push.ts) ne
// fonctionne pas dans une WKWebView, Apple ne l'autorise que dans Safari et
// dans une PWA installée depuis l'écran d'accueil. L'app de l'App Store doit
// donc recevoir ses notifications par APNs, le canal natif d'Apple. Côté
// téléphone, @capacitor/push-notifications donne un « device token » que
// components/PushNotificationManager.jsx envoie à /api/push/subscribe ; il
// est rangé dans push_subscriptions avec l'endpoint `apns://<token>`, et
// lib/push.ts choisit le canal d'après ce préfixe.
//
// Aucune dépendance : le module http2 de Node suffit, et le JWT tient en
// vingt lignes de crypto. Pas de Firebase, pas de OneSignal : le contenu des
// notifications (nom d'un prospect, heure d'un rendez-vous) ne transite que
// chez Apple, qui est de toute façon incontournable sur iPhone.
//
// Variables d'environnement (Vercel) :
//   APNS_TEAM_ID      identifiant d'équipe Apple (10 caractères, en haut à
//                     droite de developer.apple.com/account)
//   APNS_KEY_ID       identifiant de la clé (Certificates, Identifiers &
//                     Profiles → Keys → clé avec « Apple Push Notifications
//                     service » coché)
//   APNS_PRIVATE_KEY  contenu du fichier .p8 téléchargé à la création de la
//                     clé (téléchargeable UNE seule fois), sauts de ligne
//                     réels ou « \n »
//   APNS_BUNDLE_ID    défaut app.meetaaron.mobile
//   APNS_ENV          'production' (défaut — TestFlight et App Store) ou
//                     'sandbox' (build Xcode de développement)
// Variables absentes → APNs désactivé, les autres canaux continuent.

import http2 from 'http2';
import crypto from 'crypto';

const TEAM_ID = process.env.APNS_TEAM_ID || '';
const KEY_ID = process.env.APNS_KEY_ID || '';
const PRIVATE_KEY = (process.env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
export const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'app.meetaaron.mobile';
const HOST = process.env.APNS_ENV === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';

export const APNS_ENDPOINT_PREFIX = 'apns://';

export function apnsConfigured(): boolean {
  return !!(TEAM_ID && KEY_ID && PRIVATE_KEY);
}

export function isApnsEndpoint(endpoint: string): boolean {
  return endpoint.startsWith(APNS_ENDPOINT_PREFIX);
}

export function apnsTokenFromEndpoint(endpoint: string): string {
  return endpoint.slice(APNS_ENDPOINT_PREFIX.length);
}

// Un device token APNs est une suite hexadécimale (64 caractères aujourd'hui,
// Apple se réserve d'allonger). On refuse tout ce qui n'y ressemble pas :
// c'est ce qui part dans l'URL de la requête à Apple.
export function isValidApnsToken(token: string): boolean {
  return /^[0-9a-fA-F]{32,200}$/.test(token);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Apple refuse un jeton de plus d'une heure et demande de ne pas en
// régénérer plus d'un toutes les 20 minutes : on le garde 50 minutes.
let cachedJwt: { value: string; issuedAt: number } | null = null;
function providerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.issuedAt < 50 * 60) return cachedJwt.value;
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: TEAM_ID, iat: now }));
  const signingInput = `${header}.${claims}`;
  // dsaEncoding 'ieee-p1363' = la forme r||s que JOSE attend (le DER par
  // défaut serait refusé par Apple).
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: PRIVATE_KEY,
    dsaEncoding: 'ieee-p1363',
  });
  const value = `${signingInput}.${base64url(signature)}`;
  cachedJwt = { value, issuedAt: now };
  return value;
}

export type ApnsPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type ApnsResult = {
  ok: boolean;
  status: number;
  reason: string | null;
  // true quand Apple dit que ce jeton ne vaut plus rien : l'appelant doit le
  // supprimer (app désinstallée, jeton d'un autre environnement…).
  gone: boolean;
};

const GONE_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

// Envoie UNE notification à UN appareil. Ne lève jamais : renvoie un résultat
// que lib/push.ts interprète (suppression du jeton si `gone`).
export function sendApns(deviceToken: string, payload: ApnsPayload): Promise<ApnsResult> {
  if (!apnsConfigured()) {
    return Promise.resolve({ ok: false, status: 0, reason: 'NotConfigured', gone: false });
  }
  if (!isValidApnsToken(deviceToken)) {
    return Promise.resolve({ ok: true, status: 0, reason: 'InvalidTokenFormat', gone: true });
  }

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      // Même rôle que le `tag` Web Push : regroupe les notifications d'un
      // même objet dans le centre de notifications.
      ...(payload.tag ? { 'thread-id': payload.tag } : {}),
    },
    // Lu par components/NativeAppBridge.jsx au toucher de la notification.
    url: payload.url || '/app/campaigns',
  });

  return new Promise<ApnsResult>((resolve) => {
    let settled = false;
    const done = (r: ApnsResult) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        /* déjà fermé */
      }
      resolve(r);
    };

    const client = http2.connect(HOST);
    client.on('error', (err: Error) => done({ ok: false, status: 0, reason: err.message, gone: false }));
    // Une connexion qui traîne ne doit jamais bloquer un cron.
    const timer = setTimeout(() => done({ ok: false, status: 0, reason: 'Timeout', gone: false }), 8000);

    let req: http2.ClientHttp2Stream;
    try {
      req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${providerToken()}`,
        'apns-topic': APNS_BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        // Apple garde la notification 24 h si le téléphone est hors ligne.
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 24 * 3600),
        ...(payload.tag ? { 'apns-collapse-id': payload.tag.slice(0, 64) } : {}),
        'content-type': 'application/json',
      });
    } catch (err: any) {
      clearTimeout(timer);
      return done({ ok: false, status: 0, reason: err?.message || 'RequestError', gone: false });
    }

    let status = 0;
    let data = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => {
      status = Number(headers[':status'] || 0);
    });
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('error', (err: Error) => {
      clearTimeout(timer);
      done({ ok: false, status, reason: err.message, gone: false });
    });
    req.on('end', () => {
      clearTimeout(timer);
      let reason: string | null = null;
      if (data) {
        try {
          reason = JSON.parse(data).reason || null;
        } catch {
          reason = data.slice(0, 100);
        }
      }
      const ok = status === 200;
      const gone = status === 410 || (status === 400 && !!reason && GONE_REASONS.has(reason));
      // Un jeton de fournisseur refusé se régénère au prochain appel.
      if (status === 403 && (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken')) cachedJwt = null;
      done({ ok, status, reason, gone });
    });
    req.end(body);
  });
}
