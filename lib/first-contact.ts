// lib/first-contact.ts
// PREMIER CONTACT D'UN PROSPECT (recherche de la société + premier email
// d'Aaron). Extrait le 28/10/2026 de app/api/prospects/[id]/generate-first-
// contact/route.ts pour pouvoir le lancer AUSSI en arrière-plan juste après
// la création (import CSV, voir POST /api/prospects + lib/background.ts),
// sans que l'import attende 20 à 40 s par ligne.

import { supabaseAdmin } from './supabase-admin';
import { generateAaronResponse, convictionColumns } from './aaron';
import {
  sendEmailForUser,
  hasReachedProspectingCap,
  effectiveProspectingCap,
  DailySendCapExceededError,
  DomainNotDeliverableError,
  MailboxAuthBrokenError,
} from './messaging';
import { sendPushNotification } from './push';
import { ensureCompanyEnriched } from './prospect-research';

export type FirstContactProspect = {
  id: string;
  company_id: string;
  assigned_user_id: string;
  full_name: string;
  email: string;
  prospect_company_id: string | null;
  aaron_advice: string | null;
  origin?: string | null;
};

export async function loadFirstContactProspect(prospectId: string): Promise<FirstContactProspect | null> {
  const { data } = await supabaseAdmin
    .from('prospects')
    .select('id, company_id, assigned_user_id, full_name, email, prospect_company_id, aaron_advice, origin')
    .eq('id', prospectId)
    .single();
  return (data as any) || null;
}

