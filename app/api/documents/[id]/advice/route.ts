// app/api/documents/[id]/advice/route.ts
// POST -> génère (ou régénère) l'avis d'Aaron sur UN document précis
// (CHANGEMENTS A FAIRE #89 : bouton "Avis d'Aaron" sur chaque document de
// Mes documents). Mis en cache sur company_documents.advice/
// advice_generated_at (voir migration_documents_2026-08-16.sql), un appel
// Claude seulement au clic "Générer"/"Régénérer", jamais au chargement de
// la page. S'appuie sur extracted_text (déjà extrait à l'upload, voir
// app/api/documents/route.ts) — si le document n'a pas de texte exploitable
// (type non supporté, ex. .docx), l'avis l'explique plutôt que d'échouer
// silencieusement.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const documentId = params.id;

  const { data: document, error } = await supabaseAdmin
    .from('company_documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (error || !document) {
    return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.company_id !== document.company_id) return forbiddenResponse();

  if (!document.extracted_text || document.extracted_text.trim().length < 50) {
    const advice =
      "Aaron n'a pas pu lire le contenu de ce fichier (type non pris en charge pour l'extraction de texte, ou fichier trop court) — il ne peut donc pas donner d'avis dessus. Les formats PDF et texte (.txt/.csv) sont exploités automatiquement.";
    return NextResponse.json({ advice, advice_generated_at: null });
  }

  const prompt = `Tu es Aaron, copilote commercial IA. Voici un document d'entreprise mis à disposition de l'équipe commerciale.
Nom du fichier : ${document.file_name}
Description donnée par le commercial : ${document.description || 'aucune'}
Contenu extrait (peut être tronqué) :
"""
${document.extracted_text.slice(0, 4000)}
"""

Donne un avis concret en 3-4 phrases maximum sur ce document : à quoi il sert concrètement pour un commercial (argumentaire, tarifs, plaquette, etc.), s'il te semble à jour ou incomplet, et un conseil pratique sur comment/quand s'en servir face à un prospect. Sois direct et actionnable, pas générique. Réponds uniquement avec ce texte, en français, sans préambule ni titre.`;

  let advice: string;
  try {
    const data = await callClaude(
      { model: 'claude-sonnet-4-6', max_tokens: 250, messages: [{ role: 'user', content: prompt }] },
      document.company_id
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    advice = textBlock?.text?.trim() || "Aaron n'a pas pu générer d'avis cette fois — réessaie dans un instant.";
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? 'Plafond de dépense API du jour atteint pour votre société — ça repart automatiquement demain.'
              : 'Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.',
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }

  const generatedAt = new Date().toISOString();
  await supabaseAdmin
    .from('company_documents')
    .update({ advice, advice_generated_at: generatedAt })
    .eq('id', documentId);

  return NextResponse.json({ advice, advice_generated_at: generatedAt });
}
