// app/api/availability/blocks/[id]/route.ts
// DELETE -> supprime une indisponibilité ponctuelle.
// PATCH  -> modifie une indisponibilité existante (dates/raison), sans passer
//           par supprimer-puis-recréer (docx "AGENDA" item A3 : "je dois
//           pouvoir supprimer la ligne ou la modifier").
// Les deux vérifient que le block appartient bien au user_id fourni.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { createGoogleCalendarEvent } from '@/lib/google';
import { createOutlookCalendarEvent } from '@/lib/microsoft';
import { deleteGoogleCalendarEvent, deleteOutlookCalendarEvent } from '@/lib/calendar-sync';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json();
  const userId = body.user_id;
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: block } = await supabaseAdmin
    .from('availability_blocks')
    .select('id, user_id, calendar_event_id, calendar_provider')
    .eq('id', params.id)
    .maybeSingle();

  if (!block || block.user_id !== userId) {
    return NextResponse.json({ error: 'Indisponibilité introuvable' }, { status: 404 });
  }

  const update: Record<string, any> = {};
  if (typeof body.start_at === 'string') update.start_at = body.start_at;
  if (typeof body.end_at === 'string') update.end_at = body.end_at;
  if (body.reason !== undefined) update.reason = body.reason || null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('availability_blocks')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Répercute la modification sur Google/Outlook si cette indisponibilité y
  // avait été poussée (28/08/2026). Pas d'API "update" dédiée utilisée ici :
  // on supprime l'ancien événement et on en recrée un — plus simple que de
  // gérer un endpoint PATCH distinct par provider pour un cas d'usage mineur
  // (modifier une indispo déjà synchronisée reste rare). Best-effort, jamais
  // bloquant pour la modification elle-même (déjà actée côté Aaron).
  if (block.calendar_event_id && block.calendar_provider) {
    try {
      if (block.calendar_provider === 'google') {
        await deleteGoogleCalendarEvent(userId, block.calendar_event_id);
        const recreated = await createGoogleCalendarEvent(userId, {
          title: updated.reason ? `Indisponible — ${updated.reason}` : 'Indisponible',
          description: 'Indisponibilité ajoutée manuellement dans l\'agenda Meet Aaron.',
          startISO: updated.start_at,
          endISO: updated.end_at,
        });
        await supabaseAdmin.from('availability_blocks').update({ calendar_event_id: recreated.id }).eq('id', params.id);
      } else if (block.calendar_provider === 'microsoft') {
        await deleteOutlookCalendarEvent(userId, block.calendar_event_id);
        const recreated = await createOutlookCalendarEvent(userId, {
          title: updated.reason ? `Indisponible — ${updated.reason}` : 'Indisponible',
          description: 'Indisponibilité ajoutée manuellement dans l\'agenda Meet Aaron.',
          startISO: updated.start_at,
          endISO: updated.end_at,
        });
        await supabaseAdmin.from('availability_blocks').update({ calendar_event_id: recreated.id }).eq('id', params.id);
      }
    } catch (calendarErr: any) {
      console.error('Erreur mise à jour indisponibilité sur calendrier externe:', calendarErr.message);
    }
  }

  return NextResponse.json({ block: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: block } = await supabaseAdmin
    .from('availability_blocks')
    .select('id, user_id, calendar_event_id, calendar_provider')
    .eq('id', params.id)
    .maybeSingle();

  if (!block || block.user_id !== userId) {
    return NextResponse.json({ error: 'Indisponibilité introuvable' }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from('availability_blocks').delete().eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Nettoie l'événement sur Google/Outlook si cette indisponibilité y avait
  // été poussée (28/08/2026) — sinon elle resterait affichée sur le
  // calendrier externe alors qu'elle n'existe plus côté Aaron. Best-effort :
  // la suppression côté Aaron est déjà actée, un souci ici ne doit pas la
  // faire échouer.
  if (block.calendar_event_id && block.calendar_provider) {
    try {
      if (block.calendar_provider === 'google') {
        await deleteGoogleCalendarEvent(userId, block.calendar_event_id);
      } else if (block.calendar_provider === 'microsoft') {
        await deleteOutlookCalendarEvent(userId, block.calendar_event_id);
      }
    } catch (calendarErr: any) {
      console.error('Erreur suppression indisponibilité sur calendrier externe:', calendarErr.message);
    }
  }

  return NextResponse.json({ success: true });
}
