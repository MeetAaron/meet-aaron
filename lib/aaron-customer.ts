// lib/aaron-customer.ts
// Le "cerveau" d'Aaron Customer : prend le relais d'Aaron Sales une fois
// l'affaire signée (prospects.is_won = true). Trois responsabilités :
//  - generateOnboarding      : plan d'accueil (checklist) + email de
//    bienvenue prêt à envoyer au client tout juste signé.
//  - generateCheckinMessage  : email court de check-in satisfaction/NPS,
//    envoyé périodiquement par le cron app/api/cron/customer-checkins.
//  - parseCheckinResponse    : quand le client répond à un check-in (capté
//    par app/api/cron/check-inbox), extrait la note et le commentaire de sa
//    réponse en texte libre.
// Le score de santé client (lib/customer-health.ts) est volontairement
// SÉPARÉ et ne passe pas par Claude — voir ce fichier pour le pourquoi.

import { supabaseAdmin } from './supabase-admin';
import { callClaude, MonthlyCapExceededError } from './anthropic-client';
import { localeInstruction, normalizeLocale } from './locale-instruction';
import { sendEmailForUser } from './messaging';
import { sendPushNotification } from './push';

export interface OnboardingPlan {
  plan: { titre: string; description: string }[];
  welcome_email: { subject: string; body: string };
}

export interface CheckinMessage {
  subject: string;
  body: string;
}

export interface CheckinResponseParsed {
  score: number | null; // 0-10, null si le client n'a pas donné de note claire
  comment: string | null;
}

export interface RenewalOutreach {
  subject: string;
  body: string;
}

export interface TestimonialRequest {
  subject: string;
  body: string;
}

export interface SupportReplyDraft {
  is_support_request: boolean;
  suggested_subject: string | null;
  suggested_body: string | null;
}

async function loadWonProspect(prospectId: string) {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select(
      `id, full_name, email, job_title, company_id, is_won, assigned_user_id,
       prospect_company_id, prospect_companies (name, domain), users (locale)`
    )
    .eq('id', prospectId)
    .single();

  if (error || !prospect) throw new Error('Prospect introuvable');
  if (!prospect.is_won) throw new Error("Ce prospect n'est pas (encore) un client gagné");

  return prospect;
}

// Langue du commercial en charge du client — utilisée comme repère par
// défaut pour tout le contenu généré par Aaron Customer (emails au client,
// suggestions internes) : le client n'a pas de langue connue côté Meet
// Aaron (contrairement au prospect, dont on peut détecter la langue dans
// l'historique de conversation via lib/aaron.ts), donc on retombe sur celle
// du commercial qui gère la relation. Voir lib/locale-instruction.ts.
function prospectLocale(prospect: any): string {
  return normalizeLocale(prospect?.users?.locale);
}

function parseJsonResponse<T>(data: any, errorLabel: string): T {
  const textBlock = data.content.find((b: any) => b.type === 'text');
  if (!textBlock) throw new Error('Aucune réponse texte reçue de Claude');

  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    console.error(`${errorLabel} non parsable:`, textBlock.text);
    throw new Error(`Réponse Aaron mal formée (JSON invalide) — ${errorLabel}`);
  }
}

