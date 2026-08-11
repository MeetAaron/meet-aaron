// app/api/availability/blocks/route.ts
// POST -> crée une indisponibilité ponctuelle (ex: vacances, rendez-vous personnel).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const { user_id, start_at, end_at, reason } = await request.json();

  if (!user_id || !start_at || !end_at) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }

  if (new Date(start_at) >= new Date(end_at)) {
    return NextResponse.json({ error: 'La date de fin doit être après la date de début' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('availability_blocks')
    .insert({ user_id, start_at, end_at, reason: reason || null })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ block: data });
}
