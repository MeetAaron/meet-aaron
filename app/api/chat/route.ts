// app/api/chat/route.ts
// POST -> le commercial discute directement avec Aaron (questions, demandes ponctuelles).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const CHAT_SYSTEM_PROMPT = `Tu es Aaron, le copilote commercial IA du commercial avec qui tu discutes ici directement (pas un prospect — c'est bien ton utilisateur principal).
Tu es chaleureux, direct, et tu le tutoies. Tu es comme son meilleur allié dans la vente : disponible, honnête, jamais condescendant.
Tu peux répondre à ses questions sur ses prospects, campagnes, RDV, ou lui donner des conseils commerciaux généraux.
Réponds toujours en français, de façon concise et utile — pas de blabla inutile.
Si le commercial exprime une suggestion, une remarque ou une idée d'amélioration sur l'outil, le produit ou l'organisation,
dis-lui simplement que tu transmets l'info au fondateur — tu n'as pas besoin de lui demander de le faire lui-même par email,
c'est déjà fait automatiquement de ton côté.`;

// Détecte si le message du commercial contient une suggestion/remarque destinée au
// fondateur (à propos de l'outil, du produit, de l'organisation...), pour la relayer
// automatiquement dans feedback_messages — sans que le commercial ait à écrire un email
// ou à utiliser le bouton "Signaler à l'équipe" manuel.
async function detectFounderSuggestion(message: string): Promise<{ isSuggestion: boolean; summary: string | null }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content:
              `Un commercial vient d'écrire ce message à Aaron (son copilote IA) :\n"""${message}"""\n\n` +
              `Ce message contient-il une suggestion, une idée d'amélioration, une remarque ou une plainte destinée ` +
              `au fondateur/à l'équipe (à propos de l'outil Meet Aaron, du produit, de l'organisation, etc.) — ` +
              `et PAS juste une question opérationnelle sur un prospect, un RDV ou une campagne ?\n` +
              `Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour : ` +
              `{"is_suggestion": true|false, "summary": "résumé en une phrase si true, sinon null"}`,
          },
        ],
      }),
    });

    if (!response.ok) return { isSuggestion: false, summary: null };

    const data = await response.json();
    const textBlock = data.content.find((b: any) => b.type === 'text');
    if (!textBlock) return { isSuggestion: false, summary: null };

    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return { isSuggestion: !!parsed.is_suggestion, summary: parsed.summary || null };
  } catch (err) {
    // On ne bloque jamais la réponse du chat pour un souci de détection —
    // dans le doute, on ne relaie rien.
    return { isSuggestion: false, summary: null };
  }
}

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

  let businessContext = '';
  if (user?.company_id) {
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('business_summary')
      .eq('id', user.company_id)
      .maybeSingle();
    if (company?.business_summary) {
      businessContext = `\n\nRésumé de l'activité de la société (généré précédemment à partir des documents et des explications du commercial) : ${company.business_summary}`;
    }
  }

  const messages = [
    ...(history || []).map((h: any) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  const [response, suggestion] = await Promise.all([
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: [
          {
            type: 'text',
            text: `${CHAT_SYSTEM_PROMPT}\n\nTu discutes avec ${user?.full_name || 'ton commercial'}.${businessContext}`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
      }),
    }),
    detectFounderSuggestion(message),
  ]);

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: err }, { status: 500 });
  }

  if (suggestion.isSuggestion && user?.company_id) {
    await supabaseAdmin.from('feedback_messages').insert({
      user_id,
      company_id: user.company_id,
      message: suggestion.summary || message,
      source: 'chat_auto',
      context: message,
    });
  }

  const data = await response.json();
  const textBlock = data.content.find((b: any) => b.type === 'text');

  return NextResponse.json({ reply: textBlock?.text || '' });
}
