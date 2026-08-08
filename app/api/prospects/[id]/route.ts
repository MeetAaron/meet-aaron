// app/api/prospects/[id]/route.ts
// GET -> détail complet d'un prospect (fiche + historique des échanges),
// utilisé par la carte "Actions requises" du tableau de bord.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

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