// Génère (et met en cache sur prospects.onboarding_plan / welcome_email_*)
// le plan d'accueil interne (checklist pour le commercial) et l'email de
// bienvenue à valider avant envoi. Si c'est la première génération,
// initialise onboarding_status à 'a_demarrer'.
export async function generateOnboarding(prospectId: string): Promise<OnboardingPlan> {
  const prospect = await loadWonProspect(prospectId);
  const companyId = prospect.company_id;
  const societe = (prospect as any).prospect_companies?.name;
  const locale = prospectLocale(prospect);

  // CHANGEMENTS A FAIRE #89 : ne retient que les documents pris en compte
  // par Aaron et rattachés au module Client — "général" (NULL/'general')
  // ou explicitement 'clients'.
  const { data: documents } = await supabaseAdmin
    .from('company_documents')
    .select('file_name, description, extracted_text, commercial_note')
    .eq('company_id', companyId)
    .eq('included_in_aaron_context', true)
    .not('extracted_text', 'is', null)
    .or('linked_category.is.null,linked_category.eq.general,linked_category.eq.clients')
    .order('created_at', { ascending: false })
    .limit(3);

  const context = {
    client: {
      nom: prospect.full_name,
      poste: prospect.job_title,
      societe: societe || null,
    },
    documents_entreprise: (documents || []).map((doc) => ({
      nom_fichier: doc.file_name,
      description: doc.description,
      // docx "MES DOCUMENTS" item 26 : note libre du commercial/fondateur.
      note_commerciale: doc.commercial_note || null,
      extrait: doc.extracted_text ? doc.extracted_text.slice(0, 600) : null,
    })),
  };

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content:
            `Tu es Aaron, copilote commercial IA. Le commercial vient de signer un nouveau client : ` +
            `"${prospect.full_name}"${societe ? ` (${societe})` : ''}. Aide-le à bien démarrer la relation. ` +
            `Rédige tout ce qui suit (plan ET email) ${localeInstruction(locale)}.\n` +
            `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
            `{"plan": [{"titre": "étape courte (3-5 mots)", "description": "1 phrase expliquant quoi faire concrètement"}], ` +
            `"welcome_email": {"subject": "objet de l'email de bienvenue", "body": "corps de l'email, ton chaleureux et professionnel, ${localeInstruction(locale)}, sans balises HTML"}}\n` +
            `Le plan doit contenir entre 4 et 6 étapes concrètes d'onboarding (ex: envoyer les accès, planifier un call de kickoff, ` +
            `présenter les prochaines étapes, envoyer la documentation). Adapte le contenu au contexte fourni si disponible, ` +
            `sinon reste générique mais concret.\n\n` +
            `Contexte :\n${JSON.stringify(context, null, 2)}`,
        },
      ],
    },
    companyId
  );

  const result = parseJsonResponse<OnboardingPlan>(data, "Plan d'onboarding");

  const { data: current } = await supabaseAdmin
    .from('prospects')
    .select('onboarding_status')
    .eq('id', prospectId)
    .single();

  const update: Record<string, any> = {
    onboarding_plan: result.plan,
    onboarding_generated_at: new Date().toISOString(),
    welcome_email_subject: result.welcome_email.subject,
    welcome_email_body: result.welcome_email.body,
  };

  if (!current?.onboarding_status) {
    update.onboarding_status = 'a_demarrer';
    update.onboarding_status_updated_at = new Date().toISOString();
  }

  await supabaseAdmin.from('prospects').update(update).eq('id', prospectId);

  return result;
}

// Docx "CLIENTS A1(a)" : "dès la signature, séquence d'emails de bienvenue
// [...] sans action manuelle du commercial". Jusqu'ici, generateOnboarding
// ci-dessus préparait le plan + l'email de bienvenue mais le commercial
// devait toujours cliquer deux fois (générer, puis envoyer) depuis Aaron
// Client — voir app/api/customers/[id]/onboarding. Cette fonction fait les
// deux étapes d'un coup, automatiquement, dès qu'un prospect devient
// réellement client (first_order_confirmed_at renseigné) : à appeler depuis
// CHAQUE endroit qui pose cette colonne (voir app/api/prospects/[id]/route.ts
// actions marquer_gagne/confirmer_premiere_commande/set_deal_stage=signe,
// app/api/cron/check-inbox pour la détection "bon pour accord", et
// app/api/webhooks/youtrust pour la signature électronique confirmée).
//
// Best-effort et non-bloquant par construction : ne lève JAMAIS d'exception
// (best-effort volontaire) — un échec ici (plafond API atteint, boîte mail
// non connectée...) ne doit jamais empêcher la bascule "client gagné"
// elle-même, qui est l'action principale. Les appelants doivent l'invoquer
// en fire-and-forget (sans await bloquant la réponse HTTP) quand ils sont
// eux-mêmes sur le chemin critique d'une action utilisateur interactive.
export async function triggerAutomaticOnboarding(prospectId: string): Promise<void> {
  try {
    const result = await generateOnboarding(prospectId);

    const { data: prospect } = await supabaseAdmin
      .from('prospects')
      .select('id, assigned_user_id, full_name, email, welcome_email_sent_at')
      .eq('id', prospectId)
      .single();

    if (!prospect || prospect.welcome_email_sent_at || !prospect.email) return;

    await sendEmailForUser(prospect.assigned_user_id, prospect.email, result.welcome_email.subject, result.welcome_email.body);

    const sentAt = new Date().toISOString();
    await supabaseAdmin.from('prospects').update({ welcome_email_sent_at: sentAt }).eq('id', prospectId);

    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('prospect_id', prospectId)
      .eq('channel', 'email')
      .maybeSingle();

    if (conversation) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_email: '',
        recipient_email: prospect.email,
        body: result.welcome_email.body,
      });
    }

    await sendPushNotification(prospect.assigned_user_id, {
      title: 'Onboarding démarré automatiquement',
      body: `Aaron a envoyé l'email de bienvenue à ${prospect.full_name} et préparé un plan d'accueil dans Aaron Client.`,
      url: `/app/customer?user_id=${prospect.assigned_user_id}`,
    });
  } catch (err: any) {
    console.error(`Erreur onboarding automatique pour prospect ${prospectId}:`, err.message);
  }
}

