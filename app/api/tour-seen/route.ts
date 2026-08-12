// app/api/tour-seen/route.ts
// POST -> marque la visite guidée comme vue pour cet utilisateur.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  await supabaseAdmin.from('users').update({ onboarding_tour_seen: true }).eq('id', user_id);

  return NextResponse.json({ success: true });
}
