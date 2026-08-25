// app/api/chat-conversations/route.ts
// GET  -> liste les conversations de chat d'un commercial (les plus
//         favorites/récentes en premier), avec un court aperçu du dernier
//         message pour l'affichage dans app/app/chat/page.jsx.
// POST -> crée une nouvelle conversation vide ("Nouvelle conversation",
//         demande d'Alex du 25/08/2026).
//
// Voir migration_chat_conversations_2026-08-25.sql pour le contexte complet
// (notamment le choix de conservation illimitée, sans purge automatique).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

const PREVIEW_LENGTH = 80;

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: conversations, error } = await supabaseAdmin
    .from('chat_conversations')
    .select('id, title, is_favorite, created_at, updated_at')
    .eq('user_id', userId)
    .order('is_favorite', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aperçu du dernier message de chaque conversation — une seule requête
  // (DISTINCT ON, triée par conversation puis date décroissante) plutôt qu'une
  // requête par conversation.
  const { data: lastMessages } = await supabaseAdmin
    .from('chat_messages')
    .select('conversation_id, role, content, created_at')
    .eq('user_id', userId)
    .not('conversation_id', 'is', null)
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: false });

  const previewByConversation: Record<string, string> = {};
  for (const m of lastMessages || []) {
    if (!m.conversation_id || previewByConversation[m.conversation_id]) continue;
    const clean = (m.content || '').replace(/\s+/g, ' ').trim();
    previewByConversation[m.conversation_id] =
      clean.length > PREVIEW_LENGTH ? `${clean.slice(0, PREVIEW_LENGTH)}…` : clean;
  }

  return NextResponse.json({
    conversations: (conversations || []).map((c) => ({
      ...c,
      preview: previewByConversation[c.id] || null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: conversation, error } = await supabaseAdmin
    .from('chat_conversations')
    .insert({ user_id })
    .select('id, title, is_favorite, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversation: { ...conversation, preview: null } });
}
