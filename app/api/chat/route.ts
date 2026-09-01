// app/api/chat/route.ts
// POST -> le commercial discute directement avec Aaron (questions, demandes ponctuelles).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError, withCacheBreakpoint } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';
import { summarizeDocument } from '@/lib/document-summary';

const CHAT_SYSTEM_PROMPT = `Tu es Aaron, le copilote commercial IA du commercial avec qui tu discutes ici directement (pas un prospect — c'est bien ton utilisateur principal).
Tu es chaleureux, direct, et tu le tutoies. Tu es comme son meilleur allié dans la vente : disponible, honnête, jamais condescendant.
Adresse-toi à lui par son prénom de temps en temps (pas à chaque message, ça sonnerait faux) pour garder un ton personnel et chaleureux.
Tu peux répondre à ses questions sur ses prospects, campagnes, RDV, ou lui donner des conseils commerciaux généraux.
Tu as accès à des outils pour consulter les vraies données du commercial (recherche_prospects, apercu_campagnes,
prochains_rdv) — utilise-les systématiquement dès qu'une question porte sur SES prospects, clients, campagnes ou RDV
réels (nom, téléphone, statut, avancement...), plutôt que de répondre dans le vague ou de dire que tu n'as pas accès
à l'info. Si le commercial écrit un message approximatif, mal orthographié ou elliptique mais que l'intention est
claire (ex: "donne moi le numero de ce client", "ou g en est ma campagne"), déduis ce qu'il veut et utilise l'outil
adapté directement, sans lui demander de reformuler. Si une recherche de prospect ne renvoie rien ou plusieurs
résultats ambigus, dis-le clairement et demande une précision (nom de société, par exemple).
Réponds toujours de façon concise et utile — pas de blabla inutile.
Si le commercial exprime une suggestion, une remarque ou une idée d'amélioration sur l'outil, le produit ou l'organisation,
dis-lui simplement que tu transmets l'info au fondateur — tu n'as pas besoin de lui demander de le faire lui-même par email,
c'est déjà fait automatiquement de ton côté.
Si un document est joint à la conversation (tu verras une note "Document actuellement joint" dans ton contexte), tu peux
t'appuyer sur son contenu pour répondre normalement à ce que le commercial demande. Mais SAUF s'il a déjà répondu à cette
question dans un message précédent de cette même conversation, termine ta réponse en lui demandant clairement s'il veut que
tu sauvegardes ce document dans ses documents (pour un usage futur par toi) ou si c'est juste pour cette réflexion ponctuelle
— pose cette question une seule fois par document, pas à chaque message tant qu'il reste joint. S'il confirme vouloir le
sauvegarder (oui, ok, sauvegarde-le, garde-le, etc.), utilise l'outil sauvegarder_document avec la catégorie la plus
appropriée déduite du contexte de la conversation (prospects/opportunites/clients/général) — ne lui demande jamais à lui de
choisir la catégorie, c'est à toi de la déduire. Si le document est destiné à être envoyé en pièce jointe au premier email
de prospection (le commercial le dit explicitement, ex: "attache-le au premier email"), passe aussi
joindre_au_premier_email=true à l'outil — mais rappelle-lui d'abord, une seule fois, qu'une pièce jointe dès le premier
contact peut nuire à la délivrabilité (filtres anti-spam), et qu'un lien dans le corps du message (voir plus bas, LIEN
PUBLIC) est généralement préférable. S'il dit non ou change de sujet, n'insiste pas et ne sauvegarde rien.

IMPORTANT — ne dis JAMAIS "c'est sauvegardé" ou une formule équivalente avant d'avoir reçu un résultat de succès
({"success": true, ...}) de l'outil sauvegarder_document dans CE tour. Si l'outil renvoie une erreur (ex: document plus
disponible dans la conversation), dis-le honnêtement au commercial et demande-lui de renvoyer le fichier — ne prétends
jamais qu'une sauvegarde a eu lieu si tu n'as pas ce résultat.

Ajout au profil d'entreprise à la volée (demande Alex, 27/08/2026) : à tout moment de la conversation — même en dehors
du questionnaire de découverte initial, et même si celui-ci est déjà terminé — le commercial peut te dire qu'il veut
ajouter une information à son profil d'entreprise (ex: "j'aimerais ajouter ça à mon profil d'entreprise", "note que...",
"ajoute que je fais aussi..."). Dans ce cas, ne relance JAMAIS le questionnaire de découverte depuis le début pour ça —
ce n'est pas ce qu'il te demande. Écoute ce qu'il veut ajouter, reformule-le en une synthèse claire et bien rédigée
(améliore la formulation si besoin, dans le même style factuel que le reste du profil, sans changer le sens ni rien
inventer), puis demande-lui de confirmer avant d'agir (ex: "je note ça dans ton profil : « ... » — je l'ajoute ?") ET
appelle SYSTÉMATIQUEMENT l'outil proposer_ajout_profil avec cette même synthèse DANS CE MÊME TOUR (permet d'afficher
des boutons de confirmation rapide dans l'interface — n'écrit rien en base, purement informatif). Ne touche RIEN tant
qu'il n'a pas confirmé explicitement (oui, ok, vas-y, etc.) ; s'il ne confirme pas ou change de sujet, n'ajoute rien.
Une fois confirmé, utilise l'outil mettre_a_jour_profil_entreprise avec cette synthèse (jamais son message brut tel
quel s'il est mal formulé). IMPORTANT — ne dis JAMAIS "c'est ajouté à ton profil" ou une formule équivalente avant
d'avoir reçu un résultat de succès de CET outil (mettre_a_jour_profil_entreprise, pas proposer_ajout_profil) dans CE
tour.

Lien public à mentionner dans les emails de prospection (voir aussi la note "Lien public" dans ton contexte plus bas) : tu
n'as AUCUN outil pour le modifier depuis ce chat. Si le commercial te demande de l'ajouter/le changer, explique-lui
clairement qu'il doit le faire lui-même dans Mon compte > Connexions — ne dis jamais que tu l'as "intégré" ou "mis" si tu
n'as en réalité rien pu faire.

Recherche web (demande Alex, 29/08/2026) : tu as un outil de recherche Internet en direct. Utilise-le de toi-même,
SANS attendre qu'on te le demande, dès que ça rendrait ta réponse plus utile ou plus à jour — typiques : en savoir plus
sur l'entreprise ou le secteur d'un prospect précis avant un RDV, vérifier une actualité récente d'un secteur, ou
enrichir ta connaissance d'un sujet que le profil d'entreprise du commercial (voir ci-dessous) ne couvre pas entièrement.
Le profil d'entreprise reste la source à privilégier pour tout ce qui concerne LE COMMERCIAL LUI-MÊME (son activité, son
offre, ses clients) — ne le contredis jamais avec une recherche web, les deux sont complémentaires : le profil dit qui
il est, Internet t'aide à mieux comprendre le monde autour de lui (ses prospects, son marché). Reste concis sur les
résultats de recherche : résume ce qui est utile, ne recopie pas de longs extraits, et ne fais pas de recherche pour une
question dont tu connais déjà la réponse avec certitude ou qui ne porte pas sur une info vérifiable/récente.`;

