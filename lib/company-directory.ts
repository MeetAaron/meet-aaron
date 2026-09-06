// lib/company-directory.ts
//
// Sources de données STRUCTURÉES pour le sourcing (validé par Alex le
// 05/09/2026 — « premier levier : je valide » du plan de réduction des
// coûts). Constat : le poste n°1 de dépense API était Sonnet qui LIT des
// pages web (10 $ les 1 000 recherches + 15 000 tokens de résultats à lire
// par appel) pour n'en sortir que des données structurées — nom, site,
// adresse, téléphone — qu'une API d'annuaire donne pour 50× moins cher, sans
// rien inventer.
//
// Trois sources, chacune derrière une fonction pure et une variable d'env :
//   - Google Places (Text Search, API « New ») : trouve des entreprises par
//     activité + zone, avec SITE WEB et téléphone, dans tous les pays.
//     ~0,032 $ pour 20 résultats. Clé : GOOGLE_PLACES_API_KEY.
//   - recherche-entreprises.api.gouv.fr (SIRENE) : gratuit, sans clé.
//     Immatriculation française (SIRET, adresse du siège, code NAF,
//     tranche d'effectif) à partir d'un nom + ville.
//   - ABN Lookup (Australie) : gratuit, sur inscription. GUID :
//     ABN_LOOKUP_GUID. Renvoie l'ABN et le type d'entité.
//
// Sans clé, chaque fonction renvoie [] / null : lib/sourcing.ts retombe alors
// sur la recherche web IA historique. Rien ne casse, ça coûte juste plus.

export interface DirectoryCompany {
  name: string;
  domain: string | null;
  address: string | null;
  city: string | null;
  website: string | null;
  phone: string | null;
  source_url: string | null;
  source: 'google_places' | 'sirene' | 'abn';
}

export interface LegalRecord {
  registryId: string | null; // SIRET (FR) ou ABN (AU)
  legalName: string | null;
  address: string | null;
  industry: string | null; // libellé NAF (FR) / type d'entité (AU)
  headcountBand: string | null;
  source: 'sirene' | 'abn' | 'companies_house';
}

export function domainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    // Pages Facebook / Instagram / Linktree ne sont pas des domaines
    // d'entreprise : on ne saurait pas y écrire.
    if (/(facebook|instagram|linktr\.ee|linkedin|google|wix\.com\/|pagesjaunes|yelp)\./.test(host) || /^(facebook|instagram|linktr|linkedin|google|pagesjaunes|yelp)\./.test(host)) return null;
    return host || null;
  } catch {
    return null;
  }
}

// ── Google Places ───────────────────────────────────────────────────────────
export async function searchGooglePlaces(params: {
  sectorKeywords: string[];
  zoneLabel: string;
  count: number;
  excludeDomains: string[];
  languageCode?: string;
}): Promise<DirectoryCompany[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];

  const query = `${params.sectorKeywords.join(' ')} ${params.zoneLabel}`.trim();
  const exclude = new Set(params.excludeDomains.map((d) => d.toLowerCase()));
  const found: DirectoryCompany[] = [];
  let pageToken: string | undefined;

  // 3 pages max (60 lieux) : au-delà, la pertinence de Places s'effondre et
  // on préfère laisser l'IA élargir la zone.
  for (let page = 0; page < 3 && found.length < params.count; page++) {
    const body: Record<string, any> = {
      textQuery: query,
      languageCode: params.languageCode || 'fr',
      pageSize: 20,
      ...(pageToken ? { pageToken } : {}),
    };
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.websiteUri,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.businessStatus,places.googleMapsUri,nextPageToken',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('Google Places:', res.status, await res.text().catch(() => ''));
      break;
    }
    const data = await res.json();
    for (const place of data.places || []) {
      if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;
      const domain = domainFromWebsite(place.websiteUri);
      if (!domain || exclude.has(domain)) continue;
      exclude.add(domain);
      const city =
        (place.addressComponents || []).find((c: any) => (c.types || []).includes('locality'))?.longText ||
        (place.addressComponents || []).find((c: any) => (c.types || []).includes('postal_town'))?.longText ||
        null;
      found.push({
        name: place.displayName?.text || domain,
        domain,
        address: place.formattedAddress || null,
        city,
        website: place.websiteUri || null,
        phone: place.nationalPhoneNumber || null,
        source_url: place.googleMapsUri || null,
        source: 'google_places',
      });
      if (found.length >= params.count) break;
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return found;
}

