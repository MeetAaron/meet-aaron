// lib/encryption.ts
// Chiffre/déchiffre les access_token et refresh_token avant de les stocker
// dans Supabase (table oauth_connections), ainsi que les mots de passe IMAP/
// SMTP (lib/imap.ts). Clé stockée dans les variables d'environnement Vercel,
// jamais en base ni dans le code.
//
// Génère une clé avec : openssl rand -hex 32
// puis mets-la dans TOKEN_ENCRYPTION_KEY sur Vercel.
//
// INVENTAIRE CRYPTOGRAPHIQUE (CASA 4.1.3, 19/10/2026) — tout ce que
// l'application fait elle-même en matière de cryptographie passe par les
// primitives de Node (OpenSSL), jamais par une implémentation maison :
//   - AES-256-GCM (ce fichier) : jetons OAuth Google/Microsoft/CRM et mots
//     de passe IMAP/SMTP au repos. IV aléatoire de 96 bits par valeur, tag
//     d'authentification de 128 bits vérifié AVANT tout retour de clair.
//   - HMAC-SHA256 (lib/marketing-tracking.ts) : signature des liens de
//     suivi, clé DÉRIVÉE de TOKEN_ENCRYPTION_KEY (jamais la clé brute).
//   - Aléa (crypto.randomBytes / gen_random_bytes côté Postgres) : IV,
//     jetons de passage à usage unique, jetons de suivi.
//   - Mots de passe utilisateurs : bcrypt, par Supabase Auth (GoTrue) —
//     jamais manipulés par notre code.
//   - TLS : Vercel (TLS 1.2+, certificats Let's Encrypt renouvelés par
//     Vercel), Supabase (TLS vers Postgres), et HTTPS vers Google,
//     Microsoft, Anthropic, OpenAI, Stripe.
//   - Webhooks Stripe : signature HMAC-SHA256 vérifiée par la bibliothèque
//     Stripe (STRIPE_WEBHOOK_SECRET).
//
// CYCLE DE VIE DES CLÉS :
//   - TOKEN_ENCRYPTION_KEY : 256 bits, générée par openssl, détenue par le
//     seul propriétaire du projet Vercel, lue uniquement au démarrage de la
//     fonction serverless. Rotation : poser la nouvelle clé dans
//     TOKEN_ENCRYPTION_KEY et l'ancienne dans TOKEN_ENCRYPTION_KEY_PREVIOUS ;
//     les valeurs existantes se déchiffrent avec l'ancienne clé et sont
//     réécrites avec la nouvelle au prochain rafraîchissement de jeton
//     (chaque déchiffrement réussi avec l'ancienne clé est signalé dans les
//     journaux pour suivre la migration). Une fois tout réécrit, retirer
//     TOKEN_ENCRYPTION_KEY_PREVIOUS.
//   - Jetons OAuth : durée fixée par le fournisseur (accès ~1 h, rafraîchi ;
//     refresh révocable par l'utilisateur dans Connexions ou chez Google/
//     Microsoft) ; supprimés à la déconnexion de la boîte et à la suppression
//     du compte.
//   - Certificats TLS : émis et renouvelés automatiquement par Vercel (Let's
//     Encrypt, 90 jours).
//
// ÉCHEC SÛR (CASA 4.1.4) : decryptToken ne renvoie JAMAIS de clair partiel
// et ne distingue pas, pour l'appelant, un tag invalide d'un format
// invalide ou d'une mauvaise clé — une seule erreur générique
// « Déchiffrement impossible ». La cause précise va dans les journaux
// serveur, sans le chiffré ni la clé. AES-GCM n'est pas un mode à
// bourrage : il n'y a pas d'oracle de padding possible, et l'authentification
// (tag) est vérifiée par OpenSSL avant que final() ne rende un seul octet.

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function loadKey(name: string, required: boolean): Buffer | null {
  const hex = process.env[name];
  if (!hex) {
    if (required) throw new Error(`${name} manquante`);
    return null;
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(`${name} doit faire exactement 32 bytes (64 caractères hex)`);
  }
  return key;
}

const KEY = loadKey('TOKEN_ENCRYPTION_KEY', true) as Buffer;
const PREVIOUS_KEY = loadKey('TOKEN_ENCRYPTION_KEY_PREVIOUS', false);

export class DecryptionError extends Error {
  constructor() {
    super('Déchiffrement impossible');
    this.name = 'DecryptionError';
  }
}

export function encryptToken(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format stocké : iv:authTag:encrypted (tout en hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptWith(key: Buffer, iv: Buffer, authTag: Buffer, encrypted: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // final() vérifie le tag : en cas d'échec, OpenSSL lève AVANT de rendre
  // le moindre octet de clair.
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function decryptToken(stored: string): string {
  let iv: Buffer;
  let authTag: Buffer;
  let encrypted: Buffer;
  try {
    const parts = typeof stored === 'string' ? stored.split(':') : [];
    if (parts.length !== 3 || !/^[0-9a-f]{24}$/i.test(parts[0]) || !/^[0-9a-f]{32}$/i.test(parts[1]) || !/^[0-9a-f]*$/i.test(parts[2])) {
      throw new Error('format');
    }
    iv = Buffer.from(parts[0], 'hex');
    authTag = Buffer.from(parts[1], 'hex');
    encrypted = Buffer.from(parts[2], 'hex');
  } catch {
    console.error('[encryption] Valeur chiffrée mal formée (refusée)');
    throw new DecryptionError();
  }

  try {
    return decryptWith(KEY, iv, authTag, encrypted);
  } catch (errCurrent: any) {
    if (PREVIOUS_KEY) {
      try {
        const plain = decryptWith(PREVIOUS_KEY, iv, authTag, encrypted);
        // Rotation en cours : cette valeur est encore sous l'ancienne clé.
        console.warn('[encryption] Valeur déchiffrée avec TOKEN_ENCRYPTION_KEY_PREVIOUS (à réécrire)');
        return plain;
      } catch {
        // tombe dans l'erreur générique ci-dessous
      }
    }
    // Tag d'authentification invalide, clé différente ou données altérées :
    // même réponse pour l'appelant, cause générique dans les journaux, sans
    // le chiffré.
    console.error('[encryption] Échec d\'authentification AES-GCM (refusé) :', errCurrent?.code || 'auth');
    throw new DecryptionError();
  }
}
