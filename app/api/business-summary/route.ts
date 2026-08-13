// app/api/business-summary/route.ts
// POST -> génère (via Claude) un résumé de l'activité de la société, à partir
// des synthèses de documents déjà disponibles (chantier "synthèse documents")
// et de la description donnée par l'utilisateur dans le chat lors de l'accueil.
// Le résumé est stocké sur companies.business_summary et réutilisé par Aaron
// (contexte enrichi) sans avoir à relire les documents à chaque fois.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';

// GET -> relit le résumé métier déjà généré, pour qu'un commercial puisse le
// retrouver et le consulter à tout moment depuis "Préférences" (pas seulement
// juste après l'onboarding).
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('business_summary')
    .eq('id', user.company_id)
    .single();

  return NextResponse.json({ summary: company?.business_summary || null });
}

// PATCH -> permet au commercial de corriger/étoffer le résumé à la main,
// sans repasser par une régénération via Claude.
export async function PATCH(request: NextRequest) {
  const { user_id, summary } = await request.json();

  if (!user_id || typeof summary !== 'string') {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from('companies')
    .update({ business_summary: summary.trim() })
    .eq('id', user.company_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest) {
  const { user_id, description, qa } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('company_id')
    .eq('id', user_id)
    .single();

  if (userError) {
    console.error('Erreur récupération utilisateur (business-summary):', userError.message);
  }

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
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      },
      user.company_id
    );

    const textBlock = data.content.find((b: any) => b.type === 'text');
    const summary = textBlock?.text?.trim() || null;

    if (!summary) {
      return NextResponse.json({ error: 'Réponse vide du modèle' }, { status: 502 });
    }

    await supabaseAdmin.from('companies').update({ business_summary: summary }).eq('id', user.company_id);

    return NextResponse.json({ summary });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? "Plafond de dépense API du jour atteint pour votre société — ça repart automatiquement demain."
              : "Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.",
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }
}
