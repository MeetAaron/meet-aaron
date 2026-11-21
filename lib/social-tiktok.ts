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
import { supabaseAdmin as tiktokDb } from './supabase-admin';
import { encryptToken as tiktokEncrypt, decryptToken as tiktokDecrypt } from './encryption';

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

// ─────────────────────────────────────────────────────────────────────────
// PUBLICATION DE PHOTOS (21/11/2026) — Content Posting API, « Photo post »,
// documentation TikTok lue le 21/11 :
//   - creator_info/query AVANT chaque envoi (TikTok l'impose, et c'est lui
//     qui donne les niveaux de confidentialité permis) ;
//   - content/init : media_type PHOTO, post_mode DIRECT_POST, source
//     PULL_FROM_URL uniquement (images servies par meetaaron.app, domaine
//     vérifié), 35 photos au plus, auto_add_music = musique proposée par
//     TikTok (décision d'Alex : la musique vient des propositions du réseau) ;
//   - status/fetch pour savoir quand c'est en ligne.
// Appli NON AUDITÉE (bac à sable, puis production avant l'audit) : TikTok
// n'accepte que des publications privées (SELF_ONLY), et refuse même l'envoi
// vers un compte public (unaudited_client_can_only_post_to_private_accounts).


const API = 'https://open.tiktokapis.com/v2';

async function tiktokPost(path: string, accessToken: string, body?: any): Promise<{ ok: boolean; data: any; code: string; message: string }> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json().catch(() => null);
    const code = String(json?.error?.code || (res.ok ? 'ok' : `http_${res.status}`));
    return { ok: res.ok && code === 'ok', data: json?.data || null, code, message: String(json?.error?.message || '') };
  } catch (err: any) {
    return { ok: false, data: null, code: 'network', message: String(err?.message || err) };
  }
}

export async function refreshTiktokToken(refreshToken: string): Promise<TiktokTokens | null> {
  const secret = tiktokClientSecret();
  if (!secret) return null;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: tiktokClientKey(),
      client_secret: secret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json || json.error || !json.access_token) {
    console.error('[tiktok] renouvellement refusé :', res.status, json?.error || '', json?.log_id || '');
    return null;
  }
  return {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : refreshToken,
    expires_in: Number.isFinite(Number(json.expires_in)) ? Number(json.expires_in) : null,
    refresh_expires_in: Number.isFinite(Number(json.refresh_expires_in)) ? Number(json.refresh_expires_in) : null,
    open_id: String(json.open_id || ''),
    scope: json.scope ? String(json.scope) : null,
  };
}

// Jeton valable pour la société : renouvelé s'il expire dans moins de
// 5 minutes (le jeton TikTok dure 24 h, le renouvellement 365 jours).
export async function getValidTiktokAccess(companyId: string): Promise<{ accessToken: string; openId: string } | null> {
  const { data: conn } = await tiktokDb
    .from('social_connections')
    .select('id, account_id, access_token, refresh_token, access_expires_at')
    .eq('company_id', companyId)
    .eq('provider', 'tiktok')
    .maybeSingle();
  if (!conn) return null;
  const row: any = conn;
  let accessToken: string;
  try {
    accessToken = tiktokDecrypt(row.access_token);
  } catch {
    return null;
  }
  const expiresAt = row.access_expires_at ? new Date(row.access_expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() > 5 * 60 * 1000) return { accessToken, openId: row.account_id };

  if (!row.refresh_token) return expiresAt ? null : { accessToken, openId: row.account_id };
  let refreshToken: string;
  try {
    refreshToken = tiktokDecrypt(row.refresh_token);
  } catch {
    return null;
  }
  const fresh = await refreshTiktokToken(refreshToken);
  if (!fresh) return null;
  const at = (s: number | null) => (s && s > 0 ? new Date(Date.now() + s * 1000).toISOString() : null);
  await tiktokDb
    .from('social_connections')
    .update({
      access_token: tiktokEncrypt(fresh.access_token),
      refresh_token: fresh.refresh_token ? tiktokEncrypt(fresh.refresh_token) : row.refresh_token,
      access_expires_at: at(fresh.expires_in),
      refresh_expires_at: at(fresh.refresh_expires_in),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  return { accessToken: fresh.access_token, openId: row.account_id };
}

export async function queryCreatorInfo(accessToken: string) {
  return tiktokPost('/post/publish/creator_info/query/', accessToken);
}

// Niveau de confidentialité : SELF_ONLY tant que l'appli n'est pas auditée
// (seul niveau accepté), sinon le premier proposé par TikTok.
export function choosePrivacy(options: any): string | null {
  const list: string[] = Array.isArray(options) ? options.map(String) : [];
  if (process.env.TIKTOK_AUDITED !== '1' && list.includes('SELF_ONLY')) return 'SELF_ONLY';
  return list[0] || null;
}

export async function publishTiktokPhotos(params: {
  accessToken: string;
  photoUrls: string[];
  title: string;
  description: string;
  privacyLevel: string;
}) {
  return tiktokPost('/post/publish/content/init/', params.accessToken, {
    media_type: 'PHOTO',
    post_mode: 'DIRECT_POST',
    post_info: {
      title: params.title.slice(0, 90),
      description: params.description.slice(0, 4000),
      privacy_level: params.privacyLevel,
      disable_comment: false,
      auto_add_music: true,
      brand_content_toggle: false,
      brand_organic_toggle: true, // l'entreprise parle de sa propre activité
    },
    source_info: {
      source: 'PULL_FROM_URL',
      photo_cover_index: 0,
      photo_images: params.photoUrls.slice(0, 35),
    },
  });
}

export async function fetchPublishStatus(accessToken: string, publishId: string) {
  return tiktokPost('/post/publish/status/fetch/', accessToken, { publish_id: publishId });
}
