// app/api/availability/rules/[id]/route.ts
// DELETE -> supprime une règle de disponibilité récurrente.
// PATCH  -> modifie une règle existante (jour/horaires/type de RDV), sans
//           passer par supprimer-puis-recréer (docx "AGENDA" item A3 :
//           "je dois pouvoir supprimer la ligne ou la modifier").
// Les deux vérifient que la règle appartient bien au user_id fourni.

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

  const { data: rule } = await supabaseAdmin
    .from('availability_rules')
    .select('id, user_id')
    .eq('id', params.id)
    .maybeSingle();

  if (!rule || rule.user_id !== userId) {
    return NextResponse.json({ error: 'Règle introuvable' }, { status: 404 });
  }

  const update: Record<string, any> = {};
  if (typeof body.day_of_week === 'number') update.day_of_week = body.day_of_week;
  if (typeof body.start_time === 'string') update.start_time = body.start_time;
  if (typeof body.end_time === 'string') update.end_time = body.end_time;
  if (body.appointment_type !== undefined) update.appointment_type = body.appointment_type || null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('availability_rules')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule: updated });
}

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
