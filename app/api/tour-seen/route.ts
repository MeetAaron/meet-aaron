// app/api/tour-seen/route.ts
// POST -> marque la visite guidée comme vue pour cet utilisateur.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  await supabaseAdmin.from('users').update({ onboarding_tour_seen: true }).eq('id', user_id);

  return NextResponse.json({ success: true });
}
