// app/api/documents/route.ts
// GET  -> liste les documents de la société du commercial, avec un lien de téléchargement temporaire
// POST -> upload un nouveau document (multipart/form-data) dans Supabase Storage,
//         et extrait automatiquement son texte (PDF / .txt) pour qu'Aaron puisse s'en servir.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const BUCKET = 'documents';
const MAX_EXTRACTED_CHARS = 4000; // on ne garde qu'un extrait, pour limiter les tokens envoyés à Aaron

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

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

// Extrait le texte d'un fichier selon son type. Renvoie null si le type
// n'est pas supporté (ex: .docx pour l'instant) — le document reste utilisable,
// juste sans texte exploitable par Aaron.
async function extractText(buffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') {
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      return result.text.slice(0, MAX_EXTRACTED_CHARS);
    }
    if (mimeType === 'text/plain') {
      return buffer.toString('utf-8').slice(0, MAX_EXTRACTED_CHARS);
    }
    return null;
  } catch (err) {
    console.error('Erreur extraction texte document:', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const userId = formData.get('user_id') as string | null;
  const description = (formData.get('description') as string | null) || null;

  if (!file || !userId) {
    return NextResponse.json({ error: 'Fichier ou user_id manquant' }, { status: 400 });
  }

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

  const extractedText = await extractText(buffer, file.type);

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
    })
    .select()
    .single();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ document: doc });
}
