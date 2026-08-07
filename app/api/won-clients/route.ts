// app/api/won-clients/route.ts
// GET -> liste les prospects devenus clients gagnés pour un commercial

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const { data: wonClients, error } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name, domain)')
    .eq('assigned_user_id', userId)
    .eq('is_won', true)
    .order('won_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ wonClients });
}
