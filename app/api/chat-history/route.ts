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
  let conversationId = request.nextUrl.searchParams.get('conversation_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  // Client historique/périmé sans conversation_id (voir chat-conversations,
  // 25/08/2026) : on retombe sur la conversation la plus récente de ce
  // commercial plutôt que d'échouer.
  if (!conversationId) {
    const { data: fallback } = await supabaseAdmin
      .from('chat_conversations')
      .select('id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    conversationId = fallback?.id || null;
  }

  if (!conversationId) {
    return NextResponse.json({ messages: [], onboarding_step: -1, onboarding_answers: [] });
  }

  const { data: messagesDesc, error: messagesError } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
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
    // created_at renvoyé depuis le 01/09/2026 : le chat façon messagerie
    // (bulles groupées, séparateurs de jour, heure sous le dernier message
    // d'un groupe) en a besoin — voir app/app/chat/page.jsx.
    messages: (messagesDesc || []).slice().reverse().map((m) => ({ role: m.role, content: m.content, created_at: m.created_at })),
    onboarding_step: user?.onboarding_step ?? -1,
    onboarding_answers: user?.onboarding_answers ?? [],
  });
}

export async function POST(request: NextRequest) {
  const { user_id, conversation_id, messages, onboarding_step, onboarding_answers } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }
  if (!conversation_id && Array.isArray(messages) && messages.length > 0) {
    return NextResponse.json({ error: 'conversation_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  if (Array.isArray(messages) && messages.length > 0) {
    // created_at explicite et décalé d'une milliseconde par message
    // (03/09/2026, inversion constatée par Alex : la question du
    // questionnaire s'affichait AVANT la phrase d'introduction qui la
    // précède). Cause : tous les messages d'un même envoi étaient insérés
    // avec le created_at par défaut — donc la MÊME valeur — et le GET les
    // trie sur cette colonne. À égalité, Postgres ne garantit aucun ordre :
    // deux messages postés ensemble pouvaient donc ressortir inversés, au
    // hasard, d'un rechargement à l'autre.
    const batchStart = Date.now();
    const rows = messages
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m: any, index: number) => ({
        user_id,
        conversation_id,
        role: m.role,
        content: m.content,
        created_at: new Date(batchStart + index).toISOString(),
      }));

    if (rows.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('chat_messages').insert(rows);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      // Fait remonter la conversation en haut de la liste (triée par
      // updated_at, voir GET /api/chat-conversations) et lui donne un titre
      // auto (premier message du commercial, tronqué) si elle n'en a pas
      // encore — mêmes règles qu'un nouveau titre généré par /api/chat.
      const firstUserMessage = rows.find((r) => r.role === 'user')?.content || null;
      const { data: existing } = await supabaseAdmin
        .from('chat_conversations')
        .select('title')
        .eq('id', conversation_id)
        .maybeSingle();
      const titleUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
      if (existing && !existing.title && firstUserMessage) {
        titleUpdate.title = firstUserMessage.trim().slice(0, 60);
      }
      await supabaseAdmin.from('chat_conversations').update(titleUpdate).eq('id', conversation_id);
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
