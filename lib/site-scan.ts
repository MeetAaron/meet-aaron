// lib/site-scan.ts
//
// LECTURE GRATUITE DU SITE D'UNE ENTREPRISE (06/11/2026).
//
// Constat chiffré sur la première campagne d'un client : le coût par prospect
// (~0,044 $) n'est PAS dans les jetons du modèle, il est dans les recherches
// web de l'outil Anthropic, facturées 0,01 $ chacune — environ quatre par
// prospect (deux pour trouver le contact, une pour enrichir la fiche, une pour
// LinkedIn/Instagram). Changer de modèle n'y changerait presque rien.
//
// Or l'essentiel de ce que ces recherches vont chercher est sur le site de
// l'entreprise elle-même : page contact, équipe, mentions légales, pied de
// page avec les réseaux sociaux. Lire ces pages directement ne coûte rien.
// Ce module le fait, et les appelants (lib/sourcing.ts, lib/prospect-
// research.ts) ne déclenchent une recherche payante que si cette lecture n'a
// rien donné.
//
// Garde-fous : 3 pages au plus par site, 5 s par page, 400 Ko par page, HTML
// seulement, jamais d'exception vers l'appelant. Aucune information n'est
// inventée : on extrait des chaînes présentes dans la page (emails, liens
// LinkedIn/Instagram, texte), le modèle fait le tri ensuite.

export interface SiteScan {
  website: string | null;      // URL effectivement lue (page d'accueil)
  domain: string | null;
  pages: string[];             // URLs lues avec succès
  text: string;                // texte brut des pages, tronqué
  emails: string[];            // emails trouvés sur le domaine (ou sous-domaines), dédoublonnés
  linkedin_url: string | null; // page entreprise LinkedIn (linkedin.com/company/…)
  instagram_url: string | null;
  phone: string | null;
}

const EMPTY: SiteScan = { website: null, domain: null, pages: [], text: '', emails: [], linkedin_url: null, instagram_url: null, phone: null };

const CANDIDATE_PATHS = [
  '/contact', '/contact-us', '/contactez-nous', '/nous-contacter', '/kontakt', '/contatti', '/contacto', '/contactos',
  '/equipe', '/notre-equipe', '/team', '/about', '/a-propos', '/qui-sommes-nous', '/about-us', '/ueber-uns', '/chi-siamo', '/sobre-nosotros', '/over-ons',
  '/mentions-legales', '/legal', '/impressum', '/imprint',
];
const MAX_PAGES = 3;
const PAGE_TIMEOUT_MS = 5000;
const PAGE_MAX_BYTES = 400_000;
const TEXT_CAP = 7000;

const GENERIC_LOCAL_PARTS = /^(no-?reply|noreply|donotreply|ne-pas-repondre|newsletter|unsubscribe|abuse|postmaster|webmaster|privacy|dpo|rgpd|gdpr|press|presse|jobs|recrutement|careers|candidature|support|help|aide|billing|facturation|compta|comptabilite|accounting|admin|sav|service-client|customer|example|test|sentry)$/i;
const IMAGE_LIKE = /\.(png|jpe?g|gif|svg|webp)$/i;

export function normalizeWebsite(input: string | null | undefined): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!url.hostname.includes('.')) return null;
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MeetAaronBot/1.0; +https://meetaaron.app)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'fr,en;q=0.8,de;q=0.6,it;q=0.6,es;q=0.6,pt;q=0.6,nl;q=0.6',
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (type && !/html|xml/i.test(type)) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < PAGE_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        size += value.length;
      }
    }
    try { await reader.cancel(); } catch { /* flux déjà clos */ }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', aacute: 'á', acirc: 'â', auml: 'ä', atilde: 'ã', aring: 'å',
  ccedil: 'ç', iacute: 'í', icirc: 'î', iuml: 'ï', igrave: 'ì', ocirc: 'ô', oacute: 'ó', ograve: 'ò', ouml: 'ö', otilde: 'õ',
  ucirc: 'û', uacute: 'ú', ugrave: 'ù', uuml: 'ü', ntilde: 'ñ', szlig: 'ß', oelig: 'œ', aelig: 'æ',
  Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç', Ouml: 'Ö', Uuml: 'Ü', Auml: 'Ä',
  middot: '·', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', euro: '€', copy: '©',
  reg: '®', trade: '™', laquo: '«', raquo: '»', deg: '°', bull: '•',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\[at\]|\(at\)|\s@\s/gi, '@')
    .replace(/\[dot\]|\(dot\)/gi, '.');
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article|footer|header)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractEmails(html: string, domain: string | null): string[] {
  const decoded = decodeEntities(html);
  const found = new Set<string>();
  // mailto: d'abord (le plus fiable), puis le texte.
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  for (const m of decoded.match(re) || []) {
    const email = m.toLowerCase().replace(/^mailto:/, '');
    if (IMAGE_LIKE.test(email)) continue;
    const [local, host] = email.split('@');
    if (!host || GENERIC_LOCAL_PARTS.test(local)) continue;
    // Seuls les emails du domaine de l'entreprise (ou d'un sous-domaine)
    // sont retenus : un email tiers trouvé sur la page (prestataire, agence
    // web) n'est pas un contact chez elle.
    if (domain && !(host === domain || host.endsWith(`.${domain}`))) continue;
    found.add(email);
  }
  return Array.from(found).slice(0, 12);
}

