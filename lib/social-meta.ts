// lib/social-meta.ts
//
// AARON SOCIAL — socle Meta (Instagram et Facebook), 18/11/2026.
//
// Ce fichier ne contient QUE la vérification cryptographique des appels que
// Meta envoie vers Meet Aaron. Rien n'est encore lu ni enregistré : la
// liaison des comptes et le traitement des commentaires et des messages
// arrivent ensuite. Il fallait pourtant commencer par là, parce que la
// console Meta refuse d'enregistrer une adresse de rappel (webhook,
// désautorisation, suppression de données) tant qu'elle ne répond pas
// correctement.
//
// Deux secrets, saisis par Alex dans Vercel, jamais dans le code :
//   - META_APP_SECRET            : la « clé secrète » de l'application Meta.
//     Sert à vérifier que chaque appel vient bien de Meta.
//   - META_WEBHOOK_VERIFY_TOKEN  : une phrase qu'on choisit soi-même, recopiée
//     dans la console Meta au moment de déclarer le webhook.
// Tant qu'ils sont absents, toutes les routes refusent (403) : une adresse
// publique qui accepterait n'importe quel appel non signé serait une porte
// ouverte le jour où le traitement sera branché.

import { createHmac, timingSafeEqual, randomBytes as metaRandom } from 'crypto';

export function metaAppSecret(): string | null {
  return process.env.META_APP_SECRET || null;
}

