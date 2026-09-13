// lib/first-email-attachment.ts
// Demande Alex (27/08/2026) : pouvoir joindre un document (ex : la plaquette
// Aaron) au tout premier email envoyé à un prospect, sans créer de nouveau
// mécanisme de stockage — réutilise "Mes documents" (company_documents +
// bucket Supabase Storage "documents"), un document pouvant être marqué
// "à joindre au premier email" (voir migration_first_email_attachment_2026-08-27.sql
// et PATCH /api/documents/[id]).
//
// 13/09/2026 — ce n'est plus « un seul document par société » : on peut en
// marquer un PAR LANGUE (une plaquette française, une anglaise, une
// allemande…), et Aaron choisit celui qui correspond au prospect. Quand
// aucune langue ne correspond, l'ordre de repli est : document « toutes
// langues », puis français, puis le plus récent.
//
// Best-effort par construction, comme le reste de l'envoi d'emails : une
// erreur ici (fichier supprimé du storage, etc.) ne doit jamais empêcher le
// premier email lui-même de partir — on retourne simplement null et le
// premier email part sans pièce jointe.

import { supabaseAdmin } from './supabase-admin';
import { pickDocumentForLocale } from './document-language';
import { resolveProspectLocale } from './prospect-locale';

const BUCKET = 'documents';

export interface FirstEmailAttachment {
  filename: string;
  contentBase64: string;
  mimeType: string;
}

// LA BONNE PLAQUETTE POUR LE BON PAYS (13/09/2026, demande d'Alex).
//
// Le commercial peut désormais marquer PLUSIEURS documents « à joindre au
// premier email », un par langue. Aaron choisit celui qui correspond à la
// langue retenue pour ce prospect — la même que celle de l'email, calculée
// par lib/prospect-locale.ts, donc jamais une plaquette anglaise avec un
// email en allemand.
//
// `prospectId` optionnel : sans lui (appel historique, ou envoi qui ne
// concerne aucun prospect précis), on garde le comportement d'avant — le
// document marqué le plus récent.
export async function getFirstEmailAttachment(
  companyId: string,
  prospectId?: string | null
): Promise<FirstEmailAttachment | null> {
  if (!companyId) return null;

  try {
    // La colonne `language` peut ne pas exister (migration_document_langue_
    // 2026-09-13.sql pas encore jouée) : on retombe alors sur la sélection
    // d'avant, sans jamais faire échouer l'envoi.
    let docs: any[] | null = null;
    let res: any = await supabaseAdmin
      .from('company_documents')
      .select('storage_path, file_name, file_type, language')
      .eq('company_id', companyId)
      .eq('attach_to_first_email', true)
      .order('created_at', { ascending: false });
    if (res.error?.code === '42703') {
      res = await supabaseAdmin
        .from('company_documents')
        .select('storage_path, file_name, file_type')
        .eq('company_id', companyId)
        .eq('attach_to_first_email', true)
        .order('created_at', { ascending: false });
    }
    docs = res.data || [];
    if (docs.length === 0) return null;

    // Langue du prospect : même calcul que pour le corps de l'email.
    let locale: string | null = null;
    if (prospectId) {
      const { data: p } = await supabaseAdmin
        .from('prospects')
        .select('email, users(locale), prospect_companies(address)')
        .eq('id', prospectId)
        .maybeSingle();
      if (p) {
        locale = resolveProspectLocale({
          address: (p as any).prospect_companies?.address || null,
          email: (p as any).email || null,
          sellerLocale: (p as any).users?.locale || null,
        });
      }
    }

    const index = pickDocumentForLocale(docs, locale);
    const doc = index >= 0 ? docs[index] : null;
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
