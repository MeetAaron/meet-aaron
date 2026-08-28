// app/api/appointments/route.ts
// GET  -> liste les rendez-vous d'un commercial (utilisé par le tableau de bord et l'agenda)
// POST -> crée manuellement un RDV depuis l'agenda (pris en dehors d'Aaron :
//         le prospect a appelé directement, ou contact perso du commercial).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { createGoogleCalendarEvent } from '@/lib/google';
import { createOutlookCalendarEvent } from '@/lib/microsoft';
import { getConnectedProviders } from '@/lib/messaging';

const VALID_TYPES = ['visio', 'physique', 'telephonique'];

// Même durée par type que app/api/appointments/[id]/route.ts (voir son
// commentaire) — dupliquée ici plutôt qu'importée, aucune route API n'importe
// une autre route API dans ce projet (uniquement lib/), donc on garde ce
// petit tableau self-contained comme le reste du fichier.
const APPOINTMENT_DURATION_MINUTES: Record<string, number> = {
  telephonique: 30,
  visio: 60,
  physique: 120,
};

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select('*, prospects(full_name, email, prospect_companies(name))')
    .eq('user_id', userId)
    .order('proposed_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ appointments });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { user_id, type, proposed_at, prospect_id, contact_name } = body;

  if (!user_id || !type || !proposed_at) {
    return NextResponse.json({ error: 'Champs requis manquants (user_id, type, proposed_at)' }, { status: 400 });
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Type de RDV invalide' }, { status: 400 });
  }
  if (!prospect_id && !contact_name?.trim()) {
    return NextResponse.json({ error: 'Choisissez un prospect suivi par Aaron ou indiquez le nom du contact' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  if (prospect_id) {
    const { data: prospect } = await supabaseAdmin
      .from('prospects')
      .select('id, assigned_user_id')
      .eq('id', prospect_id)
      .single();
    if (!prospect || prospect.assigned_user_id !== user_id) return forbiddenResponse();
  }

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      user_id,
      prospect_id: prospect_id || null,
      contact_name: prospect_id ? null : contact_name.trim(),
      type,
      proposed_at,
      status: 'validé',
      source: 'manuel',
    })
    .select('*, prospects(full_name, email, prospect_companies(name))')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Pousse le RDV vers Google/Outlook (28/08/2026, demande Alex : "quand le
  // commercial mets [...] un rdv manuellement dans l'agenda aaron, ca se met
  // dans l'agenda de l'iphone du commercial"). Best-effort, jamais bloquant :
  // le RDV est déjà créé côté Aaron à ce stade, un souci de calendrier externe
  // (token expiré, aucun provider connecté...) ne doit pas faire échouer la
  // création — juste ne pas apparaître sur le calendrier externe.
  try {
    const providers = await getConnectedProviders(user_id);
    const startISO = proposed_at;
    const endISO = new Date(
      new Date(startISO).getTime() + (APPOINTMENT_DURATION_MINUTES[type] || 30) * 60 * 1000
    ).toISOString();
    const title = `RDV avec ${appointment.prospects?.full_name || appointment.contact_name || 'un contact'}`;
    const description = `Rendez-vous ${type} ajouté manuellement dans l'agenda Meet Aaron.`;
    const attendeeEmail = appointment.prospects?.email || undefined;

    let calendarEvent: any = null;
    let calendarProvider: 'google' | 'microsoft' | null = null;

    if (providers.has('google')) {
      calendarEvent = await createGoogleCalendarEvent(user_id, {
        title,
        description,
        startISO,
        endISO,
        attendeeEmail,
        wantsMeetLink: type === 'visio',
      });
      calendarProvider = 'google';
    } else if (providers.has('microsoft')) {
      calendarEvent = await createOutlookCalendarEvent(user_id, { title, description, startISO, endISO, attendeeEmail });
      calendarProvider = 'microsoft';
    }

    if (calendarEvent && calendarProvider) {
      await supabaseAdmin
        .from('appointments')
        .update({
          calendar_provider: calendarProvider,
          calendar_event_id: calendarEvent.id,
          meet_link: calendarEvent.meetLink || null,
        })
        .eq('id', appointment.id);
      appointment.calendar_provider = calendarProvider;
      appointment.calendar_event_id = calendarEvent.id;
      appointment.meet_link = calendarEvent.meetLink || null;
    }
  } catch (calendarErr: any) {
    console.error('Erreur poussée RDV manuel vers calendrier externe:', calendarErr.message);
  }

  return NextResponse.json({ appointment });
}
