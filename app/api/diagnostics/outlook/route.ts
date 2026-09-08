// app/api/diagnostics/outlook/route.ts
// GET ?user_id=…[&fix=1] → diagnostic complet de la boîte Outlook connectée
// du commercial authentifié (voir lib/outlook-diagnostics.ts). Affiché par
// /app/diagnostic-outlook. Réservé à l'utilisateur lui-même.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { runOutlookDiagnostics } from '@/lib/outlook-diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const fix = request.nextUrl.searchParams.get('fix') === '1';
  try {
    const report = await runOutlookDiagnostics(userId, { fix });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
