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
import { resolveMeetingLink } from '@/lib/meeting-link';
import { readJsonBody, serverError } from '@/lib/http';

const VALID_TYPES = ['visio', 'physique', 'telephonique'];

// Même durée par type que app/api/appointments/[id]/route.ts (voir son
// commentaire) — dupliquée ici plutôt qu'importée, aucune route API n'importe
// une autre route API dans ce projet (uniquement lib/), donc on garde ce
// petit tableau self-contained comme le reste du fichier.
const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;
// Conservé pour l'historique ; la durée vient désormais de duration_minutes
// (60 par défaut, quel que soit le type — décision Alex, 18/10/2026).
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
    return serverError(error, '/api/appointments');
  }

  return NextResponse.json({ appointments });
}

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  const { user_id, type, proposed_at, prospect_id, contact_name, duration_minutes } = body;
  // Durée (18/10/2026, Alex : « il faut une heure de fin, de base 1 h ») :
  // 15 min à 8 h, 60 par défaut. Colonne appointments.duration_minutes
  // (migration_duree_rdv_2026-10-18.sql) ; si elle n'est pas encore jouée,
  // l'insert est retenté sans et la durée par défaut s'applique.
  const durationMinutes = Number.isFinite(Number(duration_minutes)) && Number(duration_minutes) >= 15 && Number(duration_minutes) <= 480
    ? Math.round(Number(duration_minutes))
    : DEFAULT_APPOINTMENT_DURATION_MINUTES;

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

  const baseRow = {
    user_id,
    prospect_id: prospect_id || null,
    contact_name: prospect_id ? null : contact_name.trim(),
    type,
    proposed_at,
    status: 'validé',
    source: 'manuel',
  };
  let insertRes: any = await supabaseAdmin
    .from('appointments')
    .insert({ ...baseRow, duration_minutes: durationMinutes })
    .select('*, prospects(full_name, email, prospect_companies(name))')
    .single();
  if (insertRes.error?.code === '42703') {
    insertRes = await supabaseAdmin
      .from('appointments')
      .insert(baseRow)
      .select('*, prospects(full_name, email, prospect_companies(name))')
      .single();
  }
  const appointment: any = insertRes.data;
  const error = insertRes.error;

  if (error) {
    return serverError(error, '/api/appointments');
  }

  // Pousse le RDV vers Google/Outlook (28/08/2026, demande Alex : "quand le
  // commercial mets [...] un rdv manuellement dans l'agenda aaron, ca se met
  // dans l'agenda de l'iphone du commercial"). Best-effort, jamais bloquant :
  // le RDV est déjà créé côté Aaron à ce stade, un souci de calendrier externe
  // (token expiré, aucun provider connecté...) ne doit pas faire échouer la
  // création — juste ne pas apparaître sur le calendrier externe.
  let calendarWarning: string | null = null;
  try {
    const providers = await getConnectedProviders(user_id);
    const startISO = proposed_at;
    const endISO = new Date(new Date(startISO).getTime() + durationMinutes * 60 * 1000).toISOString();
    const title = `RDV avec ${appointment.prospects?.full_name || appointment.contact_name || 'un contact'}`;
    const description = `Rendez-vous ${type} ajouté manuellement dans l'agenda Meet Aaron.`;
    const attendeeEmail = appointment.prospects?.email || undefined;

    let calendarEvent: any = null;
    let calendarProvider: 'google' | 'microsoft' | null = null;
    if (!providers.has('google') && !providers.has('microsoft')) {
      calendarWarning = "Aucun agenda Google ou Outlook connecté : ce rendez-vous n'est pas poussé dans le calendrier de ton téléphone. Il y apparaîtra via l'abonnement calendrier (Mon compte → Connexion → Mise en route), au prochain rafraîchissement — sur iPhone, cela peut prendre jusqu'à une heure.";
    }

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
      calendarEvent = await createOutlookCalendarEvent(user_id, {
        title,
        description,
        startISO,
        endISO,
        attendeeEmail,
        wantsMeetLink: type === 'visio',
      });
      calendarProvider = 'microsoft';
    }

    // Lien de visio (10/09/2026) : la salle permanente du commercial
    // (Préférences) prime sur le lien généré par Google/Microsoft — certains
    // préfèrent leur propre Zoom — et c'est le SEUL lien possible pour une
    // boîte IMAP, qui n'a pas d'agenda. Voir lib/meeting-link.ts.
    const meetLink = type === 'visio' ? await resolveMeetingLink(user_id, calendarEvent?.meetLink, startISO) : null;

    if (calendarEvent && calendarProvider) {
      await supabaseAdmin
        .from('appointments')
        .update({
          calendar_provider: calendarProvider,
          calendar_event_id: calendarEvent.id,
          meet_link: meetLink,
        })
        .eq('id', appointment.id);
      appointment.calendar_provider = calendarProvider;
      appointment.calendar_event_id = calendarEvent.id;
      appointment.meet_link = meetLink;
    } else if (meetLink) {
      // Aucun agenda connecté (IMAP) : on enregistre quand même le lien
      // permanent pour qu'il figure dans les emails et dans l'agenda Aaron.
      await supabaseAdmin.from('appointments').update({ meet_link: meetLink }).eq('id', appointment.id);
      appointment.meet_link = meetLink;
    }
  } catch (calendarErr: any) {
    console.error('Erreur poussée RDV manuel vers calendrier externe:', calendarErr.message);
    calendarWarning = `Rendez-vous créé dans Aaron, mais pas dans ton calendrier Google/Outlook : ${calendarErr.message}. Vérifie la connexion dans Mon compte → Connexion.`;
  }

  // calendar_warning (18/10/2026) : la page Agenda l'affiche en bandeau.
  return NextResponse.json({ appointment, calendar_warning: calendarWarning });
}