function extractSocial(html: string, kind: 'linkedin' | 'instagram'): string | null {
  const re = kind === 'linkedin'
    ? /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9._%-]+\/?/gi
    : /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._]+\/?/gi;
  const matches = (html.match(re) || []).filter((u) => !/instagram\.com\/(p|reel|explore|accounts|share)\b/i.test(u));
  return matches[0] ? matches[0].replace(/\/$/, '') : null;
}

function extractPhone(text: string): string | null {
  const m = text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){2,4}/g) || [];
  const plausible = m.map((s) => s.trim()).find((s) => s.replace(/\D/g, '').length >= 9 && s.replace(/\D/g, '').length <= 15);
  return plausible || null;
}

// Lit la page d'accueil puis, parmi les liens qu'elle contient, jusqu'à deux
// pages « contact / équipe / mentions légales ». Ne lève jamais.
export async function scanCompanySite(websiteOrDomain: string | null | undefined): Promise<SiteScan> {
  const base = normalizeWebsite(websiteOrDomain);
  if (!base) return { ...EMPTY };
  const domain = new URL(base).hostname.replace(/^www\./, '').toLowerCase();

  const home = await fetchHtml(base) || (base.startsWith('https://') ? await fetchHtml(base.replace('https://', 'http://')) : null);
  if (!home) return { ...EMPTY, domain };

  const pages = [base];
  const htmls = [home];

  // Liens internes de la page d'accueil qui ressemblent à contact/équipe/légal.
  const links = new Set<string>();
  for (const m of home.matchAll(/href\s*=\s*["']([^"'#?]+)/gi)) {
    let href = m[1].trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname.replace(/^www\./, '').toLowerCase() !== domain) continue;
      const path = u.pathname.replace(/\/+$/, '').toLowerCase();
      if (CANDIDATE_PATHS.some((p) => path === p || path.endsWith(p) || path.includes(p.slice(1)))) {
        links.add(`${u.protocol}//${u.hostname}${u.pathname}`);
      }
    } catch { /* lien illisible */ }
  }
  // Ordre de préférence : contact, puis équipe/à-propos, puis mentions légales.
  const ordered = Array.from(links).sort((a, b) => score(a) - score(b));
  for (const url of ordered) {
    if (pages.length >= MAX_PAGES) break;
    const html = await fetchHtml(url);
    if (html) {
      pages.push(url);
      htmls.push(html);
    }
  }

  const all = htmls.join('\n');
  const text = htmls.map(htmlToText).join('\n\n---\n\n').slice(0, TEXT_CAP);
  return {
    website: base,
    domain,
    pages,
    text,
    emails: extractEmails(all, domain),
    linkedin_url: extractSocial(all, 'linkedin'),
    instagram_url: extractSocial(all, 'instagram'),
    phone: extractPhone(text),
  };
}

function score(url: string): number {
  const p = url.toLowerCase();
  if (/contact/.test(p)) return 0;
  if (/equipe|team|about|a-propos|qui-sommes|ueber-uns|chi-siamo|sobre|over-ons/.test(p)) return 1;
  return 2;
}

// Un email « personnel » (prenom.nom@, p.nom@, prenom@) vaut plus qu'une
// adresse de guichet (contact@, info@) pour écrire à quelqu'un.
export function isPersonalEmail(email: string): boolean {
  const local = email.split('@')[0];
  if (/^(contact|info|infos|hello|bonjour|bienvenue|accueil|commercial|sales|vente|ventes|office|mail|email|direction|secretariat|reception|reservation|devis|commande|orders|team|equipe|marketing|communication|com|rh|hr|pro|b2b|shop|boutique)$/i.test(local)) return false;
  return /^[a-z]+([._-][a-z]+)?$/i.test(local) && local.length >= 3;
}
