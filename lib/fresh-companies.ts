// lib/fresh-companies.ts
//
// Entreprises FRAÎCHEMENT IMMATRICULÉES (demande Alex, 06/09/2026 : « mets-moi
// ça en place »).
//
// L'idée : une société créée hier n'a ni fournisseur, ni prestataire, ni
// logiciel. Elle a tout à acheter, et personne ne l'a encore appelée. C'est le
// meilleur moment de toute la vie d'une entreprise pour la démarcher — et
// aucun outil grand public ne le fait, parce que la donnée est publique mais
// pas commodément exposée.
//
// Deux sources, toutes deux gratuites et officielles :
//   - Royaume-Uni : Companies House « advanced search », qui filtre
//     directement sur la date d'immatriculation (incorporated_from /
//     incorporated_to). C'est la seule des cinq qui sait faire ça côté
//     serveur. Clé gratuite, 600 requêtes / 5 min.
//   - France : recherche-entreprises.api.gouv.fr. ATTENTION — cette API
//     N'A PAS de filtre sur la date de création (vérifié dans son OpenAPI le
//     06/09/2026) : elle renvoie `date_creation` mais ne sait pas filtrer
//     dessus. On filtre donc côté client après avoir demandé le tri par
//     taille sur la zone et l'activité visées. C'est moins efficace, mais
//     gratuit et sans clé.
//
// REPLI (exigence explicite d'Alex) : si une source devient payante,
// indisponible, ou si la clé manque, la fonction renvoie simplement une liste
// vide. Le sourcing classique (annuaire ouvert puis recherche IA) reprend la
// main sans que rien ne casse — c'est déjà le comportement de lib/sourcing.ts.

export interface FreshCompany {
  name: string;
  registryId: string | null;
  country: 'FR' | 'GB';
  incorporatedOn: string | null; // YYYY-MM-DD
  address: string | null;
  city: string | null;
  postcode: string | null;
  activityCode: string | null;
  sourceUrl: string | null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Royaume-Uni ─────────────────────────────────────────────────────────────
export async function freshBritishCompanies(params: {
  sinceDays: number;
  sicCodes?: string[];
  location?: string | null;
  limit?: number;
}): Promise<FreshCompany[]> {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return [];
  const auth = 'Basic ' + Buffer.from(`${key}:`).toString('base64');
  const to = new Date();
  const from = new Date(to.getTime() - params.sinceDays * 86_400_000);

  const qs = new URLSearchParams({
    incorporated_from: isoDay(from),
    incorporated_to: isoDay(to),
    company_status: 'active',
    size: String(Math.min(params.limit || 50, 200)),
    start_index: '0',
  });
  if (params.location) qs.set('location', params.location);
  if (params.sicCodes?.length) qs.set('sic_codes', params.sicCodes.join(','));

  try {
    const res = await fetch(`https://api.company-information.service.gov.uk/advanced-search/companies?${qs}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (!res.ok) {
      // 429 = quota, 401 = clé révoquée, 402 = passée payante. Dans les trois
      // cas on se tait et on laisse le sourcing classique faire le travail.
      console.error('Companies House advanced-search:', res.status);
      return [];
    }
    const data = await res.json();
    return (data.items || []).map((c: any): FreshCompany => {
      const a = c.registered_office_address || {};
      return {
        name: c.company_name || '',
        registryId: c.company_number || null,
        country: 'GB',
        incorporatedOn: c.date_of_creation || null,
        address: [a.address_line_1, a.address_line_2, a.postal_code, a.locality].filter(Boolean).join(', ') || null,
        city: a.locality || null,
        postcode: a.postal_code || null,
        activityCode: (c.sic_codes || [])[0] || null,
        sourceUrl: c.company_number ? `https://find-and-update.company-information.service.gov.uk/company/${c.company_number}` : null,
      };
    }).filter((c: FreshCompany) => c.name);
  } catch (err: any) {
    console.error('Companies House advanced-search:', err?.message);
    return [];
  }
}

// ── France ──────────────────────────────────────────────────────────────────
export async function freshFrenchCompanies(params: {
  sinceDays: number;
  activityCodes?: string[];
  departement?: string | null;
  codePostal?: string | null;
  query?: string | null;
  limit?: number;
}): Promise<FreshCompany[]> {
  const to = new Date();
  const from = new Date(to.getTime() - params.sinceDays * 86_400_000);
  const wanted = Math.min(params.limit || 50, 100);
  const found: FreshCompany[] = [];

  // per_page est plafonné à 25 par l'API : on pagine jusqu'à 4 pages, ce qui
  // suffit largement une fois le filtre de date appliqué localement.
  for (let page = 1; page <= 4 && found.length < wanted; page++) {
    const qs = new URLSearchParams({
      q: params.query || 'entreprise',
      etat_administratif: 'A',
      per_page: '25',
      page: String(page),
    });
    if (params.activityCodes?.length) qs.set('activite_principale', params.activityCodes.join(','));
    if (params.departement) qs.set('departement', params.departement);
    if (params.codePostal) qs.set('code_postal', params.codePostal);

    try {
      const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?${qs}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        console.error('recherche-entreprises:', res.status);
        break;
      }
      const data = await res.json();
      const results = data.results || [];
      if (!results.length) break;

      for (const r of results) {
        // Le filtre de date se fait ICI, faute de paramètre côté API.
        if (!r.date_creation) continue;
        const created = new Date(r.date_creation);
        if (created < from || created > to) continue;
        const siege = r.siege || {};
        found.push({
          name: r.nom_complet || r.nom_raison_sociale || '',
          registryId: siege.siret || r.siren || null,
          country: 'FR',
          incorporatedOn: r.date_creation,
          address: siege.adresse || null,
          city: siege.libelle_commune || null,
          postcode: siege.code_postal || null,
          activityCode: r.activite_principale || null,
          sourceUrl: r.siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}` : null,
        });
        if (found.length >= wanted) break;
      }
      // 7 requêtes/seconde autorisées : on reste très en dessous.
      await new Promise((r) => setTimeout(r, 200));
    } catch (err: any) {
      console.error('recherche-entreprises:', err?.message);
      break;
    }
  }
  return found.filter((c) => c.name);
}

// Point d'entrée unique : renvoie [] plutôt que de lever, quoi qu'il arrive.
export async function findFreshCompanies(params: {
  country: 'FR' | 'GB';
  sinceDays?: number;
  sectorKeywords?: string[];
  activityCodes?: string[];
  sicCodes?: string[];
  location?: string | null;
  departement?: string | null;
  limit?: number;
}): Promise<FreshCompany[]> {
  const sinceDays = params.sinceDays ?? 30;
  try {
    if (params.country === 'GB') {
      return await freshBritishCompanies({
        sinceDays,
        sicCodes: params.sicCodes,
        location: params.location,
        limit: params.limit,
      });
    }
    return await freshFrenchCompanies({
      sinceDays,
      activityCodes: params.activityCodes,
      departement: params.departement,
      query: (params.sectorKeywords || []).join(' ') || null,
      limit: params.limit,
    });
  } catch (err: any) {
    console.error('findFreshCompanies:', err?.message);
    return [];
  }
}
