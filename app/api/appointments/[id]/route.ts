// app/api/appointments/[id]/route.ts
// PATCH -> actions sur un rendez-vous :
//   - "valider"  -> crée l'événement calendrier (Google ou Outlook)
//   - "reporter" -> repasse la main à Aaron pour une nouvelle date
//   - "annuler"  -> annule côté commercial, prévient le prospect (SAUF si le RDV est déjà
//     passé — voir plus bas, bug remonté par Alex le 2026-08-20 : annuler un RDV déjà passé
//     envoyait quand même au prospect "je dois annuler notre rendez-vous prévu", ce qui n'a pas
//     de sens pour un rendez-vous déjà terminé/manqué)
//   - "relancer" -> (RDV annulé par le client, OU RDV passé annulé côté commercial) envoie un
//     email de relance pour reprogrammer — CHANGEMENTS A FAIRE Prospects/A2 (2026-08-20) : un RDV
//     déjà passé qu'on annule doit proposer une notif "moins urgente" de reprise de contact au
//     lieu du message d'annulation classique ; on réutilise le même mécanisme que pour un RDV
//     annulé par le client plutôt que d'ajouter un nouveau statut.
//   - "traiter"  -> (RDV annulé par le client, ou RDV passé annulé côté commercial) marque
//     l'annulation comme prise en compte, sans email
//   - "acquitter_manque" -> (RDV manqué, date dépassée sans validation) le commercial "prend
//     connaissance" du message du bandeau "actions manquées" du tableau de bord, SANS déclencher
//     de validation/annulation — voir CHANGEMENTS A FAIRE #2 et migration_dashboard_missed_actions_2026-08-15.sql
//   - "supprimer" (DELETE) -> supprime définitivement un RDV déjà passé (bouton absent
//     auparavant — CHANGEMENTS A FAIRE Prospects/A4, 2026-08-20)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createGoogleCalendarEvent } from '@/lib/google';
import { createOutlookCalendarEvent } from '@/lib/microsoft';
import { sendEmailForUser, getFreeBusyForUser } from '@/lib/messaging';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

// Durée estimée par type de RDV — utilisée pour bloquer le bon créneau dans
// le calendrier et pour la vérification de conflit. Avant, une durée fixe de
// 30 min était utilisée pour TOUS les types, y compris les RDV physiques
// (largement sous-estimés en pratique).
const APPOINTMENT_DURATION_MINUTES: Record<string, number> = {
  telephonique: 30,
  visio: 60,
  physique: 120,
};

function durationMinutesForType(type: string): number {
  return APPOINTMENT_DURATION_MINUTES[type] || 30;
}

// Vérifie que le créneau [startISO, endISO] ne rentre pas en conflit avec :
//  - une indisponibilité ponctuelle déclarée (availability_blocks)
//  - les créneaux récurrents déclarés (availability_rules), s'il y en a
//  - le calendrier réel du commercial (freebusy Google et/ou Microsoft), s'il est connecté
// Retourne la liste des raisons de conflit (vide = aucun conflit détecté).
async function detectSchedulingConflicts(userId: string, startISO: string, endISO: string) {
  const reasons: string[] = [];
  const start = new Date(startISO);
  const end = new Date(endISO);

  const { data: blocks } = await supabaseAdmin
    .from('availability_blocks')
    .select('start_at, end_at, reason')
    .eq('user_id', userId)
    .lt('start_at', endISO)
    .gt('end_at', startISO);

  if (blocks && blocks.length > 0) {
    reasons.push(`Chevauche une indisponibilité déclarée${blocks[0].reason ? ` (${blocks[0].reason})` : ''}.`);
  }

  const { data: rules } = await supabaseAdmin
    .from('availability_rules')
    .select('day_of_week, start_time, end_time')
    .eq('user_id', userId);

  if (rules && rules.length > 0) {
    const dayOfWeek = start.getDay();
    const timeStr = start.toTimeString().slice(0, 8); // HH:MM:SS
    const withinAnyRule = rules.some(
      (r) => r.day_of_week === dayOfWeek && timeStr >= r.start_time && timeStr < r.end_time
    );
    if (!withinAnyRule) {
      reasons.push("En dehors des créneaux de disponibilité déclarés.");
    }
  }

  const busy = await getFreeBusyForUser(userId, startISO, endISO);
  const overlaps = busy.some((b) => new Date(b.start) < end && new Date(b.end) > start);
  if (overlaps) {
    reasons.push('Chevauche un événement déjà présent sur votre agenda (Google ou Outlook).');
  }

  return reasons;
}

