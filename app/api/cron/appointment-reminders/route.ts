// app/api/cron/appointment-reminders/route.ts
// Exécuté toutes les minutes via Vercel Cron.
// Cherche les RDV validés dont l'heure de rappel (proposed_at - X minutes) vient
// d'être atteinte, et envoie la notification selon la préférence du commercial
// (email, push, ou les deux). Évite les doublons via notifications_log.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';
// import { sendPushNotification } from '@/lib/push'; // à implémenter selon le fournisseur choisi (ex: OneSignal, FCM)

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = new Date();

  // Récupère tous les RDV validés à venir avec les préférences du commercial
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('*, users(id, full_name, email, notify_before_appointment_minutes, notify_channel), prospects(full_name)')
    .eq('status', 'validé')
    .gt('proposed_at', now.toISOString());

  const notified = [];

  for (const appt of appointments || []) {
    const reminderMinutes = appt.users.notify_before_appointment_minutes;
    const reminderTime = new Date(new Date(appt.proposed_at).getTime() - reminderMinutes * 60 * 1000);

    // La fenêtre du cron tourne toutes les minutes : on vérifie qu'on est dans la bonne minute
    const diffMs = Math.abs(now.getTime() - reminderTime.getTime());
    if (diffMs > 60_000) continue; // pas encore le moment (ou déjà passé)

    // Vérifie qu'on n'a pas déjà notifié pour ce RDV
    const { data: alreadySent } = await supabaseAdmin
      .from('notifications_log')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('type', 'appointment_reminder');

    if (alreadySent && alreadySent.length > 0) continue;

    const channel = appt.users.notify_channel; // 'email' | 'push' | 'both'
    const message = `Rappel : RDV avec ${appt.prospects.full_name} dans ${reminderMinutes} minutes.`;

    if (channel === 'email' || channel === 'both') {
      await sendEmailForUser(appt.users.id, appt.users.email, 'Rappel de rendez-vous', message);
      await supabaseAdmin.from('notifications_log').insert({
        user_id: appt.users.id,
        appointment_id: appt.id,
        channel: 'email',
        type: 'appointment_reminder',
      });
    }

    if (channel === 'push' || channel === 'both') {
      // await sendPushNotification(appt.users.id, message); // à brancher sur le service push choisi
      await supabaseAdmin.from('notifications_log').insert({
        user_id: appt.users.id,
        appointment_id: appt.id,
        channel: 'push',
        type: 'appointment_reminder',
      });
    }

    notified.push(appt.id);
  }

  return NextResponse.json({ notified: notified.length });
}
