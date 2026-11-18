// app/api/social/meta/deauthorize/route.ts
//
// AARON SOCIAL — rappel de désautorisation Meta : appelé quand une personne
// retire l'accès de Meet Aaron depuis les réglages d'Instagram ou de Facebook.
// Socle du 18/11/2026 : aucun compte n'est encore lié, il n'y a donc rien à
// débrancher. La route vérifie la signature et accuse réception ; le
// débranchement réel (jeton supprimé, posts en pause, notification « réseau
// déconnecté ») arrive avec la liaison des comptes.

import { NextRequest, NextResponse } from 'next/server';
import { parseSignedRequest, readSignedRequest } from '@/lib/social-meta';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const payload = parseSignedRequest(await readSignedRequest(request));
  if (!payload) {
    console.warn('[social-meta] désautorisation refusée : signature absente ou invalide');
    return NextResponse.json({ error: 'Signature invalide' }, { status: 403 });
  }
  console.info('[social-meta] désautorisation reçue');
  return NextResponse.json({ success: true });
}
