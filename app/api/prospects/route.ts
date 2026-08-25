// app/api/prospects/route.ts
// GET  -> liste les prospects du commercial connecté
// POST -> crée un nouveau prospect, détecte/crée sa "prospect_company" via le domaine
//         email, puis déclenche le tout premier message d'Aaron.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateAaronResponse } from '@/lib/aaron';
import { sendEmailForUser, DailySendCapExceededError } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: prospects, error } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name, domain, address, siret, website, industry, company_size, estimated_revenue)')
    .eq('assigned_user_id', userId)
    // Reste visible tant qu'aucune 1ère commande n'est confirmée — un
    // prospect "gagné" (is_won=true) mais sans commande confirmée reste donc
    // ici sous le badge "🏆 Gagné — en attente de 1ère commande" au lieu de
    // disparaître immédiatement vers Clients (voir
    // migration_first_order_confirmed_2026-08-14.sql).
    .is('first_order_confirmed_at', null)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ prospects });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { company_id, assigned_user_id, full_name, email, phone, job_title, company_name, linkedin_url } = body;

  // Docx pipeline "Réactivation" (Alex, 2026-08-23) : d'où vient ce prospect —
  // sourcé par Aaron (campagne de prospection), ajouté à la main par le
  // commercial (formulaire ou import CSV normal), ou réactivé par Aaron
  // depuis un fichier de clients/prospects/opportunités perdus (voir
  // components/CsvImportModal.jsx contexte "reactivation" et
  // app/api/reactivation/batches). Valeur par défaut 'amene_par_toi' pour ne
  // rien changer au comportement existant (ajout manuel / import CSV normal)
  // quand le champ n'est pas fourni.
  const origin = ['amene_par_aaron', 'amene_par_toi', 'reactive_par_aaron'].includes(body.origin)
    ? body.origin
    : 'amene_par_toi';
  const reactivationBatchId = body.reactivation_batch_id || null;

  // docx AJOUT GLOBAL A15 : "ajouter manuellement" une opportunité ou un
  // client directement depuis Aaron Sales / Aaron Customer (import d'une
  // base existante, relation déjà établie hors Meet Aaron) — voir
  // app/app/sales/page.jsx et app/app/customer/page.jsx. Dans ce cas on ne
  // veut surtout PAS déclencher le tout premier email de prospection à
  // froid généré par Aaron ci-dessous : ce ne serait ni pertinent (la
  // relation existe déjà) ni professionnel (mail "ravi de vous
  // découvrir" à un client existant). `skip_first_contact` saute tout le
  // bloc génération/envoi du premier message ; la page appelante enchaîne
  // ensuite avec un PATCH set_deal_stage ou marquer_gagne selon le cas. Ne
  // change rien au comportement existant (ajout normal de prospect) quand
  // le champ est absent.
  const skipFirstContact = body.skip_first_contact === true;

  if (!company_id || !assigned_user_id || !full_name || !email) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== assigned_user_id || authedUser.company_id !== company_id) return forbiddenResponse();

  const domain = email.split('@')[1];
  const cleanCompanyName = company_name?.trim() || null;

  // Infos société complémentaires (demande Alex, 2026-08-25 : "il manque des
  // infos... l'adresse, etc etc ?") — voir migration_company_info_2026-08-25.sql.
  // Toutes optionnelles, en texte libre, portées par prospect_companies (la
  // société) et non par prospects (le contact) : plusieurs contacts d'une
  // même société partagent donc automatiquement ces infos.
  const cleanStr = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const address = cleanStr(body.address);
  const siret = cleanStr(body.siret);
  const website = cleanStr(body.website);
  const industry = cleanStr(body.industry);
  const companySize = cleanStr(body.company_size);
  const estimatedRevenue = cleanStr(body.estimated_revenue);

  // Cherche ou crée la prospect_company associée à ce domaine
  let { data: prospectCompany } = await supabaseAdmin
    .from('prospect_companies')
    .select('id, name, address, siret, website, industry, company_size, estimated_revenue')
    .eq('company_id', company_id)
    .eq('domain', domain)
    .single();

  if (!prospectCompany) {
    const { data: newCompany, error: companyError } = await supabaseAdmin
      .from('prospect_companies')
      .insert({
        company_id,
        domain,
        name: cleanCompanyName,
        address,
        siret,
        website,
        industry,
        company_size: companySize,
        estimated_revenue: estimatedRevenue,
      })
      .select('id, name')
      .single();

    if (companyError) {
      return NextResponse.json({ error: companyError.message }, { status: 500 });
    }
    prospectCompany = newCompany;
  } else {
    // La société existait déjà (autre prospect sur le même domaine) : on
    // complète chaque champ encore vide avec ce que le commercial vient de
    // renseigner, sans jamais écraser une valeur déjà connue.
    const companyUpdate: Record<string, any> = {};
    if (cleanCompanyName && !prospectCompany.name) companyUpdate.name = cleanCompanyName;
    if (address && !prospectCompany.address) companyUpdate.address = address;
    if (siret && !prospectCompany.siret) companyUpdate.siret = siret;
    if (website && !prospectCompany.website) companyUpdate.website = website;
    if (industry && !prospectCompany.industry) companyUpdate.industry = industry;
    if (companySize && !prospectCompany.company_size) companyUpdate.company_size = companySize;
    if (estimatedRevenue && !prospectCompany.estimated_revenue) companyUpdate.estimated_revenue = estimatedRevenue;
    if (Object.keys(companyUpdate).length > 0) {
      await supabaseAdmin.from('prospect_companies').update(companyUpdate).eq('id', prospectCompany.id);
    }
  }

  // Crée le prospect
  const { data: prospect, error: prospectError } = await supabaseAdmin
    .from('prospects')
    .insert({
      company_id,
      assigned_user_id,
      prospect_company_id: prospectCompany.id,
      full_name,
      email,
      phone,
      job_title,
      linkedin_url: linkedin_url?.trim() || null,
      status: 'jaune',
      origin,
      reactivation_batch_id: reactivationBatchId,
    })
    .select()
    .single();

  if (prospectError) {
    return NextResponse.json({ error: prospectError.message }, { status: 500 });
  }

  // Crée la conversation associée
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .insert({ prospect_id: prospect.id, channel: 'email' })
    .select()
    .single();

  // Le prospect est créé à ce stade quoi qu'il arrive : si la génération du
  // premier message ou l'envoi d'email échoue (ex: le commercial n'a pas
  // encore connecté sa boîte mail dans "Connexions"), on ne casse pas la
  // création du prospect — on le renvoie avec un avertissement exploitable
  // par le frontend plutôt qu'une 500 sans rollback.
  let aaronOutput = null;
  let emailWarning = null;

  if (skipFirstContact) {
    return NextResponse.json({ prospect, aaronOutput: null, emailWarning: null });
  }

  try {
    // Récupère l'email réel du commercial pour l'enregistrer comme expéditeur,
    // ainsi que sa préférence de validation du 1er email (voir
    // migration_first_email_approval_2026-08-15.sql, désactivée par défaut —
    // même logique que app/api/cron/run-campaigns/route.ts pour rester cohérent
    // que le prospect vienne d'une campagne ou d'un ajout manuel).
    const { data: sender } = await supabaseAdmin
      .from('users')
      .select('email, require_first_email_approval')
      .eq('id', assigned_user_id)
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
        await sendPushNotification(assigned_user_id, {
          title: 'Premier email prêt à valider',
          body: `Aaron a préparé le premier email pour ${email}. À relire avant envoi.`,
          url: `/app/prospects?user_id=${assigned_user_id}`,
        });
      } catch (pushErr) {
        console.error('Erreur envoi notification push (premier email à valider):', pushErr);
      }
    } else if (hasEmailToSend) {
      // Envoie l'email au nom du commercial (Gmail ou Outlook selon ce qu'il a connecté)
      await sendEmailForUser(assigned_user_id, email, aaronOutput.email_draft.subject, aaronOutput.email_draft.body, { emailType: 'prospecting' });

      // Enregistre le message envoyé
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation!.id,
        direction: 'outbound',
        sender_email: sender?.email || null,
        recipient_email: email,
        body: aaronOutput.email_draft.body,
      });
    }

    // Met à jour le statut/personnalité détectés
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
