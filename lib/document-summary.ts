// lib/document-summary.ts
// Génère une courte synthèse (2-4 phrases) d'un document via Claude, pour un
// aperçu rapide côté équipe (colonne "Synthèse (Aaron)" de Mes documents).
// Factorisé ici (2026-08-26) pour être partagé par les deux chemins de
// sauvegarde d'un document : l'upload classique (app/api/documents/route.ts)
// ET la sauvegarde depuis le chat (app/api/chat/route.ts, outil
// sauvegarder_document) — ce dernier créait jusqu'ici la ligne
// company_documents SANS synthèse, ce qui laissait la colonne vide (bug
// remonté par Alex le 26/08/2026).
//
// Renvoie null si le texte extrait est vide/trop court, ou si l'appel échoue —
// le document reste utilisable sans synthèse (Aaron continue d'exploiter
// extracted_text dans tous les cas).
import { callClaude } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

// Catégories de rattachement d'un document (voir
// migration_documents_2026-08-16.sql) — 'general' est représenté par null en
// base, mais Aaron raisonne dessus comme sur une catégorie à part entière.
export type DocumentCategory = 'general' | 'prospects' | 'opportunites' | 'clients';
const DOCUMENT_CATEGORIES: DocumentCategory[] = ['general', 'prospects', 'opportunites', 'clients'];

export interface DocumentAnalysis {
  summary: string | null;
  // Catégorie déduite par Aaron (classement automatique, 01/09/2026) — null
  // s'il n'a pas su trancher, auquel cas on laisse le document en général.
  category: DocumentCategory | null;
}

// Synthèse + classement en UN SEUL appel (01/09/2026) : Aaron lit déjà tout
// le document pour la synthèse, lui demander la catégorie au passage ne coûte
// que quelques jetons de plus, au lieu d'un second appel.
export async function analyzeDocument(
  fileName: string,
  extractedText: string,
  companyId: string,
  locale: string,
  userId?: string | null
): Promise<DocumentAnalysis> {
  if (!extractedText || extractedText.trim().length < 50) return { summary: null, category: null };

  try {
    const data = await callClaude(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content:
              `Voici le contenu extrait du document "${fileName}" (usage commercial : plaquette, argumentaire, tarifs, etc.).\n\n` +
              `1. Rédige une synthèse ${localeInstruction(locale)} de 2 à 4 phrases maximum, utile pour qu'un commercial comprenne en un coup d'œil ` +
              `à quoi sert ce document et ce qu'il contient.\n` +
              `2. Range-le dans UNE de ces catégories, selon le moment de la vente où il sert :\n` +
              `   - "prospects" : sert à convaincre quelqu'un qui ne connaît pas encore l'entreprise (plaquette, argumentaire de prospection, cas clients, présentation de l'offre).\n` +
              `   - "opportunites" : sert pendant la négociation, après un premier rendez-vous (grille tarifaire, modèle de devis, conditions commerciales, comparatif concurrents, contrat type).\n` +
              `   - "clients" : sert une fois le client signé (guide de démarrage, mode d'emploi, documentation technique, support, facturation).\n` +
              `   - "general" : document interne ou transverse qui ne colle à aucune des trois (organigramme, note interne, document administratif).\n\n` +
              `Réponds UNIQUEMENT avec un JSON valide, sans texte autour ni balises markdown :\n` +
              `{"summary": "…", "category": "prospects|opportunites|clients|general"}\n\n` +
              `${extractedText.slice(0, 4000)}`,
          },
        ],
      },
      companyId,
      undefined,
      userId
    );

    const textBlock = data.content.find((block: any) => block.type === 'text');
    if (!textBlock) return { summary: null, category: null };
    const raw = textBlock.text.trim();
    try {
      const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const category = DOCUMENT_CATEGORIES.includes(parsed.category) ? (parsed.category as DocumentCategory) : null;
      return { summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : null, category };
    } catch {
      // Réponse non-JSON (rare) : on garde au moins le texte comme synthèse,
      // sans classement — mieux que de tout perdre.
      return { summary: raw, category: null };
    }
  } catch (err: any) {
    console.error('Erreur analyse document:', err.message);
    return { summary: null, category: null };
  }
}

export async function summarizeDocument(
  fileName: string,
  extractedText: string,
  companyId: string,
  locale: string
): Promise<string | null> {
  if (!extractedText || extractedText.trim().length < 50) return null;

  try {
    const data = await callClaude(
      {
        model: 'claude-haiku-4-5',
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
    console.error('Erreur génération synthèse document:', err.message);
    return null;
  }
}
