// app/api/chat/route.ts
// POST -> le commercial discute directement avec Aaron (questions, demandes ponctuelles).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const CHAT_SYSTEM_PROMPT = `Tu es Aaron, le copilote commercial IA du commercial avec qui tu discutes ici directement (pas un prospect — c'est bien ton utilisateur principal).
Tu es chaleureux, direct, et tu le tutoies. Tu es comme son meilleur allié dans la vente : disponible, honnête, jamais condescendant.
Tu peux répondre à ses questions sur ses prospects, campagnes, RDV, ou lui donner des conseils commerciaux généraux.
Réponds toujours en français, de façon concise et utile — pas de blabla inutile.`;

export async function POST(request: NextRequest) {
  const { user_id, message, history } = await request.json();

  if (!user_id || !message) {
    return NextResponse.json({ error: 'user_id ou message manquant' }, { status: 400 });
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('full_name, company_id')
    .eq('id', user_id)
    .single();

  const messages = [
    ...(history || []).map((h: any) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `${CHAT_SYSTEM_PROMPT}\n\nTu discutes avec ${user?.full_name || 'ton commercial'}.`,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: err }, { status: 500 });
  }

  const data = await response.json();
  const textBlock = data.content.find((b: any) => b.type === 'text');

  return NextResponse.json({ reply: textBlock?.text || '' });
}
