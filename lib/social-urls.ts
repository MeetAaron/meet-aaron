// lib/social-urls.ts
// Normalisation des liens LinkedIn / Instagram PUBLICS (22/10/2026, demande
// d'Alex : « retrouver les pages LinkedIn/Instagram publiques de l'entreprise
// et du contact pour enrichir la fiche »).
//
// Une URL n'est retenue que si elle a la forme exacte d'une page publique :
//   - entreprise LinkedIn : linkedin.com/company/<slug> (ou /school, /showcase)
//   - contact LinkedIn    : linkedin.com/in/<slug>
//   - Instagram           : instagram.com/<compte> (jamais un post, un reel…)
// Tout le reste (recherche LinkedIn, lien de post, URL inventée mal formée)
// est rejeté : on préfère une fiche sans lien qu'un lien faux. Aucune
// connexion à LinkedIn ni à Instagram n'est faite ici : ce sont des liens que
// le commercial ouvre lui-même.

function asUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 300 || /\s/.test(s)) return null;
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

function isHost(u: URL, base: string): boolean {
  const h = u.hostname.toLowerCase();
  return h === base || h.endsWith(`.${base}`);
}

export function normalizeLinkedInCompanyUrl(raw: unknown): string | null {
  const u = asUrl(raw);
  if (!u || !isHost(u, 'linkedin.com')) return null;
  const m = u.pathname.match(/^\/(company|school|showcase)\/([^/?#]+)\/?/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[2]).trim();
  if (!slug || slug.length > 120) return null;
  return `https://www.linkedin.com/${m[1].toLowerCase()}/${encodeURIComponent(slug)}`;
}

export function normalizeLinkedInProfileUrl(raw: unknown): string | null {
  const u = asUrl(raw);
  if (!u || !isHost(u, 'linkedin.com')) return null;
  const m = u.pathname.match(/^\/in\/([^/?#]+)\/?/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).trim();
  if (!slug || slug.length > 120) return null;
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
}

// Chemins Instagram qui ne sont PAS un compte.
const INSTAGRAM_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'direct', 'about', 'legal', 'developer', 'web']);

export function normalizeInstagramUrl(raw: unknown): string | null {
  const u = asUrl(raw);
  if (!u || !isHost(u, 'instagram.com')) return null;
  const m = u.pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
  if (!m) return null;
  const handle = m[1];
  if (INSTAGRAM_RESERVED.has(handle.toLowerCase())) return null;
  return `https://www.instagram.com/${handle}/`;
}
