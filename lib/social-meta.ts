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

import { createHmac, timingSafeEqual } from 'crypto';

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