// GET -> détails minimaux d'un RDV, utilisé par la page de bilan post-RDV
// (app/app/agenda/rdv/[id]/bilan) pour afficher le nom du prospect et savoir
// si un bilan a déjà été enregistré.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, proposed_at, type, outcome, outcome_note, prospects(full_name, assigned_user_id, company_id)')
    .eq('id', params.id)
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: 'RDV introuvable' }, { status: 404 });
  }

  const prospect = (appointment as any).prospects;

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect?.assigned_user_id && authedUser.company_id !== prospect?.company_id) {
    return forbiddenResponse();
  }

  return NextResponse.json({
    id: appointment.id,
    proposed_at: appointment.proposed_at,
    type: appointment.type,
    outcome: appointment.outcome,
    outcome_note: appointment.outcome_note,
    prospect_full_name: prospect?.full_name || null,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { action, force } = await request.json();
  const appointmentId = params.id;

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('*, prospects(full_name, email, assigned_user_id)')
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: 'RDV introuvable' }, { status: 404 });
  }

  const userId = appointment.prospects.assigned_user_id;

  // Empêche d'agir sur le RDV d'un autre commercial en devinant/connaissant son id.
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  if (action === 'valider') {
    const { data: connections } = await supabaseAdmin
      .from('oauth_connections')
      .select('provider')
      .eq('user_id', userId);

    const hasGoogle = connections?.some((c) => c.provider === 'google');
    const hasMicrosoft = connections?.some((c) => c.provider === 'microsoft');

    const startISO = appointment.proposed_at;
    const endISO = new Date(
      new Date(startISO).getTime() + durationMinutesForType(appointment.type) * 60 * 1000
    ).toISOString();

    if (!force) {
      const conflicts = await detectSchedulingConflicts(userId, startISO, endISO);
      if (conflicts.length > 0) {
        return NextResponse.json({ conflict: true, reasons: conflicts }, { status: 409 });
      }
    }

    let calendarEvent;
    let calendarProvider: 'google' | 'microsoft';

    if (hasGoogle) {
      calendarEvent = await createGoogleCalendarEvent(userId, {
        title: `RDV avec ${appointment.prospects.full_name}`,
        description: `Rendez-vous ${appointment.type} avec ${appointment.prospects.full_name}.`,
        startISO,
        endISO,
        attendeeEmail: appointment.prospects.email,
        wantsMeetLink: appointment.type === 'visio',
      });
      calendarProvider = 'google';
    } else if (hasMicrosoft) {
      calendarEvent = await createOutlookCalendarEvent(userId, {
        title: `RDV avec ${appointment.prospects.full_name}`,
        description: `Rendez-vous ${appointment.type} avec ${appointment.prospects.full_name}.`,
        startISO,
        endISO,
        attendeeEmail: appointment.prospects.email,
      });
      calendarProvider = 'microsoft';
    } else {
      return NextResponse.json(
        { error: "Aucun calendrier connecté (Google ou Microsoft) pour ce commercial" },
        { status: 400 }
      );
    }

    await supabaseAdmin
      .from('appointments')
      .update({
        status: 'validé',
        calendar_provider: calendarProvider,
        calendar_event_id: calendarEvent.id,
        meet_link: calendarEvent.meetLink || null,
      })
      .eq('id', appointmentId);

    await supabaseAdmin.from('prospects').update({ status: 'bleu', status_updated_at: new Date().toISOString() }).eq('id', appointment.prospect_id);

    return NextResponse.json({ success: true, status: 'validé' });
  }

  if (action === 'reporter') {
    await supabaseAdmin.from('appointments').update({ status: 'reporté' }).eq('id', appointmentId);
    return NextResponse.json({ success: true, status: 'reporté' });
  }

  if (action === 'annuler') {
    const alreadyPast = new Date(appointment.proposed_at) < new Date();

    await supabaseAdmin.from('appointments').update({ status: 'annulé', cancelled_by: 'commercial' }).eq('id', appointmentId);

    // Bug remonté par Alex (2026-08-20) : annuler un RDV dont la date est déjà
    // passée envoyait quand même au prospect "je dois annuler notre rendez-
    // vous prévu" — un non-sens pour un rendez-vous déjà terminé/manqué. Dans
    // ce cas on ne prévient pas le prospect ici ; le commercial choisira lui-
    // même de relancer (action "relancer", voir plus bas) via la notif moins
    // urgente qui apparaît désormais au tableau de bord pour ce cas.
    if (!alreadyPast) {
      await sendEmailForUser(
        userId,
        appointment.prospects.email,
        'Concernant notre rendez-vous',
        `Bonjour ${appointment.prospects.full_name},\n\nMalheureusement, je dois annuler notre rendez-vous prévu. Je reviens vers vous rapidement pour convenir d'un autre créneau.\n\nCordialement.`
      );
    }

    await supabaseAdmin.from('prospects').update({ status: 'jaune', status_updated_at: new Date().toISOString() }).eq('id', appointment.prospect_id);

    return NextResponse.json({ success: true, status: 'annulé' });
  }

  if (action === 'relancer') {
    await sendEmailForUser(
      userId,
      appointment.prospects.email,
      'Reprogrammons notre rendez-vous',
      `Bonjour ${appointment.prospects.full_name},\n\nJ'ai bien noté que notre rendez-vous ne pouvait finalement pas avoir lieu. Quand seriez-vous disponible pour le reprogrammer ?\n\nCordialement.`
    );

    await supabaseAdmin
      .from('appointments')
      .update({ client_cancel_acknowledged: true })
      .eq('id', appointmentId);

    await supabaseAdmin.from('prospects').update({ status: 'jaune', status_updated_at: new Date().toISOString() }).eq('id', appointment.prospect_id);

    return NextResponse.json({ success: true, status: 'relance_envoyee' });
  }

  if (action === 'traiter') {
    await supabaseAdmin
      .from('appointments')
      .update({ client_cancel_acknowledged: true })
      .eq('id', appointmentId);

    return NextResponse.json({ success: true, status: 'traite' });
  }

  if (action === 'acquitter_manque') {
    await supabaseAdmin
      .from('appointments')
      .update({ missed_action_acknowledged: true })
      .eq('id', appointmentId);

    return NextResponse.json({ success: true, status: 'manque_acquitte' });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}

