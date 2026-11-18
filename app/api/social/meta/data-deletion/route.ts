// app/api/social/meta/data-deletion/route.ts
//
// AARON SOCIAL — rappel de suppression de données Meta : appelé quand une
// personne demande, depuis Instagram ou Facebook, que Meet Aaron efface ce
// qu'il détient sur elle. Meta attend en réponse une adresse où suivre la
// demande et un code de confirmation.
//
// Socle du 18/11/2026 : aucun compte social n'est encore lié et aucune donnée
// Meta n'est stockée, la suppression est donc vraie par construction. Dès que
// la liaison existera, cette route devra effacer le jeton, les publications
// programmées et les conversations rattachées à l'identifiant reçu — à faire
// dans le même lot que la liaison, pas après.

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { parseSignedRequest, readSignedRequest } from '@/lib/social-meta';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const payload = parseSignedRequest(await readSignedRequest(request));
  if (!payload) {
    console.warn('[social-meta] suppression de données refusée : signature absente ou invalide');
    return NextResponse.json({ error: 'Signature invalide' }, { status: 403 });
  }
  const confirmationCode = randomBytes(8).toString('hex');
  console.info('[social-meta] demande de suppression de données reçue', { confirmation_code: confirmationCode });
  return NextResponse.json({
    url: `https://meetaaron.app/privacy?demande=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
