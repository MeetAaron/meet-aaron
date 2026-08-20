// app/api/chat/onboarding-ack/route.ts
// POST -> génère UNE phrase courte d'accusé de réception intelligent pour le
// questionnaire d'onboarding d'Aaron (app/app/chat/page.jsx, ONBOARDING_
// QUESTION_KEYS), avant d'enchaîner sur la question suivante.
//
// CHANGEMENTS A FAIRE, section CHAT AVEC AARON, item A4 : le questionnaire
// était un script 100% local (7 questions fixes, aucun appel IA), qui
// enchaînait sur la question suivante quelle que soit la réponse — y
// compris quand la réponse remettait en cause la prémisse même de la
// question (exemple d'Alex : "un premier contact c'est déjà un rendez-vous
// non ?" en réponse à une question qui distinguait "obtenir un rendez-vous"
// d'un premier contact). Cette route ajoute UN appel IA léger par question
// (pas un vrai tour de conversation complet) pour produire une phrase
// d'accroche qui montre qu'Aaron a vraiment lu la réponse, avant que le
// frontend affiche la question suivante à la suite.
//
// Conçu pour rester bon marché et jamais bloquant : max_tokens réduit,
// aucune conséquence si le modèle échoue ou si le plafond de dépense API de
// la société est atteint — le frontend retombe alors sur l'ancien
// comportement (juste la question suivante, sans accroche).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

const SYSTEM_PROMPT = `Tu es Aaron, copilote commercial IA, en plein questionnaire de découverte avec un commercial/fondateur qui vient de répondre à une question de ce questionnaire.

Ta seule tâche : rédiger UNE SEULE phrase courte (pas de liste, pas de retour sur tout le contexte) qui montre que tu as vraiment lu et compris sa réponse, avant qu'une autre question lui soit posée juste après (affichée séparément, ne la répète jamais et ne la dévoile jamais).

Règles impératives :
- Jamais de formule générique creuse ("Merci !", "Noté !", "Parfait !") qui ignore le contenu réel de la réponse.
- Si la réponse remet en cause la prémisse de la question (elle conteste une distinction que la question supposait, ou répond "ça n'a pas de sens pour mon métier" etc.), reconnais-le explicitement et adapte-toi à SA façon de voir les choses plutôt que d'enchaîner comme si de rien n'était.
- Si la réponse est simple et directe, une accroche brève suffit (ex: reformuler en une poignée de mots ce qu'il vient de dire, pour montrer que c'est bien pris en compte).
- Ne repose jamais la question déjà posée.
- Une seule phrase, jamais plus.`;

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
        max_tokens: 100,
        system: `${SYSTEM_PROMPT}\n\nRéponds ${localeInstruction(authedUser.locale)}.`,
        messages: [
          {
            role: 'user',
            content: `Question posée : "${question}"\nRéponse du commercial : "${answer}"`,
          },
        ],
      },
      user.company_id
    );

    const textBlock = data.content.find((b: any) => b.type === 'text');
    const ack = textBlock?.text?.trim() || null;
    return NextResponse.json({ ack });
  } catch (err) {
    // Best-effort : jamais bloquant pour le questionnaire (plafond de
    // dépense API atteint, erreur réseau, etc.) — le frontend enchaîne
    // simplement sans accroche dans ce cas. Pas de log d'erreur bruyant
    // pour un appel volontairement secondaire.
    const capped = err instanceof MonthlyCapExceededError;
    return NextResponse.json({ ack: null, capped });
  }
}
