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

// Titres de section du "profil de l'entreprise" enrichi (demande Alex,
// 29/08/2026 : "tu es le meilleur commercial du monde, qu'est ce qui devrait
// être dans une fiche entreprise pour qu'elle soit parfaite ?"). Le prompt de
// génération (app/api/business-summary/route.ts) écrit chaque titre de
// section sur sa propre ligne au format Markdown "## Titre" — reconnu ici
// pour être mis en forme comme un vrai titre (pas un paragraphe de plus) dans
// les deux exports. Rétro-compatible : un ancien résumé généré avant ce
// chantier (un seul paragraphe, sans "## ") ne matche jamais cette regex et
// continue à s'afficher exactement comme avant.
export const BUSINESS_PROFILE_HEADING_RE = /^##\s+(.+)$/;

export function splitBusinessProfileParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Classifie chaque paragraphe (déjà découpé par splitBusinessProfileParagraphs)
// pour que les deux moteurs de rendu (RTF et PDF) appliquent la même logique
// de mise en forme sans dupliquer les regex.
export type BusinessProfileParagraph =
  | { type: 'heading'; text: string }
  | { type: 'marker'; label: string; rest: string }
  | { type: 'body'; text: string };

// Aperçu court du profil (titres retirés, espaces normalisés, tronqué avec
// "…") — utilisé partout où on affiche un extrait plutôt que le document
// entier : le chat (message de fin de génération) et Mon compte > Mon
// entreprise (demande Alex, 29/08/2026 : remplacer le pavé de texte brut par
// un aperçu + bouton "voir le profil complet"). Factorisé ici pour que les
// deux endroits tronquent exactement de la même façon.
export const BUSINESS_PROFILE_PREVIEW_LENGTH = 280;

export function buildBusinessProfilePreview(fullText: string, maxLength: number = BUSINESS_PROFILE_PREVIEW_LENGTH): string {
  if (!fullText) return '';
  const stripped = fullText
    .replace(/^##\s+.+$/gm, '') // retire les titres de section markdown
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= maxLength) return stripped;
  return `${stripped.slice(0, maxLength).trimEnd()}…`;
}

export function classifyBusinessProfileParagraph(para: string): BusinessProfileParagraph {
  const headingMatch = para.match(BUSINESS_PROFILE_HEADING_RE);
  if (headingMatch) {
    return { type: 'heading', text: headingMatch[1].trim() };
  }
  const markerMatch = para.match(BUSINESS_PROFILE_MARKER_RE);
  if (markerMatch) {
    return { type: 'marker', label: para.slice(0, markerMatch[0].length), rest: para.slice(markerMatch[0].length).trim() };
  }
  return { type: 'body', text: para };
}
