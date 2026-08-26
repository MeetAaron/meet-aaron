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
    console.error('Erreur génération synthèse document:', err.message);
    return null;
  }
}