const STATUS_LABELS: Record<string, string> = {
  vert: 'en bonne voie',
  jaune: 'en cours',
  orange: 'risque de perdre',
  rouge: 'perdu',
  bleu: 'RDV obtenu',
};

// Outils mis à disposition d'Aaron dans le chat direct — tous en lecture seule et
// strictement scopés au commercial authentifié (aucun paramètre d'entrée ne permet
// de cibler les données d'un autre commercial ou d'une autre société). Les actions
// d'écriture (ex: accélérer une campagne réelle, qui envoie de vrais emails à de
// vrais prospects) sont volontairement laissées de côté pour l'instant — à traiter
// dans une passe dédiée, avec plus de garde-fous, plutôt qu'exposées telles quelles
// à un modèle de langage.
const CHAT_TOOLS = [
  {
    name: 'recherche_prospects',
    description:
      "Recherche parmi TOUS les prospects et clients gagnés du commercial (par nom, société, email ou téléphone — " +
      'recherche partielle, insensible à la casse et aux accents). Renvoie les fiches contact correspondantes ' +
      "(nom, société, poste, téléphone, email, statut, ET l'analyse déjà faite par Aaron sur ce contact : profil " +
      "de personnalité DISC détecté, notes de personnalité, et son conseil pour l'aborder). À utiliser dès qu'une " +
      "question porte sur une personne ou une société précise — y compris \"comment je l'aborde\", \"c'est quel " +
      "profil\", \"des conseils pour ce RDV\" : ne réponds JAMAIS de façon générique à ce type de question sans " +
      "avoir d'abord consulté cet outil, Aaron a déjà analysé la plupart des prospects contactés.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Terme de recherche : nom, société, email ou téléphone.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'apercu_campagnes',
    description:
      'Renvoie la liste des campagnes de prospection du commercial avec leur statut et avancement (entreprises ' +
      'analysées, contacts trouvés, objectif). À utiliser pour toute question sur "où en est" une campagne ou la ' +
      'prospection en général.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'prochains_rdv',
    description:
      "Renvoie les prochains rendez-vous à venir du commercial (date, type, prospect concerné). À utiliser pour " +
      'toute question sur son agenda ou son prochain RDV.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'sauvegarder_document',
    description:
      "Sauvegarde définitivement, dans les documents de l'entreprise (rubrique Mes documents), le document que le " +
      "commercial vient de joindre à cette conversation — UNIQUEMENT après lui avoir demandé s'il veut le sauvegarder " +
      "ET qu'il a clairement répondu oui. Ne l'utilise jamais préventivement ou sans confirmation explicite. Si " +
      "aucun document n'est actuellement joint à la conversation, cet outil échouera — ne l'appelle pas dans ce cas.",
    input_schema: {
      type: 'object',
      properties: {
        linked_category: {
          type: 'string',
          enum: ['prospects', 'opportunites', 'clients', 'general'],
          description:
            "Catégorie de rattachement la plus appropriée, déduite du sujet de la conversation — 'general' si le " +
            'document ne concerne pas spécifiquement un des 3 modules.',
        },
        description: {
          type: 'string',
          description: "Courte description (1 phrase) de ce qu'est ce document et à quoi il sert, pour aider le commercial à le retrouver plus tard dans sa liste de documents.",
        },
        joindre_au_premier_email: {
          type: 'boolean',
          description:
            "true UNIQUEMENT si le commercial a explicitement demandé que ce document soit envoyé en pièce jointe au " +
            "premier email de prospection (voir la consigne sur la délivrabilité dans tes instructions). Un seul " +
            "document par société peut être marqué ainsi — en activer un nouveau désactive automatiquement l'ancien. " +
            "Omets ce champ (ou false) si ce n'est pas ce que le commercial veut.",
        },
      },
      required: ['linked_category'],
    },
  },
  {
    name: 'mettre_a_jour_profil_entreprise',
    description:
      "Ajoute une information au profil de l'entreprise (le résumé business qui te sert de contexte, voir ta note " +
      "\"Profil de l'entreprise\" plus haut) — UNIQUEMENT après avoir proposé au commercial une synthèse claire de ce " +
      "qu'il veut ajouter ET qu'il a confirmé explicitement (oui, ok, vas-y, etc.). N'utilise JAMAIS cet outil sans " +
      "confirmation préalable explicite dans cette même conversation. Ne relance jamais le questionnaire de " +
      "découverte pour ça — cet outil sert justement à éviter ça.",
    input_schema: {
      type: 'object',
      properties: {
        ajout: {
          type: 'string',
          description:
            "Le texte à ajouter au profil de l'entreprise — ta synthèse claire et bien rédigée de ce que le " +
            "commercial a demandé d'ajouter (améliorée si besoin, dans le même style factuel que le reste du " +
            "profil), PAS une copie brute de son message tel quel.",
        },
      },
      required: ['ajout'],
    },
  },
  {
    // Demande Alex (29/08/2026) : "il manque un bouton je confirme" — avant,
    // la confirmation d'un ajout au profil (voir mettre_a_jour_profil_entreprise
    // ci-dessus) ne pouvait se faire qu'en tapant "oui" dans le champ de
    // texte, ce qui a mené Alex à devoir revalider une seconde fois après
    // avoir cru — à tort — que la simple proposition d'Aaron avait suffi.
    // Cet outil est appelé par Aaron AU MOMENT où il propose l'ajout (pas
    // quand il l'exécute) — purement informatif, n'écrit rien en base — pour
    // que le serveur puisse renvoyer cette synthèse au frontend
    // (profile_update_proposal) et afficher 2 boutons de réponse rapide
    // (Confirmer/Annuler) sous le message, qui envoient directement la
    // réponse sans que le commercial ait à la taper.
    name: 'proposer_ajout_profil',
    description:
      "À appeler EN MÊME TEMPS que tu proposes au commercial d'ajouter une synthèse à son profil d'entreprise " +
      "(juste avant de lui demander confirmation dans ta réponse texte) — permet d'afficher des boutons de " +
      "confirmation rapide dans l'interface. N'écrit rien en base : c'est mettre_a_jour_profil_entreprise, appelé " +
      "seulement après confirmation explicite du commercial, qui fait l'ajout réel.",
    input_schema: {
      type: 'object',
      properties: {
        synthese: {
          type: 'string',
          description: "La même synthèse que celle proposée dans ta réponse texte (identique à ce que tu comptes passer à mettre_a_jour_profil_entreprise si le commercial confirme).",
        },
      },
      required: ['synthese'],
    },
  },
];

