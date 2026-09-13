// lib/aaron-sender.ts
//
// LE NOM QUI S'AFFICHE QUAND AARON ÉCRIT AU COMMERCIAL.
//
// Remarque d'Alex (13/09/2026) : « Aaron Assistant Commercial sur Google —
// j'ai mis en nom/prénom pour que ça fasse stylé. Mais du coup ça ne le fait
// pas en anglais, allemand, etc. »
//
// C'est exact, et la cause n'était pas dans le code : les emails envoyés par
// sendGmailEmail ne portaient AUCUN en-tête From. Gmail comblait donc le vide
// avec le nom du profil du compte aaron@meetaaron.app — « Aaron » / « Assistant
// Commercial », en français, pour la terre entière.
//
// On pose désormais le From nous-mêmes, avec un nom traduit dans la langue du
// destinataire. L'adresse, elle, ne bouge pas : c'est toujours la boîte
// authentifiée qui envoie, Gmail n'accepterait rien d'autre.
//
// À NE PAS confondre avec le nom d'expéditeur des emails de PROSPECTION :
// ceux-là partent au nom du commercial lui-même (users.full_name, voir
// lib/messaging.ts). Ici il s'agit uniquement des emails qu'Aaron adresse à
// SON propre client — rapport de résultats, confirmation de compte, alertes.

export const AARON_SENDER_NAME: Record<string, string> = {
  fr: 'Aaron Assistant Commercial',
  en: 'Aaron Sales Assistant',
  de: 'Aaron Vertriebsassistent',
  it: 'Aaron Assistente Commerciale',
  es: 'Aaron Asistente Comercial',
  pt: 'Aaron Assistente Comercial',
  nl: 'Aaron Verkoopassistent',
};

export function aaronSenderName(locale: string | null | undefined): string {
  const key = (locale || '').trim().toLowerCase();
  return AARON_SENDER_NAME[key] || AARON_SENDER_NAME.fr;
}

// Un nom d'expéditeur contenant des accents ou des caractères non-ASCII doit
// être encodé (RFC 2047), sinon certains serveurs le tronquent ou affichent
// des caractères cassés. Les noms ci-dessus sont ASCII aujourd'hui, mais une
// traduction future ne le sera pas forcément — on encode dès que nécessaire.
export function encodeSenderName(name: string): string {
  if (/^[\x20-\x7E]*$/.test(name)) return `"${name.replace(/"/g, '')}"`;
  return `=?UTF-8?B?${Buffer.from(name).toString('base64')}?=`;
}