// ── SIRENE (France) — gratuit, sans clé ─────────────────────────────────────
const NAF_LABEL_CACHE = new Map<string, string>();

export async function lookupFrenchCompany(name: string, city?: string | null): Promise<LegalRecord | null> {
  const q = [name, city].filter(Boolean).join(' ').trim();
  if (!q) return null;
  try {
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&etat_administratif=A&page=1&per_page=3`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = (data.results || [])[0];
    if (!hit) return null;
    const siege = hit.siege || {};
    const address = [siege.adresse || [siege.numero_voie, siege.type_voie, siege.libelle_voie].filter(Boolean).join(' '), siege.code_postal, siege.libelle_commune]
      .filter(Boolean)
      .join(', ') || null;
    return {
      registryId: siege.siret || null,
      legalName: hit.nom_complet || hit.nom_raison_sociale || null,
      address,
      industry: hit.activite_principale ? `NAF ${hit.activite_principale}` : null,
      headcountBand: hit.tranche_effectif_salarie || null,
      source: 'sirene',
    };
  } catch (err: any) {
    console.error('SIRENE:', err?.message);
    return null;
  }
}

// ── ABN Lookup (Australie) — gratuit, GUID sur inscription ──────────────────
export async function lookupAustralianCompany(name: string): Promise<LegalRecord | null> {
  const guid = process.env.ABN_LOOKUP_GUID;
  if (!guid || !name.trim()) return null;
  try {
    const url = `https://abr.business.gov.au/json/MatchingNames.aspx?name=${encodeURIComponent(name)}&maxResults=3&guid=${guid}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    // Réponse JSONP : callback({...})
    const text = await res.text();
    const json = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, ''));
    const hit = (json.Names || [])[0];
    if (!hit) return null;
    return {
      registryId: hit.Abn || null,
      legalName: hit.Name || null,
      address: hit.Postcode || hit.State ? [hit.State, hit.Postcode].filter(Boolean).join(' ') : null,
      industry: null,
      headcountBand: null,
      source: 'abn',
    };
  } catch (err: any) {
    console.error('ABN Lookup:', err?.message);
    return null;
  }
}

// Pays deviné d'après l'adresse, la zone ou le domaine. Sert à choisir le
// registre national (06/09/2026 : élargi de FR/AU à FR/GB/AU/BE/CA, les cinq
// pays où la donnée officielle est gratuite et exploitable — voir la note
// « Plan de bataille : coûts et données »).
export type RegistryCountry = 'FR' | 'GB' | 'AU' | 'BE' | 'CA';

export function guessCountry(text: string | null | undefined, domain?: string | null): RegistryCountry | null {
  const t = (text || '').toLowerCase();
  const d = (domain || '').toLowerCase();

  // Le domaine est le signal le plus fiable quand il existe.
  if (/\.(co\.uk|org\.uk|uk)$/.test(d)) return 'GB';
  if (/\.(com\.au|net\.au|org\.au|au)$/.test(d)) return 'AU';
  if (/\.be$/.test(d)) return 'BE';
  if (/\.ca$/.test(d)) return 'CA';
  if (/\.fr$/.test(d)) return 'FR';

  if (/australi|\bnsw\b|\bqld\b|\bvic\b|perth|sydney|melbourne|brisbane|adelaide|canberra|hobart/.test(t)) return 'AU';
  if (/belgi|belgique|bruxelles|brussel|anvers|antwerpen|gand|gent|liège|liege|charleroi|namur/.test(t)) return 'BE';
  if (/canada|québec|quebec|montréal|montreal|toronto|vancouver|ottawa|calgary|edmonton|winnipeg/.test(t)) return 'CA';
  if (/(royaume[- ]uni|united kingdom|england|scotland|wales|angleterre|écosse|londres|london|manchester|birmingham|leeds|glasgow|bristol|edinburgh)/.test(t)) return 'GB';
  if (/france|\b\d{5}\b|paris|lyon|marseille|toulouse|bordeaux|lille|nantes|strasbourg|nice|rennes|montpellier/.test(t)) return 'FR';
  return null;
}

