// app/api/messages/[id]/report-error/route.ts
//
// « Cet email est parti avec une erreur. » Voir lib/email-correction.ts pour
// le raisonnement — notamment pourquoi Aaron commence par JUGER si ça vaut un
// second message plutôt que d'en rédiger un systématiquement.
//
// POST  { reason }   -> marque le message et renvoie le verdict + le brouillon
// PATCH { send: true, subject, body } -> envoie le rattrapage après relecture
//
// Deux appels et pas un seul, volontairement : la relecture par le commercial
// est obligatoire et n'a pas de réglage pour la désactiver. Envoyer
// automatiquement une excuse pour un message envoyé automatiquement, ce
// serait remettre une pièce dans la machine qui vient de se tromper.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { readJsonBody, serverError } from '@/lib/http';
import { draftCorrection } from '@/lib/email-correction';
import { sendEmailForUser } from '@/lib/messaging';

// Le message, sa conversation, son prospect — et le commercial à qui il
// appartient, pour qu'on ne corrige pas l'email de quelqu'un d'autre.
async function loadContext(messageId: string) {
  const { data: message } = await supabaseAdmin
    .from('messages')
    .select('id, direction, body, recipient_email, conversation_id')
    .eq('id', messageId)
    .maybeSingle();
  if (!message) return null;
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id, prospect_id, prospects(id, assigned_user_id, email, full_name)')
    .eq('id', message.conversation_id)
    .maybeSingle();
  return { message, prospect: (conversation as any)?.prospects || null };
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const body = await readJsonBody(request);
  const reason = String(body?.reason || '').trim();
  if (!reason) return NextResponse.json({ error: 'Dis en une ligne ce qui ne va pas.' }, { status: 400 });

  const ctxData = await loadContext(id);
  if (!ctxData?.message) return NextResponse.json({ error: 'Message introuvable' }, { status: 404 });
  if (ctxData.message.direction !== 'outbound') {
    return NextResponse.json({ error: "Ce message n'a pas été envoyé par toi." }, { status: 400 });
  }
  if (ctxData.prospect?.assigned_user_id && ctxData.prospect.assigned_user_id !== authedUser.id) {
    return forbiddenResponse();
  }

  // On marque AVANT de rédiger. Même si l'analyse échoue, le message reste
  // signalé : Aaron ne doit plus jamais s'appuyer dessus pour une relance —
  // sinon dans deux semaines il relancera en citant un prix faux qu'il croit
  // avoir annoncé. Colonne optionnelle : si la migration n'est pas passée, on
  // continue quand même, le rattrapage vaut mieux que rien.
  const { error: markError } = await supabaseAdmin
    .from('messages')
    .update({ error_reported_at: new Date().toISOString(), error_reason: reason.slice(0, 500) })
    .eq('id', id);
  if (markError && markError.code !== '42703') {
    return serverError(markError, '/api/messages/[id]/report-error');
  }

  const verdict = await draftCorrection(id, reason);
  return NextResponse.json(verdict);
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const body = await readJsonBody(request);
  const subject = String(body?.subject || '').trim();
  const text = String(body?.body || '').trim();
  if (!subject || !text) return NextResponse.json({ error: 'Objet et message requis.' }, { status: 400 });

  const ctxData = await loadContext(id);
  if (!ctxData?.message) return NextResponse.json({ error: 'Message introuvable' }, { status: 404 });
  const prospect = ctxData.prospect;
  if (!prospect?.email) return NextResponse.json({ error: "Ce contact n'a pas d'adresse email." }, { status: 400 });
  if (prospect.assigned_user_id && prospect.assigned_user_id !== authedUser.id) return forbiddenResponse();

  try {
    // emailType transactionnel, PAS 'prospecting' : c'est une réparation dans
    // un fil déjà ouvert, bornée à une par incident. La compter dans le
    // plafond quotidien de démarchage reviendrait à faire payer au commercial
    // une erreur qu'il n'a pas commise.
    await sendEmailForUser(authedUser.id, prospect.email, subject, text, { emailType: 'transactional' });
  } catch (err: any) {
    console.error('Envoi du rattrapage impossible :', err?.message || err);
    return NextResponse.json({ error: err?.message || "L'envoi a échoué." }, { status: 502 });
  }

  await supabaseAdmin.from('messages').insert({
    conversation_id: ctxData.message.conversation_id,
    direction: 'outbound',
    sender_email: authedUser.email || null,
    recipient_email: prospect.email,
    body: text,
  });

  // Le calendrier de relance repart de zéro. Sans ça, la relance J+3 se
  // déclenche sur le message fautif et le prospect reçoit trois emails en une
  // semaine, dont un d'excuse — exactement le genre de séquence qui fait
  // classer un expéditeur en indésirable.
  await supabaseAdmin
    .from('prospects')
    .update({ status_updated_at: new Date().toISOString() })
    .eq('id', prospect.id)
    .then(() => {}, () => {});

  return NextResponse.json({ sent: true });
}
