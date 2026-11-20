// lib/social-linkedin.ts
//
// AARON SOCIAL — liaison d'un compte LinkedIn (20/11/2026).
//
// Même parcours que TikTok (lib/social-tiktok.ts), avec l'OAuth 2.0 de
// LinkedIn (« 3-legged », produits « Sign In with LinkedIn using OpenID
// Connect » et « Share on LinkedIn » de l'appli Meet Aaron) :
//   1. /api/social/linkedin/start    fabrique l'adresse d'autorisation ;
//   2. la personne accepte sur linkedin.com ;
//   3. LinkedIn revient sur /api/social/linkedin/callback avec un code ;
//   4. on échange le code contre un jeton, rangé CHIFFRÉ dans
//      social_connections (provider 'linkedin', déjà permis par la table).
//
// Identifiants :
//   - Client ID public (77ts9ex6n7bkq4, appli créée par Alex depuis son
//     propre profil le 20/11, rattachée à la page Meet Aaron) ;
//     LINKEDIN_CLIENT_ID le remplace si besoin ;
//   - Client Secret UNIQUEMENT dans Vercel (LINKEDIN_CLIENT_SECRET, saisi
//     par Alex), jamais ici ni dans le chat.
//
// Portée : publier au nom de la PERSONNE (w_member_social). Publier au nom
// de la PAGE demande le produit « Community Management API » (examen
// LinkedIn, plus tard). Rien n'est encore publié : ce fichier lie le compte.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const DEFAULT_CLIENT_ID = '77ts9ex6n7bkq4';

export const LINKEDIN_SCOPES = 'openid profile w_member_social';
export const LINKEDIN_STATE_COOKIE = 'oauth_linkedin_state';
export const LINKEDIN_STATE_TTL_SECONDS = 10 * 60;

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const REVOKE_URL = 'https://www.linkedin.com/oauth/v2/revoke';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

export function linkedinClientId(): string {
  return process.env.LINKEDIN_CLIENT_ID || DEFAULT_CLIENT_ID;
}

export function linkedinClientSecret(): string | null {
  return process.env.LINKEDIN_CLIENT_SECRET || null;
}

// Identique, au caractère près, à « Authorized redirect URLs » de l'appli.
export function linkedinRedirectUri(): string {
  const base = (process.env.APP_URL || 'https://meetaaron.app').replace(/\/+$/, '');
  return `${base}/api/social/linkedin/callback`;
}

// « state » signé + aléa en cookie, 10 minutes : voir lib/social-tiktok.ts.
function stateKey(): Buffer | null {
  const secret = linkedinClientSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update('meet-aaron:linkedin-state:v1').digest();
}

function sign(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

export function createLinkedinState(userId: string, nowMs: number = Date.now()): { state: string; nonce: string } | null {
  const key = stateKey();
  if (!key || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const nonce = randomBytes(16).toString('hex');
  const payload = `${userId}.${Math.floor(nowMs / 1000)}.${nonce}`;
  return { state: `${payload}.${sign(payload, key)}`, nonce };
}

export function readLinkedinState(state: string | null, cookieNonce: string | null, nowMs: number = Date.now()): string | null {
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
  if (age < 0 || age > LINKEDIN_STATE_TTL_SECONDS) return null;
  return userId;
}

export function linkedinAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: linkedinClientId(),
    redirect_uri: linkedinRedirectUri(),
    state,
    scope: LINKEDIN_SCOPES,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface LinkedinTokens {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
  refresh_expires_in: number | null;
  scope: string | null;
}

// Jeton d'environ 2 mois (réglage de l'appli). Le jeton de
// renouvellement n'existe que pour certains partenaires : sans lui, la
// personne reliera de nouveau son compte à l'échéance.
export async function exchangeLinkedinCode(code: string): Promise<LinkedinTokens | null> {
  const secret = linkedinClientSecret();
  if (!secret) return null;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: linkedinClientId(),
      client_secret: secret,
      redirect_uri: linkedinRedirectUri(),
    }).toString(),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json || json.error || !json.access_token) {
    console.error('[linkedin] échange du code refusé :', res.status, json?.error || '', json?.error_description || '');
    return null;
  }
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : null,
    expires_in: num(json.expires_in),
    refresh_expires_in: num(json.refresh_token_expires_in),
    scope: json.scope ? String(json.scope) : null,
  };
}

// Identifiant (sub), nom et photo, via OpenID Connect.
export async function fetchLinkedinProfile(accessToken: string): Promise<{ id: string | null; name: string | null; avatarUrl: string | null }> {
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json) return { id: null, name: null, avatarUrl: null };
    return {
      id: json.sub ? String(json.sub) : null,
      name: json.name ? String(json.name).slice(0, 120) : null,
      avatarUrl: typeof json.picture === 'string' && /^https:\/\//.test(json.picture) ? json.picture : null,
    };
  } catch {
    return { id: null, name: null, avatarUrl: null };
  }
}

export async function revokeLinkedinToken(accessToken: string): Promise<boolean> {
  const secret = linkedinClientSecret();
  if (!secret) return false;
  try {
    const res = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: linkedinClientId(), client_secret: secret, token: accessToken }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