const FALLBACK_CHECKIN: Record<'nps' | 'satisfaction', CheckinMessage> = {
  nps: {
    subject: 'Une minute pour nous dire comment ça se passe ?',
    body:
      "Bonjour,\n\nÇa fait maintenant quelques semaines que nous travaillons ensemble, et j'aimerais avoir votre retour.\n\n" +
      "Sur une échelle de 0 à 10, quelle est la probabilité que vous nous recommandiez à un collègue ou partenaire ?\n\n" +
      "Répondez simplement à cet email avec une note de 0 à 10, et un mot sur pourquoi si vous avez une minute.\n\nMerci !",
  },
  satisfaction: {
    subject: 'Comment se passent vos débuts avec nous ?',
    body:
      "Bonjour,\n\nJ'aimerais avoir votre avis sur comment se passent nos débuts ensemble.\n\n" +
      "Sur une échelle de 0 à 10, dans quelle mesure êtes-vous satisfait(e) jusqu'ici ?\n\n" +
      "Répondez simplement à cet email avec une note de 0 à 10, et un mot sur pourquoi si vous avez une minute.\n\nMerci !",
  },
};

// Génère le texte d'un email de check-in court (satisfaction ou NPS).
// Best-effort côté personnalisation : si le plafond API est atteint ou
// l'appel échoue, on retombe sur un template générique plutôt que de
// bloquer l'envoi — l'essentiel est de solliciter le client régulièrement,
// pas d'avoir un email parfaitement personnalisé à chaque fois.
export async function generateCheckinMessage(prospectId: string, type: 'nps' | 'satisfaction'): Promise<CheckinMessage> {
  const prospect = await loadWonProspect(prospectId);
  const fallback = FALLBACK_CHECKIN[type];
  const locale = prospectLocale(prospect);

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, copilote commercial IA. Rédige un email court de check-in ${type === 'nps' ? 'NPS' : 'satisfaction'} ` +
              `pour "${prospect.full_name}", client depuis un moment. Le but : lui demander une note de 0 à 10 ` +
              `${type === 'nps' ? '(probabilité de recommandation)' : '(satisfaction générale)'} et lui demander de répondre ` +
              `directement à cet email avec sa note et un mot d'explication.\n` +
              `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
              `{"subject": "objet court", "body": "corps de l'email, 4-6 phrases maximum, ton chaleureux, ${localeInstruction(locale)}, sans balises HTML"}`,
          },
        ],
      },
      prospect.company_id
    );
    return parseJsonResponse<CheckinMessage>(data, 'Email de check-in');
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur génération email de check-in (repli sur template):', err.message);
    }
    return fallback;
  }
}

// Extrait une note (0-10) et un commentaire à partir de la réponse en texte
// libre d'un client à un email de check-in. Renvoie score: null si aucune
// note claire n'est trouvée dans le texte (ex: réponse hors-sujet) plutôt
// que d'inventer un chiffre.
export async function parseCheckinResponse(replyText: string, companyId: string | null): Promise<CheckinResponseParsed> {
  const trimmed = replyText.trim();
  if (!trimmed) return { score: null, comment: null };

  if (!companyId) return { score: null, comment: null };

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content:
              `Un client a répondu à un email lui demandant une note de satisfaction/recommandation de 0 à 10. ` +
              `Voici sa réponse :\n"${trimmed}"\n\n` +
              `Extrais la note (un entier de 0 à 10) et un court commentaire résumant son avis, s'il y en a un.\n` +
              `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
              `{"score": note entière de 0 à 10, ou null si aucune note claire n'est présente dans le texte, ` +
              `"comment": "résumé très court de son commentaire en une phrase, ou null si aucun commentaire"}`,
          },
        ],
      },
      companyId
    );
    return parseJsonResponse<CheckinResponseParsed>(data, 'Réponse de check-in');
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur analyse réponse de check-in:', err.message);
    }
    return { score: null, comment: null };
  }
}

