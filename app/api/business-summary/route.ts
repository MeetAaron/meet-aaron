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
import { localeInstruction } from '@/lib/locale-instruction';

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

  // CHANGEMENTS A FAIRE #89 (2026-08-16) : corrige une requête qui sélectionnait
  // une colonne "name" inexistante sur company_documents (la colonne s'appelle
  // file_name) — Supabase renvoyait une erreur silencieusement absorbée par le
  // `data` undefined, si bien que ce résumé n'incluait jamais aucun document.
  // Filtre aussi désormais sur included_in_aaron_context (voir
  // migration_documents_2026-08-16.sql), comme les autres endroits où Aaron
  // s'appuie sur les documents de la société.
  const { data: documents } = await supabaseAdmin
    .from('company_documents')
    .select('file_name, summary')
    .eq('company_id', user.company_id)
    .eq('included_in_aaron_context', true)
    .order('created_at', { ascending: false })
    .limit(8);

  const documentSummaries = (documents || [])
    .filter((d) => d.summary)
    .map((d) => `- ${d.file_name} : ${d.summary}`)
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
    `Rédige un résumé clair et structuré de l'activité de cette société en 5 à 9 phrases : ce qu'elle vend, ` +
    `les différents profils/types de clients (s'il y en a plusieurs), le produit ou service phare, l'argument de ` +
    `vente qui fait le plus mouche, l'objection la plus fréquente et comment la lever, et le type de conclusion à ` +
    `viser après un premier contact (RDV, devis, essai...). ` +
    // 2026-08-25 (demande Alex, feedback sur des premiers emails jugés trop
    // génériques) : si le commercial a donné des éléments concrets de
    // légitimité/expertise (années d'expérience, certifications/labels,
    // nombre de clients ou chantiers réalisés, spécialisation précise,
    // références notables), fais-en une phrase À PART, clairement identifiable
    // dans le résumé — c'est ce qu'Aaron utilise pour positionner le premier
    // message comme venant d'un expert reconnu plutôt que d'un commercial
    // générique (principe d'autorité de Cialdini, voir lib/aaron_system_prompt.md).
    // N'invente RIEN : si aucun élément concret de ce type n'a été donné,
    // n'ajoute pas cette phrase plutôt que d'en fabriquer une vague.
    `Si le commercial a mentionné des éléments concrets prouvant son expérience/expertise/légitimité (années ` +
    `d'expérience, certifications, nombre de clients ou de réalisations, spécialisation, références notables), ` +
    `regroupe-les dans une phrase séparée et explicite commençant par "Légitimité :" — sans en inventer si aucun ` +
    `n'a été fourni. ` +
    // 2026-08-26 (suite demande Alex du 25/08) : même mécanique que
    // "Légitimité :" ci-dessus, mais pour la preuve sociale (principe de
    // Cialdini du même nom) — nourrie par la nouvelle question du
    // questionnaire de découverte "as-tu un exemple concret de client
    // satisfait..." (voir chat.onboardingQSocialProof, app/app/chat/page.jsx).
    // Distincte de "Légitimité :" : la légitimité parle de QUI est le
    // commercial/la société (expertise, ancienneté), la preuve sociale parle
    // de CE QUE d'autres clients ont vécu/obtenu concrètement — les deux se
    // complètent mais ne doivent pas être fusionnées dans la même phrase.
    `Si le commercial a donné un exemple concret de client satisfait, un résultat chiffré ou une transformation ` +
    `obtenue par un client (preuve sociale), regroupe cela dans une autre phrase séparée et explicite commençant ` +
    `par "Preuve sociale :" — sans en inventer si rien de concret n'a été fourni. ` +
    `Réponds uniquement avec ce résumé, ${localeInstruction(authedUser.locale)}, sans ` +
    `préambule ni titre.`;

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        // Relevé de 400 à 500 (2026-08-26) : le résumé peut maintenant
        // contenir jusqu'à deux phrases marqueurs supplémentaires
        // ("Légitimité :" et "Preuve sociale :") en plus du corps principal.
        max_tokens: 500,
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