export function metaVerifyToken(): string | null {
  return process.env.META_WEBHOOK_VERIFY_TOKEN || null;
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// Jeton de vérification du webhook : comparaison à temps constant.
export function verifyTokenMatches(received: string | null): boolean {
  const expected = metaVerifyToken();
  if (!expected || !received) return false;
  return safeEqual(Buffer.from(received), Buffer.from(expected));
}

// Signature des notifications : en-tête « X-Hub-Signature-256: sha256=<hex> »,
// HMAC-SHA256 du corps BRUT (avant tout JSON.parse) avec la clé secrète.
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  const secret = metaAppSecret();
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  return safeEqual(received, expected);
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// « signed_request » des rappels de désautorisation et de suppression de
// données : « <signature>.<charge utile> », les deux en base64 url, la
// signature étant le HMAC-SHA256 de la charge utile ENCODÉE. Renvoie la
// charge utile décodée, ou null si la signature ne correspond pas.
export function parseSignedRequest(signedRequest: string | null): Record<string, any> | null {
  const secret = metaAppSecret();
  if (!secret || !signedRequest) return null;
  const [encodedSig, encodedPayload] = signedRequest.split('.');
  if (!encodedSig || !encodedPayload) return null;
  const expected = createHmac('sha256', secret).update(encodedPayload, 'utf8').digest();
  if (!safeEqual(fromBase64Url(encodedSig), expected)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

// Meta envoie ces deux rappels en formulaire (signed_request=…), parfois en
// JSON selon le produit : on accepte les deux.
export async function readSignedRequest(request: Request): Promise<string | null> {
  const raw = await request.text();
  if (!raw) return null;
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      const json = JSON.parse(raw);
      return typeof json?.signed_request === 'string' ? json.signed_request : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(raw).get('signed_request');
}

// ─────────────────────────────────────────────────────────────────────────
// LIAISON FACEBOOK + INSTAGRAM (21/11/2026) — « Facebook Login for
// Business » de l'appli « Aaron Sales Copilot » (id 29046254768335337).
//
// Parcours :
//   1. /api/social/meta/start fabrique l'adresse de la boîte de dialogue
//      Facebook, avec la « configuration » créée dans la console Meta
//      (META_LOGIN_CONFIG_ID, identifiant public : elle porte la liste des
//      autorisations, pages_* et instagram_*) ;
//   2. retour sur /api/social/meta/callback (adresse déjà enregistrée dans
//      l'appli) avec un code ;
//   3. code -> jeton court -> jeton long (60 jours) ;
//   4. /me/accounts donne les pages gérées, leur jeton de page (qui
//      n'expire pas quand il vient d'un jeton long) et le compte Instagram
//      professionnel relié à la page. On garde la première page : deux
//      liaisons, 'facebook' (la page) et 'instagram' (le compte relié).
// Tant que Meta n'a pas examiné l'appli, seuls les comptes qui ont un rôle
// sur l'appli (administrateur, testeur) peuvent se lier.


export const META_APP_ID = process.env.META_APP_ID || '29046254768335337';
export const META_GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}`;
export const META_STATE_COOKIE = 'oauth_meta_state';
export const META_STATE_TTL_SECONDS = 10 * 60;

// Configuration « Aaron Social » créée le 21/11/2026 dans la console Meta
// (jeton utilisateur ; business_management, instagram_basic,
// instagram_content_publish, instagram_manage_comments,
// instagram_manage_messages, pages_manage_engagement, pages_manage_metadata,
// pages_manage_posts, pages_read_engagement, pages_read_user_content +
// pages_show_list par dépendance). Identifiant public.
const DEFAULT_LOGIN_CONFIG_ID = '2435483476859148';

export function metaLoginConfigId(): string | null {
  return process.env.META_LOGIN_CONFIG_ID || DEFAULT_LOGIN_CONFIG_ID;
}

export function metaRedirectUri(): string {
  const base = (process.env.APP_URL || 'https://meetaaron.app').replace(/\/+$/, '');
  return `${base}/api/social/meta/callback`;
}

function metaStateKey(): Buffer | null {
  const secret = metaAppSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update('meet-aaron:meta-state:v1').digest();
}

export function createMetaState(userId: string, nowMs: number = Date.now()): { state: string; nonce: string } | null {
  const key = metaStateKey();
  if (!key || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const nonce = metaRandom(16).toString('hex');
  const payload = `${userId}.${Math.floor(nowMs / 1000)}.${nonce}`;
  return { state: `${payload}.${createHmac('sha256', key).update(payload).digest('hex')}`, nonce };
}

export function readMetaState(state: string | null, cookieNonce: string | null, nowMs: number = Date.now()): string | null {
  const key = metaStateKey();
  if (!key || !state || !cookieNonce) return null;
  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const [userId, issuedAt, nonce, signature] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^\d+$/.test(issuedAt) || !/^[0-9a-f]{32}$/.test(nonce)) return null;
  const expected = Buffer.from(createHmac('sha256', key).update(`${userId}.${issuedAt}.${nonce}`).digest('hex'), 'hex');
  const received = Buffer.from(/^[0-9a-f]{64}$/.test(signature) ? signature : '', 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  const a = Buffer.from(nonce);
  const b = Buffer.from(cookieNonce);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const age = Math.floor(nowMs / 1000) - Number(issuedAt);
  if (age < 0 || age > META_STATE_TTL_SECONDS) return null;
  return userId;
}

export function metaAuthorizeUrl(state: string): string | null {
  const configId = metaLoginConfigId();
  if (!configId) return null;
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: metaRedirectUri(),
    state,
    response_type: 'code',
    config_id: configId,
  });
  return `https://www.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/dialog/oauth?${params.toString()}`;
}

async function metaGet(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${META_GRAPH}${path}?${new URLSearchParams(params).toString()}`);
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) {
    console.error('[meta] appel refusé :', path, res.status, json?.error?.code || '', json?.error?.type || '');
    return null;
  }
  return json;
}

// Code -> jeton utilisateur long (environ 60 jours).
export async function exchangeMetaCode(code: string): Promise<{ token: string; expiresIn: number | null } | null> {
  const secret = metaAppSecret();
  if (!secret) return null;
  const short = await metaGet('/oauth/access_token', {
    client_id: META_APP_ID,
    client_secret: secret,
    redirect_uri: metaRedirectUri(),
    code,
  });
  if (!short?.access_token) return null;
  const long = await metaGet('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: META_APP_ID,
    client_secret: secret,
    fb_exchange_token: String(short.access_token),
  });
  const token = String(long?.access_token || short.access_token);
  const expiresIn = Number(long?.expires_in || short.expires_in) || null;
  return { token, expiresIn };
}

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  instagram: { id: string; username: string | null; picture: string | null } | null;
}

export async function fetchMetaPages(userToken: string): Promise<MetaPage[]> {
  const json = await metaGet('/me/accounts', {
    access_token: userToken,
    fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}',
    limit: '25',
  });
  const list: any[] = Array.isArray(json?.data) ? json.data : [];
  return list
    .filter((p) => p?.id && p?.access_token)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name || ''),
      accessToken: String(p.access_token),
      instagram: p.instagram_business_account?.id
        ? {
            id: String(p.instagram_business_account.id),
            username: p.instagram_business_account.username ? String(p.instagram_business_account.username) : null,
            picture: typeof p.instagram_business_account.profile_picture_url === 'string' ? p.instagram_business_account.profile_picture_url : null,
          }
        : null,
    }));
}

// Retire l'autorisation de l'appli sur le compte Facebook (au mieux).
export async function revokeMetaPermissions(userOrPageToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${META_GRAPH}/me/permissions?access_token=${encodeURIComponent(userOrPageToken)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
