// app/api/documents/route.ts
// GET  -> liste les documents de la société du commercial, avec un lien de téléchargement temporaire
// POST -> upload un nouveau document (multipart/form-data) dans Supabase Storage,
//         et extrait automatiquement son texte (PDF / .txt) pour qu'Aaron puisse s'en servir.
//
// CHANGEMENTS A FAIRE #89 : POST accepte désormais une catégorie de
// rattachement optionnelle (linked_category — voir
// migration_documents_2026-08-16.sql) choisie à l'upload, modifiable ensuite
// via PATCH /api/documents/[id]. Les actions supprimer/annoter "pris en
// compte par Aaron"/avis d'Aaron vivent dans app/api/documents/[id]/.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';
import { extractDocumentText } from '@/lib/document-extraction';

const BUCKET = 'documents';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const { data: documents, error } = await supabaseAdmin
    .from('company_documents')
    .select('*')
    .eq('company_id', user.company_id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const documentsWithUrls = await Promise.all(
    (documents || []).map(async (doc) => {
      const { data: signedUrl } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, 3600);
      return { ...doc, download_url: signedUrl?.signedUrl || null };
    })
  );

  return NextResponse.json({ documents: documentsWithUrls });
}

// Génère une courte synthèse (2-4 phrases) du document via Claude, pour un
// aperçu rapide côté équipe (liste des documents). Renvoie null si le texte
// extrait est vide/absent, ou si l'appel échoue — le document reste utilisable
// sans synthèse (Aaron continue d'exploiter extracted_text dans tous les cas).
async function summarizeDocument(
  fileName: string,
  extractedText: string,
  companyId: string,
  locale: string
): Promise<string | null> {
  if (!extractedText || extractedText.trim().length < 50) return null;

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content:
              `Voici le contenu extrait du document "${fileName}" (usage commercial : plaquette, argumentaire, tarifs, etc.). ` +
              `Rédige une synthèse ${localeInstruction(locale)} de 2 à 4 phrases maximum, utile pour qu'un commercial comprenne en un coup d'œil ` +
              `à quoi sert ce document et ce qu'il contient. Réponds UNIQUEMENT avec la synthèse, sans titre ni préambule.\n\n` +
              `${extractedText.slice(0, 4000)}`,
          },
        ],
      },
      companyId
    );

    const textBlock = data.content.find((block: any) => block.type === 'text');
    return textBlock ? textBlock.text.trim() : null;
  } catch (err: any) {
    // Y compris un plafond de dépense atteint : le document reste utilisable
    // sans synthèse (Aaron continue d'exploiter extracted_text dans tous les cas).
    console.error('Erreur génération synthèse document:', err.message);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const userId = formData.get('user_id') as string | null;
  const description = (formData.get('description') as string | null) || null;
  const rawCategory = (formData.get('linked_category') as string | null) || null;
  const linkedCategory = ['prospects', 'opportunites', 'clients'].includes(rawCategory || '') ? rawCategory : null;

  if (!file || !userId) {
    return NextResponse.json({ error: 'Fichier ou user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const storagePath = `${user.company_id}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const extractedText = await extractDocumentText(buffer, file.type);
  const summary = extractedText
    ? await summarizeDocument(file.name, extractedText, user.company_id, authedUser.locale)
    : null;

  const { data: doc, error: dbError } = await supabaseAdmin
    .from('company_documents')
    .insert({
      company_id: user.company_id,
      uploaded_by: userId,
      file_name: file.name,
      storage_path: storagePath,
      file_type: file.type,
      file_size_bytes: file.size,
      description,
      extracted_text: extractedText,
      summary,
      linked_category: linkedCategory,
    })
    .select()
    .single();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ document: doc });
}
