// app/api/cron/run-campaigns/route.ts
// Exécuté toutes les 10 minutes via Vercel Cron.
// Fait avancer UNE campagne "en_attente" ou "en_cours" PAR COMPTE COMMERCIAL,
// tous les comptes étant traités en parallèle (design validé pour le scaling :
// un commercial ne doit jamais attendre que la campagne d'un autre commercial
// soit passée avant que la sienne n'avance).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { processCampaignBatch } from '@/lib/sourcing';
import { generateAaronResponse } from '@/lib/aaron';
import { sendGmailEmail } from '@/lib/google';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

async function runOneCampaign(campaignId: string) {
  await supabaseAdmin
    .from('prospecting_campaigns')
    .update({ status: 'en_cours' })
    .eq('id', campaignId)
    .eq('status', 'en_attente');

  const result = await processCampaignBatch(campaignId, 5);

  const { data: newProspectCompanies } = await supabaseAdmin
    .from('prospect_companies')
    .select('id')
    .eq('found_by_campaign_id', campaignId);

  const companyIds = (newProspectCompanies || []).map((c) => c.id);

  const { data: newProspects } = await supabaseAdmin
    .from('prospects')
    .select('id, email, assigned_user_id, conversations(id)')
    .in('prospect_company_id', companyIds.length > 0 ? companyIds : ['00000000-0000-0000-0000-000000000000'])
    .is('personality_type', null);

  // Reste séquentiel PAR campagne (donc par commercial) pour ne pas déclencher
  // trop d'envois Gmail d'un coup depuis un même compte — seul le traitement
  // ENTRE campagnes de commerciaux différents est parallélisé (voir GET ci-dessous).
  for (const prospect of newProspects || []) {
    let conversationId = (prospect as any).conversations?.[0]?.id;
    if (!conversationId) {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .insert({ prospect_id: prospect.id, channel: 'email' })
        .select('id')
        .single();
      conversationId = conv?.id;
    }
    if (!conversationId) continue;

    try {
      const aaronOutput = await generateAaronResponse(prospect.id);

      await sendGmailEmail(
        prospect.assigned_user_id,
        prospect.email,
        aaronOutput.email_draft.subject,
        aaronOutput.email_draft.body
      );

      const { data: senderUser } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', prospect.assigned_user_id)
        .single();

      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        direction: 'outbound',
        sender_email: senderUser?.email || '',
        recipient_email: prospect.email,
        body: aaronOutput.email_draft.body,
      });

      await supabaseAdmin
        .from('prospects')
        .update({
          status: aaronOutput.prospect_status,
          personality_type: aaronOutput.personality_type,
          personality_notes: aaronOutput.personality_notes,
          aaron_advice: aaronOutput.aaron_advice,
          ...(aaronOutput.detected_phone ? { phone: aaronOutput.detected_phone } : {}),
        })
        .eq('id', prospect.id);
    } catch (err) {
      console.error(`Erreur lors du premier contact pour le prospect ${prospect.id}:`, err);
    }
  }

  return { campaign_id: campaignId, batch_result: result, first_contacts_sent: (newProspects || []).length };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: activeCampaigns } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('id, assigned_user_id')
    .in('status', ['en_attente', 'en_cours'])
    .order('created_at', { ascending: true });

  if (!activeCampaigns || activeCampaigns.length === 0) {
    return NextResponse.json({ message: 'Aucune campagne active' });
  }

  // Une seule campagne retenue par commercial pour ce tick (la plus ancienne
  // active), pour ne pas surcharger un même compte Gmail en un seul passage.
  const oneCampaignPerUser = new Map<string, string>();
  for (const c of activeCampaigns) {
    if (!oneCampaignPerUser.has(c.assigned_user_id)) {
      oneCampaignPerUser.set(c.assigned_user_id, c.id);
    }
  }

  const results = await Promise.all(
    Array.from(oneCampaignPerUser.values()).map((campaignId) =>
      runOneCampaign(campaignId).catch((err) => ({ campaign_id: campaignId, error: err.message }))
    )
  );

  return NextResponse.json({ campaigns_processed: results.length, results });
}
