// app/api/availability/blocks/[id]/route.ts
// DELETE -> supprime une indisponibilité ponctuelle.
// Vérifie que le block appartient bien au user_id fourni avant de le supprimer.

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

  const { data: block } = await supabaseAdmin
    .from('availability_blocks')
    .select('id, user_id')
    .eq('id', params.id)
    .maybeSingle();

  if (!block || block.user_id !== userId) {
    return NextResponse.json({ error: 'Indisponibilité introuvable' }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from('availability_blocks').delete().eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
