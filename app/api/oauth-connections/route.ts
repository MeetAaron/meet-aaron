// app/api/oauth-connections/route.ts
// GET    -> liste les connexions OAuth (Google/Microsoft) d'un commercial, sans les tokens
// DELETE -> déconnecte un provider (via ?connection_id=...)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: connections, error } = await supabaseAdmin
    .from('oauth_connections')
    .select('id, provider, provider_account_email, scopes, created_at')
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connections });
}

export async function DELETE(request: NextRequest) {
  const connectionId = request.nextUrl.searchParams.get('connection_id');
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!connectionId || !userId) {
    return NextResponse.json({ error: 'connection_id et user_id requis' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  // Empêche de déconnecter la boîte mail d'un autre commercial en devinant un connection_id.
  const { error } = await supabaseAdmin
    .from('oauth_connections')
    .delete()
    .eq('id', connectionId)
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
