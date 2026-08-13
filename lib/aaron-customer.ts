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

async function loadWonProspect(prospectId: string) {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select(
      `id, full_name, email, job_title, company_id, is_won, assigned_user_id,
       prospect_company_id, prospect_companies (name, domain)`
    )
    .eq('id', prospectId)
    .single();

  if (error || !prospect) throw new Error('Prospect introuvable');
  if (!prospect.is_won) throw new Error("Ce prospect n'est pas (encore) un client gagné");

  return prospect;
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

  const { data: documents } = await supabaseAdmin
    .from('company_documents')
    .select('file_name, description, extracted_text')
    .eq('company_id', companyId)
    .not('extracted_text', 'is', null)
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
            `"${prospect.full_name}"${societe ? ` (${societe})` : ''}. Aide-le à bien démarrer la relation.\n` +
            `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
            `{"plan": [{"titre": "étape courte (3-5 mots)", "description": "1 phrase expliquant quoi faire concrètement"}], ` +
            `"welcome_email": {"subject": "objet de l'email de bienvenue", "body": "corps de l'email, ton chaleureux et professionnel, en français, sans balises HTML"}}\n` +
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
              `{"subject": "objet court", "body": "corps de l'email, 4-6 phrases maximum, ton chaleureux, en français, sans balises HTML"}`,
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
