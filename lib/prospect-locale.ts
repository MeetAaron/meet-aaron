// lib/prospect-locale.ts
//
// DANS QUELLE LANGUE AARON ÉCRIT-IL AU PROSPECT ?
//
// Demande d'Alex (13/09/2026) : « si je mets le pays du client, genre
// Australia, il faut que l'email soit rédigé en anglais — logique ».
//
// Jusqu'ici, pour un prospect ajouté à la main, Aaron n'avait qu'un seul
// repère : la langue d'interface du commercial. Un commercial français qui
// démarche une entreprise australienne recevait donc un premier email en
// français. Les campagnes, elles, avaient déjà `target_locale` — ce fichier
// apporte le même bon sens aux prospects saisis un par un.
//
// Ordre des signaux, du plus fiable au moins fiable :
//   1. la langue déjà employée PAR LE PROSPECT dans ses réponses (géré dans
//      le prompt système d'Aaron, pas ici : dès qu'il a écrit, sa langue
//      prime sur tout le reste) ;
//   2. la langue cible de la campagne d'origine, quand il y en a une ;
//   3. le PAYS lu dans l'adresse de l'entreprise (ce fichier) ;
//   4. l'EXTENSION du domaine de son email (ce fichier) ;
//   5. la langue du commercial, faute de mieux.
//
// Principe directeur : dans le doute, ON NE DEVINE PAS. Un pays bilingue
// (Belgique, Suisse, Canada) et une extension neutre (.com, .net, gmail…)
// renvoient null, et le repli sur la langue du commercial s'applique — se
// tromper de langue coûte plus cher que de rester sur la valeur par défaut.

const SUPPORTED = new Set(['fr', 'en', 'de', 'it', 'es', 'pt', 'nl']);

// Noms de pays dans les langues où ils risquent d'être saisis (français et
// anglais surtout, plus la langue locale). Volontairement SANS la Belgique,
// la Suisse et le Canada : deux langues officielles ou plus, aucun choix
// évident, on laisse le repli décider.
const COUNTRY_TO_LOCALE: Array<[string, string]> = [
  // anglais
  ['australia', 'en'], ['australie', 'en'],
  ['new zealand', 'en'], ['nouvelle-zelande', 'en'], ['nouvelle zelande', 'en'],
  ['united kingdom', 'en'], ['royaume-uni', 'en'], ['royaume uni', 'en'],
  ['england', 'en'], ['angleterre', 'en'], ['scotland', 'en'], ['ecosse', 'en'],
  ['wales', 'en'], ['pays de galles', 'en'],
  ['ireland', 'en'], ['irlande', 'en'],
  ['united states', 'en'], ['etats-unis', 'en'], ['etats unis', 'en'], ['usa', 'en'],
  ['singapore', 'en'], ['singapour', 'en'],
  ['south africa', 'en'], ['afrique du sud', 'en'],
  // français
  ['france', 'fr'], ['monaco', 'fr'], ['luxembourg', 'fr'],
  // allemand
  ['germany', 'de'], ['allemagne', 'de'], ['deutschland', 'de'],
  ['austria', 'de'], ['autriche', 'de'], ['osterreich', 'de'],
  // italien
  ['italy', 'it'], ['italie', 'it'], ['italia', 'it'],
  // espagnol
  ['spain', 'es'], ['espagne', 'es'], ['espana', 'es'],
  ['mexico', 'es'], ['mexique', 'es'], ['argentina', 'es'], ['argentine', 'es'],
  ['chile', 'es'], ['chili', 'es'], ['colombia', 'es'], ['colombie', 'es'],
  ['peru', 'es'], ['perou', 'es'],
  // portugais
  ['portugal', 'pt'], ['brazil', 'pt'], ['bresil', 'pt'], ['brasil', 'pt'],
  // néerlandais
  ['netherlands', 'nl'], ['pays-bas', 'nl'], ['pays bas', 'nl'], ['nederland', 'nl'],
];

// Extensions nationales sans ambiguïté. .be, .ch et .ca sont absentes
// exprès (pays multilingues), .com/.net/.org/.io/.app aussi (aucun pays).
const TLD_TO_LOCALE: Record<string, string> = {
  au: 'en', nz: 'en', uk: 'en', ie: 'en', us: 'en', sg: 'en', za: 'en', in: 'en',
  fr: 'fr',
  de: 'de', at: 'de',
  it: 'it',
  es: 'es', mx: 'es', ar: 'es', cl: 'es', pe: 'es',
  pt: 'pt', br: 'pt',
  nl: 'nl',
};

// Minuscules, accents retirés, ponctuation ramenée à des espaces : « Perth,
// Western Australia 6000 » et « PERTH - WESTERN AUSTRALIE » doivent tomber
// sur la même clé.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function localeFromCountryText(text: string | null | undefined): string | null {
  if (!text) return null;
  const hay = ' ' + normalize(text) + ' ';
  // Les noms les plus longs d'abord : « new zealand » doit gagner sur
  // « zealand » si jamais une entrée courte venait à exister.
  const sorted = COUNTRY_TO_LOCALE.slice().sort((a, b) => b[0].length - a[0].length);
  for (const [name, loc] of sorted) {
    if (hay.includes(' ' + name + ' ')) return loc;
  }
  return null;
}

export function localeFromEmailDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  const domain = email.split('@').pop()!.toLowerCase().trim();
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  const tld = parts[parts.length - 1];
  // « exemple.co.uk » : l'extension nationale est la dernière, « uk ».
  return TLD_TO_LOCALE[tld] || null;
}

export interface ProspectLocaleSignals {
  campaignLocale?: string | null;   // campagne d'origine (target_locale)
  address?: string | null;          // adresse de l'entreprise prospectée
  country?: string | null;          // pays explicite s'il existe un jour
  email?: string | null;            // email du contact
  sellerLocale?: string | null;     // langue du commercial — dernier recours
}

// Renvoie TOUJOURS une langue supportée. Le prompt système d'Aaron garde le
// dernier mot : si le prospect a déjà répondu, c'est SA langue qui prime,
// quelle qu'ait été celle du premier email.
export function resolveProspectLocale(signals: ProspectLocaleSignals): string {
  const candidates = [
    SUPPORTED.has(String(signals.campaignLocale)) ? String(signals.campaignLocale) : null,
    localeFromCountryText(signals.country),
    localeFromCountryText(signals.address),
    localeFromEmailDomain(signals.email),
    SUPPORTED.has(String(signals.sellerLocale)) ? String(signals.sellerLocale) : null,
  ];
  for (const c of candidates) {
    if (c && SUPPORTED.has(c)) return c;
  }
  return 'fr';
}
