// app/api/cron/check-inbox/route.ts
// Exécuté périodiquement (ex. toutes les 5 minutes via Vercel Cron).
// Pour chaque commercial connecté à Gmail OU Outlook : regarde les nouveaux
// emails reçus, les rattache à la bonne conversation prospect, et fait réagir Aaron.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { listNewGmailMessages, getGmailMessage, applyAaronLabel } from '@/lib/google';
import { listNewOutlookMessages, getOutlookMessage, applyAaronCategory } from '@/lib/microsoft';
import { sendEmailForUser } from '@/lib/messaging';
import { generateAaronResponse } from '@/lib/aaron';
import { sendPushNotification } from '@/lib/push';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

function extractGmailBody(payload: any): string {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  const textPart = payload.parts?.find((p: any) => p.mimeType === 'text/plain');
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
  }
  return '';
}

type NormalizedMessage = { id: string; fromEmail: string; bodyText: string; threadId?: string };

// Normalise les nouveaux messages (Gmail ou Outlook) vers une forme commune,
// pour que tout le traitement en aval (fiche prospect, réponse d'Aaron, etc.)
// soit identique quel que soit le fournisseur du commercial.
async function fetchNewMessagesForConnection(connection: {
  user_id: string;
  provider: string;
}): Promise<NormalizedMessage[]> {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  if (connection.provider === 'google') {
    const newMessages = await listNewGmailMessages(connection.user_id, fiveMinutesAgo);
    const detailed: NormalizedMessage[] = [];
    for (const msg of newMessages) {
      const full = await getGmailMessage(connection.user_id, msg.id);
      const headers = full.payload.headers;
      const fromHeader = headers.find((h: any) => h.name === 'From')?.value || '';
      const fromEmail = fromHeader.match(/<(.+)>/)?.[1] || fromHeader;
      detailed.push({ id: msg.id, fromEmail, bodyText: extractGmailBody(full.payload), threadId: full.threadId });
    }
    return detailed;
  }

  // Outlook / Microsoft Graph : réponse déjà en JSON simple, pas de MIME à décoder
  const newMessages = await listNewOutlookMessages(connection.user_id, fiveMinutesAgo);
  const detailed: NormalizedMessage[] = [];
  for (const msg of newMessages) {
    const full = await getOutlookMessage(connection.user_id, msg.id);
    detailed.push({
      id: msg.id,
      fromEmail: full.from?.emailAddress?.address || '',
      bodyText: full.body?.content || '',
    });
  }
  return detailed;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: connections } = await supabaseAdmin
    .from('oauth_connections')
    .select('user_id, provider, provider_account_email')
    .in('provider', ['google', 'microsoft']);

  const results = [];

  for (const connection of connections || []) {
    let newMessages: NormalizedMessage[] = [];
    try {
      newMessages = await fetchNewMessagesForConnection(connection);
    } catch (err: any) {
      // Un token expiré/révoqué pour ce commercial ne doit pas bloquer les autres.
      console.error(`Erreur lecture boîte mail (${connection.provider}) pour ${connection.user_id}:`, err.message);
      continue;
    }

    for (const msg of newMessages) {
      try {
      const { fromEmail, bodyText, threadId } = msg;
      if (!fromEmail) continue;

      // Marque le message comme "géré par Aaron" dès la réception, avant même
      // de générer la réponse — si la génération échoue plus bas, le
      // commercial sait quand même qu'il ne doit pas répondre lui-même en
      // attendant. Gmail : label posé sur tout le fil. Outlook : catégorie
      // posée sur ce message précis (voir applyAaronCategory dans
      // lib/microsoft.ts — Outlook catégorise message par message, pas par fil).
      if (connection.provider === 'google') {
        applyAaronLabel(connection.user_id, threadId).catch(() => {});
      } else if (connection.provider === 'microsoft') {
        applyAaronCategory(connection.user_id, msg.id).catch(() => {});
      }

      const { data: prospect } = await supabaseAdmin
        .from('prospects')
        .select('id, full_name, is_won, is_lost')
        .eq('email', fromEmail)
        .eq('assigned_user_id', connection.user_id)
        .single();

      // is_won : le prospect est déjà client, ce fil ne concerne plus la
      // prospection. is_lost : marqué manuellement comme perdu par le
      // commercial (via "Marquer comme perdu" dans Prospects) — Aaron doit
      // arrêter de le recontacter, même s'il répond après coup.
      if (!prospect || prospect.is_won || prospect.is_lost) continue;

      const { data: conversation } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('prospect_id', prospect.id)
        .eq('channel', 'email')
        .single();

      if (!conversation) continue;

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

        // Une tentative de sauvetage attend une validation manuelle — pas de
        // notification "email" possible ici (rien n'est encore envoyé), donc
        // le push est le seul moyen de prévenir le commercial en temps réel.
        await sendPushNotification(connection.user_id, {
          title: 'Prospect en risque de perte',
          body: `${prospect.full_name} a répondu. Aaron propose une tentative de sauvetage à valider.`,
          url: `/app/prospects?user_id=${connection.user_id}`,
        });

        results.push({ prospect_id: prospect.id, new_status: aaronOutput.prospect_status, rescue_pending: true });
        continue;
      }

      await sendEmailForUser(
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

        await sendPushNotification(connection.user_id, {
          title: 'Nouveau rendez-vous à valider',
          body: `Aaron a proposé un RDV avec ${prospect.full_name}. Va le valider dans ton agenda.`,
          url: `/app/agenda?user_id=${connection.user_id}`,
        });
      }

      results.push({ prospect_id: prospect.id, new_status: aaronOutput.prospect_status });
      } catch (err: any) {
        // Un échec sur UN message (ex: token révoqué en cours de route, boîte mail
        // déconnectée entre deux messages) ne doit pas interrompre le traitement
        // des autres messages/commerciaux de ce cycle.
        console.error(`Erreur traitement message pour ${connection.user_id}:`, err.message);
      }
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
