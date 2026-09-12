// app/api/cron/send-results-reports/route.ts
// Lot 4 « Mes résultats » (docx « mon avis » d'Alex, 31/08/2026) : rapports
// envoyés automatiquement par email —
//   - chaque jour, juste après minuit : le rapport de la VEILLE ;
//   - le lundi : celui de la semaine écoulée ;
//   - le 1er du mois : celui du mois écoulé.
//
// MINUIT CHEZ LE COMMERCIAL (12/09/2026, demande d'Alex : « je suis en
// Australie, donc le rapport doit être envoyé à minuit une, et ce pour chaque
// pays selon le fuseau horaire »).
//
// Avant : un seul passage à 00h10 UTC pour toute la base. Minuit dix à Paris
// en hiver, mais huit heures du matin à Perth — le rapport « d'hier »
// arrivait une fois la journée commencée.
//
// Maintenant : le cron passe TOUTES LES HEURES (voir vercel.json) et, pour
// chaque commercial, n'envoie que s'il est minuit CHEZ LUI. La garde
// users.last_results_report_date empêche tout doublon, indispensable
// puisqu'on repasse vingt-quatre fois par jour et que les changements
// d'heure font vivre deux fois la même heure locale.
//
// Les périodes (hier, la semaine, le mois) sont elles aussi calculées dans
// le fuseau du commercial : son « hier » n'est pas celui du serveur.
//
// L'email part de aaron@meetaaron.app (sendSystemEmail), jamais de la boîte
// du commercial : c'est Aaron qui lui écrit, pas lui-même. Alex y tient, et
// c'était déjà le cas — on le documente ici pour que ça ne dérive pas.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computePeriodSummary } from '@/lib/results-report';
import { sendSystemEmail } from '@/lib/google';
import { sendPushNotification } from '@/lib/push';
import { resolveUserTimeZone, localParts } from '@/lib/user-timezone';

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

// Instant correspondant à 00h00 locale d'une date donnée, dans un fuseau
// donné. Intl ne sait que formater, pas construire : on part de l'heure UTC
// du jour et on corrige du décalage réel observé à cet instant — ce qui gère
// l'heure d'été sans table codée en dur.
function zonedStartOfDay(year: number, month: number, day: number, timeZone: string): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const asUtc = new Date(naiveUtc);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = fmt.formatToParts(asUtc);
  const val = (t: string) => Number(p.find((x) => x.type === t)?.value || '0');
  const shown = Date.UTC(val('year'), val('month') - 1, val('day'), val('hour') % 24, val('minute'), val('second'));
  return new Date(naiveUtc - (shown - naiveUtc));
}

function isEmpty(s: Awaited<ReturnType<typeof computePeriodSummary>>): boolean {
  return !s.prospectsContactes && !s.rdvObtenus && !s.rdvEnAttente && !s.opportunitesGagnees && !s.opportunitesPerdues && !s.clientsGagnes;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = new Date();

  // timezone / billing_country / last_results_report_date peuvent manquer si
  // migration_fuseau_horaire_rapports_2026-09-12.sql n'est pas encore jouée :
  // on retombe alors sur la sélection d'avant, et le comportement d'avant.
  let users: any[] | null = null;
  let res: any = await supabaseAdmin
    .from('users')
    .select('id, full_name, email, timezone, billing_country, last_results_report_date')
    .not('email', 'is', null);
  if (res.error?.code === '42703') {
    res = await supabaseAdmin.from('users').select('id, full_name, email').not('email', 'is', null);
  }
  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  users = res.data;

  let sent = 0;
  let skipped = 0;
  for (const user of users || []) {
    try {
      // ── Est-il minuit chez CE commercial ? ────────────────────────────
      const timeZone = resolveUserTimeZone(user);
      const local = localParts(now, timeZone);
      if (local.hour !== 0) {
        skipped += 1;
        continue;
      }
      // Déjà envoyé pour cette date locale : on ne repasse pas.
      if (user.last_results_report_date === local.date) {
        skipped += 1;
        continue;
      }

      // Les bornes des périodes se calculent dans le fuseau du commercial :
      // « hier » commence à son minuit à lui. On part de sa date locale et
      // on reconstruit les instants correspondants.
      const [y, m, d] = local.date.split('-').map(Number);
      const startOfToday = zonedStartOfDay(y, m, d, timeZone);
      const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
      const isMonday = local.weekday === 1;
      const isFirstOfMonth = local.dayOfMonth === 1;

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

      // Envoyé par Aaron (aaron@meetaaron.app), jamais depuis la boîte du
      // commercial — voir le commentaire en tête de fichier.
      await sendSystemEmail(user.email, subject, body);
      // Marqué AVANT la push : si la notification échoue, le rapport ne doit
      // pas repartir à l'heure suivante.
      await supabaseAdmin
        .from('users')
        .update({ last_results_report_date: local.date })
        .eq('id', user.id)
        .then(undefined, () => undefined);
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

  return NextResponse.json({ sent, skipped });
}
