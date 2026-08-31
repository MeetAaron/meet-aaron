// app/api/cron/send-results-reports/route.ts
// Lot 4 « Mes résultats » (docx « mon avis » d'Alex, 31/08/2026) : rapports
// envoyés automatiquement par email —
//   - chaque jour à 00h10 : le rapport de la VEILLE ;
//   - le premier jour de la semaine : celui de la semaine écoulée ;
//   - le premier jour du mois : celui du mois écoulé.
// Un seul cron Vercel à 00h10 UTC (voir vercel.json) qui décide quoi joindre
// selon la date. Email système (sendSystemEmail, même canal que les emails
// de compte) + notification push. Rien n'est envoyé si la période est
// entièrement vide (0 partout) — pas de spam pour un compte au repos.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computePeriodSummary } from '@/lib/results-report';
import { sendSystemEmail } from '@/lib/google';
import { sendPushNotification } from '@/lib/push';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

function summaryLines(s: Awaited<ReturnType<typeof computePeriodSummary>>): string {
  return [
    `• Prospects contactés : ${s.prospectsContactes}`,
    `• RDV obtenus : ${s.rdvObtenus} (en attente : ${s.rdvEnAttente})`,
    `• Taux de conversion prospection : ${s.tauxConversion} %`,
    `• Opportunités gagnées : ${s.opportunitesGagnees} · perdues : ${s.opportunitesPerdues}`,
    `• Clients gagnés : ${s.clientsGagnes}`,
  ].join('\n');
}

function isEmpty(s: Awaited<ReturnType<typeof computePeriodSummary>>): boolean {
  return !s.prospectsContactes && !s.rdvObtenus && !s.rdvEnAttente && !s.opportunitesGagnees && !s.opportunitesPerdues && !s.clientsGagnes;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const isMonday = now.getDay() === 1;
  const isFirstOfMonth = now.getDate() === 1;

  const { data: users, error } = await supabaseAdmin.from('users').select('id, full_name, email').not('email', 'is', null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  for (const user of users || []) {
    try {
      const parts: string[] = [];

      const daySummary = await computePeriodSummary(user.id, startOfYesterday, startOfToday);
      if (!isEmpty(daySummary)) {
        parts.push(`📅 Hier (${startOfYesterday.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}) :\n${summaryLines(daySummary)}`);
      }

      if (isMonday) {
        const weekStart = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weekSummary = await computePeriodSummary(user.id, weekStart, startOfToday);
        if (!isEmpty(weekSummary)) {
          parts.push(`🗓 La semaine écoulée :\n${summaryLines(weekSummary)}`);
        }
      }

      if (isFirstOfMonth) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const monthSummary = await computePeriodSummary(user.id, monthStart, startOfToday);
        if (!isEmpty(monthSummary)) {
          parts.push(`📈 Le mois écoulé :\n${summaryLines(monthSummary)}`);
        }
      }

      if (parts.length === 0) continue;

      const firstName = (user.full_name || '').split(' ')[0] || '';
      const subject = isFirstOfMonth ? 'Ton rapport du mois — Meet Aaron' : isMonday ? 'Ton rapport de la semaine — Meet Aaron' : "Tes résultats d'hier — Meet Aaron";
      const body =
        `Bonjour ${firstName},\n\nVoici où tu en es :\n\n${parts.join('\n\n')}\n\n` +
        `Tu retrouves le détail (et les téléchargements PDF/Excel) dans Mes résultats : https://meetaaron.app/app/resultats?user_id=${user.id}\n\n— Aaron`;

      await sendSystemEmail(user.email, subject, body);
      sendPushNotification(user.id, {
        title: subject.replace(' — Meet Aaron', ''),
        body: 'Ton rapport est arrivé — ouvre Mes résultats pour le détail.',
        url: `/app/resultats?user_id=${user.id}`,
      }).catch(() => {});
      sent += 1;
    } catch (err: any) {
      console.error(`Erreur rapport résultats pour ${user.id}:`, err.message);
    }
  }

  return NextResponse.json({ sent });
}
