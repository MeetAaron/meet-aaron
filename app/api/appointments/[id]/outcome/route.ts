// app/api/appointments/[id]/outcome/route.ts
// POST -> le commercial répond à la question d'Aaron "comment ça s'est passé ?"
// pour un RDV passé (voir app/app/agenda/rdv/[id]/bilan). Enregistre le bilan
// et fait réagir Aaron (lib/appointment-outcome.ts).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { canAccessAppointment } from '@/lib/appointment-access';
import { recordAppointmentOutcome, personalizeOutcomeNote, sendThankYouEmail, AppointmentOutcome, AppointmentMood } from '@/lib/appointment-outcome';
import { runInBackground } from '@/lib/background';
import { readJsonBody } from '@/lib/http';

const VALID_OUTCOMES: AppointmentOutcome[] = ['a_continuer', 'opportunite', 'devis', 'perdu'];

const VALID_MOODS: AppointmentMood[] = ['bien', 'moyen', 'mal'];

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  // Docx 30/08 (items 3 et 7) : en plus de l'issue, ressenti (mood), contexte
  // libre/chips, et demande d'email de remerciement rédigé par Aaron.
  const { outcome, mood, context, send_thank_you } = await readJsonBody(request);

  if (!VALID_OUTCOMES.includes(outcome)) {
    return NextResponse.json({ error: 'Réponse invalide' }, { status: 400 });
  }
  const details = {
    mood: VALID_MOODS.includes(mood) ? (mood as AppointmentMood) : null,
    context: typeof context === 'string' ? context.slice(0, 2000) : null,
  };

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, user_id, prospects(assigned_user_id, company_id)')
    .eq('id', params.id)
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: 'RDV introuvable' }, { status: 404 });
  }

  const prospect = (appointment as any).prospects;

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!canAccessAppointment(authedUser, appointment as any)) {
    return forbiddenResponse();
  }

  try {
    // 28/10/2026 : le bilan est enregistré tout de suite (base seulement),
    // puis la note d'Aaron et l'email de remerciement se font en arrière-plan.
    // La page relit GET /api/appointments/[id] quelques secondes plus tard
    // pour afficher la note personnalisée et l'état de l'email.
    const { note } = await recordAppointmentOutcome(params.id, outcome, details, { fast: true });
    const wantsThankYou = send_thank_you === true;
    const notePending = outcome !== 'opportunite' && outcome !== 'devis';
    runInBackground(`bilan RDV ${params.id}`, async () => {
      await personalizeOutcomeNote(params.id, outcome, details);
      if (wantsThankYou) {
        const result = await sendThankYouEmail(params.id, outcome, details);
        if (!result.sent) {
          // Colonne optionnelle (migration_bilan_arriere_plan_2026-10-28.sql) :
          // sans elle, l'échec reste seulement dans les journaux.
          await supabaseAdmin.from('appointments').update({ thank_you_error: result.error || 'envoi impossible' }).eq('id', params.id).then(() => {}, () => {});
        }
      }
    });
    return NextResponse.json({ note, note_pending: notePending, thank_you_pending: wantsThankYou });
  } catch (err: any) {
    console.error('Erreur enregistrement bilan RDV:', err.message);
    return NextResponse.json({ error: "Impossible d'enregistrer le bilan" }, { status: 500 });
  }
}
