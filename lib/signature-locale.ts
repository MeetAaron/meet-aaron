// lib/signature-locale.ts
//
// QUELLE SIGNATURE COLLER EN BAS D'UN EMAIL, SELON LA LANGUE DU DESTINATAIRE.
//
// Le trou etait la (A_FAIRE.docx, 26/09/2026) : depuis lib/prospect-locale.ts,
// Aaron redige deja le premier email dans la langue du prospect — anglais
// pour une entreprise australienne, allemand pour une entreprise autrichienne,
// et ainsi de suite. La signature, elle, restait celle d'une seule langue.
// Un email anglais se terminait donc par « Cordialement, / Directeur
// commercial / Port. : 06 ... », ce qui annule une bonne partie du soin mis
// dans le corps du message.
//
// Principe : users.email_signature reste LA signature par defaut (comportement
// inchange pour tout compte qui ne renseigne rien). users.email_signature_by_locale
// est un simple objet { langue: texte } qui la remplace quand la langue du
// destinataire y figure. Une langue absente, une valeur vide, une colonne pas
// encore migree : on retombe sur la signature par defaut. Jamais d'email sans
// signature parce qu'une traduction manquait.

import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { resolveProspectLocale } from '@/lib/prospect-locale';
import { callClaude } from '@/lib/anthropic-client';

export const SIGNATURE_LOCALES = ['fr', 'en', 'de', 'it', 'es', 'pt', 'nl'] as const;

// Meme plafond que capSignature dans lib/messaging.ts : une signature n'est
// pas un corps de message, et une signature geante est la premiere cause du
// « [Message tronque] » de Gmail.
const MAX_SIGNATURE_CHARS = 1500;

// ── TRADUCTION AUTOMATIQUE (18/11/2026) ────────────────────────────────────
//
// Retour d'Alex : sept onglets de langue a remplir a la main, personne ne le
// fait, et l'ecran est laid. Desormais le commercial ecrit UNE signature ;
// Aaron la decline dans les six autres langues et choisit la bonne a l'envoi.
//
// Tout tient dans la colonne jsonb existante (aucune migration) :
//   { en: '…', de: '…', _meta: { auto, src, from, manual } }
//   - auto   : traduction automatique active (vrai par defaut) ;
//   - src    : empreinte de la signature par defaut a partir de laquelle les
//              versions automatiques ont ete produites. Si la signature a
//              change depuis, ces versions sont PERIMEES et ne partent pas :
//              on retombe sur la signature par defaut, jamais sur un ancien
//              numero de telephone traduit ;
//   - from   : langue dans laquelle la signature par defaut est ecrite ;
//   - manual : langues que le commercial a ecrites ou corrigees lui-meme.
//              Celles-la ne sont jamais ecrasees ni considerees perimees.
// Une colonne sans _meta (comptes d'avant) : toutes ses langues sont
// « manuelles », exactement le comportement d'avant.

export type SignatureMeta = { auto: boolean; src: string | null; from: string | null; manual: string[] };

const LOCALE_SET = new Set<string>(SIGNATURE_LOCALES as readonly string[]);

export function signatureHash(text: string | null | undefined): string {
  return crypto.createHash('sha256').update(tidySignature(text || '').normalize('NFC')).digest('hex').slice(0, 16);
}

