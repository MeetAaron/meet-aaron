// app/api/availability/blocks/[id]/route.ts
// DELETE -> supprime une indisponibilité ponctuelle.
// PATCH  -> modifie une indisponibilité existante (dates/raison), sans passer
//           par supprimer-puis-recréer (docx "AGENDA" item A3 : "je dois
//           pouvoir supprimer la ligne ou la modifier").
// Les deux vérifient que le block appartient bien au user_id fourni.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json();
  const userId = body.user_id;
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

  const update: Record<string, any> = {};
  if (typeof body.start_at === 'string') update.start_at = body.start_at;
  if (typeof body.end_at === 'string') update.end_at = body.end_at;
  if (body.reason !== undefined) update.reason = body.reason || null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('availability_blocks')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ block: updated });
}

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
