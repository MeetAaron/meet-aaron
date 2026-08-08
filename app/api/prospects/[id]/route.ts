// app/api/prospects/[id]/route.ts
// GET   -> détail complet d'un prospect (fiche + historique des échanges)
// PATCH -> approuver ou rejeter une tentative de sauvetage proposée par Aaron
//          ("approuver_sauvetage" envoie l'email, "rejeter_sauvetage" abandonne sans envoyer)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendGmailEmail } from '@/lib/google';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name, domain)')
    .eq('id', params.id)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('prospect_id', params.id)
    .eq('channel', 'email')
    .single();

  let messages: any[] = [];
  if (conversation) {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('direction, body, sent_at')
      .eq('conversation_id', conversation.id)
      .order('sent_at', { ascending: true });
    messages = msgs || [];
  }

  return NextResponse.json({ prospect, messages });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { action } = await request.json();
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }

  if (action === 'approuver_sauvetage') {
    if (!prospect.rescue_proposal_subject || !prospect.rescue_proposal_body) {
      return NextResponse.json({ error: 'Aucune tentative de sauvetage en attente' }, { status: 400 });
    }

    await sendGmailEmail(
      prospect.assigned_user_id,
      prospect.email,
      prospect.rescue_proposal_subject,
      prospect.rescue_proposal_body
    );

    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('prospect_id', prospectId)
      .eq('channel', 'email')
      .single();

    if (conversation) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_email: '',
        recipient_email: prospect.email,
        body: prospect.rescue_proposal_body,
      });
    }

    await supabaseAdmin
      .from('prospects')
      .update({
        status: 'jaune',
        rescue_proposal_pending: false,
        rescue_proposal_subject: null,
        rescue_proposal_body: null,
      })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'sauvetage_envoye' });
  }

  if (action === 'rejeter_sauvetage') {
    await supabaseAdmin
      .from('prospects')
      .update({
        status: 'rouge',
        rescue_proposal_pending: false,
        rescue_proposal_subject: null,
        rescue_proposal_body: null,
      })
      .eq('id', prospectId);

    return NextResponse.json({ success: true, status: 'abandonne' });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
