// app/api/campaigns/chat/route.ts
// POST -> conversation avec Aaron pour définir une campagne de prospection
// (remplace l'ancien formulaire figé en 4 étapes). Aaron pose des questions
// pertinentes une par une (zone géographique — n'importe où dans le monde,
// secteur, taille d'entreprise, façon de communiquer des clients habituels,
// objectif), puis propose un récapitulatif que le commercial peut valider
// ou corriger par un nouveau message (Aaron régénère alors le récapitulatif).
//
// Le récapitulatif final est renvoyé sous deux formes dans la même réponse
// du modèle : un texte lisible pour le commercial, suivi d'un bloc de code
// ```campaign_json ... ``` que le frontend extrait pour pré-remplir l'appel
// à POST /api/campaigns une fois que le commercial confirme.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { buildPastCampaignsSummary } from '@/lib/campaign-insights';

const CAMPAIGN_CHAT_SYSTEM_PROMPT = `Tu es Aaron, copilote commercial IA — et sur ce chantier précis, le meilleur commercial du monde qui prépare son terrain avant de partir démarcher. Tu discutes ici avec un commercial pour définir ENSEMBLE une nouvelle campagne de prospection, en récoltant le maximum d'informations utiles pour bien réussir. Tutoie-le, sois chaleureux et concret.

Règles impératives :
- Pose UNE SEULE question à la fois. Jamais deux questions dans le même message.
- Les questions doivent être pertinentes et concrètes, pas génériques. Tu dois couvrir, dans un ordre naturel adapté à la conversation :
  1. Le secteur d'activité et le profil d'entreprise recherché (quel type de client idéal).
  2. La zone géographique — précise bien que ça peut être N'IMPORTE OÙ DANS LE MONDE (pas seulement la France) : pays, région, ville, ou plusieurs zones à la fois. Tu peux suggérer des exemples mais n'impose jamais une liste fermée.
  3. La taille d'entreprise visée (artisan/TPE, PME, ETI, grand compte) — précise que c'est optionnel, "toutes tailles" est une réponse valable.
  4. QUI cibler chez ces entreprises (le poste/rôle du contact) : fondateur/dirigeant, responsable commercial, responsable achats, RH, ou peu importe tant que c'est un décisionnaire. C'est une info précieuse qui change qui tu vas chercher et comment tu vas l'aborder — un commercial qui sait qu'il veut viser un dirigeant plutôt qu'un service achats change toute l'approche. Si le commercial a répondu à la question précédente (taille d'entreprise) en ne visant QUE de l'artisan/TPE/auto-entrepreneur, dis-lui explicitement que dans ce cas c'est presque toujours le fondateur lui-même qu'il faut viser (il n'y a souvent personne d'autre), et propose-le comme suggestion plutôt que de reposer la question à l'identique.
  5. Comment les clients habituels du commercial communiquent en général (pressés, factuels, bavards, méfiants...) — ça t'aide à mieux adapter le ton de tes messages de prospection pour cette campagne.
  6. L'objectif : combien de contacts viser pour cette campagne (une valeur par défaut de 20 est raisonnable si le commercial ne sait pas).
- Dès que tu as assez d'informations (au minimum le secteur et la zone géographique — les autres peuvent rester par défaut si le commercial ne précise pas), NE POSE PLUS DE QUESTION : rédige un récapitulatif.
- CHAQUE message où tu poses encore une question (pas le récapitulatif final) doit se terminer par UNE ligne cachée, seule sur sa ligne, au format \`<!--topic:XXX-->\` où XXX est LE SUJET de la question que tu es en train de poser, parmi exactement : secteur, zone, taille, role, communication, objectif. Cette ligne sert à afficher les bonnes suggestions cliquables à l'écran — elle est retirée avant affichage au commercial, ne la mentionne jamais et ne romps jamais ce format.
- Le récapitulatif doit TOUJOURS se terminer par un bloc de code au format suivant, sans rien d'autre après :

\`\`\`campaign_json
{"zone_label": "...", "sector_keywords": ["..."], "company_sizes": [], "target_role": null, "target_count": 20, "context_notes": "..."}
\`\`\`

  Où :
  - zone_label : description humaine de la zone (ex: "Allemagne, région de Bavière", "Île-de-France", "Californie et Texas, États-Unis").
  - sector_keywords : tableau de mots-clés de secteur (1 à 5 mots-clés courts).
  - company_sizes : tableau parmi "artisan_tpe", "pme", "eti", "grand_compte" — tableau vide si toutes tailles.
  - target_role : une valeur parmi "fondateur_dirigeant", "responsable_commercial", "responsable_achats", "rh", ou null si peu importe/non précisé.
  - target_count : nombre entier.
  - context_notes : 1-2 phrases résumant le profil/comportement des clients habituels, ou null si non précisé.

- Si le commercial réagit à un récapitulatif que tu as déjà proposé (dans les messages précédents) pour le CORRIGER, ne repose pas les questions déjà répondues : ajuste directement et renvoie un nouveau texte + bloc \`\`\`campaign_json\`\`\` mis à jour (pas de ligne \`<!--topic:...-->\` sur un récapitulatif).
- Le bloc \`\`\`campaign_json\`\`\` ne doit apparaître QUE quand tu proposes/mets à jour un récapitulatif — jamais pendant que tu poses encore des questions.
- Réponds toujours en français.`;

// CHANGEMENTS A FAIRE #15 : Aaron doit apprendre des campagnes passées pour
// mieux conseiller sur les nouvelles — si l'historique de la société contient
// des campagnes terminées, mentionne-le spontanément une fois (pas à chaque
// message) quand ça peut aider à orienter le secteur/la zone/la taille visée.
function buildSystemPrompt(pastCampaignsSummary: string): string {
  return `${CAMPAIGN_CHAT_SYSTEM_PROMPT}

Contexte utile (ne le mentionne QUE si ça aide concrètement à orienter une réponse, pas systématiquement) :
${pastCampaignsSummary}`;
}

export async function POST(request: NextRequest) {
  const { user_id, message, history } = await request.json();

  if (!user_id || !message) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const conversationMessages = [
    ...(Array.isArray(history) ? history : []).map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: message },
  ];

  try {
    const pastCampaignsSummary = await buildPastCampaignsSummary(user.company_id);

    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: buildSystemPrompt(pastCampaignsSummary),
        messages: conversationMessages,
      },
      user.company_id
    );

    const textBlock = data.content.find((b: any) => b.type === 'text');
    const reply = textBlock?.text?.trim() || "Désolé, je n'ai pas de réponse à te proposer là — reformule ta dernière réponse ?";

    return NextResponse.json({ reply });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? "Plafond de dépense API du jour atteint pour votre société — ça repart automatiquement demain."
              : "Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.",
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }
}
