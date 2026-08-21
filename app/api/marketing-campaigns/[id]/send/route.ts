// app/api/marketing-campaigns/[id]/send/route.ts
// POST -> envoie la campagne à un LOT de destinataires encore "en_attente"
// (BATCH_SIZE par appel, voir plus bas) puis renvoie combien il en reste.
// Le front (app/app/campaigns/page.jsx, onglet Marketing) rappelle cette
// route tant que remaining > 0 — plutôt qu'un seul appel qui enverrait des
// centaines d'emails d'affilée et risquerait le timeout d'une fonction
// serverless Vercel, jamais testable en direct dans cet environnement.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { sendEmailForUser } from '@/lib/messaging';
import { personalize, rewriteLinksForTracking, appendUnsubscribeFooter } from '@/lib/marketing-tracking';

const BATCH_SIZE = 20;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: campaign } = await supabaseAdmin.from('marketing_campaigns').select('*').eq('id', params.id).single();
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.created_by_user_id) return forbiddenResponse();

  if (!['prete', 'en_cours'].includes(campaign.status)) {
    return NextResponse.json({ error: 'Cette campagne doit être prête (destinataires figés) avant l\'envoi' }, { status: 400 });
  }

  const { data: batch, error: batchError } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('status', 'en_attente')
    .limit(BATCH_SIZE);

  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });

  if (campaign.status === 'prete') {
    await supabaseAdmin
      .from('marketing_campaigns')
      .update({ status: 'en_cours', sent_at: campaign.sent_at || new Date().toISOString() })
      .eq('id', campaign.id);
  }

  let sent = 0;
  let failed = 0;

  for (const recipient of batch || []) {
    // Client rattrapé entre-temps par un désabonnement (autre campagne) : on
    // respecte ce choix même s'il a été figé comme destinataire avant.
    const { data: prospect } = await supabaseAdmin
      .from('prospects')
      .select('full_name, marketing_opt_out')
      .eq('id', recipient.prospect_id)
      .maybeSingle();

    if (prospect?.marketing_opt_out) {
      await supabaseAdmin
        .from('marketing_campaign_recipients')
        .update({ status: 'desabonne', unsubscribed_at: new Date().toISOString() })
        .eq('id', recipient.id);
      continue;
    }

    try {
      const personalizedSubject = personalize(campaign.subject, prospect?.full_name);
      let body = personalize(campaign.body_text, prospect?.full_name);
      body = rewriteLinksForTracking(body, recipient.tracking_token);
      body = appendUnsubscribeFooter(body, recipient.tracking_token);

      await sendEmailForUser(campaign.created_by_user_id, recipient.email, personalizedSubject, body, { emailType: 'transactional' });

      await supabaseAdmin
        .from('marketing_campaign_recipients')
        .update({ status: 'envoye', sent_at: new Date().toISOString() })
        .eq('id', recipient.id);
      sent++;
    } catch (err: any) {
      await supabaseAdmin
        .from('marketing_campaign_recipients')
        .update({ status: 'echec', error_message: err.message || 'Erreur inconnue' })
        .eq('id', recipient.id);
      failed++;
    }
  }

  const { count: remaining } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'en_attente');

  if (!remaining) {
    await supabaseAdmin
      .from('marketing_campaigns')
      .update({ status: 'terminee', updated_at: new Date().toISOString() })
      .eq('id', campaign.id);
  }

  return NextResponse.json({ sent, failed, remaining: remaining || 0, done: !remaining });
}
