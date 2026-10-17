// lib/http.ts — réponses d'erreur et lecture de corps JSON communes aux routes API.
//
// SCAN CASA DU 17/10/2026 (ZAP 90022 « Application Error Disclosure » et
// 100000 « Server Error ») :
//
// 1. Les routes renvoyaient au navigateur le message brut de l'erreur
//    (Supabase, Stripe, Postgres…) avec un statut 500 : noms de colonnes,
//    de tables, de contraintes. Un attaquant s'en sert pour cartographier la
//    base. Le message part désormais dans les journaux Vercel (avec le nom de
//    la route pour le retrouver) et le navigateur ne reçoit qu'un message
//    générique.
//
// 2. Un POST sans corps, ou avec un corps qui n'est pas du JSON, faisait
//    planter `await request.json()` hors de tout try : réponse 500. Avec
//    readJsonBody, la route reçoit un objet vide, ses contrôles habituels
//    (user_id manquant → 400, jeton absent → 401, autre utilisateur → 403)
//    s'appliquent, et rien ne plante.

import { NextResponse } from 'next/server';

export const GENERIC_SERVER_ERROR = 'Erreur interne du serveur. Réessaie dans un instant.';

/** Journalise l'erreur côté serveur et renvoie un 500 sans détail interne. */
export function serverError(err: unknown, where: string) {
  const e: any = err;
  console.error(`[${where}]`, e?.message ?? e, e?.code ? `(code ${e.code})` : '');
  return NextResponse.json({ error: GENERIC_SERVER_ERROR }, { status: 500 });
}

/** Lit le corps JSON ; renvoie {} si le corps est absent, invalide ou n'est pas un objet. */
export async function readJsonBody(request: Request): Promise<any> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}
