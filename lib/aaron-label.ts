// lib/aaron-label.ts
//
// Le repère « Aaron s'en occupe » posé dans la boîte du commercial : label
// Gmail (lib/google.ts) et catégorie/dossier Outlook (lib/microsoft.ts).
//
// 13/09/2026 — jusqu'ici le nom était codé en dur en français, dans les deux
// fichiers. Deux conséquences, l'une gênante et l'autre bloquante :
//
//   - un client allemand ou espagnol voyait apparaître « Géré par Aaron »
//     dans sa boîte, seul morceau de français d'une interface par ailleurs
//     entièrement traduite ;
//   - la vidéo de vérification Google doit être INTÉGRALEMENT en anglais.
//     Un examinateur qui voit un libellé français sur le plan censé
//     démontrer gmail.modify ne peut pas lire ce qu'on lui montre, et c'est
//     un motif de rejet du dossier.
//
// Le nom suit donc désormais users.locale. L'emoji est conservé dans toutes
// les langues : c'est lui qui rend le repère reconnaissable d'un coup d'œil
// dans une liste de dossiers, et il ne se traduit pas.

const PREFIX = '🤖 ';

export const AARON_LABEL_BY_LOCALE: Record<string, string> = {
  fr: `${PREFIX}Géré par Aaron`,
  en: `${PREFIX}Managed by Aaron`,
  de: `${PREFIX}Von Aaron betreut`,
  it: `${PREFIX}Gestito da Aaron`,
  es: `${PREFIX}Gestionado por Aaron`,
  pt: `${PREFIX}Gerido por Aaron`,
  nl: `${PREFIX}Beheerd door Aaron`,
};

export const DEFAULT_AARON_LABEL = AARON_LABEL_BY_LOCALE.fr;

// Toutes les variantes connues, pour RECONNAÎTRE un repère déjà posé quelle
// que soit la langue dans laquelle il a été créé. Sans ça, un commercial qui
// change de langue se retrouverait avec deux labels concurrents et des fils
// rangés dans les deux.
const ALL_NAMES = new Set(Object.values(AARON_LABEL_BY_LOCALE));

export function aaronLabelName(locale: string | null | undefined): string {
  const key = (locale || '').trim().toLowerCase();
  return AARON_LABEL_BY_LOCALE[key] || DEFAULT_AARON_LABEL;
}

export function isAaronLabelName(name: string | null | undefined): boolean {
  return !!name && ALL_NAMES.has(name.trim());
}

// Variante SANS emoji et SANS accent, pour les serveurs IMAP qui refusent un
// nom de dossier non-ASCII (l'UTF-7 modifie de la norme IMAP n'est pas
// universellement implemente — certains Dovecot anciens et quelques
// hebergeurs mutualises renvoient une erreur a la creation).
//
// 26/09/2026 : jusqu'ici lib/imap.ts portait ses propres constantes en
// francais en dur, alors que Gmail et Outlook etaient traduits depuis le
// 13/09. Un commercial allemand sur « Autre boite mail » voyait donc
// apparaitre « Gere par Aaron » dans son client de messagerie — exactement
// le defaut qu'on avait corrige partout ailleurs.
export function aaronLabelNameAscii(locale: string | null | undefined): string {
  return aaronLabelName(locale)
    .replace(PREFIX, '')
    .normalize('NFD')
    // Plage des diacritiques combinants (U+0300 a U+036F).
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

// Toutes les variantes ASCII connues, pour RECONNAITRE un dossier deja cree
// quelle que soit la langue — meme role que isAaronLabelName cote Gmail.
const ALL_ASCII_NAMES = new Set(
  Object.keys(AARON_LABEL_BY_LOCALE).map((l) => aaronLabelNameAscii(l))
);

export function isAaronFolderName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  return ALL_NAMES.has(trimmed) || ALL_ASCII_NAMES.has(trimmed);
}
