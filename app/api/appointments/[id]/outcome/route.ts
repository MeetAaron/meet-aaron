// app/api/appointments/[id]/outcome/route.ts
// POST -> le commercial répond à la question d'Aaron "comment ça s'est passé ?"
// pour un RDV passé (voir app/app/agenda/rdv/[id]/bilan). Enregistre le bilan
// et fait réagir Aaron (lib/appointment-outcome.ts).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { recordAppointmentOutcome, AppointmentOutcome } from '@/lib/appointment-outcome';

const VALID_OUTCOMES: AppointmentOutcome[] = ['client', 'bien_passe', 'moyen', 'perdu'];

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { outcome } = await request.json();

  if (!VALID_OUTCOMES.includes(outcome)) {
    return NextResponse.json({ error: 'Réponse invalide' }, { status: 400 });
  }

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, prospects(assigned_user_id, company_id)')
    .eq('id', params.id)
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: 'RDV introuvable' }, { status: 404 });
  }

  const prospect = (appointment as any).prospects;

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect?.assigned_user_id && authedUser.company_id !== prospect?.company_id) {
    return forbiddenResponse();
  }

  try {
    const { note } = await recordAppointmentOutcome(params.id, outcome);
    return NextResponse.json({ note });
  } catch (err: any) {
    console.error('Erreur enregistrement bilan RDV:', err.message);
    return NextResponse.json({ error: "Impossible d'enregistrer le bilan" }, { status: 500 });
  }
}
