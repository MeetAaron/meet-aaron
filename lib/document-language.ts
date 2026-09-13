// lib/document-language.ts
//
// DANS QUELLE LANGUE EST CE DOCUMENT ?
//
// Demande d'Alex (13/09/2026) : « il me faut la possibilité de mettre cette
// plaquette dans mes documents et qu'Aaron sélectionne la bonne selon le pays
// où j'envoie l'email ».
//
// Le choix d'UX (je cite : « je te laisse choisir la meilleure ») : on NE
// DEMANDE RIEN au commercial au moment du dépôt. Le texte du document est
// déjà extrait pour qu'Aaron puisse le lire (company_documents.extracted_text)
// — on s'en sert pour deviner la langue, on l'affiche comme une étiquette
// modifiable à côté du fichier, et c'est tout. Quand la détection est juste,
// le commercial n'a rien à faire ; quand elle se trompe, il corrige en un
// clic. Un menu déroulant obligatoire à chaque dépôt aurait fait payer à
// tout le monde le prix de l'erreur occasionnelle.
//
// Détection par mots-outils, pas par appel à un modèle : c'est instantané,
// gratuit, déterministe, et parfaitement suffisant pour distinguer sept
// langues européennes sur une plaquette commerciale de quelques centaines de
// mots. Une plaquette n'est pas un texte ambigu.
//
// Valeurs possibles pour company_documents.language :
//   'fr' | 'en' | 'de' | 'it' | 'es' | 'pt' | 'nl' — une langue précise
//   'all'  — document valable dans toutes les langues (grille tarifaire,
//            plaquette en images, certificat…) : toujours éligible
//   null   — langue inconnue, se comporte comme un repli de dernier recours

// Mots volontairement DISCRIMINANTS : on évite ceux que plusieurs langues
// partagent (« para » existe en espagnol et en portugais, « de » partout).
// Chaque entrée compte pour 1 point, les marqueurs très typés pour 2.
const MARKERS: Record<string, Array<[string, number]>> = {
  fr: [['les', 1], ['des', 1], ['vous', 2], ['pour', 1], ['avec', 1], ['votre', 2], ['nous', 1], ['dans', 1], ['est', 1], ['être', 2], ['plus', 1], ['cette', 2]],
  en: [['the', 2], ['and', 1], ['your', 2], ['with', 1], ['for', 1], ['our', 1], ['this', 1], ['that', 1], ['from', 1], ['will', 1], ['you', 1]],
  de: [['und', 2], ['die', 1], ['der', 1], ['das', 1], ['für', 2], ['mit', 1], ['sie', 1], ['ihre', 2], ['nicht', 2], ['eine', 1], ['auch', 1]],
  it: [['che', 1], ['della', 2], ['vostro', 2], ['gli', 2], ['sono', 1], ['nella', 2], ['anche', 1], ['questo', 2], ['tuo', 1]],
  es: [['los', 2], ['las', 2], ['nuestro', 2], ['también', 2], ['del', 1], ['sus', 1], ['muy', 1], ['este', 1], ['españa', 2]],
  pt: [['não', 2], ['são', 2], ['nosso', 2], ['você', 2], ['dos', 1], ['uma', 1], ['muito', 1], ['também', 1], ['então', 2]],
  nl: [['een', 2], ['het', 2], ['van', 1], ['voor', 1], ['niet', 2], ['onze', 2], ['zijn', 1], ['deze', 2], ['ook', 1]],
};

export const DOCUMENT_LANGUAGES = ['fr', 'en', 'de', 'it', 'es', 'pt', 'nl'] as const;

// Nombre de mots minimum pour qu'une détection ait un sens. En dessous (une
// plaquette uniquement en images, un logo, un tableau de prix), on renvoie
// null plutôt qu'une langue tirée au sort — et l'écran propose alors
// « Toutes langues », qui est presque toujours la bonne réponse pour ce
// genre de fichier.
const MIN_WORDS = 25;

export function detectDocumentLanguage(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = text
    .toLowerCase()
    // Classe de caractères explicite plutôt que \p{L} : le projet compile en
    // ES5 (voir tsconfig), où les propriétés Unicode dans les regex n'existent
    // pas encore. « a-z » plus la plage accentuée latine couvre les sept
    // langues de l'app, et le texte a déjà été passé en minuscules.
    .replace(/[^a-zà-öø-ÿ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < MIN_WORDS) return null;

  const counts: Record<string, number> = {};
  for (const w of words) counts[w] = (counts[w] || 0) + 1;

  let best: string | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const lang of Object.keys(MARKERS)) {
    let score = 0;
    for (const [marker, weight] of MARKERS[lang]) {
      score += (counts[marker] || 0) * weight;
    }
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = lang;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Deux langues au coude à coude : on préfère ne rien affirmer. Le
  // commercial verra « Langue à préciser » et tranchera lui-même, ce qui
  // vaut mieux qu'une plaquette espagnole envoyée à un Portugais.
  if (!best || bestScore < 4 || bestScore < secondScore * 1.4) return null;
  return best;
}

// Ordre de préférence quand Aaron doit choisir un document pour un prospect
// dont la langue est `locale` :
//   1. le document dans SA langue ;
//   2. un document marqué « toutes langues » ;
//   3. le document français (version de référence, cf. demande d'Alex) ;
//   4. n'importe lequel, le plus récent.
// Renvoie l'index du document retenu, ou -1 si la liste est vide.
export function pickDocumentForLocale<T extends { language?: string | null }>(
  docs: T[],
  locale: string | null | undefined
): number {
  if (!docs || docs.length === 0) return -1;
  const wanted = (locale || '').trim().toLowerCase();
  const find = (pred: (d: T) => boolean) => docs.findIndex(pred);

  let i = wanted ? find((d) => (d.language || '').toLowerCase() === wanted) : -1;
  if (i >= 0) return i;
  i = find((d) => (d.language || '').toLowerCase() === 'all');
  if (i >= 0) return i;
  i = find((d) => (d.language || '').toLowerCase() === 'fr');
  if (i >= 0) return i;
  return 0;
}
