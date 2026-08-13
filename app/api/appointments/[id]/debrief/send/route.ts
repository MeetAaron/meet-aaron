// app/api/appointments/[id]/debrief/send/route.ts
// POST -> envoie l'email de relance post-RDV déjà généré (debrief_email_subject/
//         body) au prospect, au nom du commercial. Étape de validation
//         explicite (le commercial relit avant d'envoyer) — même logique que
//         l'approbation d'une tentative de sauvetage (voir
//         app/api/prospects/[id]/route.ts, action "approuver_sauvetage").

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { sendEmailForUser } from '@/lib/messaging';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const appointmentId = params.id;

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, debrief_email_subject, debrief_email_body, debrief_email_sent_at, prospect_id, prospects(assigned_user_id, company_id, full_name, email)')
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) {
    return NextResponse.json({ error: 'RDV introuvable' }, { status: 404 });
  }

  const prospect = (appointment as any).prospects;

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect?.assigned_user_id) return forbiddenResponse();

  if (!appointment.debrief_email_subject || !appointment.debrief_email_body) {
    return NextResponse.json({ error: "Aucun email de relance généré pour ce RDV — génère d'abord le compte-rendu." }, { status: 400 });
  }

  if (appointment.debrief_email_sent_at) {
    return NextResponse.json({ error: 'Cet email de relance a déjà été envoyé.' }, { status: 400 });
  }

  try {
    await sendEmailForUser(
      prospect.assigned_user_id,
      prospect.email,
      appointment.debrief_email_subject,
      appointment.debrief_email_body
    );
  } catch (err: any) {
    console.error('Erreur envoi email de relance post-RDV:', err.message);
    const message = err.message?.includes('Aucune boîte mail connectée')
      ? "Aucune boîte mail connectée — connectez Gmail ou Outlook dans \"Connexions\"."
      : "Erreur lors de l'envoi de l'email.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const sentAt = new Date().toISOString();
  await supabaseAdmin.from('appointments').update({ debrief_email_sent_at: sentAt }).eq('id', appointmentId);

  // Trace l'email dans l'historique de conversation du prospect, comme tout
  // autre message envoyé "au nom d'Aaron" (rescue proposal, premier message...).
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('prospect_id', appointment.prospect_id)
    .eq('channel', 'email')
    .maybeSingle();

  if (conversation) {
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      sender_email: '',
      recipient_email: prospect.email,
      body: appointment.debrief_email_body,
    });
  }

  return NextResponse.json({ success: true, sent_at: sentAt });
}
