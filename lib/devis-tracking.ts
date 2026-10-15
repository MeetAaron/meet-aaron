// lib/devis-tracking.ts
// Suivi d'ouverture des DEVIS — et des devis seulement.
//
// Décision du 15/10/2026 (Alex) : pas de pixel sur les emails de
// prospection. Deux raisons, et la première suffit.
//
// 1) DÉLIVRABILITÉ. Une image distante dans un message non sollicité est un
//    signal de spam, et c'est précisément sur le premier email que la
//    délivrabilité décide de tout. Sur un devis, le destinataire attend le
//    message et l'a souvent demandé : le signal ne coûte plus rien.
// 2) UTILITÉ. Savoir qu'un email froid a été ouvert ne dit pas quoi faire.
//    Savoir qu'un devis est ouvert dit exactement quoi faire : appeler.
//
// Fiabilité : environ 70 %. Les messageries d'entreprise bloquent souvent
// les images, et Apple Mail les précharge, ce qui produit l'inverse — une
// ouverture annoncée que personne n'a faite. C'est écrit noir sur blanc au
// moment du dépôt du devis, et plus jamais répété ensuite : une interface
// qui s'excuse à chaque écran n'inspire pas confiance.

import { randomBytes } from 'crypto';

// 32 caractères hexadécimaux : impossible à deviner, et surtout sans lien
// avec l'id du prospect. L'URL part chez le client ; elle ne doit révéler
// aucun identifiant interne ni permettre d'énumérer quoi que ce soit.
export function newDevisTrackToken(): string {
  return randomBytes(16).toString('hex');
}

// Base publique du pixel. NEXT_PUBLIC_APP_URL est déjà utilisée ailleurs
// pour les liens d'email ; on retombe sur le domaine de production plutôt
// que sur une URL relative, qui ne veut rien dire dans un client mail.
export function devisPixelUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://meetaaron.app').replace(/\/$/, '');
  return `${base}/api/t/${token}`;
}

// Le pixel lui-même. width/height à 1 ET display:block : sans le style,
// certains clients mail réservent une ligne entière pour l'image et le
// message se termine par un blanc inexplicable.
export function devisPixelHtml(token: string): string {
  return `<img src="${devisPixelUrl(token)}" alt="" width="1" height="1" style="width:1px;height:1px;display:block;border:0;" />`;
}
