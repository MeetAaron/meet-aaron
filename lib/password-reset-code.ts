// lib/password-reset-code.ts
// Code à 6 chiffres de réinitialisation du mot de passe (14/11/2026).
//
// Le code part dans le même email que le lien (app/api/auth/request-
// password-reset). Jamais stocké en clair : la table password_reset_tokens
// reçoit une empreinte SHA-256 de « adresse + code », au même format
// (64 caractères hexadécimaux) que les jetons de lien — même table, même
// expiration (1 heure), même usage unique, aucune migration.
//
// Lier l'empreinte à l'adresse empêche qu'un code serve pour un autre compte.
// Contre l'essai de tous les codes, la route de validation limite les
// tentatives par adresse (app/api/auth/reset-password).

import crypto from 'crypto';

export function resetCodeToken(email: string, code: string): string {
  return crypto.createHash('sha256').update(`reset-code:${email.trim().toLowerCase()}:${code}`).digest('hex');
}
