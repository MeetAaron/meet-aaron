// lib/signature.ts
// Heuristique pour extraire une signature email probable à partir du texte
// brut d'un email récemment envoyé par le commercial. C'est volontairement
// une PROPOSITION à valider/corriger par le commercial (voir /api/signature
// et app/app/preferences/page.jsx) — jamais appliquée automatiquement sans
// relecture, l'extraction restant approximative par nature.

// Marqueurs de début de citation (email précédent cité en dessous) à couper
// avant de chercher la signature, sinon on risque de récupérer la signature
// du CORRESPONDANT plutôt que celle du commercial.
const QUOTE_MARKERS = [
  /\n[^\n]*\bLe\b.{0,60}\ba écrit\s*:/i,
  /\n[^\n]*\bOn\b.{0,60}\bwrote:/i,
  /\n-{2,}\s*Message d'origine\s*-{2,}/i,
  /\n-{2,}\s*Original Message\s*-{2,}/i,
  /\n>{1}/, // première ligne citée façon ">"
];

export function guessEmailSignature(rawBody: string | null | undefined): string | null {
  if (!rawBody) return null;

  let body = rawBody.replace(/\r\n/g, '\n');

  // Coupe tout ce qui suit le premier marqueur de citation trouvé.
  for (const marker of QUOTE_MARKERS) {
    const match = body.match(marker);
    if (match && match.index !== undefined) {
      body = body.slice(0, match.index);
    }
  }

  const lines = body.split('\n').map((l) => l.trimEnd());

  // Cas le plus fiable : un séparateur de signature standard "--" (ou "— ")
  // sur sa propre ligne.
  const sepIndex = lines.findIndex((l) => l.trim() === '--' || l.trim() === '—');
  if (sepIndex !== -1 && sepIndex < lines.length - 1) {
    const candidate = lines.slice(sepIndex + 1).join('\n').trim();
    if (candidate) return candidate;
  }

  // Sinon, heuristique plus grossière : les 6 dernières lignes non vides,
  // en s'arrêtant si on retombe sur un paragraphe qui ressemble au corps du
  // message (trop long pour une ligne de signature).
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return null;

  const tail: string[] = [];
  for (let i = nonEmpty.length - 1; i >= 0 && tail.length < 6; i--) {
    const line = nonEmpty[i];
    if (line.length > 120) break; // probablement une phrase du corps du message, pas une signature
    tail.unshift(line);
  }

  const candidate = tail.join('\n').trim();
  return candidate.length > 0 ? candidate : null;
}
