// app/api/appointments/[id]/debrief/route.ts
// POST -> à partir de quelques lignes de notes laissées par le commercial
//         juste après un RDV, génère un compte-rendu structuré + un email de
//         relance prêt à valider (voir lib/aaron-sales.ts, envoi effectif via
//         app/api/appointments/[id]/debrief/send).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { generateAppointmentDebrief } from '@/lib/aaron-sales';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const appointmentId = params.id;
  const { notes } = await request.json();

  if (!notes || typeof notes !== 'string' || !notes.trim()) {
    return NextResponse.json({ error: 'Notes manquantes — quelques lignes suffisent.' }, { status: 400 });
  }

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, prospects(assigned_user_id, company_id)')
    .eq('id', appointmentId)
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
    const debrief = await generateAppointmentDebrief(appointmentId, notes);
    return NextResponse.json({ debrief });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json({ error: 'Plafond de dépense API atteint pour ce mois — réessayez plus tard.' }, { status: 429 });
    }
    console.error('Erreur génération compte-rendu post-RDV:', err.message);
    return NextResponse.json({ error: 'Impossible de générer le compte-rendu pour le moment.' }, { status: 500 });
  }
}
