// app/api/cron/referral-requests/route.ts
// Toutes les heures (vercel.json) : demandes de parrainage aux clients dont
// la première commande date d'un mois — voir lib/referral.ts. Chaque
// commercial n'est servi que dans son créneau de prospection, d'où le
// passage horaire ; une demande par client, jamais deux.
import { NextRequest, NextResponse } from 'next/server';
import { runReferralRequests } from '@/lib/referral';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  try {
    const report = await runReferralRequests();
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
