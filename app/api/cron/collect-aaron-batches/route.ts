// app/api/cron/collect-aaron-batches/route.ts
// Exécuté toutes les 10 minutes via Vercel Cron (voir vercel.json).
//
// Deuxième temps du Batch API (lib/aaron-batch.ts) : relit les lots soumis
// par run-campaigns / retry-uncontacted-prospects / send-prospect-followups,
// et applique chaque résultat revenu (envoi de l'email ou mise en attente de
// validation, fiche prospect, coût à moitié prix). Idempotent : une ligne
// déjà appliquée n'est jamais rejouée (aaron_batch_items.status).

import { NextRequest, NextResponse } from 'next/server';
import { collectAaronBatches } from '@/lib/aaron-batch';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  try {
    const result = await collectAaronBatches();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('collect-aaron-batches:', err?.message);
    return NextResponse.json({ error: err?.message || 'erreur' }, { status: 500 });
  }
}
