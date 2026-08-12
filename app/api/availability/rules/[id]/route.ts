// app/api/availability/rules/[id]/route.ts
// DELETE -> supprime une règle de disponibilité récurrente.
// Vérifie que la règle appartient bien au user_id fourni avant de la supprimer.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: rule } = await supabaseAdmin
    .from('availability_rules')
    .select('id, user_id')
    .eq('id', params.id)
    .maybeSingle();

  if (!rule || rule.user_id !== userId) {
    return NextResponse.json({ error: 'Règle introuvable' }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from('availability_rules').delete().eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
