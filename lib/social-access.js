// lib/social-access.js
//
// QUI VOIT LA PARTIE « RÉSEAUX SOCIAUX » (19/11/2026).
//
// Décision d'Alex : tant qu'Aaron Social n'est pas terminé, tout ce qui le
// concerne n'est visible QUE sur le compte aaron@meetaaron.app, jamais chez
// un client. Cette liste est lue à la fois par l'écran (pour ne pas afficher
// le bloc) et par les routes /api/social/* (pour refuser l'appel) : cacher un
// bouton ne suffit pas, la route doit refuser aussi.
//
// Le jour de l'ouverture aux clients, c'est ce fichier qu'on remplace par un
// contrôle de formule (abonnement « Réseaux sociaux »).

export const SOCIAL_PREVIEW_EMAILS = ['aaron@meetaaron.app'];

export function socialPreviewAllowed(email) {
  const value = String(email || '').trim().toLowerCase();
  return SOCIAL_PREVIEW_EMAILS.includes(value);
}