export async function runFirstContact(prospect: FirstContactProspect) {
  if (prospect.aaron_advice) {
    return { prospect, aaronOutput: null as any, emailWarning: null as string | null, emailWarningCode: null as string | null, emailWarningParams: null as Record<string, string> | null, skipped: true };
  }

  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('prospect_id', prospect.id)
    .single();

  const { data: prospectCompany } = await supabaseAdmin
    .from('prospect_companies')
    .select('*')
    .eq('id', prospect.prospect_company_id)
    .single();

  // Même recherche web unique par société qu'auparavant dans
  // app/api/prospects/route.ts — voir lib/prospect-research.ts. Ne relance
  // jamais si déjà vérifiée (research_summary ou research_checked_at déjà en
  // base).
  if (prospectCompany) {
    await ensureCompanyEnriched(prospect.company_id, prospectCompany, {
      name: prospectCompany.name || null,
      domain: prospectCompany.domain || null,
      website: prospectCompany.website || null,
      industry: prospectCompany.industry || null,
      address: prospectCompany.address || null,
    });
  }

  let aaronOutput = null;
  // Voir app/api/prospects/route.ts : on renvoie un CODE traduisible en plus
  // du texte français, pour que l'alerte suive la langue de l'interface.
  let emailWarning = null;
  let emailWarningCode: string | null = null;
  let emailWarningParams: Record<string, string> | null = null;

  // Hisse hors du try : le bloc catch en a besoin pour savoir s'il a le droit
  // de ranger un brouillon dans pending_first_email_* (voir plus bas).
  let sender: { email: string | null; require_first_email_approval: boolean | null } | null = null;

  try {
    const senderRes = await supabaseAdmin
      .from('users')
      .select('email, require_first_email_approval')
      .eq('id', prospect.assigned_user_id)
      .single();
    sender = (senderRes.data as any) || null;

    // ───────────────────────────────────────────────────────────────────────
    // NE REDIGER QUE CE QU'ON PEUT ENVOYER (Alex, 30/10/2026).
    //
    // Constat : un import de 300 prospects faisait rediger les 300 premiers
    // emails a Sonnet DANS LA FOULEE, alors que la montee en charge de la
    // boite d'envoi (WARMUP_STEPS, lib/messaging.ts) n'en laissait partir que
    // 8 le premier jour. Les 292 autres etaient payes puis jetes : l'envoi
    // levait DailySendCapExceededError, et le catch plus bas n'enregistrait
    // meme pas le texte produit. Facture constatee : 3,17 $ le 29/10 et
    // 3,56 $ le 30/10 contre 1,81 $ sur les 28 jours precedents.
    //
    // Desormais on verifie le plafond AVANT de payer la redaction. Le prospect
    // reste "jamais contacte" (aucun message, aucun brouillon en attente), donc
    // app/api/cron/retry-uncontacted-prospects le reprend tout seul le jour ou
    // le plafond se libere — ce cron verifie deja hasReachedProspectingCap et
    // se limite a MAX_PER_USER_PER_RUN par passage. Bonus : l'email est redige
    // le jour de son envoi, donc avec des informations fraiches.
    //
    // Exception volontaire : require_first_email_approval = true. Dans ce mode
    // rien ne part automatiquement, le compteur d'envois ne bouge donc jamais
    // et le plafond ne se declencherait pas — et le commercial veut justement
    // ses brouillons prets a relire. On redige comme avant.
    if (!sender?.require_first_email_approval && (await hasReachedProspectingCap(prospect.assigned_user_id))) {
      const cap = await effectiveProspectingCap(prospect.assigned_user_id);
      emailWarningCode = 'dailyCap';
      emailWarningParams = { cap: String(cap) };
      emailWarning = `Prospect ajoute — plafond quotidien d'emails de prospection atteint (${cap}/jour), le premier message sera redige et envoye automatiquement des que le plafond se libere.`;
      return { prospect, aaronOutput: null, emailWarning, emailWarningCode, emailWarningParams, skipped: false };
    }

    aaronOutput = await generateAaronResponse(prospect.id);

    // Réponse du modèle COUPÉE puis reconstruite (voir lib/extract-json.ts) :
    // l'objet est exploitable mais au moins une valeur est amputée. Un
    // prospect réel a reçu un email dont le corps entier était « Bon »
    // (Alex, 30/10/2026). On garde le brouillon — il a été payé et il est
    // souvent récupérable en deux mots — mais il attend une relecture au
    // lieu de partir tout seul.
    const truncated = aaronOutput.truncated === true;

    const hasEmailToSend = aaronOutput.email_draft?.subject?.trim() && aaronOutput.email_draft?.body?.trim();

    // FICHE ENREGISTREE AVANT L'ENVOI (Alex, 30/10/2026). Cet UPDATE se
    // trouvait APRES sendEmailForUser : si l'envoi echouait (plafond, SPF,
    // boite deconnectee), l'exception sautait l'enregistrement et tout le
    // travail de Claude — statut, profil, conviction, conseil — etait perdu
    // alors qu'il etait deja paye. Il ne depend pas de l'envoi : il monte ici.
    await supabaseAdmin
      .from('prospects')
      .update({
        status: aaronOutput.prospect_status,
        status_updated_at: new Date().toISOString(),
        personality_type: aaronOutput.personality_type,
        personality_notes: aaronOutput.personality_notes,
        aaron_advice: aaronOutput.aaron_advice,
        ...convictionColumns(aaronOutput),
      })
      .eq('id', prospect.id);

    if (hasEmailToSend && (sender?.require_first_email_approval || truncated)) {
      await supabaseAdmin
        .from('prospects')
        .update({
          pending_first_email_subject: aaronOutput.email_draft.subject,
          pending_first_email_body: aaronOutput.email_draft.body,
          pending_first_email_generated_at: new Date().toISOString(),
        })
        .eq('id', prospect.id);

      emailWarning = truncated
        ? "Prospect ajouté — le premier email a été coupé pendant sa rédaction, il t'attend pour relecture avant envoi."
        : "Prospect ajouté — le premier email est prêt et t'attend pour validation avant envoi.";
      emailWarningCode = truncated ? 'truncatedDraft' : 'pendingApproval';

      try {
        await sendPushNotification(prospect.assigned_user_id, {
          title: 'Premier email prêt à valider',
          // Le NOM, pas l'adresse email : plus lisible sur un écran verrouillé.
          body: `Aaron a préparé le premier email pour ${prospect.full_name}. À relire avant envoi.`,
          tag: `premier_email:${prospect.id}`,
          // Lien profond : fiche + modale de validation ouvertes d'emblée.
          url: `/app/prospects?user_id=${prospect.assigned_user_id}&contact=${prospect.id}&action=valider_email`,
        });
      } catch (pushErr) {
        console.error('Erreur envoi notification push (premier email à valider):', pushErr);
      }
    } else if (hasEmailToSend) {
      // 25/09/2026 : plus de piece jointe sur le premier contact FROID (signal
      // de spam classique). La plaquette part avec la premiere reponse
      // d'Aaron — voir getBrochureForReply dans lib/first-email-attachment.ts.
      await sendEmailForUser(prospect.assigned_user_id, prospect.email, aaronOutput.email_draft.subject, aaronOutput.email_draft.body, {
        emailType: 'prospecting',
      });

      if (conversation) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          sender_email: sender?.email || null,
          recipient_email: prospect.email,
          body: aaronOutput.email_draft.body,
        });
      }
    }
  } catch (err: any) {
    console.error('Erreur génération/envoi du premier message prospect:', err.message);

    // ───────────────────────────────────────────────────────────────────────
    // NE PLUS JETER CE QU'ON A PAYE (Alex, 30/10/2026).
    //
    // L'email etait redige par Sonnet PUIS perdu des que l'envoi echouait pour
    // une raison temporaire. Le prospect repassait alors "jamais contacte" et
    // le cron de rattrapage repayait une redaction complete.
    //
    // On range desormais le brouillon dans pending_first_email_*, exactement
    // la ou lib/first-email-deferred.ts va le chercher toutes les 20 minutes
    // (reclamation atomique, remise en place si l'envoi rate encore). Effet de
    // bord voulu : un prospect avec un brouillon en attente est exclu du cron
    // retry-uncontacted-prospects, donc plus aucune redaction en double.
    const draft = aaronOutput?.email_draft;
    const retryable =
      err instanceof DailySendCapExceededError ||
      err instanceof DomainNotDeliverableError ||
      err instanceof MailboxAuthBrokenError;
    if (retryable && !sender?.require_first_email_approval && draft?.subject?.trim() && draft?.body?.trim()) {
      try {
        await supabaseAdmin
          .from('prospects')
          .update({
            pending_first_email_subject: draft.subject,
            pending_first_email_body: draft.body,
            pending_first_email_generated_at: new Date().toISOString(),
          })
          .eq('id', prospect.id);
      } catch (keepErr: any) {
        console.error('Erreur sauvegarde du brouillon de premier email (non bloquant):', keepErr.message);
      }
    }
    if (err instanceof DailySendCapExceededError) {
      emailWarningCode = 'dailyCap';
      emailWarningParams = { cap: String(err.cap) };
      emailWarning = `Prospect ajouté — plafond quotidien d'emails de prospection atteint (${err.cap}/jour), le premier message sera renvoyé automatiquement dès que le plafond se libère.`;
    } else if (err instanceof DomainNotDeliverableError) {
      emailWarningCode = 'domainNotDeliverable';
      emailWarningParams = { domain: String(err.domain) };
      emailWarning = `Prospect ajouté, mais le premier message n'a pas été envoyé : le domaine ${err.domain} n'a pas de SPF valide, tes emails de prospection partiraient en spam. Corrige-le dans « Connexions » — le message partira automatiquement une fois réglé.`;
    } else if (err.message?.includes('Aucune boîte mail connectée')) {
      emailWarningCode = 'noMailbox';
      emailWarning = "Prospect ajouté, mais aucun email n'a été envoyé : connecte ta boîte mail dans « Connexions ».";
    } else {
      emailWarningCode = 'sendFailed';
      emailWarning = "Prospect ajouté, mais le premier message n'a pas pu être envoyé automatiquement.";
    }

    // Stocke le message d'erreur RÉEL (diagnostic panne, remonté par Alex,
    // 30/08/2026, test Outlook — voir
    // migration_prospect_first_message_error_2026-08-30.sql) pour pouvoir
    // diagnostiquer sans accès aux logs serveur, même schéma que
    // send-verification/resend-verification pour l'email de confirmation.
    try {
      await supabaseAdmin
        .from('prospects')
        .update({
          first_message_send_error: String(err?.message || err),
          first_message_send_error_at: new Date().toISOString(),
        })
        .eq('id', prospect.id);
    } catch (logErr: any) {
      console.error('Erreur stockage first_message_send_error (non bloquant):', logErr.message);
    }
  }

  return { prospect, aaronOutput, emailWarning, emailWarningCode, emailWarningParams, skipped: false };
}
