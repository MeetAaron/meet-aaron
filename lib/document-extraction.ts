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

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Note : 'application/msword' est l'ANCIEN format .doc binaire (pré-2007,
// pas du XML/zip ni du texte RTF) — un format totalement différent qu'on ne
// sait pas lire ici, volontairement absent de cette liste pour ne pas
// tenter de le parser comme du RTF (ce qui produirait du texte corrompu
// plutôt qu'une erreur claire).
const RTF_MIMES = new Set(['application/rtf', 'text/rtf']);

// Extraction complète, SANS troncature — ajoutée le 27/08/2026 pour l'import
// d'une version modifiée du "Profil de l'entreprise" (voir
// app/api/business-summary/import/route.ts) : contrairement à l'usage
// "Mes documents" ci-dessous (juste un extrait pour donner du contexte à
// Aaron), cette fonctionnalité doit pouvoir comparer/analyser l'intégralité
// d'un document potentiellement long, donc pas de coupe à 4000 caractères
// ici. Gère .docx et .rtf en plus de .pdf/.txt/.csv (voir
// lib/docx-extraction.ts et lib/rtf-extraction.ts — implémentations pures JS
// sans dépendance, l'accès au registre npm étant bloqué dans cet
// environnement).
export async function extractFullDocumentText(buffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') {
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      return result.text || null;
    }
    if (mimeType === DOCX_MIME) {
      const { extractTextFromDocx } = await import('./docx-extraction');
      return extractTextFromDocx(buffer);
    }
    if (RTF_MIMES.has(mimeType)) {
      const { extractTextFromRtf } = await import('./rtf-extraction');
      const text = extractTextFromRtf(buffer.toString('utf-8'));
      return text || null;
    }
    if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'application/vnd.ms-excel') {
      return buffer.toString('utf-8');
    }
    return null;
  } catch (err) {
    console.error('Erreur extraction texte document (complet):', err);
    return null;
  }
}

// Extrait le texte d'un fichier selon son type. Renvoie null si le type
// n'est pas supporté — le document reste utilisable, juste sans texte
// exploitable par Aaron. Usage "Mes documents" (contexte Aaron) : on ne
// garde qu'un extrait, voir extractFullDocumentText ci-dessus pour un besoin
// qui a lui besoin du texte complet.
export async function extractDocumentText(buffer: Buffer, mimeType: string): Promise<string | null> {
  const full = await extractFullDocumentText(buffer, mimeType);
  return full ? full.slice(0, MAX_EXTRACTED_CHARS) : null;
}
