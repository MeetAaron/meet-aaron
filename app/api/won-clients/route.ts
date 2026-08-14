// app/api/won-clients/route.ts
// GET -> liste les prospects devenus clients gagnés pour un commercial

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

  const { data: wonClients, error } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name, domain)')
    .eq('assigned_user_id', userId)
    // Client à part entière = 1ère commande confirmée (pas juste "gagné" —
    // voir migration_first_order_confirmed_2026-08-14.sql).
    .not('first_order_confirmed_at', 'is', null)
    .order('won_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ wonClients });
}
