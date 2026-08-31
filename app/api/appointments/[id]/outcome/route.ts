// app/api/appointments/[id]/outcome/route.ts
// POST -> le commercial répond à la question d'Aaron "comment ça s'est passé ?"
// pour un RDV passé (voir app/app/agenda/rdv/[id]/bilan). Enregistre le bilan
// et fait réagir Aaron (lib/appointment-outcome.ts).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { recordAppointmentOutcome, sendThankYouEmail, AppointmentOutcome, AppointmentMood } from '@/lib/appointment-outcome';

const VALID_OUTCOMES: AppointmentOutcome[] = ['a_continuer', 'opportunite', 'devis', 'perdu'];

const VALID_MOODS: AppointmentMood[] = ['bien', 'moyen', 'mal'];

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  // Docx 30/08 (items 3 et 7) : en plus de l'issue, ressenti (mood), contexte
  // libre/chips, et demande d'email de remerciement rédigé par Aaron.
  const { outcome, mood, context, send_thank_you } = await request.json();

  if (!VALID_OUTCOMES.includes(outcome)) {
    return NextResponse.json({ error: 'Réponse invalide' }, { status: 400 });
  }
  const details = {
    mood: VALID_MOODS.includes(mood) ? (mood as AppointmentMood) : null,
    context: typeof context === 'string' ? context.slice(0, 2000) : null,
  };

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
    const { note } = await recordAppointmentOutcome(params.id, outcome, details);
    let thankYou: { sent: boolean; error?: string } = { sent: false };
    if (send_thank_you === true) {
      thankYou = await sendThankYouEmail(params.id, outcome, details);
    }
    return NextResponse.json({ note, thank_you_sent: thankYou.sent, thank_you_error: thankYou.error || null });
  } catch (err: any) {
    console.error('Erreur enregistrement bilan RDV:', err.message);
    return NextResponse.json({ error: "Impossible d'enregistrer le bilan" }, { status: 500 });
  }
}
