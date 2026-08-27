// lib/first-email-attachment.ts
// Demande Alex (27/08/2026) : pouvoir joindre un document (ex : la plaquette
// Aaron) au tout premier email envoyé à un prospect, sans créer de nouveau
// mécanisme de stockage — réutilise "Mes documents" (company_documents +
// bucket Supabase Storage "documents"), un document pouvant être marqué
// "à joindre au premier email" (voir migration_first_email_attachment_2026-08-27.sql
// et PATCH /api/documents/[id]).
//
// Un seul document par société devrait avoir attach_to_first_email=true à un
// instant donné (l'application désactive l'ancien quand on en active un
// nouveau) — si jamais plusieurs étaient marqués (ex: incohérence manuelle
// en base), on prend simplement le plus récent plutôt que d'échouer.
//
// Best-effort par construction, comme le reste de l'envoi d'emails : une
// erreur ici (fichier supprimé du storage, etc.) ne doit jamais empêcher le
// premier email lui-même de partir — on retourne simplement null et le
// premier email part sans pièce jointe.

import { supabaseAdmin } from './supabase-admin';

const BUCKET = 'documents';

export interface FirstEmailAttachment {
  filename: string;
  contentBase64: string;
  mimeType: string;
}

export async function getFirstEmailAttachment(companyId: string): Promise<FirstEmailAttachment | null> {
  if (!companyId) return null;

  try {
    const { data: doc } = await supabaseAdmin
      .from('company_documents')
      .select('storage_path, file_name, file_type')
      .eq('company_id', companyId)
      .eq('attach_to_first_email', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!doc) return null;

    const { data: file, error } = await supabaseAdmin.storage.from(BUCKET).download(doc.storage_path);
    if (error || !file) {
      console.error('Erreur téléchargement pièce jointe premier email (envoi sans pièce jointe):', error?.message);
      return null;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    return {
      filename: doc.file_name,
      contentBase64: buffer.toString('base64'),
      mimeType: doc.file_type || 'application/octet-stream',
    };
  } catch (err: any) {
    console.error('Erreur récupération pièce jointe premier email (envoi sans pièce jointe):', err.message);
    return null;
  }
}