const FALLBACK_RENEWAL: RenewalOutreach = {
  subject: 'Votre renouvellement approche',
  body:
    "Bonjour,\n\nVotre contrat arrive bientôt à échéance et j'aimerais qu'on échange sur la suite.\n\n" +
    "Avez-vous quelques minutes cette semaine pour en discuter ensemble ?\n\nAu plaisir d'échanger,",
};

// Aaron Customer v2 — génère (et met en cache sur prospects.renewal_email_*)
// un email de relance de renouvellement, déclenché par le cron
// app/api/cron/renewal-reminders quand contract_renewal_date approche.
// Best-effort : repli sur un template générique si l'appel Claude échoue,
// pour ne jamais bloquer l'alerte au commercial.
export async function generateRenewalOutreach(prospectId: string): Promise<RenewalOutreach> {
  const prospect = await loadWonProspect(prospectId);
  const locale = prospectLocale(prospect);

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, copilote commercial IA. Le contrat du client "${prospect.full_name}" arrive bientôt à ` +
              `échéance. Rédige un email court pour amorcer la discussion de renouvellement, ton chaleureux et ` +
              `professionnel, qui ouvre la porte à un échange plutôt que de présumer la réponse.\n` +
              `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
              `{"subject": "objet court", "body": "corps de l'email, 4-6 phrases maximum, ${localeInstruction(locale)}, sans balises HTML"}`,
          },
        ],
      },
      prospect.company_id
    );
    return parseJsonResponse<RenewalOutreach>(data, 'Email de renouvellement');
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur génération email de renouvellement (repli sur template):', err.message);
    }
    return FALLBACK_RENEWAL;
  }
}

// Aaron Customer v2 — suggère une piste d'upsell pour un client en bonne
// santé (voir app/api/cron/upsell-signals). Best-effort, retourne null si
// l'appel échoue plutôt qu'un texte inventé — pas de repli générique ici car
// une suggestion vague ne rendrait pas service au commercial.
export async function generateUpsellSuggestion(prospectId: string): Promise<string | null> {
  const prospect = await loadWonProspect(prospectId);
  const societe = (prospect as any).prospect_companies?.name;
  const locale = prospectLocale(prospect);

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('business_summary')
    .eq('id', prospect.company_id)
    .maybeSingle();

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, copilote commercial IA. Le client "${prospect.full_name}"${societe ? ` (${societe})` : ''} ` +
              `est en très bonne santé (satisfait, onboarding terminé, ancien) — bon candidat pour une offre ` +
              `complémentaire ou une montée en gamme.\n` +
              (company?.business_summary ? `Activité de la société qui vend : ${company.business_summary}\n\n` : '') +
              `Suggère en 1-2 phrases courtes et concrètes une piste d'upsell ou de cross-sell pour ce client, ` +
              `que le commercial pourra explorer lors d'un prochain échange. Réponds uniquement avec cette suggestion, ` +
              `${localeInstruction(locale)}, sans préambule.`,
          },
        ],
      },
      prospect.company_id
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    return textBlock?.text?.trim() || null;
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur génération suggestion upsell:', err.message);
    }
    return null;
  }
}

const FALLBACK_TESTIMONIAL: TestimonialRequest = {
  subject: 'Votre avis compte beaucoup pour nous',
  body:
    "Bonjour,\n\nJe suis ravi que ça se passe bien de votre côté !\n\n" +
    "Accepteriez-vous de partager un court témoignage ou un avis sur votre expérience avec nous ? " +
    "Ça nous aiderait énormément.\n\nMerci d'avance,",
};

