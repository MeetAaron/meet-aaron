// app/api/business-summary/import/route.ts
// POST -> l'utilisateur renvoie une version modifiée du "Profil de
// l'entreprise" (Word/RTF/PDF) après l'avoir édité (demande Alex,
// 27/08/2026). On extrait le texte et on le stocke "en attente" — RIEN n'est
// changé sur le profil actif tant que l'utilisateur n'a pas choisi, côté UI,
// "Ne pas analyser" (voir .../import/discard) ou "Faire analyser par Aaron"
// (voir .../import/analyze).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { extractFullDocumentText } from '@/lib/document-extraction';

const ACCEPTED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/rtf',
  'text/rtf',
]);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const userId = formData.get('user_id') as string | null;

  if (!file || !userId) {
    return NextResponse.json({ error: 'Fichier ou user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  if (!ACCEPTED_MIMES.has(file.type)) {
    return NextResponse.json(
      {
        error:
          "Format non reconnu — envoie le document en Word (.docx), RTF (.rtf) ou PDF (.pdf). L'ancien format .doc n'est pas supporté : réenregistre en .docx depuis Word (\"Enregistrer sous\").",
      },
      { status: 400 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const extractedText = await extractFullDocumentText(buffer, file.type);

  if (!extractedText || extractedText.trim().length < 10) {
    return NextResponse.json(
      { error: "Le texte n'a pas pu être lu dans ce document (fichier vide, scanné en image, ou corrompu)." },
      { status: 422 }
    );
  }

  const { error } = await supabaseAdmin
    .from('companies')
    .update({
      business_summary_pending_text: extractedText.trim(),
      business_summary_pending_file_name: file.name,
      business_summary_pending_uploaded_at: new Date().toISOString(),
      business_summary_pending_uploaded_by: userId,
    })
    .eq('id', user.company_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    fileName: file.name,
    // Aperçu (pas la version complète, potentiellement longue) pour un
    // premier retour visuel côté UI avant que l'utilisateur ne choisisse.
    preview: extractedText.trim().slice(0, 300),
  });
}
