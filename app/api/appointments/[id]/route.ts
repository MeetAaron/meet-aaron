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
import { deleteGoogleCalendarEvent, deleteOutlookCalendarEvent } from '@/lib/calendar-sync';
import { sendEmailForUser } from '@/lib/messaging';
import { confirmAppointment, rescheduleAppointment, cancellationDraft } from '@/lib/appointment-flow';

import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { canAccessAppointment } from '@/lib/appointment-access';
import { runInBackground } from '@/lib/background';
import { readJsonBody, serverError } from '@/lib/http';

// GET -> détails minimaux d'un RDV, utilisé par la page de bilan post-RDV
// (app/app/agenda/rdv/[id]/bilan) pour afficher le nom du prospect et savoir
// si un bilan a déjà été enregistré.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  let res: any = await supabaseAdmin
    .from('appointments')
    .select('id, user_id, contact_name, proposed_at, type, outcome, outcome_note, thank_you_sent_at, thank_you_error, prospects(full_name, email, assigned_user_id, company_id)')
    .eq('id', params.id)
    .single();
  if (res.error && res.error.code === '42703') {
    // migration_bilan_arriere_plan_2026-10-28.sql pas encore passée.
    res = await supabaseAdmin
      .from('appointments')
      .select('id, user_id, contact_name, proposed_at, type, outcome, outcome_note, thank_you_sent_at, prospects(full_name, email, assigned_user_id, company_id)')
      .eq('id', params.id)
      .single();
  }
  const appointment: any = res.data;
  const error = res.error;

  if (error || !appointment) {
    return NextResponse.json({ error: 'RDV introuvable' }, { status: 404 });
  }

  const prospect = (appointment as any).prospects;

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!canAccessAppointment(authedUser, appointment as any)) {
    return forbiddenResponse();
  }

  return NextResponse.json({
    id: appointment.id,
    proposed_at: appointment.proposed_at,
    type: appointment.type,
    outcome: appointment.outcome,
    outcome_note: appointment.outcome_note,
    prospect_full_name: prospect?.full_name || (appointment as any).contact_name || null,
    // Faux pour un contact saisi à la main : la page bilan masque alors la
    // case « email de remerciement », qui ne pouvait qu'échouer.
    can_send_thank_you: !!prospect?.email,
    // État de l'email de remerciement envoyé en arrière-plan après le bilan.
    thank_you_sent_at: appointment.thank_you_sent_at || null,
    thank_you_error: appointment.thank_you_error || null,
  });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const { action, force, preview, subject, body, skip_email, new_proposed_at } = await readJsonBody(request);
  const appointmentId = params.id;

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('*, prospects(full_name, email, assigned_user_id, prospect_companies(address, found_by_campaign_id))')
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: 'RDV introuvable' }, { status: 404 });
  }

  // Empêche d'agir sur le RDV d'un autre commercial en devinant/connaissant son id.
  // Autorisés (24/10/2026, revue des accès après le « Accès refusé » du
  // bilan) : le commercial à qui appartient le RDV (appointments.user_id, ce
  // que l'agenda et les Stories affichent) OU celui du prospect. Avant, seul
  // le commercial du prospect passait dès qu'il y avait un prospect : si les
  // deux différaient, le propriétaire du RDV était bloqué sur tous les
  // boutons. Pas d'accès « même société » ici : ces actions envoient des
  // emails depuis la boîte de celui qui agit.
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== appointment.user_id && authedUser.id !== appointment.prospects?.assigned_user_id) {
    return forbiddenResponse();
  }
  const userId = authedUser.id;

  if (action === 'valider') {
    // Même parcours que la confirmation automatique (lib/appointment-flow.ts,
    // 08/11/2026) : conflits sauf `force`, agenda, lien visio, email dans la
    // langue du prospect, prospect en bleu.
    const r = await confirmAppointment(appointmentId, userId, { force: !!force });
    if (!r.ok) return NextResponse.json({ conflict: true, reasons: r.reasons }, { status: 409 });
    return NextResponse.json({ success: true, status: 'validé', calendar_warning: r.calendarWarning });
  }

  if (action === 'reporter' && new_proposed_at) {
    // Report avec une nouvelle date choisie par le commercial (08/11/2026) :
    // l'ancien événement est retiré, le nouveau créé, le prospect prévenu
    // (« j'ai dû décaler… ») dans sa langue. Pas de contrôle de conflit : le
    // commercial a choisi lui-même le créneau.
    const when = new Date(new_proposed_at);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60000) {
      return NextResponse.json({ error: 'Date de report invalide' }, { status: 400 });
    }
    const r = await rescheduleAppointment(appointmentId, userId, when.toISOString());
    return NextResponse.json({ success: true, status: 'validé', calendar_warning: r.ok ? r.calendarWarning : null });
  }

  if (action === 'reporter') {
    await supabaseAdmin.from('appointments').update({ status: 'reporté' }).eq('id', appointmentId);
    return NextResponse.json({ success: true, status: 'reporté' });
  }

  if (action === 'annuler' && preview) {
    // Aaron prépare l'email d'annulation, le commercial le relit et l'envoie
    // lui-même (décision Alex, 08/11/2026). Rien n'est modifié ici.
    const draft = await cancellationDraft(appointmentId, userId);
    return NextResponse.json({ draft, already_past: new Date(appointment.proposed_at) < new Date() });
  }

  if (action === 'annuler') {
    const alreadyPast = new Date(appointment.proposed_at) < new Date();

    await supabaseAdmin.from('appointments').update({ status: 'annulé', cancelled_by: 'commercial' }).eq('id', appointmentId);

    // Nettoie l'événement calendrier Google/Outlook (28/08/2026) — sans ça,
    // un RDV annulé côté Aaron restait affiché comme si de rien n'était sur
    // le calendrier externe du commercial. Best-effort : l'annulation côté
    // Aaron est déjà actée, un souci ici ne doit pas la faire échouer.
    if (appointment.calendar_event_id && appointment.calendar_provider) {
      runInBackground(`suppression agenda RDV ${appointmentId}`, async () => {
        if (appointment.calendar_provider === 'google') {
          await deleteGoogleCalendarEvent(userId, appointment.calendar_event_id);
        } else if (appointment.calendar_provider === 'microsoft') {
          await deleteOutlookCalendarEvent(userId, appointment.calendar_event_id);
        }
      });
    }

    // Bug remonté par Alex (2026-08-20) : annuler un RDV dont la date est déjà
    // passée envoyait quand même au prospect "je dois annuler notre rendez-
    // vous prévu" — un non-sens pour un rendez-vous déjà terminé/manqué. Dans
    // ce cas on ne prévient pas le prospect ici ; le commercial choisira lui-
    // même de relancer (action "relancer", voir plus bas) via la notif moins
    // urgente qui apparaît désormais au tableau de bord pour ce cas.
    if (!alreadyPast && appointment.prospects?.email && !skip_email) {
      // Texte relu par le commercial (subject/body envoyés par la page),
      // sinon le brouillon d'Aaron dans la langue du prospect.
      const draft = typeof body === 'string' && body.trim() ? { subject: (typeof subject === 'string' && subject.trim()) || 'Concernant notre rendez-vous', body } : await cancellationDraft(appointmentId, userId);
      if (draft) {
        runInBackground(`email d'annulation RDV ${appointmentId}`, () =>
          sendEmailForUser(userId, appointment.prospects.email, draft.subject, draft.body)
        );
      }
    }

    if (appointment.prospect_id) {
      await supabaseAdmin.from('prospects').update({ status: 'jaune', status_updated_at: new Date().toISOString() }).eq('id', appointment.prospect_id);
    }

    return NextResponse.json({ success: true, status: 'annulé' });
  }

  if (action === 'relancer') {
    // RDV saisi avec un simple nom de contact : pas d'adresse email à qui
    // écrire. On le classe comme traité au lieu de planter (500).
    if (!appointment.prospects?.email) {
      await supabaseAdmin.from('appointments').update({ client_cancel_acknowledged: true }).eq('id', appointmentId);
      return NextResponse.json({ error: "Pas d'adresse email pour ce contact : relance-le directement." }, { status: 400 });
    }
    runInBackground(`relance RDV ${appointmentId}`, () =>
      sendEmailForUser(
        userId,
        appointment.prospects.email,
        'Reprogrammons notre rendez-vous',
        `Bonjour ${appointment.prospects.full_name},\n\nJ'ai bien noté que notre rendez-vous ne pouvait finalement pas avoir lieu. Quand seriez-vous disponible pour le reprogrammer ?\n\nCordialement.`
      )
    );

    await supabaseAdmin
      .from('appointments')
      .update({ client_cancel_acknowledged: true })
      .eq('id', appointmentId);

    if (appointment.prospect_id) {
      await supabaseAdmin.from('prospects').update({ status: 'jaune', status_updated_at: new Date().toISOString() }).eq('id', appointment.prospect_id);
    }

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
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const appointmentId = params.id;

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('proposed_at, user_id, prospects(assigned_user_id)')
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: 'RDV introuvable' }, { status: 404 });
  }

  // Le commercial du rendez-vous, ou celui du prospect (même règle que PATCH).
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== (appointment as any).user_id && authedUser.id !== (appointment as any).prospects?.assigned_user_id) {
    return forbiddenResponse();
  }

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
    return serverError(deleteError, '/api/appointments/[id]');
  }

  return NextResponse.json({ success: true });
}
