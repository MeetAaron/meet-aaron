// app/api/business-summary/import/analyze/route.ts
// POST -> bouton "Faire analyser par Aaron" (demande Alex, 27/08/2026) :
// Aaron compare l'ancien profil au document modifié renvoyé par
// l'utilisateur, produit une version mise à jour du profil qui intègre
// fidèlement les changements, ET une courte note en langage naturel de ce
// qu'il a remarqué comme changé — pour que l'utilisateur puisse vérifier en
// un coup d'œil que rien d'important n'a été perdu dans la mise à jour.
// N'écrase companies.business_summary qu'à la toute fin, une fois la réponse
// de Claude obtenue avec succès (sinon le document en attente reste en
// attente, rien n'est perdu).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

const NEW_PROFILE_MARKER = 'NOUVEAU_PROFIL:';
const CHANGES_MARKER = 'CHANGEMENTS_REMARQUES:';

function parseAnalysisResponse(text: string): { updatedSummary: string; changeNote: string | null } {
  const newProfileIdx = text.indexOf(NEW_PROFILE_MARKER);
  const changesIdx = text.indexOf(CHANGES_MARKER);

  if (newProfileIdx === -1) {
    // Format inattendu (rare) — on utilise la réponse telle quelle comme
    // profil plutôt que d'échouer complètement ; pas de note de changements
    // dans ce cas, l'utilisateur verra directement le résultat dans le champ.
    return { updatedSummary: text.trim(), changeNote: null };
  }

  const afterMarker = newProfileIdx + NEW_PROFILE_MARKER.length;
  if (changesIdx === -1 || changesIdx < afterMarker) {
    return { updatedSummary: text.slice(afterMarker).trim(), changeNote: null };
  }

  const updatedSummary = text.slice(afterMarker, changesIdx).trim();
  const changeNote = text.slice(changesIdx + CHANGES_MARKER.length).trim() || null;
  return { updatedSummary, changeNote };
}

export async function POST(request: NextRequest) {
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('business_summary, business_summary_pending_text')
    .eq('id', user.company_id)
    .single();

  if (!company?.business_summary_pending_text) {
    return NextResponse.json({ error: 'Aucun document en attente d’analyse' }, { status: 400 });
  }

  const prompt =
    `Tu es Aaron, copilote commercial IA. Voici l'ancien profil de l'entreprise, que tu utilises pour contextualiser tes emails et conversations :\n"""\n` +
    `${company.business_summary || '(vide — aucun profil existant)'}\n"""\n\n` +
    `L'utilisateur a modifié ce profil dans un document (Word ou PDF) qu'il vient de renvoyer. Voici le texte extrait de sa nouvelle version :\n"""\n` +
    `${company.business_summary_pending_text}\n"""\n\n` +
    `Tâche :\n` +
    `1. Rédige une version mise à jour du profil, dans le même esprit que l'original (clair, structuré, phrases complètes) — intègre fidèlement les ` +
    `changements de l'utilisateur (ajouts, suppressions, corrections) sans reformuler inutilement ce qui n'a pas changé. Si sa nouvelle version est ` +
    `beaucoup plus longue/détaillée que l'ancienne, respecte cette longueur et ce niveau de détail — ne résume PAS, ne coupe PAS. Conserve les phrases ` +
    `commençant par "Légitimité :" et "Preuve sociale :" si elles existaient et restent pertinentes.\n` +
    `2. Repère ce qui a changé par rapport à l'ancienne version et résume-le en 2 à 4 phrases maximum, à la première personne du singulier ` +
    `("J'ai remarqué que..."), pour que l'utilisateur puisse vérifier rapidement que rien d'important n'a été perdu dans la mise à jour. Si l'ancien ` +
    `profil était vide, dis simplement que tu as pris en compte ce premier profil.\n\n` +
    `Réponds STRICTEMENT dans ce format ${localeInstruction(authedUser.locale)}, avec exactement ces deux en-têtes tels quels, rien avant ni entre :\n` +
    `${NEW_PROFILE_MARKER}\n<le profil mis à jour>\n\n${CHANGES_MARKER}\n<ton résumé des changements>`;

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        // Généreux (contrairement aux 500 tokens de la génération initiale
        // courte, voir app/api/business-summary/route.ts) : le profil renvoyé
        // par l'utilisateur peut être un vrai document long (Alex : "si ça
        // fait 20 pages c'est encore mieux"), et la réponse doit pouvoir le
        // réécrire en entier sans le tronquer.
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      },
      user.company_id
    );

    const textBlock = data.content.find((b: any) => b.type === 'text');
    const rawText = textBlock?.text?.trim();

    if (!rawText) {
      return NextResponse.json({ error: 'Réponse vide du modèle' }, { status: 502 });
    }

    const { updatedSummary, changeNote } = parseAnalysisResponse(rawText);

    if (!updatedSummary) {
      return NextResponse.json({ error: 'Réponse du modèle inexploitable' }, { status: 502 });
    }

    const { error } = await supabaseAdmin
      .from('companies')
      .update({
        business_summary: updatedSummary,
        business_summary_pending_text: null,
        business_summary_pending_file_name: null,
        business_summary_pending_uploaded_at: null,
        business_summary_pending_uploaded_by: null,
      })
      .eq('id', user.company_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ summary: updatedSummary, changeNote });
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
