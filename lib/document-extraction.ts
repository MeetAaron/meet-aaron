// lib/document-extraction.ts
// Extraction de texte à partir d'un fichier uploadé — utilisée par
// app/api/documents/route.ts (upload dans "Mes documents") ET par
// app/api/chat/document/route.ts (document déposé directement dans le chat
// Aaron, voir ce fichier pour le contexte complet). Sortie de
// app/api/documents/route.ts vers un module partagé le 22/08/2026 pour éviter
// de dupliquer cette logique (contrairement à d'autres helpers du projet
// dupliqués volontairement par indépendance de module, l'extraction de texte
// n'a aucune logique métier propre à un module — un seul et même code, donc
// un seul endroit).

export const MAX_EXTRACTED_CHARS = 4000; // on ne garde qu'un extrait, pour limiter les tokens envoyés à Aaron

// Extrait le texte d'un fichier selon son type. Renvoie null si le type
// n'est pas supporté (ex: .docx pour l'instant) — le document reste utilisable,
// juste sans texte exploitable par Aaron.
export async function extractDocumentText(buffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') {
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      return result.text.slice(0, MAX_EXTRACTED_CHARS);
    }
    if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'application/vnd.ms-excel') {
      return buffer.toString('utf-8').slice(0, MAX_EXTRACTED_CHARS);
    }
    return null;
  } catch (err) {
    console.error('Erreur extraction texte document:', err);
    return null;
  }
}
