// app/api/send-insights/route.ts
// GET ?user_id= -> ce qu'Aaron a appris des envois de ce commercial (voir
// lib/send-insights.ts) : taux de réponse par tranche horaire et par jour,
// créneau appris. Consommé par Mes résultats et par la suggestion du
// tableau de bord. ?refresh=1 recalcule à la volée (quelques centaines de
// lignes lues, pas d'appel modèle) — utile pour voir tout de suite l'effet
// d'une période de prospection.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { computeSendInsightsForUser, getSendInsights, saveSendInsights } from '@/lib/send-insights';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  let insights = refresh ? null : await getSendInsights(userId);
  if (!insights) {
    insights = await computeSendInsightsForUser(userId);
    await saveSendInsights(insights); // best-effort (table absente = ignoré)
  }
  return NextResponse.json({ insights });
}
