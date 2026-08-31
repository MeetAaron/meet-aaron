// app/api/cron/quote-reminders/route.ts
// Exécuté chaque matin via Vercel Cron (voir vercel.json). Docx « mon avis »
// d'Alex (31/08/2026) : « rappels quotidiens si le devis n'est pas envoyé,
// avec des conseils d'Aaron de plus en plus pressants ». Une notification
// push par contact en « proposition demandée » (quote_requested_at renseigné,
// devis_sent_at vide), avec le conseil qui correspond au nombre de jours
// d'attente (lib/notifications.ts, quoteAdviceLevel). Le cron étant
// quotidien, une seule relance par jour et par contact, sans table de log.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPushNotification } from '@/lib/push';
import { derivePipelinePosition } from '@/lib/pipeline';
import { quoteAdviceLevel, QUOTE_ADVICE_FR } from '@/lib/notifications';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = new Date();
  const { data: prospects, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, assigned_user_id, status, deal_stage, is_won, is_lost, first_order_confirmed_at, quote_requested_at, devis_sent_at, pipeline_stage, pipeline_lost_at_stage, pipeline_lost_reason, pipeline_risk')
    .not('quote_requested_at', 'is', null)
    .is('devis_sent_at', null);

  if (error) {
    if (error.code === '42703') {
      return NextResponse.json({ skipped: true, reason: 'migration_pipeline_fusion_2026-09-01.sql pas encore lancée' });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sent: string[] = [];
  for (const p of (prospects || []) as any[]) {
    const pos = derivePipelinePosition(p);
    if (pos.lost || pos.stage === 'client') continue;
    // Lot 3 : le commercial a répondu lui-même → relance en pause tant que le
    // client n'a pas réagi (quote_paused_at, colonne optionnelle).
    if (p.quote_paused_at) continue;
    const days = Math.max(0, Math.floor((now.getTime() - new Date(p.quote_requested_at).getTime()) / (24 * 60 * 60 * 1000)));
    if (days < 1) continue; // la demande du jour a déjà eu sa notification immédiate
    const level = quoteAdviceLevel(days);
    const title = level >= 2 ? `Devis toujours pas envoyé — ${p.full_name}` : `Devis à faire — ${p.full_name}`;
    await sendPushNotification(p.assigned_user_id, {
      title,
      body: `${days} jour${days > 1 ? 's' : ''} d'attente. ${QUOTE_ADVICE_FR[level]}`,
      url: `/app/prospects?user_id=${p.assigned_user_id}&contact=${p.id}`,
    }).catch(() => {});
    sent.push(p.id);
  }

  return NextResponse.json({ sent: sent.length });
}
