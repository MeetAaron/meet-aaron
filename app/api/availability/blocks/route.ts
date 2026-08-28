// app/api/availability/blocks/route.ts
// POST -> crée une indisponibilité ponctuelle (ex: vacances, rendez-vous personnel).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { createGoogleCalendarEvent } from '@/lib/google';
import { createOutlookCalendarEvent } from '@/lib/microsoft';
import { getConnectedProviders } from '@/lib/messaging';

export async function POST(request: NextRequest) {
  const { user_id, start_at, end_at, reason } = await request.json();

  if (!user_id || !start_at || !end_at) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  if (new Date(start_at) >= new Date(end_at)) {
    return NextResponse.json({ error: 'La date de fin doit être après la date de début' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('availability_blocks')
    .insert({ user_id, start_at, end_at, reason: reason || null, source: 'manuel' })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Pousse l'indisponibilité vers Google/Outlook (28/08/2026, demande Alex —
  // même logique que pour un RDV manuel, voir app/api/appointments/route.ts).
  // Best-effort, jamais bloquant : l'indisponibilité est déjà créée côté
  // Aaron à ce stade.
  try {
    const providers = await getConnectedProviders(user_id);
    const title = reason ? `Indisponible — ${reason}` : 'Indisponible';
    const description = 'Indisponibilité ajoutée manuellement dans l\'agenda Meet Aaron.';

    let calendarEvent: any = null;
    let calendarProvider: 'google' | 'microsoft' | null = null;

    if (providers.has('google')) {
      calendarEvent = await createGoogleCalendarEvent(user_id, { title, description, startISO: start_at, endISO: end_at });
      calendarProvider = 'google';
    } else if (providers.has('microsoft')) {
      calendarEvent = await createOutlookCalendarEvent(user_id, { title, description, startISO: start_at, endISO: end_at });
      calendarProvider = 'microsoft';
    }

    if (calendarEvent && calendarProvider) {
      await supabaseAdmin
        .from('availability_blocks')
        .update({ calendar_provider: calendarProvider, calendar_event_id: calendarEvent.id })
        .eq('id', data.id);
      data.calendar_provider = calendarProvider;
      data.calendar_event_id = calendarEvent.id;
    }
  } catch (calendarErr: any) {
    console.error('Erreur poussée indisponibilité vers calendrier externe:', calendarErr.message);
  }

  return NextResponse.json({ block: data });
}
