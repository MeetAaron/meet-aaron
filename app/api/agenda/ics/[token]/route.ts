// app/api/agenda/ics/[token]/route.ts
// Flux ICS public (lecture seule) des RDV + indisponibilités manuelles d'UN
// commercial, identifié par un token opaque (users.ics_feed_token) plutôt que
// par son id — cette URL est destinée à être collée dans les réglages
// Calendrier d'un téléphone/ordinateur, donc potentiellement stockée hors de
// l'app ; un id utilisateur devinable exposerait les RDV de n'importe qui.
//
// Volontairement PAS authentifié par cookie/session (impossible : l'app
// Calendrier de l'iPhone qui interroge cette URL périodiquement n'a ni
// session ni cookie Meet Aaron) — la sécurité repose entièrement sur le
// caractère non devinable du token (UUID v4).
//
// N'inclut QUE ce qu'Aaron gère lui-même :
//  - les RDV validés (source Aaron ou manuel) — jamais les RDV annulés/
//    reportés/en attente, qui n'ont rien à faire sur un calendrier externe.
//  - les indisponibilités ajoutées manuellement (source='manuel').
// N'inclut PAS :
//  - les créneaux de disponibilité récurrents (availability_rules) — exclusion
//    explicitement demandée par Alex (28/08/2026), pollueraient visuellement
//    le calendrier externe chaque semaine.
//  - les indisponibilités remontées par la synchro Google/Outlook
//    (source='sync') — les réinjecter ici recréerait une boucle avec le
//    calendrier dont elles viennent déjà.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const WINDOW_PAST_DAYS = 7;
const WINDOW_FUTURE_DAYS = 120;

// Échappement RFC 5545 (texte ICS) : antislash, virgule, point-virgule et
// retours à la ligne doivent être échappés, dans cet ordre précis (l'antislash
// en premier, sinon on ré-échappe les échappements qu'on vient de poser).
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

function toIcsDate(iso: string): string {
  // Format ICS UTC : YYYYMMDDTHHMMSSZ (pas de tirets/deux-points).
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// Un événement ICS dépassant 75 octets par ligne doit être replié (RFC 5545,
// section 3.1) — sans ça, certains lecteurs de calendrier (dont l'app
// Calendrier iOS) tronquent ou rejettent la ligne plutôt que de l'afficher en
// entier.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  chunks.push(rest);
  return chunks.join('\r\n');
}

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  // Certains clients calendrier ajoutent ".ics" à l'URL collée — on l'accepte
  // en la retirant plutôt que de renvoyer 404 pour une URL par ailleurs valide.
  const token = params.token.replace(/\.ics$/i, '');

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, first_name, full_name')
    .eq('ics_feed_token', token)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: 'Lien invalide' }, { status: 404 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: appointments }, { data: blocks }] = await Promise.all([
    supabaseAdmin
      .from('appointments')
      .select('id, proposed_at, type, status, contact_name, prospects(full_name)')
      .eq('user_id', user.id)
      .eq('status', 'validé')
      .gte('proposed_at', windowStart)
      .lte('proposed_at', windowEnd),
    supabaseAdmin
      .from('availability_blocks')
      .select('id, start_at, end_at, reason')
      .eq('user_id', user.id)
      .eq('source', 'manuel')
      .gte('start_at', windowStart)
      .lte('start_at', windowEnd),
  ]);

  const APPOINTMENT_DURATION_MINUTES: Record<string, number> = {
    telephonique: 30,
    visio: 60,
    physique: 120,
  };

  const dtstamp = toIcsDate(now.toISOString());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meet Aaron//Agenda RDV//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Meet Aaron — RDV',
    'X-PUBLISHED-TTL:PT30M',
  ];

  for (const appt of appointments || []) {
    const startISO = appt.proposed_at;
    const endISO = new Date(
      new Date(startISO).getTime() + (APPOINTMENT_DURATION_MINUTES[appt.type] || 30) * 60 * 1000
    ).toISOString();
    const contactName = (appt as any).prospects?.full_name || appt.contact_name || 'un contact';

    lines.push(
      'BEGIN:VEVENT',
      `UID:appointment-${appt.id}@meetaaron.app`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${toIcsDate(startISO)}`,
      `DTEND:${toIcsDate(endISO)}`,
      foldLine(`SUMMARY:${escapeIcsText(`RDV avec ${contactName}`)}`),
      foldLine(`DESCRIPTION:${escapeIcsText(`Rendez-vous ${appt.type} — géré par Meet Aaron.`)}`),
      'END:VEVENT'
    );
  }

  for (const block of blocks || []) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:block-${block.id}@meetaaron.app`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${toIcsDate(block.start_at)}`,
      `DTEND:${toIcsDate(block.end_at)}`,
      foldLine(`SUMMARY:${escapeIcsText(block.reason ? `Indisponible — ${block.reason}` : 'Indisponible')}`),
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="meet-aaron-agenda.ics"',
      // Court plutôt que nul : l'app Calendrier iOS ne relit un abonnement
      // webcal que toutes les quelques heures de toute façon (pas de vrai
      // temps réel possible avec ce mécanisme, contrairement à la synchro
      // Google/Outlook) — pas la peine de forcer un re-fetch à chaque appel.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
