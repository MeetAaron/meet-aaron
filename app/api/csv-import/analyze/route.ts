// app/api/csv-import/analyze/route.ts
//
// POST -> analyse un lot de lignes CSV déjà mappées/validées côté client
// (voir lib/csv-import.ts et components/CsvImportModal.jsx) pour AIDER à
// nettoyer les données avant import — jamais pour décider seule quoi
// importer. Le schéma de sortie est volontairement limité à 4 champs, aucun
// d'entre eux ne pouvant fabriquer une donnée de contact :
//   - company_name_suggestion : uniquement déduit du domaine email fourni
//     (jamais inventé de zéro), et seulement si le domaine n'est pas une
//     messagerie grand public
//   - full_name_fix : uniquement une correction de casse/espaces du nom déjà
//     fourni, jamais un nom différent
//   - is_likely_junk / junk_reason : détection de lignes de test, purement
//     indicative (la ligne reste importable, juste décochée par défaut)
// Téléphone, poste, email et LinkedIn ne sont même pas transmis à Claude —
// il ne peut donc structurellement pas les inventer. Toute suggestion reste
// affichée dans un champ éditable côté client : rien n'est appliqué en
// silence avant la relecture humaine et le clic "Importer".

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';

const MAX_ROWS_PER_CALL = 40;
const ALLOWED_MODULES = ['ap', 'as', 'ac'];

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { user_id, company_id, module, rows } = body;

  if (!user_id || !company_id || !ALLOWED_MODULES.includes(module) || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }
  if (rows.length > MAX_ROWS_PER_CALL) {
    return NextResponse.json({ error: `Maximum ${MAX_ROWS_PER_CALL} lignes par appel` }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id || authedUser.company_id !== company_id) return forbiddenResponse();

  // On ne transmet à Claude QUE ce qui est utile à cette analyse précise —
  // pas de téléphone/poste/LinkedIn, hors sujet ici et donc impossible à
  // faire fuiter dans une suggestion.
  const sanitizedRows = rows.map((r: any, i: number) => ({
    idx: typeof r.idx === 'number' ? r.idx : i,
    full_name: (r.full_name || '').toString().slice(0, 200),
    email: (r.email || '').toString().slice(0, 200),
    company_name: (r.company_name || '').toString().slice(0, 200),
  }));

  const prompt = `Tu analyses une liste de lignes issues d'un import CSV de contacts commerciaux, pour aider à nettoyer les données AVANT import. Tu ne dois RIEN inventer.

Pour CHAQUE ligne (identifiée par "idx"), réponds avec :
- "company_name_suggestion" : une suggestion de nom d'entreprise déduite UNIQUEMENT du domaine de l'email, et SEULEMENT si "company_name" est vide et que le domaine n'est manifestement PAS une messagerie grand public (gmail, outlook, yahoo, free, orange, etc.). Sinon null. N'invente jamais un nom qui ne dérive pas visiblement du domaine.
- "full_name_fix" : UNIQUEMENT une correction de casse/espaces du nom déjà fourni (ex: "jean dupont" -> "Jean Dupont"), jamais un nom différent. null si déjà correct ou si le nom est vide.
- "is_likely_junk" : true si la ligne ressemble à une donnée de test ou invalide (ex: "test test", "asdf asdf", email "test@test.com", "n/a"...).
- "junk_reason" : courte raison en français si is_likely_junk est true, sinon null.

Ne renvoie RIEN d'autre que ces 4 champs par ligne. N'invente jamais de téléphone, poste, email ou profil LinkedIn — ces champs ne te sont même pas transmis.

Lignes à analyser :
${JSON.stringify(sanitizedRows, null, 2)}

Réponds UNIQUEMENT avec un tableau JSON d'objets {"idx", "company_name_suggestion", "full_name_fix", "is_likely_junk", "junk_reason"}, un par ligne reçue, sans texte avant ni après, sans balises markdown.`;

  let suggestions: any;
  try {
    const data = await callClaude(
      { model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] },
      company_id,
      module
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    const cleaned = (textBlock?.text || '').replace(/```json|```/g, '').trim();
    suggestions = JSON.parse(cleaned);
    if (!Array.isArray(suggestions)) throw new Error('Réponse IA non conforme (pas un tableau)');
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? 'Plafond de dépense API du jour atteint pour votre société — vous pouvez importer sans assistance IA, ou réessayer demain.'
              : err.reason === 'credits_exhausted'
              ? 'Plafond de dépense API atteint et solde de crédits épuisé pour ce module.'
              : 'Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.',
        },
        { status: 429 }
      );
    }
    // Erreur de parsing JSON ou autre appel raté : l'analyse IA est une AIDE,
    // pas une étape obligatoire — on renvoie une liste vide plutôt qu'une
    // erreur bloquante, l'import reste possible sans elle.
    return NextResponse.json({
      suggestions: [],
      warning: "L'analyse IA n'a pas pu être faite pour ce lot — les lignes restent importables telles quelles.",
    });
  }

  // Filtrage défensif : on ne fait jamais confiance aveuglément à la sortie
  // IA même si le prompt l'interdit — on ignore tout champ hors schéma et on
  // s'assure que chaque idx correspond bien à une ligne réellement envoyée.
  const validIdx = new Set(sanitizedRows.map((r) => r.idx));
  const cleanSuggestions = suggestions
    .filter((s: any) => s && validIdx.has(s.idx))
    .map((s: any) => ({
      idx: s.idx,
      company_name_suggestion: typeof s.company_name_suggestion === 'string' ? s.company_name_suggestion.slice(0, 200) : null,
      full_name_fix: typeof s.full_name_fix === 'string' ? s.full_name_fix.slice(0, 200) : null,
      is_likely_junk: s.is_likely_junk === true,
      junk_reason: typeof s.junk_reason === 'string' ? s.junk_reason.slice(0, 200) : null,
    }));

  return NextResponse.json({ suggestions: cleanSuggestions });
}
