// lib/founder.ts
// COMPTES FONDATEUR (24/10/2026). Une seule liste pour le serveur, au lieu
// d'une adresse codée en dur dans chaque route : la page Mon compte
// affichait « Marge par client » pour deux adresses, mais le serveur n'en
// acceptait qu'une — l'autre tombait sur « Accès refusé ».
//
// MEETAARON_FOUNDER_EMAIL peut contenir plusieurs adresses séparées par des
// virgules ; les deux adresses d'Alex restent acceptées par défaut.

const DEFAULT_FOUNDER_EMAILS = ['aaron@meetaaron.app', 'alexandre.fevre01@gmail.com'];

export const FOUNDER_EMAILS: string[] = Array.from(new Set([
  ...String(process.env.MEETAARON_FOUNDER_EMAIL || '').split(','),
  ...DEFAULT_FOUNDER_EMAILS,
].map((e) => e.trim().toLowerCase()).filter(Boolean)));

export function isFounderEmail(email: string | null | undefined): boolean {
  return FOUNDER_EMAILS.includes(String(email || '').trim().toLowerCase());
}