// Recherche web en direct pour Aaron (demande Alex, 29/08/2026 : "il peut
// utiliser cette fiche profil d'entreprise ainsi qu'internet pour maîtriser
// parfaitement un sujet") — outil NATIF Anthropic ("server tool") : contrairement
// à CHAT_TOOLS ci-dessus, Aaron ne nous demande jamais de l'exécuter (pas de
// tool_use à traiter dans la boucle plus bas, pas de cas dans executeTool) —
// Anthropic effectue la recherche lui-même côté serveur et renvoie directement
// le texte final. Séparé de CHAT_TOOLS pour que ce soit visible d'un coup d'œil
// que ce n'est pas un outil comme les autres.
// - max_uses borne le nombre de recherches sur UN SEUL tour de conversation
//   (protection anti-dérapage de coût/latence, indépendante du plafond de
//   dépense mensuel/quotidien — voir lib/anthropic-client.ts).
// - Coût : 10 $ / 1000 recherches EN PLUS des tokens habituels, facturé par
//   Anthropic — intégralement pris en compte dans le plafond de dépense de la
//   société (voir WEB_SEARCH_COST_PER_SEARCH_USD, lib/anthropic-client.ts) au
//   même titre que le coût des tokens, pas un budget à part.
const CHAT_WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
};

