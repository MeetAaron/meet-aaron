// app/api/welcome/prefill/route.ts
// POST (multipart : file) -> pré-remplit les 12 réponses du questionnaire de
// découverte à partir d'un document déjà prêt (présentation, plaquette,
// profil d'entreprise en PDF / Word / RTF).
//
// Parcours de première connexion (21/10/2026, Alex : « le dépôt d'un document
// reste proposé en haut de l'écran pour pré-remplir »). Aaron lit le document
// et propose une réponse par question QUAND le document la contient ;
// l'utilisateur relit, corrige ou complète chaque réponse avant de valider.
// Rien n'est enregistré ici : les réponses ne sont gardées qu'une fois
// validées par l'utilisateur (POST /api/welcome).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { extractFullDocumentText } from '@/lib/document-extraction';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';
import { serverError } from '@/lib/http';

const ACCEPTED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
]);
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const questionsRaw = formData.get('questions') as string | null;
  if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
  if (!ACCEPTED_MIMES.has(file.type)) return NextResponse.json({ error: 'unsupported_format' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 400 });

  // Les questions viennent du client (dans la langue de l'interface), avec
  // leur clé : [{ key, question }]. On ne garde que des clés connues.
  let questions: { key: string; question: string }[] = [];
  try {
    const parsed = JSON.parse(questionsRaw || '[]');
    if (Array.isArray(parsed)) {
      questions = parsed
        .filter((q) => q && typeof q.key === 'string' && /^chat\.onboarding[A-Za-z0-9]+$/.test(q.key) && typeof q.question === 'string')
        .slice(0, 20)
        .map((q) => ({ key: q.key, question: q.question.slice(0, 400) }));
    }
  } catch {
    questions = [];
  }
  if (questions.length === 0) return NextResponse.json({ error: 'Questions manquantes' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const text = await extractFullDocumentText(buffer, file.type);
  if (!text || text.trim().length < 30) return NextResponse.json({ error: 'unreadable' }, { status: 422 });

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', authedUser.id).maybeSingle();

  const prompt =
    `Voici un document décrivant l'entreprise d'un utilisateur (présentation, plaquette ou profil). ` +
    `Pour CHAQUE question ci-dessous, rédige la réponse que l'utilisateur donnerait, à la première personne, ` +
    `UNIQUEMENT à partir du document. Si le document ne permet pas de répondre, mets null : n'invente rien.\n\n` +
    `QUESTIONS :\n${questions.map((q) => `- [${q.key}] ${q.question}`).join('\n')}\n\n` +
    `DOCUMENT :\n"""\n${text.trim().slice(0, 24000)}\n"""\n\n` +
    `Rédige les réponses ${localeInstruction(authedUser.locale)}, une à trois phrases chacune.\n` +
    `Réponds UNIQUEMENT avec un objet JSON, sans texte autour : {"<clé>": "réponse ou null", ...}`;

  try {
    const data = await callClaude(
      { model: 'claude-haiku-4-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] },
      user?.company_id || null,
      undefined,
      authedUser.id
    );
    const out = data.content.filter((b: any) => b.type === 'text').pop()?.text || '';
    const match = out.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const v = parsed?.[q.key];
      if (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null') answers[q.key] = v.trim().slice(0, 1500);
    }
    return NextResponse.json({ answers, filled: Object.keys(answers).length, total: questions.length });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) return NextResponse.json({ error: 'cap' }, { status: 429 });
    return serverError(err, '/api/welcome/prefill');
  }
}
