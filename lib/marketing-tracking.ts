// lib/marketing-tracking.ts
// Helpers de suivi pour le module Aaron Marketing (docx AJOUT GLOBAL, message
// du 21/08/2026 : campagnes email vers les clients déjà gagnés — voir
// migration_marketing_campaigns_2026-08-21.sql).
//
// Suivi des CLICS : fonctionne pleinement, même en email texte brut — chaque
// URL du corps est réécrite pour passer par une redirection de suivi avant
// d'atteindre sa destination réelle.
//
// Suivi des OUVERTURES : les colonnes marketing_campaign_recipients.opened_at
// / open_count existent déjà en base mais ne sont volontairement PAS encore
// alimentées. Le suivi d'ouverture classique repose sur un pixel invisible en
// HTML — or lib/google.ts (sendGmailEmail) et lib/microsoft.ts
// (sendOutlookEmail) envoient aujourd'hui TOUS les emails de l'app en
// text/plain, pas seulement ceux de ce module. Passer l'app entière en HTML
// (multipart/alternative) pour débloquer ça toucherait tous les emails de
// prospection et transactionnels existants, sans possibilité de test en
// direct dans cet environnement — scopé pour un prochain lot, communiqué
// explicitement à Alex plutôt que fait à moitié en silence.

const URL_REGEX = /(https?:\/\/[^\s<>()]+)/g;

function baseUrl(): string {
  return (process.env.APP_URL || 'https://app.meetaaron.app').replace(/\/$/, '');
}

// Remplace chaque URL http(s) trouvée dans un texte par un lien de suivi
// propre à CE destinataire (token), qui redirige vers l'URL d'origine — voir
// app/api/marketing-campaigns/track/click/[token]/route.ts. Les URL de suivi
// elles-mêmes (déjà générées, ex. lors d'un re-calcul) ne sont pas re-réécrites
// une seconde fois.
export function rewriteLinksForTracking(text: string, token: string): string {
  const trackBase = `${baseUrl()}/api/marketing-campaigns/track/click/`;
  return text.replace(URL_REGEX, (match) => {
    if (match.startsWith(trackBase)) return match;
    return `${trackBase}${token}?u=${encodeURIComponent(match)}`;
  });
}

export function unsubscribeLink(token: string): string {
  return `${baseUrl()}/api/marketing-campaigns/track/unsubscribe/${token}`;
}

// Pied de page ajouté à CHAQUE email de campagne envoyé — lien de
// désabonnement obligatoire (conformité, et demande implicite d'Alex : "le
// meilleur au monde" suppose une app qui respecte les règles de base de
// l'emailing marketing, pas seulement une app qui envoie des emails).
export function appendUnsubscribeFooter(text: string, token: string): string {
  return `${text}\n\n---\nPour ne plus recevoir ce type d'email : ${unsubscribeLink(token)}`;
}

// Personnalisation simple par balise de fusion — {{prenom}} remplacé par le
// prénom du destinataire (premier mot de full_name). Volontairement limité à
// une seule balise pour ce premier lot plutôt que d'inventer un mini-langage
// de templating non testable en direct.
export function personalize(text: string, fullName: string | null | undefined): string {
  const firstName = (fullName || '').trim().split(/\s+/)[0] || '';
  return text.replace(/\{\{\s*prenom\s*\}\}/gi, firstName);
}
