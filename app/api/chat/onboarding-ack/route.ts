// app/api/chat/onboarding-ack/route.ts
// POST -> analyse chaque message du commercial pendant le questionnaire de
// découverte d'Aaron (app/app/chat/page.jsx) pour décider s'il faut avancer à
// la question suivante ou rester sur place, avant d'enchaîner.
//
// CHANGEMENTS A FAIRE, section CHAT AVEC AARON, item A4, puis retour Alex
// (2026-08-25, capture d'écran à l'appui) : le questionnaire ne faisait
// qu'ACCUSER réception avant d'enchaîner systématiquement sur la question
// suivante, quel que soit le message reçu — y compris quand ce message était
// une VRAIE question du commercial ("c'est à dire ?") plutôt qu'une réponse.
// Résultat : Aaron ignorait la question et passait au sujet suivant comme un
// simple formulaire à cases, alors qu'Alex avait explicitement demandé une
// vraie interaction. Cette route classe maintenant chaque message en
// is_answer (true = une réponse, même partielle/imparfaite, à la question
// posée -> le frontend avance) ou false (une question, une incompréhension,
// un aparté -> Aaron doit clarifier/répondre et RE-présenter la même
// question, le frontend reste sur place et relance l'utilisateur dessus).
//
// Conçu pour rester bon marché et jamais bloquant : max_tokens réduit,
// dégradation silencieuse si le modèle échoue ou si le plafond de dépense
// API de la société est atteint — le frontend retombe alors sur l'ancien
// comportement (avance directement, sans accroche ni clarification).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

const SYSTEM_PROMPT = `Tu es Aaron, copilote commercial IA, en plein questionnaire de découverte avec un commercial/fondateur. Tu viens de lui poser une question de ce questionnaire, et il vient de répondre — mais "répondre" est à vérifier : c'est parfois une vraie réponse, parfois une question EN RETOUR, une incompréhension, ou un aparté sans lien.

Ta tâche a deux étapes :

1. Détermine si son message répond réellement à la question posée (même de façon brève, partielle ou imparfaite — ça compte comme une réponse), OU s'il s'agit plutôt d'une question, d'une demande de clarification, d'une incompréhension, ou d'un message hors sujet qui n'apporte AUCUNE réponse exploitable.

2. Rédige "reply" en conséquence :
   - Si c'est une réponse (is_answer=true) : UNE SEULE phrase courte qui montre que tu as vraiment lu et compris — jamais une formule générique creuse ("Merci !", "Noté !"). Si sa réponse remet en cause la prémisse de la question, reconnais-le explicitement et adapte-toi à sa façon de voir les choses. Ne répète jamais la question posée (une autre question sera affichée juste après, séparément — ne la devine pas et ne l'invente pas).
   - Si ce n'est PAS une réponse (is_answer=false) : réponds RÉELLEMENT à ce qu'il demande — explique, reformule la question avec d'autres mots ou un exemple concret, dissipe son incompréhension — comme le ferait un humain attentif qui n'a pas envie de brusquer la conversation. Termine ensuite en reposant clairement la question initiale (tu peux la reformuler, mais le sens doit rester exactement le même) pour qu'il sache qu'elle est toujours en attente de réponse.

Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour ni balises markdown :
{"is_answer": true|false, "reply": "..."}`;

export async function POST(request: NextRequest) {
  const { user_id, question, answer } = await request.json();

  if (!user_id || !question || !answer) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: `${SYSTEM_PROMPT}\n\nRéponds ${localeInstruction(authedUser.locale)}.`,
        messages: [
          {
            role: 'user',
            content: `Question posée : "${question}"\nMessage du commercial : "${answer}"`,
          },
        ],
      },
      user.company_id
    );

    const textBlock = data.content.find((b: any) => b.type === 'text');
    if (!textBlock) return NextResponse.json({ is_answer: true, reply: null });

    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json({
      is_answer: parsed.is_answer !== false,
      reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : null,
    });
  } catch (err) {
    // Best-effort : jamais bloquant pour le questionnaire (plafond de
    // dépense API atteint, erreur réseau, réponse JSON malformée...) — le
    // frontend enchaîne simplement sans accroche ni clarification dans ce
    // cas, exactement comme avant l'ajout de cette route.
    const capped = err instanceof MonthlyCapExceededError;
    return NextResponse.json({ is_answer: true, reply: null, capped });
  }
}
