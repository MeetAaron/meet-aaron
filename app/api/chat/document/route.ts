// app/api/chat/document/route.ts
// POST -> upload d'un document déposé directement dans le chat avec Aaron
// (demande d'Alex, 22/08/2026 : "possibilité de déposer un document dans le
// chat aaron. Et ensuite aaron demande si le doc est juste pour la réflexion
// en cours ou si c'est à sauvegarder dans mes documents").
//
// Ce endpoint UPLOAD le fichier tout de suite (même bucket Storage que "Mes
// documents", voir app/api/documents/route.ts) et extrait son texte, mais
// N'ÉCRIT PAS de ligne dans company_documents — le document reste "temporaire"
// (visible seulement dans cette conversation) tant que le commercial n'a pas
// confirmé vouloir le garder. C'est app/api/chat/route.ts (outil
// sauvegarder_document, voir plus bas dans ce fichier pour le format des
// métadonnées renvoyées) qui crée la ligne définitive le cas échéant, à partir
// du storage_path déjà renvoyé ici — pas de ré-upload.
//
// Limite connue et assumée : un document déposé puis jamais confirmé (le
// commercial dit "non" ou change de sujet sans répondre) reste dans le bucket
// Storage sans jamais être nettoyé — pas de cron de purge pour l'instant.
// Volume attendu faible (documents ponctuels de chat, pas un usage de masse),
// donc pas priorisé, mais assumé explicitement plutôt que laissé dans l'angle
// mort.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { extractDocumentText } from '@/lib/document-extraction';

const BUCKET = 'documents';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo — cohérent avec un document commercial usuel (pas un usage de stockage de masse)

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

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: 'Fichier trop volumineux (10 Mo maximum)' }, { status: 400 });
  }

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  // Sous-dossier "chat/" (même bucket que "Mes documents") : purement pour
  // distinguer visuellement un dépôt via le chat d'un upload classique dans
  // les logs/Storage — aucune incidence fonctionnelle, le fichier est déplacé
  // nulle part au moment de la confirmation, seule la ligne company_documents
  // est créée en pointant vers ce même storage_path.
  const storagePath = `${user.company_id}/chat/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const extractedText = await extractDocumentText(buffer, file.type);

  return NextResponse.json({
    document: {
      file_name: file.name,
      storage_path: storagePath,
      file_type: file.type,
      file_size_bytes: file.size,
      extracted_text: extractedText, // null si le format n'est pas supporté (ex: .docx) — Aaron le signale au commercial plutôt que d'improviser un contenu
    },
  });
}
