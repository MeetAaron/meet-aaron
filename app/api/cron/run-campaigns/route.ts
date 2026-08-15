// app/api/cron/run-campaigns/route.ts
// Exécuté toutes les 10 minutes via Vercel Cron.
// Fait avancer UNE campagne "en_attente" ou "en_cours" PAR COMPTE COMMERCIAL,
// tous les comptes étant traités en parallèle (design validé pour le scaling :
// un commercial ne doit jamais attendre que la campagne d'un autre commercial
// soit passée avant que la sienne n'avance).
//
// IMPORTANT (corrigé le 14/08) : la sélection des "nouveaux" prospects à
// contacter utilisait `personality_type IS NULL`. C'est FAUX : Aaron ne
// détecte un profil de personnalité qu'APRÈS une réponse du prospect — sur
// un prospect déjà contacté mais qui n'a pas encore répondu, personality_type
// reste légitimement null. Résultat réel : tant qu'une campagne restait
// "en_cours", ce cron réenvoyait un message toutes les 10 minutes à tous ses
// prospects déjà contactés mais pas encore répondus (spam constaté en
// production). Le bon critère de "jamais contacté" est l'absence de tout
// message sortant dans sa conversation — c'est ce que ce cron vérifie
// désormais.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { processCampaignBatch } from '@/lib/sourcing';
import { generateAaronResponse } from '@/lib/aaron';
import { sendEmailForUser } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

async function runOneCampaign(campaignId: string, assignedUserId: string) {
  await supabaseAdmin
    .from('prospecting_campaigns')
    .update({ status: 'en_cours' })
    .eq('id', campaignId)
    .eq('status', 'en_attente');

  // Option opt-in (voir migration_first_email_approval_2026-08-15.sql,
  // désactivée par défaut) : si le commercial veut relire le tout premier
  // email avant envoi plutôt que de laisser Aaron l'envoyer directement.
  // Une seule requête par campagne (pas par prospect) puisqu'une campagne
  // appartient toujours à un seul commercial.
  const { data: campaignOwner } = await supabaseAdmin
    .from('users')
    .select('require_first_email_approval')
    .eq('id', assignedUserId)
    .single();
  const requireApproval = campaignOwner?.require_first_email_approval === true;

  const result = await processCampaignBatch(campaignId, 5);

  const { data: newProspectCompanies } = await supabaseAdmin
    .from('prospect_companies')
    .select('id')
    .eq('found_by_campaign_id', campaignId);

  const companyIds = (newProspectCompanies || []).map((c) => c.id);

  const { data: candidateProspects } = await supabaseAdmin
    .from('prospects')
    .select('id, email, assigned_user_id, conversations(id, messages(id))')
    .in('prospect_company_id', companyIds.length > 0 ? companyIds : ['00000000-0000-0000-0000-000000000000']);

  // Vraiment "jamais contacté" = aucun message dans aucune de ses
  // conversations — voir la note en tête de fichier.
  const newProspects = (candidateProspects || []).filter((p: any) => {
    const totalMessages = (p.conversations || []).reduce(
      (sum: number, c: any) => sum + (c.messages?.length || 0),
      0
    );
    return totalMessages === 0;
  });

  // Reste séquentiel PAR campagne (donc par commercial) pour ne pas déclencher
  // trop d'envois Gmail d'un coup depuis un même compte — seul le traitement
  // ENTRE campagnes de commerciaux différents est parallélisé (voir GET ci-dessous).
  for (const prospect of newProspects) {
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

      // Garde-fou : ne pas envoyer/archiver un email vide si Aaron n'a rien
      // proposé (voir même correctif dans check-inbox).
      const hasEmailToSend =
        aaronOutput.email_draft?.subject?.trim() && aaronOutput.email_draft?.body?.trim();

      if (hasEmailToSend && requireApproval) {
        // Ne pas envoyer : on garde l'email généré en attente de relecture
        // par le commercial (voir app/app/prospects/page.jsx, badge "1er
        // email à valider") et on le notifie. Aucun message n'est inséré
        // dans la conversation tant que l'envoi n'est pas confirmé.
        await supabaseAdmin
          .from('prospects')
          .update({
            pending_first_email_subject: aaronOutput.email_draft.subject,
            pending_first_email_body: aaronOutput.email_draft.body,
            pending_first_email_generated_at: new Date().toISOString(),
          })
          .eq('id', prospect.id);

        try {
          await sendPushNotification(prospect.assigned_user_id, {
            title: 'Premier email prêt à valider',
            body: `Aaron a préparé le premier email pour ${prospect.email}. À relire avant envoi.`,
            url: `/app/prospects?user_id=${prospect.assigned_user_id}`,
          });
        } catch (pushErr) {
          console.error('Erreur envoi notification push (premier email à valider):', pushErr);
        }
      } else if (hasEmailToSend) {
        await sendEmailForUser(
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
      }

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

  return { campaign_id: campaignId, batch_result: result, first_contacts_sent: newProspects.length };
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

  // TOUTES les campagnes actives d'un commercial avancent désormais (plus
  // seulement la plus ancienne) — un commercial peut lancer plusieurs
  // campagnes en même temps (ex: plusieurs zones géographiques) et les voir
  // progresser en parallèle plutôt qu'en file d'attente. On garde en
  // revanche le traitement SÉQUENTIEL des campagnes D'UN MÊME commercial
  // (boucle for, pas Promise.all) pour ne pas envoyer trop d'emails Gmail
  // d'un coup depuis un même compte — seul le traitement ENTRE commerciaux
  // différents reste parallélisé.
  const campaignIdsByUser = new Map<string, string[]>();
  for (const c of activeCampaigns) {
    const list = campaignIdsByUser.get(c.assigned_user_id) || [];
    list.push(c.id);
    campaignIdsByUser.set(c.assigned_user_id, list);
  }

  const results = await Promise.all(
    Array.from(campaignIdsByUser.entries()).map(async ([assignedUserId, campaignIds]) => {
      const userResults = [];
      for (const campaignId of campaignIds) {
        try {
          userResults.push(await runOneCampaign(campaignId, assignedUserId));
        } catch (err: any) {
          userResults.push({ campaign_id: campaignId, error: err.message });
        }
      }
      return userResults;
    })
  );

  const flatResults = results.flat();
  return NextResponse.json({ campaigns_processed: flatResults.length, results: flatResults });
}
