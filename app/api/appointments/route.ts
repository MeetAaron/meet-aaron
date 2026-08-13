// app/api/appointments/route.ts
// GET  -> liste les rendez-vous d'un commercial (utilisé par le tableau de bord et l'agenda)
// POST -> crée manuellement un RDV depuis l'agenda (pris en dehors d'Aaron :
//         le prospect a appelé directement, ou contact perso du commercial).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

const VALID_TYPES = ['visio', 'physique', 'telephonique'];

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select('*, prospects(full_name, email, prospect_companies(name))')
    .eq('user_id', userId)
    .order('proposed_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ appointments });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { user_id, type, proposed_at, prospect_id, contact_name } = body;

  if (!user_id || !type || !proposed_at) {
    return NextResponse.json({ error: 'Champs requis manquants (user_id, type, proposed_at)' }, { status: 400 });
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Type de RDV invalide' }, { status: 400 });
  }
  if (!prospect_id && !contact_name?.trim()) {
    return NextResponse.json({ error: 'Choisissez un prospect suivi par Aaron ou indiquez le nom du contact' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  if (prospect_id) {
    const { data: prospect } = await supabaseAdmin
      .from('prospects')
      .select('id, assigned_user_id')
      .eq('id', prospect_id)
      .single();
    if (!prospect || prospect.assigned_user_id !== user_id) return forbiddenResponse();
  }

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      user_id,
      prospect_id: prospect_id || null,
      contact_name: prospect_id ? null : contact_name.trim(),
      type,
      proposed_at,
      status: 'validé',
      source: 'manuel',
    })
    .select('*, prospects(full_name, email, prospect_companies(name))')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ appointment });
}
