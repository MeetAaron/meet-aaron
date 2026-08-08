// app/api/appointments/[id]/route.ts
// PATCH -> actions sur un rendez-vous :
//   - "valider"  -> crée l'événement calendrier (Google ou Outlook)
//   - "reporter" -> repasse la main à Aaron pour une nouvelle date
//   - "annuler"  -> annule côté commercial, prévient le prospect
//   - "relancer" -> (RDV annulé par le client) envoie un email de relance pour reprogrammer
//   - "traiter"  -> (RDV annulé par le client) marque l'annulation comme prise en compte, sans email

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createGoogleCalendarEvent, sendGmailEmail } from '@/lib/google';
import { createOutlookCalendarEvent } from '@/lib/microsoft';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { action } = await request.json();
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
    const { data: connections } = await supabaseAdmin
      .from('oauth_connections')
      .select('provider')
      .eq('user_id', userId);

    const hasGoogle = connections?.some((c) => c.provider === 'google');
    const hasMicrosoft = connections?.some((c) => c.provider === 'microsoft');

    const startISO = appointment.proposed_at;
    const endISO = new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString();

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

    await supabaseAdmin.from('prospects').update({ status: 'bleu' }).eq('id', appointment.prospect_id);

    return NextResponse.json({ success: true, status: 'validé' });
  }

  if (action === 'reporter') {
    await supabaseAdmin.from('appointments').update({ status: 'reporté' }).eq('id', appointmentId);
    return NextResponse.json({ success: true, status: 'reporté' });
  }

  if (action === 'annuler') {
    await supabaseAdmin.from('appointments').update({ status: 'annulé', cancelled_by: 'commercial' }).eq('id', appointmentId);

    await sendGmailEmail(
      userId,
      appointment.prospects.email,
      'Concernant notre rendez-vous',
      `Bonjour ${appointment.prospects.full_name},\n\nMalheureusement, je dois annuler notre rendez-vous prévu. Je reviens vers vous rapidement pour convenir d'un autre créneau.\n\nCordialement.`
    );

    await supabaseAdmin.from('prospects').update({ status: 'jaune' }).eq('id', appointment.prospect_id);

    return NextResponse.json({ success: true, status: 'annulé' });
  }

  if (action === 'relancer') {
    await sendGmailEmail(
      userId,
      appointment.prospects.email,
      'Reprogrammons notre rendez-vous',
      `Bonjour ${appointment.prospects.full_name},\n\nJ'ai bien noté que notre rendez-vous ne pouvait finalement pas avoir lieu. Quand seriez-vous disponible pour le reprogrammer ?\n\nCordialement.`
    );

    await supabaseAdmin
      .from('appointments')
      .update({ client_cancel_acknowledged: true })
      .eq('id', appointmentId);

    await supabaseAdmin.from('prospects').update({ status: 'jaune' }).eq('id', appointment.prospect_id);

    return NextResponse.json({ success: true, status: 'relance_envoyee' });
  }

  if (action === 'traiter') {
    await supabaseAdmin
      .from('appointments')
      .update({ client_cancel_acknowledged: true })
      .eq('id', appointmentId);

    return NextResponse.json({ success: true, status: 'traite' });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
