// app/api/appointments/[id]/brief/route.ts
// GET -> renvoie la fiche de brief pré-RDV déjà générée (mise en cache sur
//        appointments.pre_brief), ou la génère à la volée si elle n'existe
//        pas encore. ?regenerate=1 force une nouvelle génération (ex: de
//        nouveaux échanges ont eu lieu depuis la dernière fois).
// Voir lib/aaron-sales.ts (generateAppointmentBrief) et app/app/sales/page.jsx.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { generateAppointmentBrief } from '@/lib/aaron-sales';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const appointmentId = params.id;
  const forceRegenerate = request.nextUrl.searchParams.get('regenerate') === '1';

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, pre_brief, pre_brief_generated_at, prospects(assigned_user_id, company_id)')
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

  if (!forceRegenerate && appointment.pre_brief) {
    return NextResponse.json({ brief: appointment.pre_brief, generated_at: appointment.pre_brief_generated_at, cached: true });
  }

  try {
    const brief = await generateAppointmentBrief(appointmentId);
    return NextResponse.json({ brief, generated_at: new Date().toISOString(), cached: false });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json({ error: 'Plafond de dépense API atteint pour ce mois — réessayez plus tard.' }, { status: 429 });
    }
    console.error('Erreur génération brief pré-RDV:', err.message);
    return NextResponse.json({ error: 'Impossible de générer le brief pour le moment.' }, { status: 500 });
  }
}
