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
