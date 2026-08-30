// app/api/cron/check-inbox/route.ts
// Exécuté périodiquement (ex. toutes les 5 minutes via Vercel Cron).
// Pour chaque commercial connecté à Gmail OU Outlook : regarde les nouveaux
// emails reçus, les rattache à la bonne conversation prospect, et fait réagir Aaron.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { listNewGmailMessages, getGmailMessage, applyAaronLabel } from '@/lib/google';
import { listNewOutlookMessages, getOutlookMessage, applyAaronCategory } from '@/lib/microsoft';
import { sendEmailForUser, computeHumanReplyDelayMs } from '@/lib/messaging';
import { generateAaronResponse } from '@/lib/aaron';
import { generateDevis } from '@/lib/aaron-sales';
import { recordAppointmentOutcome } from '@/lib/appointment-outcome';
import { parseCheckinResponse, generateTestimonialRequest, generateSupportReply, triggerAutomaticOnboarding, parseKickoffResponse } from '@/lib/aaron-customer';
import { sendPushNotification } from '@/lib/push';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

// Docx pipeline (Alex, 2026-08-23) : les notifications de frontière
// d'abonnement (nouvelle opportunité, devis signé) ont un texte différent
// selon que le commercial a déjà le module concerné — voir doc pipeline
// sections I.5/I.7. Petit helper partagé plutôt que de dupliquer la requête
// à chaque endroit.
async function getCompanyModuleFlags(companyId: string | null) {
  if (!companyId) return { offer_as_active: false, offer_ac_active: false };
  const { data } = await supabaseAdmin
    .from('companies')
    .select('offer_as_active, offer_ac_active')
    .eq('id', companyId)
    .maybeSingle();
  return { offer_as_active: !!data?.offer_as_active, offer_ac_active: !!data?.offer_ac_active };
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

// Rattrapage automatique après coupure/reconnexion (demande Alex, 27/08/2026,
// suite à l'audit du comportement déco/reco avec Ludovic) : avant, la fenêtre
// de lecture était toujours fixe ("il y a 5 minutes"), quelle que soit la
// durée d'une éventuelle coupure de la boîte mail (token révoqué, commercial
// déconnecté puis reconnecté...) — un prospect ayant répondu PENDANT cette
// coupure n'était donc jamais rattrapé : le prochain passage du cron ne
// regardait de nouveau que les 5 dernières minutes, pas la coupure entière.
//
// oauth_connections.last_checked_at mémorise l'heure de la DERNIÈRE lecture
// RÉUSSIE de cette boîte mail (posée plus bas, uniquement quand
// fetchNewMessagesForConnection n'a pas levé d'erreur). On l'utilise comme
// point de départ réel au lieu d'un fixe "5 minutes" : après 20 minutes de
// coupure, le premier passage réussi après reconnexion relit exactement les
// 20 dernières minutes — ni plus (pas de retraitement inutile), ni moins
// (pas de trou). Plafonné à 48h pour éviter de rebalayer des mois de boîte
// mail si une connexion reste invalide très longtemps (voir
// MAX_CATCHUP_LOOKBACK_MS) — au-delà, on rattrape au mieux les 48 dernières
// heures et le reste est signalé comme non rattrapable (voir plus bas).
const DEFAULT_LOOKBACK_MS = 5 * 60 * 1000;
const MAX_CATCHUP_LOOKBACK_MS = 48 * 60 * 60 * 1000; // 48h

function computeLookbackTimestamp(lastCheckedAt: string | null): number {
  const now = Date.now();
  if (!lastCheckedAt) return now - DEFAULT_LOOKBACK_MS;
  const last = new Date(lastCheckedAt).getTime();
  // Jamais moins de 5 minutes (petite dérive de planification du cron), et
  // jamais plus de 48h de rattrapage.
  return Math.min(now - DEFAULT_LOOKBACK_MS, Math.max(last, now - MAX_CATCHUP_LOOKBACK_MS));
}

// Normalise les nouveaux messages (Gmail ou Outlook) vers une forme commune,
// pour que tout le traitement en aval (fiche prospect, réponse d'Aaron, etc.)
// soit identique quel que soit le fournisseur du commercial.
async function fetchNewMessagesForConnection(connection: {
  user_id: string;
  provider: string;
  last_checked_at: string | null;
}): Promise<NormalizedMessage[]> {
  const afterTimestamp = computeLookbackTimestamp(connection.last_checked_at);

  if (connection.provider === 'google') {
    const newMessages = await listNewGmailMessages(connection.user_id, afterTimestamp);
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
  const newMessages = await listNewOutlookMessages(connection.user_id, afterTimestamp);
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

// Traite un email reçu d'un client déjà gagné (is_won = true). Contrairement
// au flux de prospection, Aaron ne répond JAMAIS automatiquement à un client
// (pas de generateAaronResponse ici) — on se contente de : 1) archiver le
// message dans l'historique de conversation existant, 2) si un check-in
// satisfaction/NPS attend une réponse ET que le message en contient une note
// claire, l'enregistrer (et si c'est une note promoteur, déclencher une
// demande de témoignage) ; 3) sinon (pas de check-in en attente, ou message
// sans note claire), traiter le message comme une vraie demande potentielle
// et proposer une suggestion de réponse au commercial (triage support
// niveau 1, voir lib/aaron-customer.ts -> generateSupportReply).
async function handleWonCustomerMessage(
  prospect: { id: string; full_name: string; company_id: string | null; kickoff_call_proposed_at?: string | null },
  userId: string,
  fromEmail: string,
  bodyText: string,
  providerMessageId: string
) {
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('prospect_id', prospect.id)
    .eq('channel', 'email')
    .single();

  if (conversation) {
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversation.id,
      direction: 'inbound',
      sender_email: fromEmail,
      recipient_email: '',
      body: bodyText,
      // Nécessaire pour la sécurité anti-doublon du rattrapage automatique
      // (voir plus bas dans GET) — avant, seul le flux prospection l'écrivait.
      provider_message_id: providerMessageId,
    });
  }

  // Tâche #141 (sous-item 1) : si Aaron a proposé un RDV de lancement et
  // qu'aucune ligne "lancement" n'est encore en cours de discussion/validée
  // pour ce client, on regarde d'abord si CE message y répond avec une date
  // exploitable — avant le triage check-in/support ci-dessous, qui ne
  // concerne pas ce cas. Voir lib/aaron-customer.ts -> parseKickoffResponse.
  if (prospect.kickoff_call_proposed_at) {
    const { data: existingKickoff } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('prospect_id', prospect.id)
      .eq('purpose', 'lancement')
      .in('status', ['proposé', 'validé'])
      .maybeSingle();

    if (!existingKickoff) {
      try {
        const parsed = await parseKickoffResponse(bodyText, prospect.company_id);
        if (parsed.proposed_at) {
          await supabaseAdmin.from('appointments').insert({
            prospect_id: prospect.id,
            user_id: userId,
            type: parsed.type,
            purpose: 'lancement',
            proposed_at: parsed.proposed_at,
            status: 'proposé',
            source: 'aaron',
            contact_name: prospect.full_name,
          });

          await sendPushNotification(userId, {
            title: 'RDV de lancement à valider',
            body: `${prospect.full_name} a répondu à la proposition de premier appel — à valider dans l'agenda.`,
            url: `/app/agenda?user_id=${userId}`,
          });

          return;
        }
      } catch (err: any) {
        console.error(`Erreur analyse réponse de RDV de lancement pour prospect ${prospect.id}:`, err.message);
        // On retombe sur le triage check-in/support ci-dessous plutôt que
        // d'abandonner silencieusement ce message.
      }
    }
  }

  const { data: pendingCheckin } = await supabaseAdmin
    .from('customer_checkins')
    .select('id')
    .eq('prospect_id', prospect.id)
    .is('responded_at', null)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingCheckin) {
    try {
      const parsed = await parseCheckinResponse(bodyText, prospect.company_id);

      if (parsed.score !== null) {
        const now = new Date().toISOString();

        await supabaseAdmin
          .from('customer_checkins')
          .update({ responded_at: now, response_score: parsed.score, response_comment: parsed.comment })
          .eq('id', pendingCheckin.id);

        await supabaseAdmin.from('prospects').update({ last_checkin_response_at: now }).eq('id', prospect.id);

        // Note basse (0-6/10) : signal fort qu'il vaut mieux prévenir le
        // commercial tout de suite plutôt que d'attendre le prochain calcul du
        // score de santé (une fois par jour, voir app/api/cron/customer-health).
        if (parsed.score <= 6) {
          await sendPushNotification(userId, {
            title: 'Client insatisfait',
            body: `${prospect.full_name} a répondu avec une note de ${parsed.score}/10 à un check-in. Un contact personnel peut aider.`,
            url: `/app/customer?user_id=${userId}`,
          });
        }

        // Note promoteur (>= 9/10) : bon moment pour solliciter un témoignage
        // pendant que le client est enthousiaste — voir
        // lib/aaron-customer.ts -> generateTestimonialRequest.
        if (parsed.score >= 9) {
          try {
            await generateTestimonialRequest(prospect.id);
            await sendPushNotification(userId, {
              title: 'Client promoteur — demande de témoignage prête',
              body: `${prospect.full_name} a mis ${parsed.score}/10. Un email de demande de témoignage est prêt à valider dans Aaron Customer.`,
              url: `/app/customer?user_id=${userId}`,
            });
          } catch (err: any) {
            console.error(`Erreur génération demande de témoignage pour prospect ${prospect.id}:`, err.message);
          }
        }

        return;
      }
    } catch (err: any) {
      console.error(`Erreur traitement réponse check-in pour prospect ${prospect.id}:`, err.message);
      // On retombe sur le triage support ci-dessous plutôt que d'abandonner
      // le message : mieux vaut proposer une suggestion de réponse qu'ignorer
      // silencieusement un email dont on n'a pas réussi à extraire de note.
    }
  }

  try {
    const draft = await generateSupportReply(prospect.id, bodyText);
    if (!draft.is_support_request || !draft.suggested_subject || !draft.suggested_body) return;

    await supabaseAdmin.from('customer_support_drafts').insert({
      prospect_id: prospect.id,
      inbound_excerpt: bodyText.slice(0, 500),
      suggested_subject: draft.suggested_subject,
      suggested_body: draft.suggested_body,
      is_simple: draft.is_simple,
    });

    await sendPushNotification(userId, {
      title: 'Nouveau message client',
      body: draft.is_simple
        ? `${prospect.full_name} a écrit une question simple. Aaron a préparé la réponse, prête à envoyer.`
        : `${prospect.full_name} a écrit. Aaron propose une réponse à relire dans Aaron Customer.`,
      url: `/app/customer?user_id=${userId}`,
    });
  } catch (err: any) {
    console.error(`Erreur triage support pour prospect ${prospect.id}:`, err.message);
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: connections } = await supabaseAdmin
    .from('oauth_connections')
    .select('id, user_id, provider, provider_account_email, scopes, label_scope_notified_at, last_checked_at')
    .in('provider', ['google', 'microsoft']);

  // Alerte ponctuelle, une seule fois par connexion (demande Alex, 27/08/2026,
  // suite au test réel avec Ludovic où le label n'est jamais apparu) : les
  // comptes Google connectés sans le bon scope n'ont pas le label et Google
  // ne le redonne jamais rétroactivement à un jeton déjà émis. Le badge
  // d'avertissement + bouton "Reconnecter" existe déjà dans Connexions
  // (app/app/connexions/page.jsx) mais ne se voit que si le commercial y
  // retourne — même angle mort déjà comblé pour SPF/DMARC (voir
  // lib/email-deliverability.ts). Best-effort : ne bloque jamais le
  // traitement des emails ci-dessous en cas d'échec.
  //
  // CORRECTION (27/08/2026, plus tard le même jour) : le scope vérifié ici
  // était gmail.labels (ajouté le 25/08), qui s'est avéré INSUFFISANT — voir
  // app/api/auth/google/route.ts pour l'explication complète (gmail.labels
  // suffit pour lister/créer le label, mais pas pour l'appliquer à un fil,
  // qui nécessite gmail.modify). On vérifie donc désormais gmail.modify.
  // Voir reset_label_scope_notified_2026-08-27.sql : remet
  // label_scope_notified_at à null pour les connexions déjà notifiées sous
  // l'ancienne logique (gmail.labels) mais toujours sans gmail.modify, sinon
  // elles ne seraient jamais re-notifiées malgré le vrai problème non résolu.
  for (const connection of connections || []) {
    if (
      connection.provider !== 'google' ||
      connection.label_scope_notified_at ||
      (connection.scopes || []).includes('https://www.googleapis.com/auth/gmail.modify')
    ) {
      continue;
    }
    try {
      await sendPushNotification(connection.user_id, {
        title: 'Petite permission à redonner à Aaron',
        body: "Le repère \"🤖 Géré par Aaron\" ne peut pas s'afficher dans ta boîte tant que tu n'as pas reconnecté Gmail — un clic dans Connexions suffit.",
        url: '/app/connexions',
      });
      await supabaseAdmin
        .from('oauth_connections')
        .update({ label_scope_notified_at: new Date().toISOString() })
        .eq('id', connection.id);
    } catch (err: any) {
      console.error('Erreur notification scope gmail.modify manquant (non bloquant):', err.message);
    }
  }

  const results = [];

  for (const connection of connections || []) {
    let newMessages: NormalizedMessage[] = [];
    // Capturé AVANT la lecture (pas après) : si de nouveaux messages arrivent
    // pendant le traitement de ce cycle, ils restent bien "après" ce repère et
    // seront donc repris au cycle suivant plutôt que silencieusement sautés.
    const checkStartedAt = new Date();
    try {
      newMessages = await fetchNewMessagesForConnection(connection);
    } catch (err: any) {
      // Un token expiré/révoqué pour ce commercial ne doit pas bloquer les
      // autres — et ne doit surtout PAS faire avancer last_checked_at : tant
      // que la boîte reste injoignable, on veut continuer à repartir du même
      // point (ou plus loin en arrière si la coupure dure), pour rattraper
      // l'intégralité de la coupure une fois reconnecté (voir
      // computeLookbackTimestamp plus haut).
      console.error(`Erreur lecture boîte mail (${connection.provider}) pour ${connection.user_id}:`, err.message);
      continue;
    }

    for (const msg of newMessages) {
      try {
      const { fromEmail, bodyText, threadId } = msg;
      if (!fromEmail) continue;

      // Sécurité anti-doublon : avec le rattrapage automatique ci-dessus, la
      // fenêtre relue après une coupure peut légèrement recouvrir une fenêtre
      // déjà traitée avant la coupure. Un message déjà enregistré (même
      // provider_message_id) ne doit jamais être retraité — sinon Aaron
      // pourrait répondre deux fois au même prospect, ou écraser une note de
      // check-in déjà enregistrée.
      const { data: alreadyProcessed } = await supabaseAdmin
        .from('messages')
        .select('id')
        .eq('provider_message_id', msg.id)
        .limit(1)
        .maybeSingle();
      if (alreadyProcessed) continue;

      // GARANTIE DE PÉRIMÈTRE (demande Alex, 2026-08-26 : "garantis-moi
      // qu'aaron n'est capable que de prendre en charge les emails des
      // contacts dont il a la charge"). Ce périmètre est structurellement
      // garanti par ce match : un email dont l'expéditeur ne correspond à
      // AUCUN prospect assigné à CE commercial est ignoré (aucune ligne
      // trouvée = `continue` juste en dessous) — Aaron ne peut donc déjà
      // traiter que les contacts que le commercial a lui-même créés
      // (démarchés par Aaron via une campagne, ou ajoutés/importés
      // manuellement), jamais un email personnel quelconque adressé à sa
      // boîte mail.
      const { data: prospect } = await supabaseAdmin
        .from('prospects')
        .select('id, full_name, is_won, is_lost, company_id, ai_managed, kickoff_call_proposed_at, deal_stage')
        .eq('email', fromEmail)
        .eq('assigned_user_id', connection.user_id)
        .single();

      // is_lost : marqué manuellement comme perdu par le commercial (via
      // "Marquer comme perdu" dans Prospects) — Aaron doit arrêter de le
      // recontacter, même s'il répond après coup.
      if (!prospect || prospect.is_lost) continue;

      // Contrôle MANUEL par-dessus la garantie structurelle ci-dessus : le
      // bouton "Aaron s'en charge / n'en charge plus" (Prospects, Aaron
      // Opportunité, Aaron Client — voir ai_managed, initialement réservé à
      // Aaron Client via migration_customer_ai_managed_2026-08-17.sql puis
      // étendu à tout prospect le 2026-08-26). Placé AVANT la pose du
      // label/catégorie juste en dessous, contrairement à la version
      // précédente : un contact explicitement repris en main par le
      // commercial ne doit ni être traité PAR Aaron, ni être étiqueté "Géré
      // par Aaron" (l'étiquette doit rester un signal fiable — c'est très
      // précisément ce qu'Alex a demandé : "comment savoir quel email aaron
      // prend en charge et quel il ne prend pas en charge ?").
      if (prospect.ai_managed === false) continue;

      // Marque le message comme "géré par Aaron" dès la réception, avant même
      // de générer la réponse — si la génération échoue plus bas, le
      // commercial sait quand même qu'il ne doit pas répondre lui-même en
      // attendant. Gmail : label posé sur tout le fil. Outlook : catégorie
      // posée sur ce message précis (voir applyAaronCategory dans
      // lib/microsoft.ts — Outlook catégorise message par message, pas par fil).
      //
      // AWAIT nécessaire (même bug que sur l'envoi, voir lib/google.ts ->
      // sendGmailEmail, constaté par Alex le 27/08/2026 : un email envoyé par
      // Aaron sans que le label ne se pose jamais). applyAaronLabel et
      // applyAaronCategory avalent déjà leurs propres erreurs en interne —
      // attendre ne peut donc jamais faire échouer le traitement du message —
      // mais sans await, l'appel restait fire-and-forget et pouvait être
      // interrompu si la fonction serverless se terminait avant que les
      // requêtes réseau internes n'aient fini.
      if (connection.provider === 'google') {
        await applyAaronLabel(connection.user_id, threadId);
      } else if (connection.provider === 'microsoft') {
        await applyAaronCategory(connection.user_id, msg.id);
      }

      // is_won : le prospect est déjà client — Aaron Prospect (relance de
      // prospection automatique) ne s'applique plus, mais Aaron Customer
      // capte quand même le message pour l'historique et, si un check-in
      // satisfaction/NPS est en attente de réponse, en extrait la note.
      // Voir lib/aaron-customer.ts et migration_aaron_customer_2026-08-13.sql.
      if (prospect.is_won) {
        await handleWonCustomerMessage(prospect, connection.user_id, fromEmail, bodyText, msg.id);
        continue;
      }

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
            status_updated_at: new Date().toISOString(),
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

      // Garde-fou : Aaron peut légitimement n'avoir "rien à répondre" (ex: un
      // accusé de réception automatique, un message hors-sujet/spam détecté
      // dans la boîte mail) — dans ce cas email_draft.subject/body est vide.
      // Avant, on envoyait quand même un email vide au prospect (et on en
      // gardait une trace vide côté commercial, source de confusion). On
      // met à jour le statut/la personnalité du prospect dans tous les cas,
      // mais on n'envoie et n'archive un message que s'il y a vraiment
      // quelque chose à envoyer.
      const hasEmailToSend =
        aaronOutput.email_draft?.subject?.trim() && aaronOutput.email_draft?.body?.trim();

      if (hasEmailToSend) {
        // Demande Alex (30/08/2026) : un email "long" envoyé 3 minutes après
        // la réponse du prospect ne fait pas crédible — voir
        // computeHumanReplyDelayMs (lib/messaging.ts). Les emails courts
        // gardent le comportement historique (envoi immédiat, ci-dessous) ;
        // les emails longs sont mis en attente dans pending_aaron_replies et
        // envoyés plus tard par app/api/cron/send-pending-replies.
        const delayMs = computeHumanReplyDelayMs(aaronOutput.email_draft.body);

        if (delayMs > 0) {
          await supabaseAdmin.from('pending_aaron_replies').insert({
            conversation_id: conversation.id,
            prospect_id: prospect.id,
            user_id: connection.user_id,
            to_email: fromEmail,
            subject: aaronOutput.email_draft.subject,
            body: aaronOutput.email_draft.body,
            send_after: new Date(Date.now() + delayMs).toISOString(),
          });
        } else {
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
        }
      }

      await supabaseAdmin
        .from('prospects')
        .update({
          status: aaronOutput.prospect_status,
          status_updated_at: new Date().toISOString(),
          personality_type: aaronOutput.personality_type,
          personality_notes: aaronOutput.personality_notes,
          aaron_advice: aaronOutput.aaron_advice,
          ...(aaronOutput.detected_phone ? { phone: aaronOutput.detected_phone } : {}),
        })
        .eq('id', prospect.id);

      // Demande de devis détectée par Aaron dans le message reçu : on prépare
      // automatiquement une proposition chiffrée (catalogue produits +
      // historique des devis déjà envoyés à ce prospect, voir
      // lib/aaron-sales.ts) mais on ne l'envoie JAMAIS automatiquement — le
      // commercial la relit et valide dans Aaron Opportunité. Best-effort : un
      // échec ici ne doit pas empêcher le reste du traitement du message.
      if (aaronOutput.quote_requested) {
        try {
          await generateDevis(prospect.id);
          await sendPushNotification(connection.user_id, {
            title: 'Devis prêt à valider',
            body: `${prospect.full_name} a demandé un devis. Aaron a préparé une proposition à relire dans Aaron Opportunité.`,
            url: `/app/sales?user_id=${connection.user_id}`,
          });
        } catch (err: any) {
          console.error(`Erreur génération devis automatique pour prospect ${prospect.id}:`, err.message);
        }
      }

      // Docx pipeline (Alex, 2026-08-23), section I.5 : le prospect a répondu
      // avec un signal d'opportunité clair (demande de devis, enthousiasme
      // net) alors que le bilan du RDV n'a pas encore été rempli par le
      // commercial — Aaron enregistre le bilan à sa place, exactement comme
      // s'il avait cliqué "Opportunité" (ou "Demande de devis"), ce qui
      // retire au passage la notification "Comment ça s'est passé ?" encore
      // en attente (appointments.outcome n'est plus null, voir
      // app/api/cron/appointment-feedback-prompts). Texte différent selon
      // que le commercial a déjà l'abonnement Aaron Opportunités.
      if (aaronOutput.opportunity_signal?.detected) {
        try {
          const { data: pendingAppointment } = await supabaseAdmin
            .from('appointments')
            .select('id')
            .eq('prospect_id', prospect.id)
            .eq('status', 'validé')
            .eq('purpose', 'commercial')
            .is('outcome', null)
            .order('proposed_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pendingAppointment) {
            await recordAppointmentOutcome(pendingAppointment.id, aaronOutput.quote_requested ? 'devis' : 'opportunite');

            const { offer_as_active } = await getCompanyModuleFlags(prospect.company_id);
            await sendPushNotification(connection.user_id, {
              title: 'Nouvelle opportunité !',
              body: offer_as_active
                ? `${prospect.full_name} vient de basculer en opportunité — tu peux la suivre dès maintenant dans Aaron Opportunités. Je m'occupe de la faire avancer.`
                : `Bonne nouvelle : ${prospect.full_name} vient de basculer en opportunité ! Abonne-toi à Aaron Opportunités pour la suivre jusqu'à la signature.`,
              url: `/app/sales?user_id=${connection.user_id}`,
            });
          }
        } catch (err: any) {
          console.error(`Erreur bascule automatique en opportunité pour prospect ${prospect.id}:`, err.message);
        }
      }

      // Docx pipeline (Alex, 2026-08-23), section I.4 : score de conviction
      // Aaron pour la détection de "en négociation" — toujours enregistré
      // pour affichage (badge sur la fiche), bascule automatique de
      // deal_stage seulement à confiance forte (>= 75), jamais en arrière.
      if (aaronOutput.negotiation_confidence) {
        try {
          const { score, reason } = aaronOutput.negotiation_confidence;
          const now = new Date().toISOString();
          await supabaseAdmin
            .from('prospects')
            .update({
              negotiation_confidence_score: score,
              negotiation_confidence_reason: reason || null,
              negotiation_confidence_updated_at: now,
            })
            .eq('id', prospect.id);

          const currentStage = (prospect as any).deal_stage;
          if (score >= 75 && (currentStage === 'rdv_fait' || currentStage === 'devis_envoye')) {
            await supabaseAdmin
              .from('prospects')
              .update({ deal_stage: 'en_negociation', deal_stage_updated_at: now })
              .eq('id', prospect.id);

            await sendPushNotification(connection.user_id, {
              title: 'Affaire en négociation',
              body: reason
                ? `${prospect.full_name} — Aaron détecte une vraie dynamique de négociation : ${reason} (confiance ${score}/100).`
                : `${prospect.full_name} montre des signes clairs de négociation active (confiance ${score}/100).`,
              url: `/app/sales?user_id=${connection.user_id}`,
            });
          } else if (score >= 40) {
            await sendPushNotification(connection.user_id, {
              title: 'Signal de négociation détecté',
              body: reason
                ? `${prospect.full_name} — ${reason} (confiance ${score}/100, à confirmer toi-même dans Aaron Opportunités).`
                : `${prospect.full_name} montre un signal de négociation à confirmer (confiance ${score}/100).`,
              url: `/app/sales?user_id=${connection.user_id}`,
            });
          }
        } catch (err: any) {
          console.error(`Erreur score de conviction négociation pour prospect ${prospect.id}:`, err.message);
        }
      }

      // Accord ferme détecté dans l'email reçu (docx "OPPORTUNITES A1") : Aaron
      // bascule automatiquement ce prospect en client gagné — même effet que
      // l'action manuelle "set_deal_stage = signé" côté UI (is_won, won_at,
      // first_order_confirmed_at) — et prévient le commercial avec la raison
      // détectée. Best-effort : un échec ici ne doit pas empêcher le reste du
      // traitement du message (l'email de réponse a déjà été envoyé au-dessus).
      if (aaronOutput.deal_approved?.detected) {
        try {
          const now = new Date().toISOString();
          await supabaseAdmin
            .from('prospects')
            .update({
              deal_stage: 'signe',
              deal_stage_updated_at: now,
              is_won: true,
              won_at: now,
              is_lost: false,
              first_order_confirmed_at: now,
              won_reason: aaronOutput.deal_approved.reason || null,
            })
            .eq('id', prospect.id);

          // Docx pipeline (Alex, 2026-08-23), section I.7 : texte différent
          // selon que le commercial a déjà l'abonnement Aaron Clients.
          const { offer_ac_active } = await getCompanyModuleFlags(prospect.company_id);
          const raison = aaronOutput.deal_approved.reason ? ` — ${aaronOutput.deal_approved.reason}` : '';
          await sendPushNotification(connection.user_id, {
            title: 'Devis signé 🎉',
            body: offer_ac_active
              ? `${prospect.full_name} a donné son accord${raison}. Félicitations, nouveau client ! Tu peux désormais le suivre dans Aaron Clients, je m'occupe de son accueil.`
              : `${prospect.full_name} a donné son accord${raison}. Félicitations, nouveau client ! Abonne-toi à Aaron Clients pour l'accueillir, le fidéliser, et vendre encore et encore.`,
            url: `/app/customer?user_id=${connection.user_id}`,
          });

          // Docx "CLIENTS A1(a)" : onboarding automatique dès la signature —
          // voir lib/aaron-customer.ts. Fire-and-forget, best-effort.
          triggerAutomaticOnboarding(prospect.id).catch(() => {});
        } catch (err: any) {
          console.error(`Erreur bascule automatique en client pour prospect ${prospect.id}:`, err.message);
        }
      }

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

          // C'est le seul cas où le commercial doit être averti d'un RDV déjà
          // validé qui bouge : le client annule. Si le client propose une
          // nouvelle date dans le même message, le bloc appointment_proposal
          // juste en dessous crée/actualise la nouvelle ligne "proposé" —
          // sinon la réponse d'Aaron au client (email_draft) relance pour en
          // fixer une.
          await sendPushNotification(connection.user_id, {
            title: 'Rendez-vous annulé par le prospect',
            body: `${prospect.full_name} a annulé le rendez-vous. Aaron lui propose une nouvelle date.`,
            url: `/app/agenda?user_id=${connection.user_id}`,
          });
        }
      }

      if (aaronOutput.appointment_proposal?.detected) {
        // Anti-doublon : avant, on insérait systématiquement une NOUVELLE ligne
        // à chaque détection, y compris quand le prospect précisait/changeait
        // simplement la date d'un rendez-vous déjà en cours de discussion (ou
        // déjà validé) — résultat : plusieurs lignes "à valider" pour un seul
        // et même rendez-vous. On regarde d'abord s'il existe déjà une ligne
        // en cours pour ce prospect (proposé = en discussion, validé = déjà
        // confirmé côté commercial) et on l'utilise/la met à jour au lieu d'en
        // recréer une.
        const { data: existingAppointment } = await supabaseAdmin
          .from('appointments')
          .select('id, status, proposed_at')
          .eq('prospect_id', prospect.id)
          .in('status', ['proposé', 'validé'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const sameDate =
          existingAppointment &&
          new Date(existingAppointment.proposed_at).getTime() ===
            new Date(aaronOutput.appointment_proposal.proposed_datetime).getTime();

        if (existingAppointment && existingAppointment.status === 'validé' && sameDate) {
          // Le client reconfirme simplement une date déjà validée par le
          // commercial : rien à faire, on évite de recréer une ligne "à valider".
        } else if (existingAppointment && existingAppointment.status === 'proposé') {
          // Un rendez-vous est déjà en cours de discussion pour ce prospect :
          // on met à jour la date/le type au lieu d'ajouter une deuxième ligne.
          await supabaseAdmin
            .from('appointments')
            .update({
              type: aaronOutput.appointment_proposal.type,
              proposed_at: aaronOutput.appointment_proposal.proposed_datetime,
            })
            .eq('id', existingAppointment.id);

          await sendPushNotification(connection.user_id, {
            title: 'Nouveau rendez-vous à valider',
            body: `Aaron a proposé un RDV avec ${prospect.full_name}. Va le valider dans ton agenda.`,
            url: `/app/agenda?user_id=${connection.user_id}`,
          });
        } else {
          // Aucune ligne en cours (ou date différente d'un rendez-vous déjà
          // validé, ex: le client redemande à changer un RDV déjà confirmé) :
          // nouvelle ligne.
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
      }

      results.push({ prospect_id: prospect.id, new_status: aaronOutput.prospect_status });
      } catch (err: any) {
        // Un échec sur UN message (ex: token révoqué en cours de route, boîte mail
        // déconnectée entre deux messages) ne doit pas interrompre le traitement
        // des autres messages/commerciaux de ce cycle.
        console.error(`Erreur traitement message pour ${connection.user_id}:`, err.message);
      }
    }

    // La boîte a été lue avec succès jusqu'ici (même si 0 nouveau message) :
    // on avance le repère de rattrapage automatique (voir
    // computeLookbackTimestamp en haut du fichier). Best-effort — un échec de
    // cette seule mise à jour ne doit pas faire perdre les messages déjà
    // traités ci-dessus ; au pire, le prochain cycle relira une fenêtre un
    // peu plus large que nécessaire (sans trou, grâce à la sécurité
    // anti-doublon sur provider_message_id).
    try {
      await supabaseAdmin
        .from('oauth_connections')
        .update({ last_checked_at: checkStartedAt.toISOString() })
        .eq('id', connection.id);
    } catch (err: any) {
      console.error(`Erreur mise à jour last_checked_at pour ${connection.user_id}:`, err.message);
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
