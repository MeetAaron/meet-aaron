// app/api/cron/appointment-feedback-prompts/route.ts
// Exécuté périodiquement via Vercel Cron (toutes les 15 minutes).
// Une fois l'heure d'un RDV validé passée, demande au commercial (push +
// email) comment ça s'est passé, avec un lien vers app/app/agenda/rdv/[id]/bilan.
// Fenêtre de 48h : au-delà, on arrête de relancer (le commercial a eu largement
// le temps de répondre, pas la peine de le harceler indéfiniment sur un vieux RDV).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';

const WINDOW_HOURS = 48;
const NOTIFICATION_TYPE = 'appointment_feedback_prompt';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select('id, proposed_at, user_id, outcome, users(id, full_name, email, notify_channel), prospects(full_name)')
    .eq('status', 'validé')
    // purpose = 'commercial' (défaut historique) uniquement : le bilan
    // "Bon RDV / Opportunité / Devis / Perdu" n'a pas de sens pour un RDV de
    // lancement (purpose = 'lancement', tâche #141) puisque le client est
    // déjà signé — voir migration_kickoff_rdv_2026-08-20.sql.
    .eq('purpose', 'commercial')
    .is('outcome', null)
    .lt('proposed_at', now.toISOString())
    .gt('proposed_at', windowStart.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const notified = [];

  for (const appt of appointments || []) {
    try {
      const { data: alreadySent } = await supabaseAdmin
        .from('notifications_log')
        .select('id')
        .eq('appointment_id', appt.id)
        .eq('type', NOTIFICATION_TYPE);

      if (alreadySent && alreadySent.length > 0) continue;

      const user = (appt as any).users;
      const prospect = (appt as any).prospects;
      const channel = user?.notify_channel || 'email';
      const url = `/app/agenda/rdv/${appt.id}/bilan`;
      const message = `Comment s'est passé le RDV avec ${prospect?.full_name || 'ton prospect'} ?`;

      if (channel === 'email' || channel === 'both') {
        const { error: logError } = await supabaseAdmin.from('notifications_log').insert({
          user_id: user.id,
          appointment_id: appt.id,
          channel: 'email',
          type: NOTIFICATION_TYPE,
        });
        if (logError) {
          if (logError.code === '23505') continue;
          console.error('Erreur log notification (email, bilan RDV):', logError.message);
        } else {
          await sendEmailForUser(
            user.id,
            user.email,
            'Comment ça s\'est passé ?',
            `${message}\n\nDis-le à Aaron ici : ${process.env.APP_URL || ''}${url}`
          );
        }
      }

      if (channel === 'push' || channel === 'both') {
        const { error: logError } = await supabaseAdmin.from('notifications_log').insert({
          user_id: user.id,
          appointment_id: appt.id,
          channel: 'push',
          type: NOTIFICATION_TYPE,
        });
        if (logError) {
          if (logError.code === '23505') continue;
          console.error('Erreur log notification (push, bilan RDV):', logError.message);
        } else {
          await sendPushNotification(user.id, {
            title: 'Comment ça s\'est passé ?',
            body: message,
            url,
          });
        }
      }

      notified.push(appt.id);
    } catch (err: any) {
      // Un échec sur UNE relance ne doit pas empêcher les autres.
      console.error(`Erreur envoi demande de bilan RDV ${appt.id}:`, err.message);
    }
  }

  return NextResponse.json({ notified: notified.length });
}
