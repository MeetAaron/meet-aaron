// app/api/documents/[id]/route.ts
// CHANGEMENTS A FAIRE #89 (Mes documents) :
// DELETE -> supprime définitivement un document (fichier dans Supabase
//           Storage + ligne en base). Action destructive, confirmée côté UI
//           avant l'appel.
// PATCH   -> met à jour l'annotation "pris en compte par Aaron"
//           (included_in_aaron_context — permet de retirer un document du
//           contexte envoyé à Aaron sans le supprimer, ex. un vieux tarif
//           qu'on veut garder archivé mais qu'on ne veut plus voir cité),
//           la catégorie de rattachement (linked_category — voir
//           migration_documents_2026-08-16.sql), et/ou la note commerciale
//           (commercial_note — texte libre pris en compte par Aaron en plus
//           de l'extrait du document, voir migration_document_note_2026-08-20.sql
//           et docx "MES DOCUMENTS" item 26).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

const BUCKET = 'documents';
const VALID_CATEGORIES = ['general', 'prospects', 'opportunites', 'clients'];
// Langue du document (13/09/2026) : les sept langues de l'app, plus 'all'
// pour un document valable partout (grille tarifaire, plaquette en images),
// plus la chaîne vide pour revenir à « indéterminé ».
const VALID_LANGUAGES = ['fr', 'en', 'de', 'it', 'es', 'pt', 'nl', 'all'];

async function loadDocumentForCompany(documentId: string) {
  const { data: document } = await supabaseAdmin
    .from('company_documents')
    .select('id, company_id, storage_path, language')
    .eq('id', documentId)
    .single();
  return document;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const documentId = params.id;
  const body = await request.json();

  const document = await loadDocumentForCompany(documentId);
  if (!document) {
    return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.company_id !== document.company_id) return forbiddenResponse();

  const update: Record<string, any> = {};

  if (typeof body.included_in_aaron_context === 'boolean') {
    update.included_in_aaron_context = body.included_in_aaron_context;
  }

  if (body.linked_category !== undefined) {
    if (body.linked_category !== null && !VALID_CATEGORIES.includes(body.linked_category)) {
      return NextResponse.json({ error: 'Catégorie invalide' }, { status: 400 });
    }
    update.linked_category = body.linked_category;
    // Correction manuelle : Aaron ne « gère » plus le classement de ce
    // document (colonne « Géré par Aaron » de Mes documents, 01/09/2026).
    update.category_auto = false;
  }

  // Langue du document (13/09/2026) : devinée au dépôt, corrigée ici d'un
  // clic. 'all' = valable dans toutes les langues, chaîne vide = on efface
  // l'étiquette. C'est elle qui décide quelle plaquette Aaron joint au
  // premier email — voir lib/first-email-attachment.ts.
  if (body.language !== undefined) {
    const lang = body.language === null || body.language === '' ? null : String(body.language);
    if (lang !== null && !VALID_LANGUAGES.includes(lang)) {
      return NextResponse.json({ error: 'Langue invalide' }, { status: 400 });
    }
    update.language = lang;
  }

  if (typeof body.commercial_note === 'string') {
    // Plafond défensif (même logique que extracted_text/description) : une
    // note commerciale n'a pas vocation à être un document entier.
    update.commercial_note = body.commercial_note.slice(0, 4000) || null;
  }

  // Pièce jointe au premier email (demande Alex, 27/08/2026 — voir
  // migration_first_email_attachment_2026-08-27.sql et
  // lib/first-email-attachment.ts).
  //
  // 13/09/2026 — L'EXCLUSIVITÉ DEVIENT « UN SEUL PAR LANGUE », plus « un
  // seul tout court ». Avant, marquer la plaquette anglaise démarquait la
  // française, ce qui rendait la plaquette par pays impossible. Un email ne
  // porte toujours qu'une seule pièce jointe : c'est Aaron qui choisit
  // laquelle selon la langue du prospect. On ne désactive donc que les
  // documents marqués dans LA MÊME langue.
  if (typeof body.attach_to_first_email === 'boolean') {
    if (body.attach_to_first_email) {
      const lang = update.language !== undefined ? update.language : (document as any).language ?? null;
      let q = supabaseAdmin
        .from('company_documents')
        .update({ attach_to_first_email: false })
        .eq('company_id', document.company_id)
        .neq('id', documentId);
      // `null` (langue indéterminée) se compare avec .is(), pas avec .eq().
      q = lang === null ? q.is('language', null) : q.eq('language', lang);
      const { error: exclusivityError } = await q;
      // Colonne `language` absente (migration pas encore jouée) : on
      // retombe sur l'ancienne règle, un seul document marqué en tout.
      if (exclusivityError && (exclusivityError as any).code === '42703') {
        await supabaseAdmin
          .from('company_documents')
          .update({ attach_to_first_email: false })
          .eq('company_id', document.company_id)
          .neq('id', documentId);
      }
    }
    update.attach_to_first_email = body.attach_to_first_email;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  let { data: updated, error } = await supabaseAdmin
    .from('company_documents')
    .update(update)
    .eq('id', documentId)
    .select()
    .single();

  // Colonne category_auto absente (migration_documents_auto_category_
  // 2026-09-01.sql pas encore passée) : on rejoue sans elle.
  if (error && (error as any).code === '42703' && 'category_auto' in update) {
    const { category_auto, ...withoutFlag } = update;
    ({ data: updated, error } = await supabaseAdmin
      .from('company_documents')
      .update(withoutFlag)
      .eq('id', documentId)
      .select()
      .single());
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ document: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const documentId = params.id;

  const document = await loadDocumentForCompany(documentId);
  if (!document) {
    return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.company_id !== document.company_id) return forbiddenResponse();

  // On supprime d'abord le fichier de stockage, mais on continue même en cas
  // d'échec (fichier déjà absent, etc.) : ce qui compte pour l'utilisateur
  // est que le document disparaisse de sa liste et du contexte d'Aaron.
  const { error: storageError } = await supabaseAdmin.storage.from(BUCKET).remove([document.storage_path]);
  if (storageError) {
    console.error('Erreur suppression fichier storage (document conservé en base) :', storageError.message);
  }

  const { error: dbError } = await supabaseAdmin.from('company_documents').delete().eq('id', documentId);
  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
