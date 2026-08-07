// app/api/appointments/[id]/route.ts
// PATCH -> le commercial clique sur Valider / Reporter / Annuler pour un RDV proposé par Aaron.
//   - "valider"  -> crée l'événement calendrier (Google ou Outlook selon la connexion active)
//   - "reporter" -> repasse la main à Aaron pour proposer une nouvelle date au prospect
//   - "annuler"  -> marque le RDV annulé, prévient le prospect

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createGoogleCalendarEvent } from '@/lib/google';
import { createOutlookCalendarEvent } from '@/lib/microsoft';
import { sendGmailEmail } from '@/lib/google';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { action } = await request.json(); // "valider" | "reporter" | "annuler"
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

  if (action === 'valider') {
    // Détermine quel calendrier utiliser (priorité Google, sinon Microsoft)
    const { data: connections } = await supabaseAdmin
      .from('oauth_connections')
      .select('provider')
      .eq('user_id', userId);

    const hasGoogle = connections?.some((c) => c.provider === 'google');
    const hasMicrosoft = connections?.some((c) => c.provider === 'microsoft');

    const startISO = appointment.proposed_at;
    const endISO = new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString(); // durée par défaut 30 min

    let calendarEvent;
    let calendarProvider: 'google' | 'microsoft';

    if (hasGoogle) {
      calendarEvent = await createGoogleCalendarEvent(userId, {
        title: `RDV avec ${appointment.prospects.full_name}`,
        description: `Rendez-vous ${appointment.type} pris via Meet Aaron.`,
        startISO,
        endISO,
        attendeeEmail: appointment.prospects.email,
      });
      calendarProvider = 'google';
    } else if (hasMicrosoft) {
      calendarEvent = await createOutlookCalendarEvent(userId, {
        title: `RDV avec ${appointment.prospects.full_name}`,
        description: `Rendez-vous ${appointment.type} pris via Meet Aaron.`,
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
      })
      .eq('id', appointmentId);

    // Prospect repasse en statut "bleu" (RDV confirmé)
    await supabaseAdmin.from('prospects').update({ status: 'bleu' }).eq('id', appointment.prospect_id);

    return NextResponse.json({ success: true, status: 'validé' });
  }

  if (action === 'reporter') {
    await supabaseAdmin.from('appointments').update({ status: 'reporté' }).eq('id', appointmentId);
    // Le déclenchement d'une nouvelle proposition de créneau par Aaron se fait
    // via l'endpoint /api/prospects/[id]/generate (Aaron reprend la conversation).
    return NextResponse.json({ success: true, status: 'reporté' });
  }

  if (action === 'annuler') {
    await supabaseAdmin.from('appointments').update({ status: 'annulé' }).eq('id', appointmentId);

    // Prévient le prospect par email
    await sendGmailEmail(
      userId,
      appointment.prospects.email,
      'Concernant notre rendez-vous',
      `Bonjour ${appointment.prospects.full_name},\n\nMalheureusement, je dois annuler notre rendez-vous prévu. Je reviens vers vous rapidement pour convenir d'un autre créneau.\n\nCordialement.`
    );

    await supabaseAdmin.from('prospects').update({ status: 'jaune' }).eq('id', appointment.prospect_id);

    return NextResponse.json({ success: true, status: 'annulé' });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
