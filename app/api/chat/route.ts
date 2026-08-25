// app/api/chat/route.ts
// POST -> le commercial discute directement avec Aaron (questions, demandes ponctuelles).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

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
choisir la catégorie, c'est à toi de la déduire. S'il dit non ou change de sujet, n'insiste pas et ne sauvegarde rien.`;

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
      },
      required: ['linked_category'],
    },
  },
];

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
  toolInput: any
) {
  if (!attachedDocument) {
    return { error: "Aucun document n'est actuellement joint à cette conversation." };
  }
  if (!companyId) {
    return { error: 'Société introuvable pour ce commercial.' };
  }

  const rawCategory = toolInput?.linked_category;
  const linkedCategory = ['prospects', 'opportunites', 'clients'].includes(rawCategory) ? rawCategory : null;

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
      linked_category: linkedCategory,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Erreur sauvegarde document (chat):', error.message);
    return { error: "Échec de la sauvegarde du document." };
  }

  return { success: true, document_id: doc.id };
}

async function executeTool(
  toolName: string,
  toolInput: any,
  userId: string,
  attachedDocument: AttachedDocument,
  companyId: string | null
) {
  switch (toolName) {
    case 'recherche_prospects':
      return runRechercheProspects(userId, toolInput?.query || '');
    case 'apercu_campagnes':
      return runApercuCampagnes(userId);
    case 'prochains_rdv':
      return runProchainsRdv(userId);
    case 'sauvegarder_document':
      return runSauvegarderDocument(attachedDocument, userId, companyId, toolInput);
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
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content:
              `Un commercial vient d'écrire ce message à Aaron (son copilote IA) :\n"""${message}"""\n\n` +
              `Ce message contient-il une suggestion, une idée d'amélioration, une remarque ou une plainte destinée ` +
              `au fondateur/à l'équipe (à propos de l'outil Meet Aaron, du produit, de l'organisation, etc.) — ` +
              `et PAS juste une question opérationnelle sur un prospect, un RDV ou une campagne ?\n` +
              `Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour : ` +
              `{"is_suggestion": true|false, "summary": "résumé en une phrase si true, sinon null"}`,
          },
        ],
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

  if (!user_id || !message) {
    return NextResponse.json({ error: 'user_id ou message manquant' }, { status: 400 });
  }
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
      .select('business_summary')
      .eq('id', user.company_id)
      .maybeSingle();
    if (company?.business_summary) {
      businessContext = `\n\nRésumé de l'activité de la société (généré précédemment à partir des documents et des explications du commercial) : ${company.business_summary}`;
    }
  }

  const messages: any[] = [
    ...(history || []).map((h: any) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
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
  let data;
  let suggestion;
  try {
    [data, suggestion] = await Promise.all([
      callClaude(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: systemBlocks,
          tools: CHAT_TOOLS,
          messages,
        },
        user?.company_id || null
      ),
      detectFounderSuggestion(message, user?.company_id || null),
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
          const result = await executeTool(block.name, block.input, user_id, attachedDocument, user?.company_id || null);
          if (block.name === 'sauvegarder_document' && (result as any)?.success) {
            documentSaved = true;
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
          tools: CHAT_TOOLS,
          messages,
        },
        user?.company_id || null
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
      message: suggestion.summary || message,
      source: 'chat_auto',
      context: message,
    });
  }

  const textBlock = data.content.find((b: any) => b.type === 'text');
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
    { user_id, conversation_id, role: 'user', content: message },
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
    conversationUpdate.title = message.trim().slice(0, 60);
  }
  await supabaseAdmin.from('chat_conversations').update(conversationUpdate).eq('id', conversation_id);

  // document_saved indique au frontend (app/app/chat/page.jsx) qu'il peut
  // retirer le chip "document joint" — le document vient d'être écrit dans
  // company_documents par l'outil sauvegarder_document ci-dessus.
  return NextResponse.json({ reply, document_saved: documentSaved });
}
