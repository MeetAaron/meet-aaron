// lib/directory-db.ts
//
// Lecture de l'annuaire libre de droits (table directory_companies, voir
// migration_directory_companies_2026-09-06.sql).
//
// C'est la couche « découverte » qui remplace Google Places : elle donne le
// nom, le domaine, le téléphone et l'adresse d'établissements réels, à partir
// de sources dont la licence autorise le stockage (Overture Maps, Foursquare
// OS Places, registres publics). Coût par requête : zéro, c'est notre base.
//
// Ordre de bataille dans lib/sourcing.ts :
//   1. entreprises fraîchement immatriculées (registres, gratuit)
//   2. CET annuaire (gratuit, stockable, instantané)
//   3. recherche web IA (payante) — repli quand l'annuaire ne couvre pas
//      encore la zone ou le secteur demandés.
//
// Tant que la table est vide, tout renvoie [] et Aaron travaille exactement
// comme avant. Le remplissage se fait par scripts/import-overture.mjs.

import { supabaseAdmin } from './supabase-admin';

export interface DirectoryHit {
  name: string;
  domain: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  category: string | null;
  source: string;
  sourceUrl: string | null;
}

// Mots-clés de secteur → catégories Overture. Volontairement court : on
// complète au fur et à mesure des campagnes réelles plutôt que d'inventer une
// taxonomie complète qui ne servira pas.
const SECTOR_TO_CATEGORY: Record<string, string[]> = {
  plomberie: ['plumber', 'plumbing'],
  plombier: ['plumber', 'plumbing'],
  chauffagiste: ['hvac_contractor', 'heating_contractor', 'plumber'],
  chauffage: ['hvac_contractor', 'heating_contractor'],
  electricite: ['electrician'],
  électricité: ['electrician'],
  electricien: ['electrician'],
  batiment: ['general_contractor', 'construction', 'builder'],
  bâtiment: ['general_contractor', 'construction', 'builder'],
  maconnerie: ['masonry_contractor', 'general_contractor'],
  menuiserie: ['carpenter', 'joinery'],
  couvreur: ['roofing_contractor'],
  peinture: ['painter'],
  restauration: ['restaurant', 'cafe', 'fast_food_restaurant'],
  restaurant: ['restaurant'],
  boulangerie: ['bakery'],
  coiffure: ['hair_salon', 'barber'],
  immobilier: ['real_estate_agency'],
  comptabilite: ['accounting', 'accountant'],
  comptabilité: ['accounting', 'accountant'],
  avocat: ['lawyer', 'legal_services'],
  garage: ['auto_repair_shop', 'car_repair'],
  paysagiste: ['landscaper', 'landscaping'],
  serrurier: ['locksmith'],
  hotel: ['hotel', 'lodging'],
  hôtel: ['hotel', 'lodging'],
  pharmacie: ['pharmacy'],
  opticien: ['optician'],
  fleuriste: ['florist'],
  boucherie: ['butcher'],
};

function normalize(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function categoriesForSectors(sectorKeywords: string[]): string[] {
  const out = new Set<string>();
  for (const raw of sectorKeywords || []) {
    const k = normalize(raw);
    for (const [word, cats] of Object.entries(SECTOR_TO_CATEGORY)) {
      if (k.includes(normalize(word))) cats.forEach((c) => out.add(c));
    }
  }
  return [...out];
}

// Ville probable extraite d'un libellé de zone libre (« Lyon », « Île-de-France,
// Lyon »). Renvoie null si le libellé décrit une région ou un pays : dans ce
// cas on filtre seulement sur le pays et la catégorie.
function cityFromZone(zoneLabel: string): string | null {
  const parts = (zoneLabel || '').split(/[,;/]| et /i).map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last.length < 3) return null;
  // Un mot unique et court ressemble à une ville ; « Île-de-France » ou
  // « Nouvelle-Aquitaine » sont des régions, on ne les cherche pas en ville.
  if (/(region|région|province|state|county|comté|land|departement|département)/i.test(last)) return null;
  return last;
}

export async function searchDirectory(params: {
  country: string | null;
  zoneLabel: string;
  sectorKeywords: string[];
  excludeDomains: string[];
  count: number;
}): Promise<DirectoryHit[]> {
  if (!params.country) return [];
  try {
    const categories = categoriesForSectors(params.sectorKeywords);
    let q = supabaseAdmin
      .from('directory_companies')
      .select('name, domain, website, phone, address, city, country, category, source')
      .eq('country', params.country)
      .not('domain', 'is', null)
      // Un établissement fermé n'a rien à faire dans une campagne : Overture
      // marque les fermetures définitives par confidence = 0.
      .or('confidence.is.null,confidence.gt.0')
      .limit(Math.max(params.count * 4, 40));

    if (categories.length) q = q.in('category', categories);

    const city = cityFromZone(params.zoneLabel);
    if (city) q = q.ilike('city', `%${city}%`);

    const { data, error } = await q;
    if (error) {
      // Table absente (migration pas encore jouée) ou requête refusée : on se
      // tait, le sourcing enchaîne sur la recherche classique.
      console.error('directory_companies:', error.message);
      return [];
    }

    const exclude = new Set((params.excludeDomains || []).map((d) => d.toLowerCase()));
    const seen = new Set<string>();
    const hits: DirectoryHit[] = [];
    for (const row of data || []) {
      const domain = (row.domain || '').toLowerCase();
      if (!domain || exclude.has(domain) || seen.has(domain)) continue;
      seen.add(domain);
      hits.push({
        name: row.name,
        domain,
        website: row.website || `https://${domain}`,
        phone: row.phone || null,
        address: row.address || null,
        city: row.city || null,
        country: row.country,
        category: row.category || null,
        source: row.source,
        sourceUrl: row.website || null,
      });
      if (hits.length >= params.count) break;
    }
    return hits;
  } catch (err: any) {
    console.error('searchDirectory:', err?.message);
    return [];
  }
}

// Combien de lignes l'annuaire contient pour un pays — sert au diagnostic et
// à décider s'il vaut la peine d'être interrogé.
export async function directoryCount(country?: string | null): Promise<number> {
  try {
    let q = supabaseAdmin.from('directory_companies').select('id', { count: 'exact', head: true });
    if (country) q = q.eq('country', country);
    const { count, error } = await q;
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}
