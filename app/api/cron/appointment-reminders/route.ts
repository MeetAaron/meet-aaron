// app/api/cron/appointment-reminders/route.ts
// Exécuté toutes les minutes via Vercel Cron.
// Rappel « juste avant » au commercial : 30 min avant un appel ou une visio
// (ou sa préférence notify_before_appointment_minutes), 1 h avant un
// rendez-vous physique — décision Alex, 08/11/2026 (lib/reminder-texts.ts).
// Dans la langue du commercial, avec le lien visio. Évite les doublons via
// notifications_log, et rattrape un passage manqué : un rappel dont l'heure
// est passée depuis moins de 15 minutes part quand même (avant, une minute
// de retard du cron faisait sauter le rappel pour de bon).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { resolveUserTimeZone } from '@/lib/user-timezone';
import { reminderLeadMinutes, reminderTexts, typeLabel, fmtTime } from '@/lib/reminder-texts';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

const CATCH_UP_MS = 15 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = new Date();
  // Fenêtre : rendez-vous dans les deux prochaines heures (le plus long délai
  // de rappel est 1 h, plus le rattrapage).
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('id, proposed_at, type, meet_link, contact_name, users(id, full_name, email, locale, timezone, billing_country, notify_before_appointment_minutes, notify_channel), prospects(full_name, prospect_companies(name))')
    .eq('status', 'validé')
    .gt('proposed_at', new Date(now.getTime() - CATCH_UP_MS).toISOString())
    .lt('proposed_at', new Date(now.getTime() + 2 * 3600 * 1000).toISOString());

  const notified: string[] = [];

  for (const appt of (appointments || []) as any[]) {
    try {
      const user = appt.users;
      if (!user) continue;
      const lead = reminderLeadMinutes(appt.type, user.notify_before_appointment_minutes);
      const reminderTime = new Date(new Date(appt.proposed_at).getTime() - lead * 60 * 1000);
      const late = now.getTime() - reminderTime.getTime();
      if (late < 0 || late > CATCH_UP_MS) continue;

      const locale = user.locale || 'fr';
      const tz = resolveUserTimeZone(user);
      const T = reminderTexts(locale);
      const name = appt.prospects?.full_name || appt.contact_name || '';
      const minutesLeft = Math.max(1, Math.round((new Date(appt.proposed_at).getTime() - now.getTime()) / 60000));
      const title = T.reminderTitle.replace('{minutes}', String(minutesLeft));
      const body = T.reminderBody.replace('{name}', name).replace('{type}', typeLabel(locale, appt.type)).replace('{time}', fmtTime(appt.proposed_at, locale, tz));
      const emailBody = appt.meet_link ? `${body}\n\n${T.reminderLink.replace('{link}', appt.meet_link)}` : body;

      const channel = user.notify_channel || 'both';
      if (channel === 'email' || channel === 'both') {
        const { error: logError } = await supabaseAdmin.from('notifications_log').insert({ user_id: user.id, appointment_id: appt.id, channel: 'email', type: 'appointment_reminder' });
        if (!logError) {
          await sendEmailForUser(user.id, user.email, title, emailBody);
        } else if (logError.code !== '23505') {
          console.error('Erreur log notification (email):', logError.message);
        }
      }
      if (channel === 'push' || channel === 'both') {
        const { error: logError } = await supabaseAdmin.from('notifications_log').insert({ user_id: user.id, appointment_id: appt.id, channel: 'push', type: 'appointment_reminder' });
        if (!logError) {
          await sendPushNotification(user.id, { title, body, url: `/app/agenda?user_id=${user.id}&rdv=${appt.id}`, tag: `rappel_rdv:${appt.id}` });
        } else if (logError.code !== '23505') {
          console.error('Erreur log notification (push):', logError.message);
        }
      }
      notified.push(appt.id);
    } catch (err: any) {
      // Un échec sur UN rappel (boîte déconnectée…) ne doit pas empêcher les
      // autres rappels de ce cycle.
      console.error(`Erreur envoi rappel RDV ${appt.id}:`, err?.message || err);
    }
  }

  return NextResponse.json({ notified: notified.length });
}
