// lib/business-profile-format.ts
// Logique de mise en forme partagée entre les deux exports du "Profil de
// l'entreprise" (lib/rtf-document.ts pour Word, lib/business-profile-pdf.ts
// pour PDF) — demande Alex, 27/08/2026. Factorisé pour éviter de dupliquer
// deux fois la même règle de découpage en paragraphes et de détection des
// phrases-marqueurs.

// Détecte les phrases-marqueurs déjà produites par la génération IA du
// résumé (voir app/api/business-summary/route.ts, prompts "Légitimité :" et
// "Preuve sociale :") pour les mettre en avant visuellement dans l'export —
// mais reste générique : si l'utilisateur a écrit/collé son propre texte
// structuré en paragraphes (fournisseurs, façon de travailler, etc.), chaque
// paragraphe reste simplement mis en forme proprement, marqueur ou non.
export const BUSINESS_PROFILE_MARKER_RE = /^(Légitimité|Preuve sociale)\s*:/i;

export function splitBusinessProfileParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
