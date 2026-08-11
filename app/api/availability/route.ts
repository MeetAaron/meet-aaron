// app/api/availability/route.ts
// GET -> renvoie les règles hebdomadaires + les indisponibilités ponctuelles
// du commercial connecté.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const [rulesRes, blocksRes] = await Promise.all([
    supabaseAdmin
      .from('availability_rules')
      .select('*')
      .eq('user_id', userId)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true }),
    supabaseAdmin
      .from('availability_blocks')
      .select('*')
      .eq('user_id', userId)
      .gte('end_at', new Date().toISOString())
      .order('start_at', { ascending: true }),
  ]);

  if (rulesRes.error) {
    return NextResponse.json({ error: rulesRes.error.message }, { status: 500 });
  }
  if (blocksRes.error) {
    return NextResponse.json({ error: blocksRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ rules: rulesRes.data || [], blocks: blocksRes.data || [] });
}