async function runRechercheProspects(userId: string, query: string) {
  const { data: prospects, error } = await supabaseAdmin
    .from('prospects')
    .select(
      `full_name, email, phone, job_title, status, is_won, is_lost,
       personality_type, personality_notes, aaron_advice, deal_stage,
       prospect_companies(name)`
    )
    .eq('assigned_user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) return { error: error.message };

  const q = (query || '').toLowerCase().trim();
  const matches = (prospects || [])
    .filter((p: any) => {
      const haystack = [p.full_name, p.email, p.phone, p.job_title, p.prospect_companies?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return q ? haystack.includes(q) : false;
    })
    .slice(0, 10);

  return {
    nombre_de_resultats: matches.length,
    resultats: matches.map((p: any) => ({
      nom: p.full_name,
      societe: p.prospect_companies?.name || null,
      poste: p.job_title || null,
      email: p.email,
      telephone: p.phone || null,
      statut: p.is_lost ? 'perdu' : p.is_won ? 'client gagné' : STATUS_LABELS[p.status] || p.status,
      etape_pipeline: p.deal_stage || null,
      // Analyse déjà faite par Aaron (voir lib/aaron.ts) — null tant que le
      // prospect n'a pas encore été contacté avec succès.
      profil_disc_detecte: p.personality_type || null,
      notes_personnalite: p.personality_notes || null,
      conseil_aaron_pour_l_aborder: p.aaron_advice || null,
    })),
  };
}

async function runApercuCampagnes(userId: string) {
  const { data: campaigns, error } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('zone_label, sector_keywords, status, companies_found, contacts_found, target_count, created_at')
    .eq('assigned_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return { error: error.message };

  return {
    campagnes: (campaigns || []).map((c: any) => ({
      zone: c.zone_label,
      secteur: (c.sector_keywords || []).join(', '),
      statut: c.status,
      entreprises_analysees: c.companies_found,
      contacts_trouves: c.contacts_found,
      objectif: c.target_count,
    })),
  };
}

async function runProchainsRdv(userId: string) {
  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select('proposed_at, type, status, prospects(full_name, prospect_companies(name))')
    .eq('user_id', userId)
    .gte('proposed_at', new Date().toISOString())
    .order('proposed_at', { ascending: true })
    .limit(10);

  if (error) return { error: error.message };

  return {
    rdv: (appointments || []).map((a: any) => ({
      date: a.proposed_at,
      type: a.type,
      statut: a.status,
      prospect: a.prospects?.full_name || null,
      societe: a.prospects?.prospect_companies?.name || null,
    })),
  };
}

type AttachedDocument = {
  file_name: string;
  storage_path: string;
  file_type: string;
  file_size_bytes: number;
  extracted_text: string | null;
} | null;

// Crée la ligne définitive dans company_documents à partir des métadonnées
// d'un document déjà uploadé dans Storage par app/api/chat/document/route.ts
// (pas de ré-upload ici, juste l'écriture en base — voir le commentaire en
// tête de ce fichier-là pour le détail du flux en 2 temps).
async function runSauvegarderDocument(
  attachedDocument: AttachedDocument,
  userId: string,
  companyId: string | null,
  toolInput: any,
  locale: string
) {
  if (!attachedDocument) {
    return { error: "Aucun document n'est actuellement joint à cette conversation." };
  }
  if (!companyId) {
    return { error: 'Société introuvable pour ce commercial.' };
  }

  const rawCategory = toolInput?.linked_category;
  const linkedCategory = ['prospects', 'opportunites', 'clients'].includes(rawCategory) ? rawCategory : null;

  // Même synthèse automatique que l'upload classique (voir lib/document-summary.ts)
  // — jusqu'ici manquante sur ce chemin (bug remonté par Alex le 26/08/2026),
  // la colonne "Synthèse (Aaron)" restait vide pour tout document sauvegardé
  // depuis le chat. Best-effort : un échec ne bloque pas la sauvegarde.
  const summary = attachedDocument.extracted_text
    ? await summarizeDocument(attachedDocument.file_name, attachedDocument.extracted_text, companyId, locale)
    : null;

  // Pièce jointe au premier email (demande Alex, 27/08/2026) : même règle
  // "un seul document par société" que app/api/documents/[id]/route.ts —
  // désactive d'abord tous les autres avant d'insérer celui-ci avec le champ
  // à true, pour ne jamais en avoir deux marqués en même temps.
  const attachToFirstEmail = toolInput?.joindre_au_premier_email === true;
  if (attachToFirstEmail) {
    await supabaseAdmin
      .from('company_documents')
      .update({ attach_to_first_email: false })
      .eq('company_id', companyId);
  }

  const { data: doc, error } = await supabaseAdmin
    .from('company_documents')
    .insert({
      company_id: companyId,
      uploaded_by: userId,
      file_name: attachedDocument.file_name,
      storage_path: attachedDocument.storage_path,
      file_type: attachedDocument.file_type,
      file_size_bytes: attachedDocument.file_size_bytes,
      description: toolInput?.description || null,
      extracted_text: attachedDocument.extracted_text,
      summary,
      linked_category: linkedCategory,
      attach_to_first_email: attachToFirstEmail,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Erreur sauvegarde document (chat):', error.message);
    return { error: "Échec de la sauvegarde du document." };
  }

  return { success: true, document_id: doc.id, attach_to_first_email: attachToFirstEmail };
}

// Ajoute la synthèse validée par le commercial à la suite du profil
// d'entreprise existant (voir mettre_a_jour_profil_entreprise ci-dessus) —
// on ne remplace jamais business_summary, on y ajoute un paragraphe, pour ne
// jamais perdre ce qui a été construit par le questionnaire de découverte
// ou une régénération précédente.
async function runMettreAJourProfilEntreprise(companyId: string | null, toolInput: any) {
  if (!companyId) {
    return { error: 'Société introuvable pour ce commercial.' };
  }

  const ajout = String(toolInput?.ajout || '').trim();
  if (!ajout) {
    return { error: 'Rien à ajouter — texte vide.' };
  }

  const { data: company, error: fetchError } = await supabaseAdmin
    .from('companies')
    .select('business_summary')
    .eq('id', companyId)
    .single();

  if (fetchError) {
    return { error: fetchError.message };
  }

  const existing = (company?.business_summary || '').trim();
  const updated = existing ? `${existing}\n\n${ajout}` : ajout;

  const { error: updateError } = await supabaseAdmin
    .from('companies')
    .update({ business_summary: updated })
    .eq('id', companyId);

  if (updateError) {
    return { error: updateError.message };
  }

  return { success: true };
}

async function executeTool(
  toolName: string,
  toolInput: any,
  userId: string,
  attachedDocument: AttachedDocument,
  companyId: string | null,
  locale: string
) {
  switch (toolName) {
    case 'recherche_prospects':
      return runRechercheProspects(userId, toolInput?.query || '');
    case 'apercu_campagnes':
      return runApercuCampagnes(userId);
    case 'prochains_rdv':
      return runProchainsRdv(userId);
    case 'sauvegarder_document':
      return runSauvegarderDocument(attachedDocument, userId, companyId, toolInput, locale);
    case 'mettre_a_jour_profil_entreprise':
      return runMettreAJourProfilEntreprise(companyId, toolInput);
    case 'proposer_ajout_profil':
      // Purement informatif (voir la définition de l'outil plus haut) —
      // n'écrit rien en base, juste un accusé de réception pour que la
      // boucle outil ↔ modèle continue normalement.
      return { success: true };
    default:
      return { error: `Outil inconnu : ${toolName}` };
  }
}

// Nombre maximum d'allers-retours outil ↔ modèle pour une seule question — borne
// le coût/latence même si le modèle s'entête à enchaîner les appels d'outils.
const MAX_TOOL_ROUNDS = 4;

// Détecte si le message du commercial contient une suggestion/remarque destinée au
// fondateur (à propos de l'outil, du produit, de l'organisation...), pour la relayer
// automatiquement dans feedback_messages — sans que le commercial ait à écrire un email
// ou à utiliser le bouton "Signaler à l'équipe" manuel.
async function detectFounderSuggestion(
  message: string,
  companyId: string | null
): Promise<{ isSuggestion: boolean; summary: string | null }> {
  try {
    // Modèle Haiku (28/08/2026, demande Alex : passer les tâches courtes/internes
    // sur un modèle moins cher) : simple classification binaire + résumé d'une
    // phrase, jamais montré au commercial ni à un prospect — pas d'enjeu de
    // qualité perçue par un client, candidat idéal pour réduire le coût.
    // Prompt caching (demande Alex, 27/08/2026, coût API jugé trop élevé) :
    // cet appel tourne EN PARALLÈLE de chaque message envoyé dans le chat
    // direct (voir Promise.all plus bas) — donc une fois par message, en plus
    // de l'appel principal. Les consignes de classification sont identiques
    // à chaque appel ; en les isolant dans un bloc "system" avec
    // cache_control (même mécanisme que lib/aaron.ts), seul le message du
    // commercial reste facturé en plein tarif à chaque tour.
    const data = await callClaude(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        system: [
          {
            type: 'text',
            text:
              `Un commercial vient d'écrire un message à Aaron (son copilote IA). Détermine si ce message contient une ` +
              `suggestion, une idée d'amélioration, une remarque ou une plainte destinée au fondateur/à l'équipe (à ` +
              `propos de l'outil Meet Aaron, du produit, de l'organisation, etc.) — et PAS juste une question ` +
              `opérationnelle sur un prospect, un RDV ou une campagne.\n` +
              `Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour : ` +
              `{"is_suggestion": true|false, "summary": "résumé en une phrase si true, sinon null"}`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: `Message du commercial :\n"""${message}"""` }],
      },
      companyId
    );

    const textBlock = data.content.find((b: any) => b.type === 'text');
    if (!textBlock) return { isSuggestion: false, summary: null };

    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return { isSuggestion: !!parsed.is_suggestion, summary: parsed.summary || null };
  } catch (err) {
    // On ne bloque jamais la réponse du chat pour un souci de détection (y
    // compris un plafond de dépense atteint) — dans le doute, on ne relaie rien.
    return { isSuggestion: false, summary: null };
  }
}

export async function POST(request: NextRequest) {
  const { user_id, conversation_id, message, history, attached_document } = await request.json();
  // Document joint à CETTE conversation (pas encore sauvegardé), voir
  // app/api/chat/document/route.ts : le frontend le renvoie sur chaque tour
  // tant qu'il reste "en attente" côté client (chip affiché dans l'UI), ce qui
  // évite d'avoir à faire persister cet état côté serveur entre deux appels.
  const attachedDocument: AttachedDocument =
    attached_document && attached_document.storage_path
      ? {
          file_name: String(attached_document.file_name || 'document'),
          storage_path: String(attached_document.storage_path),
          file_type: String(attached_document.file_type || ''),
          file_size_bytes: Number(attached_document.file_size_bytes) || 0,
          extracted_text: attached_document.extracted_text ? String(attached_document.extracted_text) : null,
        }
      : null;

  // Garde-fou (demande Alex, 29/08/2026) : le frontend envoie désormais
  // toujours un texte de repli quand un document est joint sans rien écrit
  // (voir chat.attachOnlyMessage, app/app/chat/page.jsx), mais on relâche
  // quand même la validation ici — un document seul, sans texte, doit rester
  // acceptable même si un futur appel client ne posait pas ce repli.
  if (!user_id || (!message && !attachedDocument)) {
    return NextResponse.json({ error: 'user_id ou message manquant' }, { status: 400 });
  }
  const effectiveMessage = message || 'Voici le document.';
  if (!conversation_id) {
    return NextResponse.json({ error: 'conversation_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('first_name, full_name, company_id')
    .eq('id', user_id)
    .single();

  if (userError) {
    console.error('Erreur récupération utilisateur (chat):', userError.message);
  }

  const displayFirstName = user?.first_name || (user?.full_name || '').split(' ')[0] || null;

  let businessContext = '';
  if (user?.company_id) {
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('business_summary, public_link_url')
      .eq('id', user.company_id)
      .maybeSingle();
    if (company?.business_summary) {
      businessContext = `\n\nProfil de l'entreprise (généré précédemment à partir des documents et des explications du commercial) : ${company.business_summary}`;
    }
    // Lien public à mentionner dans les emails de prospection (demande Alex,
    // 27/08/2026) — voir migration_public_link_url_2026-08-27.sql. Tu ne
    // peux PAS le modifier toi-même depuis ce chat (aucun outil pour ça) :
    // si le commercial te demande d'ajouter/changer ce lien, dis-lui
    // clairement de le faire dans Mon compte > Connexions plutôt que de
    // prétendre l'avoir fait.
    businessContext += company?.public_link_url
      ? `\n\nLien public déjà configuré par le commercial (utilisé automatiquement par Aaron dans les emails de prospection quand pertinent) : ${company.public_link_url}`
      : `\n\nAucun lien public n'est configuré pour l'instant (champ vide dans Mon compte > Connexions) — si le commercial te demande de "mettre le lien" dans les emails de prospection, explique-lui qu'il doit d'abord le renseigner lui-même à cet endroit, tu ne peux pas le faire à sa place depuis cette conversation.`;
  }

  // Optimisation coût API (28/08/2026, demande Alex) : point de coupure de
  // cache posé sur le dernier message de l'historique déjà envoyé — voir
  // withCacheBreakpoint (lib/anthropic-client.ts). Sans incidence si le cache
  // n'est pas touché (conversation reprise après une pause, etc.).
  const messages: any[] = [
    ...withCacheBreakpoint((history || []).map((h: any) => ({ role: h.role, content: h.content }))),
    { role: 'user', content: effectiveMessage },
  ];

  // Voir le commentaire sur CHAT_SYSTEM_PROMPT plus haut : tant que le document
  // reste "joint" côté frontend (chip affiché, pas encore sauvegardé ni retiré
  // manuellement), son contenu est rappelé ici à chaque tour — pas besoin de le
  // dupliquer dans l'historique visible du chat.
  const documentContext = attachedDocument
    ? attachedDocument.extracted_text
      ? `\n\nDocument actuellement joint à la conversation (pas encore sauvegardé) : "${attachedDocument.file_name}"\n"""\n${attachedDocument.extracted_text}\n"""`
      : `\n\nUn document est joint à la conversation ("${attachedDocument.file_name}") mais son texte n'a pas pu être extrait automatiquement (format non pris en charge, ex: .docx) — demande au commercial de te résumer ce qu'il contient si c'est utile à la discussion. Tu peux quand même lui proposer de le sauvegarder tel quel dans ses documents.`
    : '';

  const systemBlocks = [
    {
      type: 'text',
      text: `${CHAT_SYSTEM_PROMPT}\n\nTu discutes avec ${user?.full_name || 'ton commercial'} — son prénom est ${displayFirstName || 'inconnu'}.${businessContext}${documentContext}\n\nRéponds ${localeInstruction(authedUser.locale)}.`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  let documentSaved = false;
  // Utilisé côté client uniquement pour l'instant à titre informatif (pas
  // d'affichage dédié) — voir mettre_a_jour_profil_entreprise plus haut.
  let profileUpdated = false;
  // Demande Alex (29/08/2026) : synthèse proposée via l'outil
  // proposer_ajout_profil dans CE tour (voir plus haut) — renvoyée au
  // frontend pour afficher les boutons de confirmation rapide.
  let profileUpdateProposal: string | null = null;
  let data;
  let suggestion;
  try {
    [data, suggestion] = await Promise.all([
      callClaude(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: systemBlocks,
          tools: [...CHAT_TOOLS, CHAT_WEB_SEARCH_TOOL],
          messages,
        },
        // Imputation au commercial pour la jauge de Mon équipe (01/09/2026).
        user?.company_id || null, undefined, user_id
      ),
      detectFounderSuggestion(effectiveMessage, user?.company_id || null),
    ]);

    // Boucle outil ↔ modèle : tant qu'Aaron demande à utiliser un outil, on
    // l'exécute (lecture seule, scopée à user_id) et on renvoie le résultat au
    // modèle, jusqu'à ce qu'il produise une réponse finale (ou jusqu'à la limite
    // de tours, pour ne jamais laisser une boucle s'emballer en coût/latence).
    let round = 0;
    while (data.stop_reason === 'tool_use' && round < MAX_TOOL_ROUNDS) {
      round += 1;
      const toolUseBlocks = data.content.filter((b: any) => b.type === 'tool_use');

      messages.push({ role: 'assistant', content: data.content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block: any) => {
          const result = await executeTool(block.name, block.input, user_id, attachedDocument, user?.company_id || null, authedUser.locale);
          if (block.name === 'sauvegarder_document' && (result as any)?.success) {
            documentSaved = true;
          }
          if (block.name === 'mettre_a_jour_profil_entreprise' && (result as any)?.success) {
            profileUpdated = true;
          }
          if (block.name === 'proposer_ajout_profil') {
            profileUpdateProposal = String(block.input?.synthese || '').trim() || null;
          }
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          };
        })
      );

      messages.push({ role: 'user', content: toolResults });

      data = await callClaude(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: systemBlocks,
          tools: [...CHAT_TOOLS, CHAT_WEB_SEARCH_TOOL],
          messages,
        },
        // Imputation au commercial pour la jauge de Mon équipe (01/09/2026).
        user?.company_id || null, undefined, user_id
      );
    }
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? "Plafond de dépense API du jour atteint pour ta société — ça repart automatiquement demain."
              : "Le plafond de dépense API mensuel de ta société est atteint — contacte ton administrateur.",
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (suggestion.isSuggestion && user?.company_id) {
    await supabaseAdmin.from('feedback_messages').insert({
      user_id,
      company_id: user.company_id,
      message: suggestion.summary || effectiveMessage,
      source: 'chat_auto',
      context: effectiveMessage,
    });
  }

  // Dernier bloc "text" plutôt que le premier (changement du 29/08/2026, ajout
  // de CHAT_WEB_SEARCH_TOOL ci-dessus) : quand Aaron fait une recherche web, la
  // réponse peut contenir PLUSIEURS blocs "text" entrecoupés de blocs
  // server_tool_use/web_search_tool_result (ex: un texte intermédiaire avant de
  // relancer une recherche, puis le texte final) — prendre le premier renverrait
  // un texte tronqué/prématuré au commercial. Sans recherche web, il n'y a
  // normalement qu'un seul bloc "text" : ce changement ne modifie rien pour ce
  // cas, qui reste le plus courant.
  const textBlocks = data.content.filter((b: any) => b.type === 'text');
  const textBlock = textBlocks[textBlocks.length - 1];
  // Filet de sécurité : si la limite de tours d'outils a été atteinte sans que le
  // modèle ait produit de texte final, on répond quand même quelque chose de
  // sensé plutôt qu'une bulle vide dans le chat.
  const reply = textBlock?.text || (data.stop_reason === 'tool_use' ? "Je n'ai pas réussi à finaliser ma réponse — peux-tu reformuler ta question ?" : '');

  // Persiste l'échange (voir migration_chat_history_2026-08-13.sql) pour que
  // app/app/chat/page.jsx puisse le retrouver après un remount (navigation vers
  // une autre page, fermeture d'onglet...) au lieu de repartir d'une conversation
  // vide. Attendu (pas fire-and-forget) : sur une plateforme serverless, le
  // travail lancé après la réponse HTTP n'est pas garanti de s'exécuter jusqu'au
  // bout. Ne bloque jamais la réponse au commercial si cette écriture échoue.
  const rowsToInsert: { user_id: string; conversation_id: string; role: string; content: string }[] = [
    { user_id, conversation_id, role: 'user', content: effectiveMessage },
  ];
  if (reply) rowsToInsert.push({ user_id, conversation_id, role: 'assistant', content: reply });
  const { error: historyError } = await supabaseAdmin.from('chat_messages').insert(rowsToInsert);
  if (historyError) console.error('Erreur persistance chat_messages:', historyError.message);

  // Voir le commentaire équivalent dans app/api/chat-history/route.ts : fait
  // remonter la conversation en haut de liste et lui donne un titre auto
  // (premier message du commercial) si elle n'en a pas encore.
  const { data: existingConversation } = await supabaseAdmin
    .from('chat_conversations')
    .select('title')
    .eq('id', conversation_id)
    .maybeSingle();
  const conversationUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
  if (existingConversation && !existingConversation.title) {
    conversationUpdate.title = effectiveMessage.trim().slice(0, 60);
  }
  await supabaseAdmin.from('chat_conversations').update(conversationUpdate).eq('id', conversation_id);

  // document_saved indique au frontend (app/app/chat/page.jsx) qu'il peut
  // retirer le chip "document joint" — le document vient d'être écrit dans
  // company_documents par l'outil sauvegarder_document ci-dessus.
  return NextResponse.json({
    reply,
    document_saved: documentSaved,
    profile_updated: profileUpdated,
    profile_update_proposal: profileUpdateProposal,
  });
}
