// app/api/cron/prospect-appointment-reminders/route.ts
// Exécuté périodiquement via Vercel Cron (toutes les 30 minutes).
// Envoie un email de rappel au PROSPECT (pas au commercial) ~24h avant son RDV,
// depuis la boîte Gmail du commercial (plus personnel qu'un email "système").
// Évite les doublons via notifications_log (type 'prospect_appointment_reminder_24h').

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';
import { serverError } from '@/lib/http';
import { resolveProspectLocale } from '@/lib/prospect-locale';
import { resolveUserTimeZone } from '@/lib/user-timezone';

// Rappel de la veille au prospect, dans SA langue et au fuseau du commercial
// (06/11/2026 — était français en dur, heure de Paris).
const REMINDER_TEXTS: Record<string, { intl: string; subject: string; hello: string; body: string; link: string; reschedule: string; bye: string }> = {
  fr: { intl: 'fr-FR', subject: 'Rappel : notre rendez-vous demain', hello: 'Bonjour {name},', body: 'Petit rappel : nous avons rendez-vous demain, le {date}.', link: 'Le lien pour nous rejoindre : {link}', reschedule: "N'hésitez pas à me répondre directement à cet email si vous avez besoin de le décaler.", bye: 'À demain,' },
  en: { intl: 'en-GB', subject: 'Reminder: our meeting tomorrow', hello: 'Hello {name},', body: 'A quick reminder: we are meeting tomorrow, {date}.', link: 'The link to join: {link}', reschedule: 'Just reply to this email if you need to reschedule.', bye: 'See you tomorrow,' },
  de: { intl: 'de-DE', subject: 'Erinnerung: unser Termin morgen', hello: 'Guten Tag {name},', body: 'Kurze Erinnerung: wir haben morgen einen Termin, {date}.', link: 'Der Link zur Teilnahme: {link}', reschedule: 'Antworten Sie einfach auf diese E-Mail, falls Sie verschieben müssen.', bye: 'Bis morgen,' },
  it: { intl: 'it-IT', subject: 'Promemoria: il nostro appuntamento di domani', hello: 'Buongiorno {name},', body: 'Un breve promemoria: abbiamo appuntamento domani, {date}.', link: 'Il link per collegarsi: {link}', reschedule: 'Risponda pure a questa email se ha bisogno di spostarlo.', bye: 'A domani,' },
  es: { intl: 'es-ES', subject: 'Recordatorio: nuestra reunión de mañana', hello: 'Hola {name},', body: 'Un breve recordatorio: tenemos reunión mañana, {date}.', link: 'El enlace para unirse: {link}', reschedule: 'Responda a este correo si necesita cambiar la fecha.', bye: 'Hasta mañana,' },
  pt: { intl: 'pt-PT', subject: 'Lembrete: a nossa reunião de amanhã', hello: 'Olá {name},', body: 'Um pequeno lembrete: temos reunião amanhã, {date}.', link: 'O link para entrar: {link}', reschedule: 'Basta responder a este email se precisar de remarcar.', bye: 'Até amanhã,' },
  nl: { intl: 'nl-NL', subject: 'Herinnering: onze afspraak morgen', hello: 'Hallo {name},', body: 'Even een herinnering: we hebben morgen een afspraak, {date}.', link: 'De link om deel te nemen: {link}', reschedule: 'Beantwoord gewoon deze e-mail als je moet verzetten.', bye: 'Tot morgen,' },
};

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
    .select('id, proposed_at, type, meet_link, user_id, users(id, full_name, locale, timezone, billing_country), prospects(id, full_name, email, prospect_companies(address, found_by_campaign_id))')
    .eq('status', 'validé')
    .gte('proposed_at', windowStart.toISOString())
    .lte('proposed_at', windowEnd.toISOString());

  if (error) {
    return serverError(error, '/api/cron/prospect-appointment-reminders');
  }

  // Chaque RDV appartient à un commercial différent (comptes distincts) — les
  // traiter en parallèle plutôt que un par un accélère nettement ce cron
  // quand plusieurs commerciaux ont des RDV à rappeler au même moment.
  const results = await Promise.all(
    (appointments || []).map(async (appt) => {
      const prospect = (appt as any).prospects;
      const commercial = (appt as any).users;

      if (!prospect?.email) return null;

      const { data: alreadySent } = await supabaseAdmin
        .from('notifications_log')
        .select('id')
        .eq('appointment_id', appt.id)
        .eq('type', REMINDER_TYPE);

      if (alreadySent && alreadySent.length > 0) return null;

      let campaignLocale: string | null = null;
      const campaignId = prospect?.prospect_companies?.found_by_campaign_id;
      if (campaignId) {
        const { data: campaign } = await supabaseAdmin.from('prospecting_campaigns').select('target_locale').eq('id', campaignId).maybeSingle();
        campaignLocale = campaign?.target_locale || null;
      }
      const loc = resolveProspectLocale({
        campaignLocale,
        address: prospect?.prospect_companies?.address || null,
        email: prospect.email,
        sellerLocale: commercial?.locale || null,
      });
      const T = REMINDER_TEXTS[loc] || REMINDER_TEXTS.fr;
      const dateStr = new Date(appt.proposed_at).toLocaleString(T.intl, {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: resolveUserTimeZone(commercial || {}),
      });

      try {
        // Le lien de visio est répété ici (10/09/2026) : c'est le moment
        // précis où le prospect en a besoin, et l'invitation d'agenda reçue
        // des semaines plus tôt est souvent introuvable. Voir
        // lib/meeting-link.ts pour son origine (Meet, Teams ou salle
        // permanente du commercial).
        const meetLine = (appt as any).meet_link ? `${T.link.replace('{link}', (appt as any).meet_link)}\n\n` : '';
        await sendEmailForUser(
          appt.user_id,
          prospect.email,
          T.subject,
          `${T.hello.replace('{name}', prospect.full_name || '')}\n\n` +
            `${T.body.replace('{date}', dateStr)}\n\n` +
            meetLine +
            `${T.reschedule}\n\n` +
            `${T.bye}\n${commercial?.full_name || ''}`
        );

        await supabaseAdmin.from('notifications_log').insert({
          user_id: appt.user_id,
          appointment_id: appt.id,
          channel: 'email',
          type: REMINDER_TYPE,
        });

        return appt.id;
      } catch (err: any) {
        // On continue avec les autres RDV même si l'envoi échoue pour l'un d'eux
        // (ex: token Google expiré pour ce commercial) — pas de log ici pour retenter au prochain passage.
        console.error(`Erreur rappel prospect pour le RDV ${appt.id}:`, err.message);
        return null;
      }
    })
  );

  const notified = results.filter(Boolean);

  return NextResponse.json({ notified: notified.length });
}
