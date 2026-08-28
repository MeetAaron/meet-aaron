// app/api/crm-connections/custom-chat/route.ts
// POST -> conversation avec Aaron pour cadrer une demande de CRM sur-mesure
// (docx item 27 / tâche #139). Remplace l'ancienne case "Ajouter un autre
// CRM" en texte libre : Aaron pose des questions une par une (nom du CRM,
// données à synchroniser, accès disponible côté commercial, détails
// techniques utiles), puis propose un récapitulatif. Ce chantier NE construit
// PAS d'intégration réelle (impossible de deviner l'API d'un CRM inconnu à
// l'avance) — le but est de récolter une demande bien cadrée, que le
// frontend transmet ensuite au patron via la boîte à suggestions déjà
// existante (POST /api/feedback), comme le faisait le formulaire texte libre
// qu'il remplace.
//
// Même schéma que app/api/campaigns/chat/route.ts (conversation sans état
// persistant côté serveur : le frontend renvoie l'historique complet à
// chaque tour, Aaron répond avec un texte + un bloc caché <!--topic:XXX-->
// pendant les questions, puis un bloc ```custom_crm_json``` en clair une
// fois le récapitulatif prêt).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError, withCacheBreakpoint } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

const CUSTOM_CRM_CHAT_SYSTEM_PROMPT = `Tu es Aaron, copilote commercial IA. Un commercial ou le fondateur d'une petite entreprise veut connecter un CRM qui n'est pas dans la liste des intégrations déjà proposées par l'application (HubSpot, Salesforce, Pipedrive, Jobber, Axonaut, Sellsy, Housecall Pro, Capsule CRM, ServiceM8). Ton rôle ici est UNIQUEMENT de récolter les informations nécessaires pour que l'équipe technique de l'application puisse ensuite construire cette intégration — tu ne peux pas la construire toi-même dans cette conversation, ne le promets jamais. Tutoie la personne, sois chaleureux et concret, comme un collègue technique qui aide à cadrer une demande.

Règles impératives :
- Pose UNE SEULE question à la fois. Jamais deux questions dans le même message.
- Couvre, dans un ordre naturel adapté à la conversation :
  1. Le nom exact du CRM (et son secteur/pays si ce n'est pas un CRM très connu).
  2. Quelles données il/elle voudrait synchroniser avec ce CRM (ex : les prospects/contacts, les opportunités gagnées, les deux, autre chose de précis).
  3. Quel type d'accès il/elle a côté CRM : une clé API, un compte développeur/OAuth, ou s'il/elle ne sait pas encore et qu'il faudra vérifier avec le support du CRM.
  4. S'il/elle a un lien vers la documentation de l'API de ce CRM, ou tout autre détail technique utile (nom exact du champ à synchroniser, format particulier attendu, etc.) — précise que c'est optionnel, "je ne sais pas" est une réponse tout à fait valable.
- Dès que tu as le nom du CRM et au moins une idée des données à synchroniser, tu peux proposer un récapitulatif même si l'accès ou les détails techniques restent flous (indique-le simplement dans les notes).
- CHAQUE message où tu poses encore une question (pas le récapitulatif final) doit se terminer par UNE ligne cachée, seule sur sa ligne, au format \`<!--topic:XXX-->\` où XXX est LE SUJET de la question que tu es en train de poser, parmi exactement : nom, donnees, acces, details. Cette ligne sert à afficher des suggestions cliquables à l'écran — elle est retirée avant affichage, ne la mentionne jamais et ne romps jamais ce format.
- Le récapitulatif doit TOUJOURS se terminer par un bloc de code au format suivant, sans rien d'autre après :

\`\`\`custom_crm_json
{"crm_name": "...", "data_to_sync": ["..."], "auth_method": "...", "notes": "..."}
\`\`\`

  Où :
  - crm_name : nom du CRM tel que donné par la personne.
  - data_to_sync : tableau de 1 à 5 éléments courts décrivant les données à synchroniser (ex: ["prospects/contacts", "opportunités gagnées"]).
  - auth_method : description courte de l'accès disponible (ex: "clé API disponible", "compte développeur/OAuth à créer", "ne sait pas encore, à vérifier avec le support du CRM").
  - notes : 1-3 phrases résumant les détails techniques utiles mentionnés (lien doc, champs précis...), ou null si rien de plus à ajouter.

- Si la personne réagit à un récapitulatif déjà proposé pour le CORRIGER, ne repose pas les questions déjà répondues : ajuste directement et renvoie un nouveau texte + bloc \`\`\`custom_crm_json\`\`\` mis à jour (pas de ligne \`<!--topic:...-->\` sur un récapitulatif).
- Le bloc \`\`\`custom_crm_json\`\`\` ne doit apparaître QUE quand tu proposes/mets à jour un récapitulatif — jamais pendant que tu poses encore des questions.`;

function buildSystemPrompt(locale: string): string {
  return `${CUSTOM_CRM_CHAT_SYSTEM_PROMPT}

Réponds ${localeInstruction(locale)} — mais garde bien le vocabulaire fixe de la ligne \`<!--topic:XXX-->\` (nom, donnees, acces, details) exactement tel quel, quelle que soit la langue de la réponse : c'est lu par le code, pas affiché tel quel.`;
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

  // Optimisation coût API (28/08/2026, demande Alex) : point de coupure de
  // cache sur le dernier message de l'historique déjà envoyé, voir
  // withCacheBreakpoint (lib/anthropic-client.ts) et le même mécanisme sur le
  // "system" juste en dessous.
  const conversationMessages = [
    ...withCacheBreakpoint(
      (Array.isArray(history) ? history : []).map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }))
    ),
    { role: 'user', content: message },
  ];

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: [
          { type: 'text', text: buildSystemPrompt(authedUser.locale), cache_control: { type: 'ephemeral' } },
        ],
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
              ? "Plafond de dépense API du jour atteint pour ta société — ça repart automatiquement demain."
              : "Le plafond de dépense API mensuel de ta société est atteint — contacte ton administrateur.",
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }
}
