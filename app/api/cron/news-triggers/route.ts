// app/api/cron/news-triggers/route.ts
// Chaque matin de semaine (vercel.json) : Aaron surveille l'actualité des
// sociétés des prospects classés « sans réponse » et prépare, quand il y a
// du neuf, une relance à valider — voir lib/news-triggers.ts. Rien n'est
// envoyé par ce cron : les propositions attendent le commercial.
// ?user_id=… pour ne traiter qu'un compte (tests).
import { NextRequest, NextResponse } from 'next/server';
import { runNewsTriggers } from '@/lib/news-triggers';

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
    const onlyUserId = request.nextUrl.searchParams.get('user_id');
    const report = await runNewsTriggers(new Date(), onlyUserId);
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
