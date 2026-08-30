// app/api/prospects/route.ts
// GET  -> liste les prospects du commercial connecté
// POST -> crée un nouveau prospect, détecte/crée sa "prospect_company" via le domaine
//         email, puis déclenche le tout premier message d'Aaron.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateAaronResponse } from '@/lib/aaron';
import { sendEmailForUser, DailySendCapExceededError, DomainNotDeliverableError } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { isGenericEmailDomain } from '@/lib/csv-import';
import { researchProspectCompany } from '@/lib/prospect-research';
import { getFirstEmailAttachment } from '@/lib/first-email-attachment';

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

  // docx item 13 (2026-08-27, remonté par Alex) : "l'ajout manuel d'un
  // prospect prend environ 1 minute" — cette route faisait tout de façon
  // strictement synchrone (recherche web de la société + génération Claude
  // du 1er email + envoi Gmail/Outlook réel) avant de répondre, bloquant le
  // formulaire d'ajout pendant toute cette durée. `async_first_contact`
  // (utilisé uniquement par le formulaire d'ajout manuel de
  // app/app/prospects/page.jsx pour l'instant) fait sortir immédiatement
  // après la création du prospect ; le frontend appelle ensuite séparément
  // POST /api/prospects/[id]/generate-first-contact, SANS l'attendre, pour
  // faire tout le travail lent en arrière-plan pendant que le prospect est
  // déjà visible et utilisable dans la liste. Comportement strictement
  // inchangé quand ce flag est absent (import CSV, Aaron Sales/Customer).
  const asyncFirstContact = body.async_first_contact === true;

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

  // Cherche ou crée la prospect_company associée à ce domaine.
  //
  // BUGFIX (2026-08-25, remonté par Alex : 3 prospects avec 3 sociétés
  // différentes affichaient tous "Dupont SAS" dans la liste) : le matching
  // par domaine email a du sens pour un vrai domaine d'entreprise (plusieurs
  // contacts @dupont-sas.fr partagent légitimement la même fiche société,
  // d'où le badge "+N autres contacts"). Mais pour un domaine grand public
  // (gmail.com, yahoo.fr, etc. — typiquement des emails de test ou des
  // prospects dont on n'a que l'email perso), ce même matching fusionnait
  // à tort n'importe quels prospects partageant ce domaine dans UNE seule
  // fiche société, quel que soit le nom d'entreprise saisi pour chacun : le
  // premier nom saisi "gagnait" et tous les suivants étaient silencieusement
  // ignorés (voir le bloc `else` juste en dessous, qui ne complète que les
  // champs encore vides). `isGenericEmailDomain` (déjà utilisée côté import
  // CSV, voir lib/csv-import.ts) exclut ces domaines du matching : chaque
  // prospect sur un domaine grand public obtient désormais toujours sa
  // propre fiche société.
  const domainForMatching = domain && !isGenericEmailDomain(email) ? domain : null;

  let prospectCompany = null;
  if (domainForMatching) {
    const { data: existingCompany } = await supabaseAdmin
      .from('prospect_companies')
      .select('id, name, address, siret, website, industry, company_size, estimated_revenue, research_summary')
      .eq('company_id', company_id)
      .eq('domain', domainForMatching)
      .single();
    prospectCompany = existingCompany;
  }

  if (!prospectCompany) {
    // BUGFIX (2026-08-25, suite) : la première version de ce correctif ne
    // touchait qu'à la LECTURE (`domainForMatching` ci-dessus) mais insérait
    // encore le domaine BRUT (`domain`, potentiellement 'gmail.com' etc.) sur
    // la nouvelle fiche société. `prospect_companies` a une contrainte unique
    // sur (company_id, domain) : dès qu'un 2e prospect sur le même domaine
    // grand public était créé, l'insert échouait avec "duplicate key value
    // violates unique constraint prospect_companies_company_id_domain_key"
    // (remonté par Alex en recréant ses prospects test après le premier
    // correctif). On stocke donc `null` comme domaine pour une fiche société
    // créée pour un domaine grand public — elle ne sert de toute façon jamais
    // au matching dans ce cas (voir `domainForMatching` ci-dessus), et
    // Postgres autorise plusieurs lignes à `null` sur une colonne unique
    // (NULL n'est jamais égal à NULL) donc plus aucune collision possible.
    const { data: newCompany, error: companyError } = await supabaseAdmin
      .from('prospect_companies')
      .insert({
        company_id,
        domain: domainForMatching,
        name: cleanCompanyName,
        address,
        siret,
        website,
        industry,
        company_size: companySize,
        estimated_revenue: estimatedRevenue,
      })
      .select('id, name, address, siret, website, industry, company_size, estimated_revenue, research_summary')
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

  // Voir commentaire sur asyncFirstContact plus haut : sort immédiatement,
  // AVANT même la recherche web de la société (elle aussi lente) — tout le
  // travail lent est délégué à /api/prospects/[id]/generate-first-contact.
  if (asyncFirstContact) {
    return NextResponse.json({ prospect, aaronOutput: null, emailWarning: null });
  }

  // MAÎTRISE + AUTO-COMPLÉTION DE LA SOCIÉTÉ CONTACTÉE (demande Alex,
  // 2026-08-26) : avant tout premier contact, Aaron doit connaître le vrai
  // métier de la société qu'il s'apprête à démarcher, pas juste son nom — et
  // "quand j'entre le prospect manuellement aaron doit essayer de compléter
  // la fiche prospect par lui-même (trouver le site web, trouver le siret,
  // maîtriser parfaitement)". Voir lib/prospect-research.ts (recherche web
  // unique par société, renvoie résumé + champs structurés, exception
  // intégrée pour les sociétés de test qui n'existent pas réellement) et
  // lib/aaron_system_prompt.md (section MAÎTRISE DES DEUX SOCIÉTÉS). Placé
  // AVANT le early-return `skipFirstContact` (contrairement à la première
  // version de cette fonctionnalité) : un ajout manuel de client/opportunité
  // existant ne déclenche jamais de premier message, mais sa fiche mérite
  // quand même d'être complétée automatiquement — c'est explicitement ce
  // qu'Alex a demandé. Ne lance la recherche qu'une seule fois par fiche
  // société (research_summary/research_checked_at déjà en base = on ne
  // repaie jamais deux fois la même recherche), et ne complète chaque champ
  // structuré QUE s'il est encore vide, exactement comme companyUpdate
  // ci-dessus : jamais écraser une valeur déjà renseignée par le commercial.
  // Ne bloque jamais la création du prospect en cas d'échec de la recherche.
  if (!prospectCompany.research_summary) {
    try {
      const research = await researchProspectCompany(company_id, {
        name: cleanCompanyName || prospectCompany.name || null,
        domain: domainForMatching,
        website: website || prospectCompany.website || null,
        industry: industry || prospectCompany.industry || null,
      });
      if (research) {
        const researchUpdate: Record<string, any> = { research_checked_at: new Date().toISOString() };
        if (research.summary) researchUpdate.research_summary = research.summary;
        if (research.website && !prospectCompany.website) researchUpdate.website = research.website;
        if (research.siret && !prospectCompany.siret) researchUpdate.siret = research.siret;
        if (research.address && !prospectCompany.address) researchUpdate.address = research.address;
        if (research.industry && !prospectCompany.industry) researchUpdate.industry = research.industry;
        await supabaseAdmin.from('prospect_companies').update(researchUpdate).eq('id', prospectCompany.id);
        prospectCompany = { ...prospectCompany, ...researchUpdate };
      } else {
        // Fiche non recherchable (société de test) : on marque quand même la
        // fiche comme vérifiée pour ne pas retenter à chaque nouveau contact.
        await supabaseAdmin
          .from('prospect_companies')
          .update({ research_checked_at: new Date().toISOString() })
          .eq('id', prospectCompany.id);
      }
    } catch (err: any) {
      console.error('Erreur recherche web société prospect (non bloquant):', err.message);
    }
  }

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
      // Pièce jointe éventuelle sur ce vrai premier email (plaquette, etc.)
      // — voir lib/first-email-attachment.ts. Best-effort : null la plupart
      // du temps (aucun document marqué), l'envoi se fait alors normalement.
      const firstEmailAttachment = await getFirstEmailAttachment(prospect.company_id);
      // Envoie l'email au nom du commercial (Gmail ou Outlook selon ce qu'il a connecté)
      await sendEmailForUser(assigned_user_id, email, aaronOutput.email_draft.subject, aaronOutput.email_draft.body, {
        emailType: 'prospecting',
        attachment: firstEmailAttachment || undefined,
      });

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
        : err instanceof DomainNotDeliverableError
        ? `Prospect ajouté, mais le premier message n'a pas été envoyé : le domaine ${err.domain} n'a pas de SPF/DMARC valide, tes emails de prospection partiraient en spam. Corrige-le dans "Connexions" — le message partira automatiquement une fois réglé.`
        : err.message?.includes('Aucune boîte mail connectée')
        ? "Prospect ajouté, mais aucun email n'a été envoyé : connectez votre boîte mail dans \"Connexions\"."
        : "Prospect ajouté, mais le premier message n'a pas pu être envoyé automatiquement.";

    // Stocke le message d'erreur RÉEL (diagnostic panne, remonté par Alex,
    // 30/08/2026, test Outlook — voir
    // migration_prospect_first_message_error_2026-08-30.sql), même schéma
    // que generate-first-contact/route.ts et que
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

  return NextResponse.json({ prospect, aaronOutput, emailWarning });
}