// DELETE -> supprime définitivement un RDV déjà passé. CHANGEMENTS A FAIRE
// Prospects/A4 (2026-08-20) : Alex n'avait aucun moyen de supprimer un RDV
// dont la date était dépassée, seulement de l'annuler (ce qui, en plus,
// envoyait à tort un email d'annulation au prospect pour un rendez-vous déjà
// passé — voir le commentaire sur l'action "annuler" plus haut). Volontairement
// limité aux RDV déjà passés : un RDV à venir doit être annulé (pour prévenir
// le prospect), pas supprimé en silence.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const appointmentId = params.id;

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('proposed_at, prospects(assigned_user_id)')
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: 'RDV introuvable' }, { status: 404 });
  }

  const userId = (appointment as any).prospects?.assigned_user_id;

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  if (new Date(appointment.proposed_at) >= new Date()) {
    return NextResponse.json(
      { error: "Ce RDV n'est pas encore passé — annulez-le plutôt, pour prévenir le prospect." },
      { status: 400 }
    );
  }

  // notifications_log référence appointment_id (voir les crons de rappel/
  // bilan RDV) — on nettoie d'abord pour éviter une violation de contrainte
  // de clé étrangère à la suppression.
  await supabaseAdmin.from('notifications_log').delete().eq('appointment_id', appointmentId);

  const { error: deleteError } = await supabaseAdmin.from('appointments').delete().eq('id', appointmentId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
