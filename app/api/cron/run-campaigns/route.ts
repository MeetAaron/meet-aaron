// app/api/cron/run-campaigns/route.ts
// Exécuté toutes les 10 minutes via Vercel Cron.
// Fait avancer UNE campagne "en_attente" ou "en_cours" par petits lots, puis déclenche
// le premier message d'Aaron pour chaque nouveau prospect trouvé dans ce lot.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { processCampaignBatch } from '@/lib/sourcing';
import { generateAaronResponse } from '@/lib/aaron';
import { sendGmailEmail } from '@/lib/google';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: campaign } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('id')
    .in('status', ['en_attente', 'en_cours'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ message: 'Aucune campagne active' });
  }

  await supabaseAdmin
    .from('prospecting_campaigns')
    .update({ status: 'en_cours' })
    .eq('id', campaign.id)
    .eq('status', 'en_attente');

  const result = await processCampaignBatch(campaign.id, 5);

  const { data: newProspectCompanies } = await supabaseAdmin
    .from('prospect_companies')
    .select('id')
    .eq('found_by_campaign_id', campaign.id);

  const companyIds = (newProspectCompanies || []).map((c) => c.id);

  const { data: newProspects } = await supabaseAdmin
    .from('prospects')
    .select('id, email, assigned_user_id, conversations(id)')
    .in('prospect_company_id', companyIds.length > 0 ? companyIds : ['00000000-0000-0000-0000-000000000000'])
    .is('personality_type', null);

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

  return NextResponse.json({
    campaign_id: campaign.id,
    batch_result: result,
    first_contacts_sent: (newProspects || []).length,
  });
}
