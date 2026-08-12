// app/api/business-summary/route.ts
// POST -> génère (via Claude) un résumé de l'activité de la société, à partir
// des synthèses de documents déjà disponibles (chantier "synthèse documents")
// et de la description donnée par l'utilisateur dans le chat lors de l'accueil.
// Le résumé est stocké sur companies.business_summary et réutilisé par Aaron
// (contexte enrichi) sans avoir à relire les documents à chaque fois.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const { user_id, description, qa } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('company_id')
    .eq('id', user_id)
    .single();

  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: documents } = await supabaseAdmin
    .from('company_documents')
    .select('name, summary')
    .eq('company_id', user.company_id)
    .order('created_at', { ascending: false })
    .limit(8);

  const documentSummaries = (documents || [])
    .filter((d) => d.summary)
    .map((d) => `- ${d.name} : ${d.summary}`)
    .join('\n');

  // Réponses structurées au questionnaire de découverte guidé (voir app/app/chat/page.jsx) —
  // bien plus exploitables pour le modèle qu'un unique pavé de texte libre.
  const qaText = Array.isArray(qa) && qa.length
    ? qa.map((item: any) => `Q: ${item.question || '(réponse libre)'}\nR: ${item.answer}`).join('\n\n')
    : '';

  if (!documentSummaries && !description && !qaText) {
    return NextResponse.json(
      { error: "Pas encore assez d'informations — ajoutez au moins un document ou une description." },
      { status: 400 }
    );
  }

  const prompt =
    `Tu es Aaron, copilote commercial IA. Voici ce qu'un commercial vient de te fournir pour que tu comprennes ` +
    `mieux son métier :\n\n` +
    (documentSummaries ? `Documents fournis (déjà résumés) :\n${documentSummaries}\n\n` : '') +
    (qaText ? `Réponses du commercial à un questionnaire de découverte :\n${qaText}\n\n` : '') +
    (description && !qaText ? `Description donnée à l'oral par le commercial :\n"""${description}"""\n\n` : '') +
    `Rédige un résumé clair et structuré de l'activité de cette société en 5 à 8 phrases : ce qu'elle vend, ` +
    `les différents profils/types de clients (s'il y en a plusieurs), le produit ou service phare, l'argument de ` +
    `vente qui fait le plus mouche, l'objection la plus fréquente et comment la lever, et le type de conclusion à ` +
    `viser après un premier contact (RDV, devis, essai...). Réponds uniquement avec ce résumé, en français, sans ` +
    `préambule ni titre.`;

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
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: err }, { status: 502 });
    }

    const data = await response.json();
    const textBlock = data.content.find((b: any) => b.type === 'text');
    const summary = textBlock?.text?.trim() || null;

    if (!summary) {
      return NextResponse.json({ error: 'Réponse vide du modèle' }, { status: 502 });
    }

    await supabaseAdmin.from('companies').update({ business_summary: summary }).eq('id', user.company_id);

    return NextResponse.json({ summary });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }
}
