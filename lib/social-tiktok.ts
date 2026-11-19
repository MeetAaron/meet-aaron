// lib/social-tiktok.ts
//
// AARON SOCIAL — liaison d'un compte TikTok (19/11/2026).
//
// Parcours (Login Kit pour le Web, documentation TikTok lue le 19/11) :
//   1. /api/social/tiktok/start    fabrique l'adresse d'autorisation TikTok ;
//   2. la personne accepte sur tiktok.com ;
//   3. TikTok revient sur /api/social/tiktok/callback avec un code ;
//   4. on échange ce code contre des jetons, rangés CHIFFRÉS dans
//      social_connections (migration_social_connections_2026-11-19.sql).
//
// Identifiants :
//   - la « Client key » est publique (elle figure dans l'adresse
//     d'autorisation). Celle du bac à sable « Test Meet Aaron » est mise en
//     valeur par défaut ; TIKTOK_CLIENT_KEY la remplacera par celle de
//     production le jour venu, sans toucher au code ;
//   - le « Client secret » ne vit QUE dans Vercel (TIKTOK_CLIENT_SECRET,
//     saisi par Alex). Il n'apparaît jamais ici ni dans le chat.
//
// Rien n'est encore publié sur TikTok : ce fichier ne fait que lier le compte.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const SANDBOX_CLIENT_KEY = 'sbawztt5in3tt1qwd7';

export const TIKTOK_SCOPES = 'user.info.basic,video.publish,video.upload';
export const TIKTOK_STATE_COOKIE = 'oauth_tiktok_state';
export const TIKTOK_STATE_TTL_SECONDS = 10 * 60;

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

export function tiktokClientKey(): string {
  return process.env.TIKTOK_CLIENT_KEY || SANDBOX_CLIENT_KEY;
}

export function tiktokClientSecret(): string | null {
  return process.env.TIKTOK_CLIENT_SECRET || null;
}

// Doit être IDENTIQUE, au caractère près, à l'adresse déclarée dans le
// portail TikTok (Login Kit > Redirect URI).
export function tiktokRedirectUri(): string {
  const base = (process.env.APP_URL || 'https://meetaaron.app').replace(/\/+$/, '');
  return `${base}/api/social/tiktok/callback`;
}

// ── « state » : la preuve que le retour de TikTok répond bien à NOTRE départ ──
//
// Forme : « <utilisateur>.<horodatage>.<aléa>.<signature> ». La signature
// (HMAC-SHA256, clé dérivée du secret de l'application) empêche d'en fabriquer
// un ; l'aléa est aussi posé dans un cookie du navigateur qui a cliqué
// « Lier », ce qui empêche de faire terminer par quelqu'un d'autre une
// liaison commencée ailleurs.
function stateKey(): Buffer | null {
  const secret = tiktokClientSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update('meet-aaron:tiktok-state:v1').digest();
}

function sign(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

export function createTiktokState(userId: string, nowMs: number = Date.now()): { state: string; nonce: string } | null {
  const key = stateKey();
  if (!key || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const nonce = randomBytes(16).toString('hex');
  const payload = `${userId}.${Math.floor(nowMs / 1000)}.${nonce}`;
  return { state: `${payload}.${sign(payload, key)}`, nonce };
}

export function readTiktokState(state: string | null, cookieNonce: string | null, nowMs: number = Date.now()): string | null {
  const key = stateKey();
  if (!key || !state || !cookieNonce) return null;
  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const [userId, issuedAt, nonce, signature] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^\d+$/.test(issuedAt) || !/^[0-9a-f]{32}$/.test(nonce)) return null;

  const expected = Buffer.from(sign(`${userId}.${issuedAt}.${nonce}`, key), 'hex');
  const received = Buffer.from(/^[0-9a-f]{64}$/.test(signature) ? signature : '', 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  const a = Buffer.from(nonce);
  const b = Buffer.from(cookieNonce);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const age = Math.floor(nowMs / 1000) - Number(issuedAt);
  if (age < 0 || age > TIKTOK_STATE_TTL_SECONDS) return null;
  return userId;
}

export function tiktokAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_key: tiktokClientKey(),
    response_type: 'code',
    scope: TIKTOK_SCOPES,
    redirect_uri: tiktokRedirectUri(),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface TiktokTokens {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
  refresh_expires_in: number | null;
  open_id: string;
  scope: string | null;
}

// Échange le code contre des jetons. Renvoie null (et journalise le code
// d'erreur de TikTok, jamais les jetons) si TikTok refuse.
export async function exchangeTiktokCode(code: string): Promise<TiktokTokens | null> {
  const secret = tiktokClientSecret();
  if (!secret) return null;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: tiktokClientKey(),
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: tiktokRedirectUri(),
    }).toString(),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json || json.error || !json.access_token || !json.open_id) {
    console.error('[tiktok] échange du code refusé :', res.status, json?.error || '', json?.error_description || '', json?.log_id || '');
    return null;
  }
  return {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : null,
    expires_in: Number.isFinite(Number(json.expires_in)) ? Number(json.expires_in) : null,
    refresh_expires_in: Number.isFinite(Number(json.refresh_expires_in)) ? Number(json.refresh_expires_in) : null,
    open_id: String(json.open_id),
    scope: json.scope ? String(json.scope) : null,
  };
}

// Nom et photo du compte, pour afficher « Lié : <nom> ». Facultatif : si la
// lecture échoue, la liaison reste valable, sans nom.
export async function fetchTiktokProfile(accessToken: string): Promise<{ name: string | null; avatarUrl: string | null }> {
  try {
    const res = await fetch(`${USER_INFO_URL}?fields=open_id,display_name,avatar_url`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json: any = await res.json().catch(() => null);
    const user = json?.data?.user;
    return {
      name: user?.display_name ? String(user.display_name).slice(0, 120) : null,
      avatarUrl: typeof user?.avatar_url === 'string' && /^https:\/\//.test(user.avatar_url) ? user.avatar_url : null,
    };
  } catch {
    return { name: null, avatarUrl: null };
  }
}

// Retire l'accès côté TikTok quand le compte est délié chez nous. Au mieux :
// un échec ici n'empêche pas de supprimer la liaison de notre base.
export async function revokeTiktokToken(accessToken: string): Promise<boolean> {
  const secret = tiktokClientSecret();
  if (!secret) return false;
  try {
    const res = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: tiktokClientKey(), client_secret: secret, token: accessToken }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
