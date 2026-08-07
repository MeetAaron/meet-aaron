// app/api/oauth-connections/route.ts
// GET    -> liste les connexions OAuth (Google/Microsoft) d'un commercial, sans les tokens
// DELETE -> déconnecte un provider (via ?connection_id=...)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

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
  if (!connectionId) {
    return NextResponse.json({ error: 'connection_id manquant' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('oauth_connections').delete().eq('id', connectionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