// Mise au propre d'une signature SANS toucher a ses retours a la ligne : une
// signature est une suite de lignes courtes voulues telles quelles. On retire
// seulement les espaces de fin de ligne, les lignes vides en double et celles
// du debut et de la fin.
export function tidySignature(text: string): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toObject(byLocale: any): Record<string, any> | null {
  let map: any = byLocale;
  if (typeof map === 'string') {
    try { map = JSON.parse(map); } catch { map = null; }
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  return map;
}

// Lit la colonne : les textes par langue d'un cote, les reglages de l'autre.
export function parseSignatureMap(byLocale: any): { entries: Record<string, string>; meta: SignatureMeta } {
  const map = toObject(byLocale);
  const entries: Record<string, string> = {};
  if (map) {
    for (const locale of SIGNATURE_LOCALES) {
      const raw = map[locale];
      if (typeof raw === 'string' && raw.trim()) entries[locale] = raw.trim().slice(0, MAX_SIGNATURE_CHARS);
    }
  }
  const rawMeta = map && map._meta && typeof map._meta === 'object' ? map._meta : null;
  if (!rawMeta) {
    return { entries, meta: { auto: true, src: null, from: null, manual: Object.keys(entries) } };
  }
  const manual = Array.isArray(rawMeta.manual)
    ? rawMeta.manual.filter((l: any) => typeof l === 'string' && LOCALE_SET.has(l) && entries[l])
    : [];
  return {
    entries,
    meta: {
      auto: rawMeta.auto !== false,
      src: typeof rawMeta.src === 'string' ? rawMeta.src : null,
      from: typeof rawMeta.from === 'string' && LOCALE_SET.has(rawMeta.from) ? rawMeta.from : null,
      manual,
    },
  };
}

// Reconstruit la valeur a ecrire en base. null quand il n'y a rien a retenir
// (aucun texte et traduction automatique active = l'etat par defaut).
export function buildSignatureMap(entries: Record<string, string>, meta: SignatureMeta): Record<string, any> | null {
  const out: Record<string, any> = {};
  for (const locale of SIGNATURE_LOCALES) {
    const value = (entries[locale] || '').trim().slice(0, MAX_SIGNATURE_CHARS);
    if (value) out[locale] = value;
  }
  const manual = meta.manual.filter((l) => out[l]);
  if (Object.keys(out).length === 0 && meta.auto && !meta.from) return null;
  out._meta = { auto: meta.auto, src: meta.src, from: meta.from, manual };
  return out;
}

// Nettoie ce qui arrive de l'UI avant de l'ecrire en base : on ne garde que
// les langues supportees, on coupe les valeurs trop longues, et on supprime
// les entrees vides (une langue vidée = retour au repli, pas une signature
// vide dans les emails).
export function normalizeSignatureMap(input: any): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const locale of SIGNATURE_LOCALES) {
    const raw = (input as any)[locale];
    if (typeof raw !== 'string') continue;
    const value = tidySignature(raw).slice(0, MAX_SIGNATURE_CHARS);
    if (value) out[locale] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Une version automatique n'est valable que si elle a ete produite a partir
// de la signature par defaut ACTUELLE.
function usableEntry(
  locale: string,
  entries: Record<string, string>,
  meta: SignatureMeta,
  defaultSignature: string
): string | null {
  const candidate = entries[locale];
  if (!candidate) return null;
  if (meta.manual.includes(locale)) return candidate;
  if (!meta.auto) return null;
  return meta.src && meta.src === signatureHash(defaultSignature) ? candidate : null;
}

// Choix effectif. `byLocale` peut arriver en objet (jsonb) ou en chaine JSON
// selon le client Postgrest — les deux sont acceptes.
export function pickSignature(
  defaultSignature: string | null | undefined,
  byLocale: any,
  locale: string | null | undefined
): string {
  const fallback = (defaultSignature || '').trim();
  const key = String(locale || '').trim().toLowerCase();
  if (!key) return fallback;
  const { entries, meta } = parseSignatureMap(byLocale);
  return usableEntry(key, entries, meta, fallback) || fallback;
}

// ── LANGUE D'UN TEXTE, SANS APPEL A L'IA ───────────────────────────────────
//
// La signature doit parler la langue DU MESSAGE qu'elle termine. Le meilleur
// indice est donc le corps de l'email lui-meme : si Aaron repond en anglais a
// un prospect allemand qui lui a ecrit en anglais, la signature est anglaise.
// Comptage de mots-outils sur les sept langues ; un mot propre a une seule
// langue compte double. Dans le doute (texte court, deux langues au coude a
// coude) : null, et les autres signaux decident.
const STOPWORDS: Record<string, string[]> = {
  fr: ['le', 'la', 'les', 'des', 'est', 'et', 'vous', 'nous', 'pour', 'dans', 'que', 'qui', 'une', 'un', 'votre', 'vos', 'avec', 'sur', 'pas', 'je', 'bonjour', 'ce', 'cette', 'au', 'aux', 'du', 'en', 'ne', 'plus', 'merci', 'notre', 'serait', 'bien', 'cordialement'],
  en: ['the', 'and', 'you', 'your', 'for', 'with', 'that', 'this', 'is', 'are', 'we', 'our', 'to', 'of', 'in', 'it', 'have', 'be', 'would', 'can', 'hi', 'hello', 'on', 'as', 'at', 'not', 'if', 'from', 'thanks', 'will', 'regards', 'please'],
  de: ['der', 'die', 'das', 'und', 'ist', 'sie', 'ich', 'wir', 'nicht', 'mit', 'für', 'auf', 'ein', 'eine', 'zu', 'den', 'von', 'dem', 'ihre', 'ihr', 'ihnen', 'hallo', 'auch', 'sich', 'es', 'im', 'dass', 'oder', 'gerne', 'uns', 'grüße', 'guten'],
  it: ['il', 'lo', 'gli', 'di', 'che', 'è', 'per', 'con', 'non', 'un', 'una', 'sono', 'del', 'della', 'vi', 'ci', 'buongiorno', 'ciao', 'più', 'come', 'anche', 'nel', 'alla', 'grazie', 'vostro', 'vostra', 'saluti', 'questo', 'essere', 'gentile'],
  es: ['el', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'es', 'por', 'con', 'para', 'no', 'su', 'sus', 'hola', 'se', 'lo', 'como', 'más', 'pero', 'nos', 'usted', 'gracias', 'del', 'al', 'muy', 'saludos', 'estimado', 'nuestro'],
  pt: ['o', 'os', 'as', 'de', 'que', 'e', 'em', 'um', 'uma', 'é', 'por', 'com', 'para', 'não', 'seu', 'sua', 'olá', 'se', 'do', 'da', 'dos', 'das', 'mais', 'como', 'você', 'obrigado', 'ao', 'muito', 'cumprimentos', 'nosso', 'nossa'],
  nl: ['de', 'het', 'een', 'en', 'van', 'is', 'dat', 'u', 'je', 'ik', 'wij', 'we', 'niet', 'met', 'voor', 'op', 'te', 'zijn', 'uw', 'aan', 'ook', 'hallo', 'als', 'bij', 'naar', 'om', 'dit', 'er', 'graag', 'ons', 'groet', 'beste'],
};

const STOPWORD_WEIGHTS: Record<string, Map<string, number>> = (() => {
  const seen = new Map<string, number>();
  for (const words of Object.values(STOPWORDS)) for (const w of new Set(words)) seen.set(w, (seen.get(w) || 0) + 1);
  const out: Record<string, Map<string, number>> = {};
  for (const [locale, words] of Object.entries(STOPWORDS)) {
    out[locale] = new Map(Array.from(new Set(words)).map((w) => [w, seen.get(w) === 1 ? 2 : 1]));
  }
  return out;
})();

export function detectTextLocale(text: string | null | undefined): string | null {
  const tokens = String(text || '').toLowerCase().split(/[^a-z\u00c0-\u024f]+/).filter(Boolean);
  if (tokens.length < 12) return null;
  const scores: Array<[string, number]> = [];
  for (const locale of SIGNATURE_LOCALES) {
    const weights = STOPWORD_WEIGHTS[locale];
    let score = 0;
    for (const token of tokens) score += weights.get(token) || 0;
    scores.push([locale, score]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (best[1] < 8) return null;
  if (second && best[1] < second[1] * 1.3) return null;
  return best[0];
}

// ── TRADUCTION D'UNE SIGNATURE ─────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'French', en: 'English', de: 'German', it: 'Italian', es: 'Spanish', pt: 'Portuguese', nl: 'Dutch',
};

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>()]+/gi;

// Une traduction de signature n'est acceptee que si elle n'a touche a RIEN de
// ce qui sert a joindre le commercial : memes chiffres dans le meme ordre
// (telephones, codes postaux, SIRET), memes adresses email, memes liens, et
// le meme nombre de lignes. Au moindre ecart on jette la traduction : mieux
// vaut une signature dans la langue du commercial qu'un numero faux.
export function isFaithfulSignature(source: string, translated: string): boolean {
  const src = tidySignature(source);
  const out = tidySignature(translated);
  if (!out) return false;
  if (out.length > src.length * 2 + 60) return false;
  const digits = (s: string) => s.replace(/\D+/g, '');
  if (digits(src) !== digits(out)) return false;
  const list = (s: string, re: RegExp) => (s.match(re) || []).map((v) => v.toLowerCase()).sort().join('|');
  if (list(src, EMAIL_RE) !== list(out, EMAIL_RE)) return false;
  if (list(src, URL_RE) !== list(out, URL_RE)) return false;
  const lines = (s: string) => s.split('\n').filter((l) => l.trim()).length;
  return lines(src) === lines(out);
}

function extractJsonObject(raw: string): any {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('réponse non JSON');
  }
}

