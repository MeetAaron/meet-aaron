// lib/encryption.ts
// Chiffre/déchiffre les access_token et refresh_token avant de les stocker
// dans Supabase (table oauth_connections). Clé stockée dans les variables
// d'environnement Vercel, jamais en base ni dans le code.
//
// Génère une clé avec : openssl rand -hex 32
// puis mets-la dans TOKEN_ENCRYPTION_KEY sur Vercel.

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'hex'); // 32 bytes

if (KEY.length !== 32) {
  throw new Error('TOKEN_ENCRYPTION_KEY doit faire exactement 32 bytes (64 caractères hex)');
}

export function encryptToken(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format stocké : iv:authTag:encrypted (tout en hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(stored: string): string {
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
