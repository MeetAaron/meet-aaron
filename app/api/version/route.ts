// app/api/version/route.ts
//
// Identifiant de la version du site actuellement en ligne (15/11/2026).
// Lu par components/VersionWatcher.jsx quand l'app revient au premier plan :
// si l'identifiant a change depuis le chargement de la page, une nouvelle
// version a ete deployee et la page se recharge toute seule.
//
// L'identifiant est le commit Git du deploiement (variable systeme de
// Vercel), fige a la compilation par next.config.js (NEXT_PUBLIC_BUILD_ID).
// Aucune donnee, aucun secret : pas d'authentification.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { id: process.env.NEXT_PUBLIC_BUILD_ID || '' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
