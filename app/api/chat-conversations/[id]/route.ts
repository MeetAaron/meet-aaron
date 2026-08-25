// app/api/chat-conversations/[id]/route.ts
// PATCH -> bascule le favori (⭐) et/ou renomme une conversation.
// DELETE -> supprime définitivement une conversation et ses messages
//           (l'utilisateur n'est jamais obligé de la garder même si la
//           conservation par défaut est illimitée, voir la migration).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

async function loadOwnedConversation(id: string, userId: string) {
  const { data } = await supabaseAdmin.from('chat_conversations').select('id, user_id').eq('id', id).maybeSingle();
  if (!data || data.user_id !== userId) return null;
  return data;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { user_id, is_favorite, title } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const owned = await loadOwnedConversation(params.id, user_id);
  if (!owned) return NextResponse.json({ error: 'Conversation introuvable' }, { status: 404 });

  const update: Record<string, any> = {};
  if (typeof is_favorite === 'boolean') update.is_favorite = is_favorite;
  if (typeof title === 'string') update.title = title.trim().slice(0, 120) || null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Rien à mettre à jour' }, { status: 400 });
  }

  const { data: conversation, error } = await supabaseAdmin
    .from('chat_conversations')
    .update(update)
    .eq('id', params.id)
    .select('id, title, is_favorite, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversation });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const owned = await loadOwnedConversation(params.id, userId);
  if (!owned) return NextResponse.json({ error: 'Conversation introuvable' }, { status: 404 });

  // chat_messages.conversation_id référence chat_conversations(id) on delete
  // cascade — les messages de la conversation sont supprimés automatiquement.
  const { error } = await supabaseAdmin.from('chat_conversations').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
