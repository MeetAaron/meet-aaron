// app/api/chat-history/route.ts
// GET  -> relit l'historique de chat déjà persisté (dont la progression du
//         questionnaire de découverte guidé), pour hydrater app/app/chat/page.jsx
//         au chargement plutôt que de repartir d'une conversation vide.
// POST -> ajoute un ou plusieurs messages à l'historique, et met à jour la
//         progression du questionnaire guidé si fournie.
//
// Contexte : voir migration_chat_history_2026-08-13.sql. Avant cette route,
// `messages`/`onboardingStep`/`onboardingAnswers` n'existaient qu'en state React
// local dans app/app/chat/page.jsx — perdus au moindre remount (ex: navigation
// vers "Mes documents" puis retour).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

// Nombre de messages les plus récents renvoyés/conservés en contexte — évite
// qu'une conversation très longue (des mois d'historique) fasse grossir sans
// limite le coût en tokens à chaque appel à Claude (voir /api/chat).
const HISTORY_LIMIT = 60;

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: messagesDesc, error: messagesError } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('onboarding_step, onboarding_answers')
    .eq('id', userId)
    .single();

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }

  return NextResponse.json({
    messages: (messagesDesc || []).slice().reverse().map((m) => ({ role: m.role, content: m.content })),
    onboarding_step: user?.onboarding_step ?? -1,
    onboarding_answers: user?.onboarding_answers ?? [],
  });
}

export async function POST(request: NextRequest) {
  const { user_id, messages, onboarding_step, onboarding_answers } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  if (Array.isArray(messages) && messages.length > 0) {
    const rows = messages
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m: any) => ({ user_id, role: m.role, content: m.content }));

    if (rows.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('chat_messages').insert(rows);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }
  }

  if (onboarding_step !== undefined || onboarding_answers !== undefined) {
    const update: Record<string, any> = {};
    if (onboarding_step !== undefined) update.onboarding_step = onboarding_step;
    if (onboarding_answers !== undefined) update.onboarding_answers = onboarding_answers;

    const { error: updateError } = await supabaseAdmin.from('users').update(update).eq('id', user_id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
