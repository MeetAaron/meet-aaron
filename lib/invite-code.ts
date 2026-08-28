// lib/invite-code.ts
// Genere un code d'invitation lisible pour qu'un commercial rejoigne une societe
// existante (ex: "OPENX-7K3F"), a partir du nom de la societe + suffixe aleatoire.

import crypto from 'crypto';

export function generateInviteCode(companyName: string): string {
  const prefix = (companyName || 'MEETAARON')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents (diacritiques)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8) || 'MEETAARON';

  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 caracteres

  return `${prefix}-${suffix}`;
}

// Code d'activation PAR SIÈGE COMMERCIAL (abonnements équipes, 28/08/2026,
// voir migration_team_seats_2026-08-28.sql) — même format que
// generateInviteCode mais préfixe "SIEGE" fixe plutôt que le nom de la
// société, pour distinguer visuellement les deux types de code si jamais un
// vieux code d'invitation société traîne encore quelque part (ex: dans un
// email déjà envoyé) et que quelqu'un les compare.
export function generateSeatActivationCode(): string {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 caracteres, unicite plus large qu'un code societe (beaucoup plus de codes generes dans la duree de vie de l'app)
  return `SIEGE-${suffix}`;
}
