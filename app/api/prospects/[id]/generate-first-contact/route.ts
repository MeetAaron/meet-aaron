// app/api/prospects/[id]/generate-first-contact/route.ts
// POST -> déclenche la recherche web de la société + la génération/l'envoi du
// tout premier message d'Aaron pour un prospect qui vient d'être créé à la
// main.
//
// docx item 13 (2026-08-27, remonté par Alex) : "l'ajout manuel d'un
// prospect prend environ 1 minute" — POST /api/prospects faisait tout de
// façon strictement synchrone (recherche web de la société + appel Claude
// pour générer le 1er email + envoi Gmail/Outlook réel) avant de répondre,
// bloquant le formulaire d'ajout pendant toute cette durée. Cette route
// isole cette partie lente : POST /api/prospects répond désormais en moins
// d'une seconde (juste les écritures DB), et le frontend
// (app/app/prospects/page.jsx) déclenche cet appel séparément, SANS
// l'attendre, juste après — exactement le même schéma déjà en place pour
// /api/prospects/[id]/linkedin-draft. Le prospect reste visible et
// utilisable dans la liste pendant qu'Aaron prépare son premier message en
// arrière-plan ; l'utilisateur est notifié comme avant (push si validation
// requise, ou tout simplement le prospect qui se met à jour au prochain
// rafraîchissement de la liste).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateAaronResponse } from '@/lib/aaron';
import { sendEmailForUser, DailySendCapExceededError } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { researchProspectCompany } from '@/lib/prospect-research';
import { getFirstEmailAttachment } from '@/lib/first-email-attachment';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, company_id, assigned_user_id, email, prospect_company_id, aaron_advice, origin')
    .eq('id', params.id)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return forbiddenResponse();
  }

  // Garde-fou idempotence : si ce prospect a déjà un conseil d'Aaron
  // renseigné, le premier contact a déjà été généré (appel précédent déjà
  // passé, ou double-appel accidentel côté frontend) — on ne relance jamais
  // une deuxième génération/un deuxième envoi pour le même prospect.
  if (prospect.aaron_advice) {
    return NextResponse.json({ prospect, aaronOutput: null, emailWarning: null, skipped: true });
  }

  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('prospect_id', prospect.id)
    .single();

  const { data: prospectCompany } = await supabaseAdmin
    .from('prospect_companies')
    .select('id, name, domain, website, industry, research_summary')
    .eq('id', prospect.prospect_company_id)
    .single();

  // Même recherche web unique par société qu'auparavant dans
  // app/api/prospects/route.ts — voir lib/prospect-research.ts. Ne relance
  // jamais si déjà vérifiée (research_summary ou research_checked_at déjà en
  // base).
  if (prospectCompany && !prospectCompany.research_summary) {
    try {
      const research = await researchProspectCompany(prospect.company_id, {
        name: prospectCompany.name || null,
        domain: prospectCompany.domain || null,
        website: prospectCompany.website || null,
        industry: prospectCompany.industry || null,
      });
      if (research) {
        const researchUpdate: Record<string, any> = { research_checked_at: new Date().toISOString() };
        if (research.summary) researchUpdate.research_summary = research.summary;
        if (research.website && !prospectCompany.website) researchUpdate.website = research.website;
        if (research.siret) researchUpdate.siret = research.siret;
        if (research.address) researchUpdate.address = research.address;
        if (research.industry && !prospectCompany.industry) researchUpdate.industry = research.industry;
        await supabaseAdmin.from('prospect_companies').update(researchUpdate).eq('id', prospectCompany.id);
      } else {
        await supabaseAdmin
          .from('prospect_companies')
          .update({ research_checked_at: new Date().toISOString() })
          .eq('id', prospectCompany.id);
      }
    } catch (err: any) {
      console.error('Erreur recherche web société prospect (non bloquant):', err.message);
    }
  }

  let aaronOutput = null;
  let emailWarning = null;

  try {
    const { data: sender } = await supabaseAdmin
      .from('users')
      .select('email, require_first_email_approval')
      .eq('id', prospect.assigned_user_id)
      .single();

    aaronOutput = await generateAaronResponse(prospect.id);

    const hasEmailToSend = aaronOutput.email_draft?.subject?.trim() && aaronOutput.email_draft?.body?.trim();

    if (hasEmailToSend && sender?.require_first_email_approval) {
      await supabaseAdmin
        .from('prospects')
        .update({
          pending_first_email_subject: aaronOutput.email_draft.subject,
          pending_first_email_body: aaronOutput.email_draft.body,
          pending_first_email_generated_at: new Date().toISOString(),
        })
        .eq('id', prospect.id);

      emailWarning = "Prospect ajouté — le premier email est prêt et t'attend pour validation avant envoi.";

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
      const firstEmailAttachment = await getFirstEmailAttachment(prospect.company_id);
      await sendEmailForUser(prospect.assigned_user_id, prospect.email, aaronOutput.email_draft.subject, aaronOutput.email_draft.body, {
        emailType: 'prospecting',
        attachment: firstEmailAttachment || undefined,
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

    await supabaseAdmin
      .from('prospects')
      .update({
        status: aaronOutput.prospect_status,
        status_updated_at: new Date().toISOString(),
        personality_type: aaronOutput.personality_type,
        personality_notes: aaronOutput.personality_notes,
        aaron_advice: aaronOutput.aaron_advice,
      })
      .eq('id', prospect.id);
  } catch (err: any) {
    console.error('Erreur génération/envoi du premier message prospect:', err.message);
    emailWarning =
      err instanceof DailySendCapExceededError
        ? `Prospect ajouté — plafond quotidien d'emails de prospection atteint (${err.cap}/jour), le premier message sera renvoyé automatiquement dès que le plafond se libère.`
        : err.message?.includes('Aucune boîte mail connectée')
        ? "Prospect ajouté, mais aucun email n'a été envoyé : connectez votre boîte mail dans \"Connexions\"."
        : "Prospect ajouté, mais le premier message n'a pas pu être envoyé automatiquement.";
  }

  return NextResponse.json({ prospect, aaronOutput, emailWarning });
}
