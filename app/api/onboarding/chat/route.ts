// app/api/onboarding/chat/route.ts
//
// LE QUESTIONNAIRE DE BIENVENUE EST UNE CONVERSATION (décision Alex,
// 08/11/2026 : « Aaron doit être capable de répondre aux questions, de faire
// plusieurs échanges avant de confirmer, et avant chaque validation reprendre
// proprement ce que l'utilisateur a dit… comme un échange entre un
// utilisateur et un expert commercial »).
//
// POST { question_key, question, history: [{role:'user'|'aaron', content}],
//        message, locale, draft? }
//  -> { kind: 'ask' | 'propose', message, proposed_answer }
//
//   - 'ask'     : l'utilisateur a posé une question, n'a pas compris, ou sa
//                 réponse est trop vague pour être utile : Aaron explique,
//                 donne un exemple, et repose la question autrement. Rien
//                 n'est validé.
//   - 'propose' : Aaron a compris : il reformule proprement (« Ok, donc tu
//                 es … ») et propose `proposed_answer`, le texte qui sera
//                 enregistré si l'utilisateur confirme. L'utilisateur peut
//                 encore compléter : on repasse ici avec l'historique.
//
// Reste dans le métier : une question politique, personnelle ou hors sujet
// reçoit une réponse courte qui ramène à la question en cours.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { readJsonBody } from '@/lib/http';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction, normalizeLocale } from '@/lib/locale-instruction';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Turn = { role: 'user' | 'aaron'; content: string };

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { question_key, question, history, message, locale, draft, company_name } = await readJsonBody(request);
  if (typeof question !== 'string' || !question.trim()) {
    return NextResponse.json({ error: 'question manquante' }, { status: 400 });
  }
  const turns: Turn[] = Array.isArray(history)
    ? history.filter((t: any) => t && (t.role === 'user' || t.role === 'aaron') && typeof t.content === 'string').slice(-12)
    : [];
  const userMessage = typeof message === 'string' ? message.trim().slice(0, 3000) : '';
  if (!userMessage) return NextResponse.json({ error: 'message manquant' }, { status: 400 });
  const lang = normalizeLocale(typeof locale === 'string' ? locale : null);

  const transcript = [...turns, { role: 'user', content: userMessage }]
    .map((t) => `${t.role === 'user' ? 'UTILISATEUR' : 'AARON'} : ${t.content}`)
    .join('\n');

  const prompt =
    `Tu es Aaron, expert commercial et copilote de vente. Tu aides un dirigeant ou un commercial à remplir la fiche de son entreprise, question par question, dans une conversation. ` +
    `Tu tutoies, tu es chaleureux, concret et bref (2 à 4 phrases), jamais condescendant. ${localeInstruction(lang)}\n\n` +
    `QUESTION EN COURS (clé « ${String(question_key || '')} ») : « ${question.trim()} »\n` +
    (company_name ? `Entreprise de l'utilisateur : ${String(company_name).slice(0, 120)}\n` : '') +
    (typeof draft === 'string' && draft.trim() ? `Réponse pré-remplie depuis un document de l'utilisateur (peut servir de base) : « ${draft.trim().slice(0, 800)} »\n` : '') +
    `\nCONVERSATION SUR CETTE QUESTION :\n${transcript}\n\n` +
    `Décide :\n` +
    `- Si le dernier message de l'utilisateur est une question, une incompréhension (« je n'ai pas compris », « c'est-à-dire ? »), ou une réponse trop vague pour servir (« oui », « normal », un mot), réponds en EXPERT : explique ce que la question cherche et pourquoi ça aide Aaron à prospecter, donne un ou deux exemples concrets adaptés à son métier s'il est connu, puis repose la question simplement. kind = "ask", proposed_answer = null.\n` +
    `- Si le dernier message (avec le reste de la conversation) répond à la question, même partiellement mais utilement : reformule proprement ce que tu as compris, à la deuxième personne (« Ok, donc tu … », « Si je résume, … »), en une ou deux phrases, et termine par une question de confirmation (« C'est bien ça ? » ou « Tu veux ajouter quelque chose ? »). kind = "propose", proposed_answer = la réponse NETTOYÉE à enregistrer, rédigée à la troisième personne ou de façon neutre (ex. « Traiteur événementiel à Lyon, 18 salariés, mariages et séminaires d'entreprise »), fidèle à ce qu'il a dit, sans rien inventer, 1 à 3 phrases.\n` +
    `- Si l'utilisateur complète une réponse déjà proposée, intègre le complément et repropose (kind = "propose").\n` +
    `- Hors sujet (politique, personnel, sans rapport avec son activité) : une phrase polie qui ramène à la question, kind = "ask".\n` +
    `Réponds UNIQUEMENT avec un objet JSON : {"kind": "ask" | "propose", "message": "ce que tu dis à l'utilisateur", "proposed_answer": "texte à enregistrer" | null}`;

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-5',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      },
      authedUser.company_id || null,
      undefined,
      authedUser.id,
      'saisie_campagne'
    );
    const raw = (data?.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('').trim();
    const jsonText = raw.startsWith('{') ? raw : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonText);
    const kind = parsed.kind === 'propose' && typeof parsed.proposed_answer === 'string' && parsed.proposed_answer.trim() ? 'propose' : 'ask';
    return NextResponse.json({
      kind,
      message: String(parsed.message || '').trim(),
      proposed_answer: kind === 'propose' ? String(parsed.proposed_answer).trim() : null,
    });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json({ error: 'Plafond de dépense atteint pour ce mois.' }, { status: 429 });
    }
    console.error('[onboarding/chat]', err?.message || err);
    return NextResponse.json({ error: 'Aaron ne répond pas pour le moment, réessaie.' }, { status: 500 });
  }
}
