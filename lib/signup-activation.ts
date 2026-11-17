// lib/signup-activation.ts
//
// LIEN D'ACTIVATION ENVOYÉ PAR EMAIL (17/11/2026, demande d'Alex : « je veux
// que quiconque, fondateur ou commercial, puisse se créer un compte dans
// l'appli ; pour Stripe, ça doit passer par le navigateur »).
//
// Dans l'application iPhone / Android, on ne peut ni vendre l'abonnement ni
// afficher un bouton qui mène au paiement sur le site (Apple 3.1.1, Google
// Payments). On peut en revanche ENVOYER UN EMAIL : la personne remplit le
// formulaire dans l'app, reçoit un lien, le paiement se fait dans le
// navigateur.
//
// Le lien porte toutes les informations du formulaire, CHIFFRÉES ET
// AUTHENTIFIÉES (AES-256-GCM, même clé que les jetons OAuth :
// lib/encryption.ts). Aucune table à créer, et un lien modifié à la main est
// rejeté. Il vaut 14 jours : il crée à chaque clic une session Stripe neuve
// (une session Stripe, elle, expire au bout de 24 h).

import { encryptToken, decryptToken } from './encryption';

export type ActivationPayload = {
  auth_user_id: string;
  email: string;
  first_name: string;
  full_name: string;
  company_name: string;
  country: string;
  locale: string;
  role: 'patron' | 'commercial';
  billing_interval: 'month' | 'year';
  exp: number; // millisecondes
};

const LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export function makeActivationToken(data: Omit<ActivationPayload, 'exp'>): string {
  const payload: ActivationPayload = { ...data, exp: Date.now() + LIFETIME_MS };
  // Format interne iv:tag:données (hexadécimal) — déjà sûr dans une URL.
  return encryptToken(JSON.stringify({ v: 1, ...payload }));
}

// null si le lien est illisible, modifié ou expiré.
export function readActivationToken(token: string | null | undefined): ActivationPayload | null {
  if (!token || typeof token !== 'string' || token.length > 4000) return null;
  try {
    const parsed = JSON.parse(decryptToken(token));
    if (!parsed || parsed.v !== 1 || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    if (!parsed.auth_user_id || !parsed.email || !parsed.company_name || !parsed.country) return null;
    return parsed as ActivationPayload;
  } catch {
    return null;
  }
}
