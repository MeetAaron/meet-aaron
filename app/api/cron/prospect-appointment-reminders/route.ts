// app/api/cron/prospect-appointment-reminders/route.ts
// Exécuté périodiquement via Vercel Cron (toutes les 30 minutes).
// Envoie un email de rappel au PROSPECT (pas au commercial) ~24h avant son RDV,
// depuis la boîte Gmail du commercial (plus personnel qu'un email "système").
// Évite les doublons via notifications_log (type 'prospect_appointment_reminder_24h').

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendGmailEmail } from '@/lib/google';

const REMINDER_TYPE = 'prospect_appointment_reminder_24h';
const TARGET_HOURS_BEFORE = 24;
const WINDOW_HOURS = 0.5; // demi-fenêtre : couvre les RDV entre 23h30 et 24h30 avant l'heure du RDV

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() + (TARGET_HOURS_BEFORE - WINDOW_HOURS) * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + (TARGET_HOURS_BEFORE + WINDOW_HOURS) * 60 * 60 * 1000);

  // RDV validés dont l'heure tombe dans la fenêtre "~24h avant"
  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select('id, proposed_at, type, user_id, users(id, full_name), prospects(id, full_name, email)')
    .eq('status', 'validé')
    .gte('proposed_at', windowStart.toISOString())
    .lte('proposed_at', windowEnd.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const notified = [];

  for (const appt of appointments || []) {
    const prospect = (appt as any).prospects;
    const commercial = (appt as any).users;

    if (!prospect?.email) continue;

    const { data: alreadySent } = await supabaseAdmin
      .from('notifications_log')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('type', REMINDER_TYPE);

    if (alreadySent && alreadySent.length > 0) continue;

    const dateStr = new Date(appt.proposed_at).toLocaleString('fr-FR', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Europe/Paris',
    });

    try {
      await sendGmailEmail(
        appt.user_id,
        prospect.email,
        'Rappel : notre rendez-vous demain',
        `Bonjour ${prospect.full_name},\n\n` +
          `Petit rappel : nous avons rendez-vous demain, le ${dateStr}.\n\n` +
          `N'hésitez pas à me répondre directement à cet email si vous avez besoin de le décaler.\n\n` +
          `À demain,\n${commercial?.full_name || ''}`
      );

      await supabaseAdmin.from('notifications_log').insert({
        user_id: appt.user_id,
        appointment_id: appt.id,
        channel: 'email',
        type: REMINDER_TYPE,
      });

      notified.push(appt.id);
    } catch (err: any) {
      // On continue avec les autres RDV même si l'envoi échoue pour l'un d'eux
      // (ex: token Google expiré pour ce commercial) — pas de log ici pour retenter au prochain passage.
      console.error(`Erreur rappel prospect pour le RDV ${appt.id}:`, err.message);
    }
  }

  return NextResponse.json({ notified: notified.length });
}