// ── Royaume-Uni : Companies House ───────────────────────────────────────────
// API publique gratuite, clé obtenue en self-service et immédiate.
// Authentification : HTTP Basic, clé en NOM D'UTILISATEUR et mot de passe
// vide (c'est la source d'erreur n°1 sur cette API).
// Limite : 600 requêtes par tranche de 5 minutes.
function companiesHouseAuth(): string | null {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64');
}

export async function lookupBritishCompany(name: string, city?: string | null): Promise<LegalRecord | null> {
  const auth = companiesHouseAuth();
  if (!auth || !name.trim()) return null;
  try {
    const q = [name, city].filter(Boolean).join(' ');
    const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q)}&items_per_page=3`;
    const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    // Sur /search/companies le nom de société s'appelle `title`, pas
    // `company_name` (piège de l'API : les deux endpoints diffèrent).
    const hit = (data.items || []).find((i: any) => i.company_status === 'active') || (data.items || [])[0];
    if (!hit) return null;
    const a = hit.address || {};
    const address = [a.address_line_1, a.address_line_2, a.postal_code, a.locality].filter(Boolean).join(', ') || hit.address_snippet || null;
    return {
      registryId: hit.company_number || null,
      legalName: hit.title || null,
      address,
      industry: null, // /search/companies ne renvoie pas les codes SIC
      headcountBand: null,
      source: 'companies_house',
    };
  } catch (err: any) {
    console.error('Companies House:', err?.message);
    return null;
  }
}

// ── Belgique : pas d'API officielle ─────────────────────────────────────────
// La Banque-Carrefour des Entreprises ne publie que des fichiers CSV mensuels
// (kbopub.economie.fgov.be/kbo-open-data), sans API de recherche. Tant que
// l'import en masse n'est pas fait, on renvoie null et la recherche retombe
// sur les méthodes classiques (annuaire ouvert puis recherche IA) — c'est
// exactement le repli prévu, pas une panne.
export async function lookupBelgianCompany(_name: string, _city?: string | null): Promise<LegalRecord | null> {
  return null;
}

// ── Canada : lookup par identifiant seulement ───────────────────────────────
// L'API fédérale ISED n'expose AUCUNE recherche par nom ni par province : elle
// exige un numéro de société complet. Sans numéro, rien à interroger — on
// renvoie null, même repli que la Belgique. (Le jeu de données ouvert
// quotidien permettrait une recherche locale ; à faire si un client canadien
// le justifie.)
export async function lookupCanadianCompany(_name: string, _city?: string | null): Promise<LegalRecord | null> {
  return null;
}

// ── Aiguilleur ──────────────────────────────────────────────────────────────
// Un seul point d'entrée : le pays choisit le registre, et TOUT échec renvoie
// null sans lever d'exception. L'enrichissement légal est un bonus, jamais un
// prérequis — si un registre tombe, devient payant ou nous refuse une clé,
// Aaron continue avec la recherche classique.
export async function lookupCompanyRegistry(
  country: RegistryCountry | null,
  name: string,
  city?: string | null
): Promise<LegalRecord | null> {
  if (!country || !name) return null;
  try {
    switch (country) {
      case 'FR': return await lookupFrenchCompany(name, city);
      case 'GB': return await lookupBritishCompany(name, city);
      case 'AU': return await lookupAustralianCompany(name);
      case 'BE': return await lookupBelgianCompany(name, city);
      case 'CA': return await lookupCanadianCompany(name, city);
      default: return null;
    }
  } catch {
    return null;
  }
}