// Aaron Customer v2 — déclenché automatiquement quand un client répond à un
// check-in avec une note promoteur (>= 9/10, voir
// app/api/cron/check-inbox -> handleWonCustomerMessage). Génère un email
// demandant un témoignage/avis, mis en cache sur prospects.testimonial_email_*,
// à valider et envoyer par le commercial (jamais d'envoi automatique).
export async function generateTestimonialRequest(prospectId: string): Promise<TestimonialRequest> {
  const prospect = await loadWonProspect(prospectId);
  const fallback = FALLBACK_TESTIMONIAL;
  const locale = prospectLocale(prospect);

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, copilote commercial IA. Le client "${prospect.full_name}" vient de donner une excellente ` +
              `note de satisfaction/recommandation. Rédige un email court demandant s'il accepterait de laisser un ` +
              `témoignage ou un avis sur son expérience, ton chaleureux et reconnaissant, sans être insistant.\n` +
              `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
              `{"subject": "objet court", "body": "corps de l'email, 4-6 phrases maximum, ${localeInstruction(locale)}, sans balises HTML"}`,
          },
        ],
      },
      prospect.company_id
    );
    const result = parseJsonResponse<TestimonialRequest>(data, 'Demande de témoignage');

    await supabaseAdmin
      .from('prospects')
      .update({
        testimonial_email_subject: result.subject,
        testimonial_email_body: result.body,
        testimonial_requested_at: new Date().toISOString(),
      })
      .eq('id', prospectId);

    return result;
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur génération demande de témoignage (repli sur template):', err.message);
    }
    await supabaseAdmin
      .from('prospects')
      .update({
        testimonial_email_subject: fallback.subject,
        testimonial_email_body: fallback.body,
        testimonial_requested_at: new Date().toISOString(),
      })
      .eq('id', prospectId);
    return fallback;
  }
}

// Aaron Customer v2 — triage support niveau 1. Appelé par
// app/api/cron/check-inbox (handleWonCustomerMessage) sur un email reçu d'un
// client qui n'est PAS une réponse claire à un check-in. Classifie si c'est
// une vraie demande (question, problème, besoin d'aide) et, si oui, rédige
// une suggestion de réponse — jamais envoyée automatiquement, seulement
// proposée au commercial (voir customer_support_drafts et
// app/app/customer/page.jsx).
export async function generateSupportReply(prospectId: string, messageBody: string): Promise<SupportReplyDraft> {
  const trimmed = messageBody.trim();
  if (!trimmed) return { is_support_request: false, suggested_subject: null, suggested_body: null };

  const prospect = await loadWonProspect(prospectId);
  const locale = prospectLocale(prospect);

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, copilote commercial IA. Voici un email reçu d'un client déjà signé, "${prospect.full_name}" :\n` +
              `"""${trimmed}"""\n\n` +
              `Détermine si c'est une vraie demande nécessitant une réponse (question, problème, besoin d'aide, ` +
              `demande d'info) ou juste un message informatif/social ne nécessitant pas de suggestion (accusé de ` +
              `réception, remerciement simple, hors-sujet...).\n` +
              `Si c'est une vraie demande, rédige une suggestion de réponse professionnelle et utile (${localeInstruction(locale)}) — mais SANS ` +
              `inventer d'information technique ou de politique que tu ne connais pas ; si tu ne peux pas répondre ` +
              `sur le fond, propose une réponse qui accuse réception et indique que le commercial revient vers lui ` +
              `rapidement avec les détails.\n` +
              `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
              `{"is_support_request": true ou false, "suggested_subject": "objet de la réponse, ou null si is_support_request est false", ` +
              `"suggested_body": "corps de la réponse suggérée, ou null si is_support_request est false"}`,
          },
        ],
      },
      prospect.company_id
    );
    return parseJsonResponse<SupportReplyDraft>(data, 'Suggestion de réponse support');
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur génération suggestion de réponse support:', err.message);
    }
    return { is_support_request: false, suggested_subject: null, suggested_body: null };
  }
}