// Un seul appel pour toutes les langues. Renvoie la langue d'origine reconnue
// et les versions validees ; une langue dont la traduction est refusee par
// isFaithfulSignature est simplement absente du resultat.
export async function translateSignature(
  signature: string,
  hintLocale: string,
  companyId: string | null,
  userId: string | null
): Promise<{ from: string; translations: Record<string, string> }> {
  const source = tidySignature(signature).slice(0, MAX_SIGNATURE_CHARS);
  const hint = LOCALE_SET.has(hintLocale) ? hintLocale : 'fr';
  const prompt =
    `You localise a professional EMAIL SIGNATURE so that it reads naturally to recipients who speak another language.\n` +
    `Supported languages: ${SIGNATURE_LOCALES.map((l) => `${l} (${LANGUAGE_NAMES[l]})`).join(', ')}.\n\n` +
    `1. Detect the language the signature is written in (look at the closing formula, job title and labels). ` +
    `If nothing in it reveals a language, assume "${hint}".\n` +
    `2. Produce the signature in EVERY OTHER supported language.\n\n` +
    `Rules, in order of importance:\n` +
    `- Keep EXACTLY the same number of lines, in the same order, including blank lines.\n` +
    `- NEVER change: names of people, company and brand names, phone numbers (every digit and its formatting), email addresses, URLs, street addresses, postcodes, city names, social handles, legal or registration numbers.\n` +
    `- Translate ONLY: closing formulas (the equivalent a native professional would write), job titles, generic labels (phone, mobile, website, address…), short taglines, country names.\n` +
    `- Keep separators (| · — - /), punctuation, emojis and the capitalisation style.\n` +
    `- A line with nothing to translate is copied unchanged.\n` +
    `- Do not add anything (no greeting, no comment, no country code).\n\n` +
    `Return ONLY a JSON object, no markdown: {"source": "xx", "translations": {"xx": "…", …}} ` +
    `with one key per target language and "\\n" for line breaks.\n\n` +
    `Signature:\n${JSON.stringify(source)}`;

  const data = await callClaude(
    {
      model: 'claude-haiku-4-5',
      max_tokens: Math.min(8000, 600 + Math.ceil((source.length * 7) / 2)),
      messages: [{ role: 'user', content: prompt }],
    },
    companyId,
    undefined,
    userId,
    'autre'
  );
  const raw = (data?.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('');
  const parsed = extractJsonObject(raw);
  const detected = String(parsed?.source || '').slice(0, 2).toLowerCase();
  const from = LOCALE_SET.has(detected) ? detected : hint;
  const translations: Record<string, string> = {};
  const rawTranslations = parsed?.translations && typeof parsed.translations === 'object' ? parsed.translations : {};
  for (const locale of SIGNATURE_LOCALES) {
    if (locale === from) continue;
    const value = rawTranslations[locale];
    if (typeof value === 'string' && isFaithfulSignature(source, value)) {
      translations[locale] = tidySignature(value).slice(0, MAX_SIGNATURE_CHARS);
    }
  }
  return { from, translations };
}

export type SignatureState = {
  signature: string;
  entries: Record<string, string>;
  meta: SignatureMeta;
  // Vrai quand il manque au moins une version automatique a jour.
  needsTranslation: boolean;
};

export function signatureStateOf(defaultSignature: string | null | undefined, byLocale: any, hintLocale?: string | null): SignatureState {
  const signature = tidySignature(defaultSignature || '');
  const { entries, meta } = parseSignatureMap(byLocale);
  const fresh = !!meta.src && meta.src === signatureHash(signature);
  const from = meta.from || (hintLocale && LOCALE_SET.has(hintLocale) ? hintLocale : null);
  // Sans langue d'origine connue, il faut passer par la traduction : c'est
  // elle qui la reconnait.
  const targets = (SIGNATURE_LOCALES as readonly string[]).filter((l) => l !== from && !meta.manual.includes(l));
  const needsTranslation =
    !!signature && meta.auto && (!meta.from || !fresh || targets.some((l) => !entries[l]));
  return { signature, entries, meta, needsTranslation };
}

// Produit (ou rafraichit) les versions automatiques et les enregistre.
// Sans effet si la traduction automatique est coupee, si la signature est
// vide ou si tout est deja a jour. Ne leve jamais : en cas d'echec (plafond
// atteint, IA indisponible) on renvoie l'etat tel qu'il est, et l'envoi
// retombe sur la signature par defaut.
export async function refreshSignatureTranslations(
  userId: string,
  hintLocale?: string | null
): Promise<SignatureState | null> {
  try {
    const read = async () =>
      supabaseAdmin
        .from('users')
        .select('email_signature, email_signature_by_locale, locale, company_id')
        .eq('id', userId)
        .maybeSingle();
    const { data: user, error } = await read();
    if (error || !user) return null;
    const hint = (hintLocale && LOCALE_SET.has(hintLocale) ? hintLocale : null) || (user as any).locale || 'fr';
    const state = signatureStateOf((user as any).email_signature, (user as any).email_signature_by_locale, hint);
    if (!state.needsTranslation) return state;

    const hash = signatureHash(state.signature);
    const { from, translations } = await translateSignature(
      state.signature,
      state.meta.from || hint,
      (user as any).company_id || null,
      userId
    );

    // La signature a pu etre modifiee pendant l'appel (le commercial tape
    // encore) : on relit, et on n'ecrit que si elle est restee la meme.
    const { data: latest } = await read();
    if (!latest || signatureHash((latest as any).email_signature) !== hash) return null;
    const current = parseSignatureMap((latest as any).email_signature_by_locale);
    if (!current.meta.auto) return signatureStateOf((latest as any).email_signature, (latest as any).email_signature_by_locale, hint);

    const entries: Record<string, string> = {};
    for (const locale of current.meta.manual) entries[locale] = current.entries[locale];
    for (const locale of SIGNATURE_LOCALES) {
      if (locale === from || entries[locale]) continue;
      // Traduction refusee par le controle : on garde le texte d'origine
      // pour cette langue, ce qui revient a envoyer la signature par defaut
      // sans relancer un appel a chaque email.
      entries[locale] = translations[locale] || state.signature;
    }
    const meta: SignatureMeta = { auto: true, src: hash, from, manual: current.meta.manual };
    const value = buildSignatureMap(entries, meta);
    const { error: writeError } = await supabaseAdmin
      .from('users')
      .update({ email_signature_by_locale: value })
      .eq('id', userId);
    if (writeError) {
      console.error('[signature] ecriture des traductions:', writeError.message);
      return null;
    }
    return signatureStateOf(state.signature, value, hint);
  } catch (err: any) {
    console.error('[signature] traduction automatique:', err?.message || err);
    return null;
  }
}

// A L'ENVOI : la colonne a utiliser pour cette langue. Si la version voulue
// manque ou est perimee, on la produit sur-le-champ (une seule fois par
// signature : le resultat est enregistre), avec un delai maximal pour ne
// jamais retenir un email a cause de sa signature.
export async function signatureMapForSend(
  userId: string,
  defaultSignature: string | null | undefined,
  byLocale: any,
  locale: string | null | undefined,
  sellerLocale: string | null | undefined,
  timeoutMs = 8000
): Promise<any> {
  const signature = tidySignature(defaultSignature || '');
  const key = String(locale || '').trim().toLowerCase();
  if (!signature || !LOCALE_SET.has(key)) return byLocale;
  const { entries, meta } = parseSignatureMap(byLocale);
  if (!meta.auto) return byLocale;
  if (usableEntry(key, entries, meta, signature)) return byLocale;
  const fresh = !!meta.src && meta.src === signatureHash(signature);
  // Langue d'origine connue et a jour : la signature par defaut EST la bonne.
  if (fresh && meta.from === key) return byLocale;
  // Rien n'a encore ete traduit et le destinataire parle la langue du
  // commercial : inutile d'attendre une traduction pour cet envoi-ci.
  if (!meta.from && key === String(sellerLocale || '').toLowerCase()) return byLocale;

  const refreshed = await Promise.race([
    refreshSignatureTranslations(userId, sellerLocale),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  return refreshed ? buildSignatureMap(refreshed.entries, refreshed.meta) : byLocale;
}

// ── BANDEAU PAR LANGUE (30/09/2026) ────────────────────────────────────────
//
// Meme logique que la signature texte, appliquee a l'image du bandeau. Elle
// manquait : le texte etait traduit depuis le 26/09, mais l'image restait
// unique, donc un email allemand se terminait par un bandeau francais.
//
// Une valeur n'est acceptee que si c'est une URL http(s). C'est la meme
// regle que safeImageUrl dans lib/messaging.ts, redite ici pour que rien
// d'invalide n'entre en base : une data: URI de 200 Ko dans la signature,
// c'est le « [Message tronque] » de Gmail garanti.
function isHttpUrl(value: any): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

export function normalizeBannerMap(input: any): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const locale of SIGNATURE_LOCALES) {
    const raw = (input as any)[locale];
    if (isHttpUrl(raw)) out[locale] = String(raw).trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function pickBannerUrl(
  defaultUrl: string | null | undefined,
  byLocale: any,
  locale: string | null | undefined
): string | null {
  const fallback = isHttpUrl(defaultUrl) ? String(defaultUrl).trim() : null;
  const key = String(locale || '').trim().toLowerCase();
  if (!key) return fallback;

  let map: any = byLocale;
  if (typeof map === 'string') {
    try { map = JSON.parse(map); } catch { map = null; }
  }
  if (!map || typeof map !== 'object') return fallback;

  const candidate = map[key];
  return isHttpUrl(candidate) ? String(candidate).trim() : fallback;
}

// Langue probable du DESTINATAIRE d'un envoi, a partir de sa seule adresse
// email — le seul element dont dispose sendEmailForUser.
//
// On reprend exactement les signaux de lib/prospect-locale.ts (pays de
// l'adresse de sa societe, extension de son domaine, langue cible de la
// campagne d'origine, puis langue du commercial), pour que la signature parle
// forcement la meme langue que le corps du message : les deux sortent du meme
// calcul, jamais de deux heuristiques concurrentes.
//
// Toute erreur (colonne absente, prospect inconnu, email interne) retombe sur
// la langue du commercial : aucun envoi ne doit echouer a cause de la
// signature.
export async function recipientLocaleForSignature(
  userId: string,
  to: string,
  sellerLocale: string | null | undefined
): Promise<string> {
  const fallback = resolveProspectLocale({ email: to, sellerLocale });
  try {
    const { data: prospect } = await supabaseAdmin
      .from('prospects')
      .select('email, prospect_companies(address, found_by_campaign_id)')
      .eq('assigned_user_id', userId)
      .ilike('email', to)
      .limit(1)
      .maybeSingle();

    if (!prospect) return fallback;

    const company: any = (prospect as any).prospect_companies || null;
    let campaignLocale: string | null = null;
    if (company?.found_by_campaign_id) {
      const { data: campaign } = await supabaseAdmin
        .from('prospecting_campaigns')
        .select('target_locale')
        .eq('id', company.found_by_campaign_id)
        .maybeSingle();
      campaignLocale = (campaign as any)?.target_locale || null;
    }

    return resolveProspectLocale({
      campaignLocale,
      address: company?.address || null,
      email: (prospect as any).email || to,
      sellerLocale,
    });
  } catch {
    return fallback;
  }
}
