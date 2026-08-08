// app/api/cron/check-inbox/route.ts
// Exécuté périodiquement (ex. toutes les 5 minutes via Vercel Cron).
// Pour chaque commercial connecté à Gmail : regarde les nouveaux emails reçus,
// les rattache à la bonne conversation prospect, et fait réagir Aaron.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { listNewGmailMessages, getGmailMessage, sendGmailEmail } from '@/lib/google';
import { generateAaronResponse } from '@/lib/aaron';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

function extractEmailBody(payload: any): string {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  const textPart = payload.parts?.find((p: any) => p.mimeType === 'text/plain');
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
  }
  return '';
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: googleConnections } = await supabaseAdmin
    .from('oauth_connections')
    .select('user_id, provider_account_email')
    .eq('provider', 'google');

  const results = [];

  for (const connection of googleConnections || []) {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const newMessages = await listNewGmailMessages(connection.user_id, fiveMinutesAgo);

    for (const msg of newMessages) {
      const fullMessage = await getGmailMessage(connection.user_id, msg.id);
      const headers = fullMessage.payload.headers;
      const fromHeader = headers.find((h: any) => h.name === 'From')?.value || '';
      const fromEmail = fromHeader.match(/<(.+)>/)?.[1] || fromHeader;

      const { data: prospect } = await supabaseAdmin
        .from('prospects')
        .select('id, is_won')
        .eq('email', fromEmail)
        .eq('assigned_user_id', connection.user_id)
        .single();

      if (!prospect || prospect.is_won) continue;

      const { data: conversation } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('prospect_id', prospect.id)
        .eq('channel', 'email')
        .single();

      if (!conversation) continue;

      const bodyText = extractEmailBody(fullMessage.payload);

      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'inbound',
        sender_email: fromEmail,
        recipient_email: connection.provider_account_email,
        body: bodyText,
        provider_message_id: msg.id,
      });

      const aaronOutput = await generateAaronResponse(prospect.id);

      // Si Aaron propose une tentative de sauvetage, on ne l'envoie PAS automatiquement —
      // elle attend la validation du commercial (voir Action requise "Prospect perdu").
      if (aaronOutput.rescue_proposal) {
        await supabaseAdmin
          .from('prospects')
          .update({
            status: aaronOutput.prospect_status,
            personality_type: aaronOutput.personality_type,
            personality_notes: aaronOutput.personality_notes,
            aaron_advice: aaronOutput.aaron_advice,
            ...(aaronOutput.detected_phone ? { phone: aaronOutput.detected_phone } : {}),
            rescue_proposal_subject: aaronOutput.rescue_proposal.subject,
            rescue_proposal_body: aaronOutput.rescue_proposal.body,
            rescue_proposal_pending: true,
          })
          .eq('id', prospect.id);

        results.push({ prospect_id: prospect.id, new_status: aaronOutput.prospect_status, rescue_pending: true });
        continue;
      }

      await sendGmailEmail(
        connection.user_id,
        fromEmail,
        aaronOutput.email_draft.subject,
        aaronOutput.email_draft.body
      );

      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_email: connection.provider_account_email,
        recipient_email: fromEmail,
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

      if (aaronOutput.appointment_cancelled) {
        const { data: cancelledAppointment } = await supabaseAdmin
          .from('appointments')
          .select('id')
          .eq('prospect_id', prospect.id)
          .eq('status', 'validé')
          .order('proposed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelledAppointment) {
          await supabaseAdmin
            .from('appointments')
            .update({ status: 'annulé', cancelled_by: 'client' })
            .eq('id', cancelledAppointment.id);
        }
      }

      if (aaronOutput.appointment_proposal?.detected) {
        await supabaseAdmin.from('appointments').insert({
          prospect_id: prospect.id,
          user_id: connection.user_id,
          type: aaronOutput.appointment_proposal.type,
          proposed_at: aaronOutput.appointment_proposal.proposed_datetime,
          status: 'proposé',
        });
      }

      results.push({ prospect_id: prospect.id, new_status: aaronOutput.prospect_status });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
