#!/usr/bin/env node
/**
 * scripts/import-overture.mjs
 *
 * Remplit public.directory_companies depuis Overture Maps Places.
 *
 * POURQUOI CE SCRIPT EXISTE PLUTÔT QU'UN APPEL D'API
 * --------------------------------------------------
 * Aucune des sources d'établissements libres de droits n'expose d'API HTTP :
 * Overture et Foursquare OS Places publient des fichiers Parquet (S3/Azure),
 * et les seules API HTTP disponibles sont soit propriétaires avec interdiction
 * de stockage (Google Places), soit sous licence à partage à l'identique
 * (OpenStreetMap/Overpass, ODbL — contamine une base propriétaire).
 *
 * On extrait donc localement, avec DuckDB, la tranche dont on a besoin
 * (un pays, quelques catégories), et on l'insère dans Supabase. Overture
 * publie une version par mois : relancer ce script chaque mois suffit.
 *
 * PRÉREQUIS
 * ---------
 *   1. DuckDB (https://duckdb.org/docs/installation) — une seule commande :
 *        macOS/Linux : curl https://install.duckdb.org | sh
 *        Windows     : winget install DuckDB.cli
 *   2. Node 18+.
 *   3. Deux variables d'environnement :
 *        SUPABASE_URL=...
 *        SUPABASE_SERVICE_ROLE_KEY=...      (clé service_role, jamais l'anon)
 *
 * USAGE
 * -----
 *   node scripts/import-overture.mjs --country FR --categories plumber,electrician
 *   node scripts/import-overture.mjs --country GB --bbox -0.51,51.28,0.33,51.69 --limit 20000
 *   node scripts/import-overture.mjs --country FR --sql-only > insert_fr.sql
 *
 * `--sql-only` n'écrit rien dans Supabase : il produit un fichier .sql à jouer
 * à la main dans l'éditeur SQL — c'est le mode à utiliser quand on n'a pas la
 * clé service_role sous la main.
 *
 * LICENCES
 * --------
 * Overture Places combine des contributions sous CDLA Permissive 2.0 et
 * Apache 2.0 : stockage et usage commercial autorisés, AUCUNE obligation de
 * partage à l'identique (contrairement à OpenStreetMap). La colonne
 * source_license de chaque ligne conserve cette information.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Version d'Overture utilisée. À mettre à jour depuis
// https://docs.overturemaps.org/release/latest/ (une publication par mois).
const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE || '2026-08-20.0';
const OVERTURE_PLACES = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=places/type=place/*`;

// Boîtes englobantes par pays. Overture stocke un `bbox` par établissement :
// filtrer dessus permet à DuckDB d'écarter des fichiers entiers sans les lire,
// ce qui fait la différence entre une extraction de deux minutes et une heure.
const COUNTRY_BBOX = {
  FR: [-5.15, 41.33, 9.56, 51.09],
  GB: [-8.65, 49.86, 1.77, 60.86],
  BE: [2.51, 49.49, 6.41, 51.51],
  NL: [3.36, 50.75, 7.23, 53.56],
  DE: [5.87, 47.27, 15.04, 55.06],
  AT: [9.53, 46.37, 17.16, 49.02],
  ES: [-9.30, 35.95, 4.33, 43.79],
  PT: [-9.53, 36.96, -6.19, 42.15],
  IT: [6.63, 35.49, 18.52, 47.09],
  CA: [-141.0, 41.68, -52.62, 70.0],
  AU: [112.92, -43.65, 153.64, -10.06],
  US: [-125.0, 24.4, -66.9, 49.4],
};

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const country = String(arg('country', 'FR')).toUpperCase();
const categories = String(arg('categories', '')).split(',').map((c) => c.trim()).filter(Boolean);
const limit = Number(arg('limit', 20000));
const sqlOnly = Boolean(arg('sql-only', false));
const bboxArg = arg('bbox', null);

const bbox = bboxArg && typeof bboxArg === 'string'
  ? bboxArg.split(',').map(Number)
  : COUNTRY_BBOX[country];

if (!bbox) {
  console.error(`Pays inconnu : ${country}. Pays connus : ${Object.keys(COUNTRY_BBOX).join(', ')}`);
  process.exit(1);
}

const [minLon, minLat, maxLon, maxLat] = bbox;

// La requête. Points importants :
//  - on ne garde QUE les établissements ayant un site web : sans domaine on ne
//    peut pas écrire, donc la ligne ne sert à rien pour de la prospection ;
//  - `confidence > 0` écarte les fermetures définitives ;
//  - on ne prend AUCUN champ nominatif : Overture n'en a pas, et on n'ira pas
//    en chercher ailleurs.
const categoryFilter = categories.length
  ? `AND (categories.primary IN (${categories.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')}))`
  : '';

const query = `
INSTALL httpfs; LOAD httpfs;
INSTALL spatial; LOAD spatial;
SET s3_region='us-west-2';

COPY (
  SELECT
    names.primary                                             AS name,
    lower(regexp_replace(regexp_replace(websites[1], '^https?://', ''), '^www\\\\.', ''))  AS raw_domain,
    websites[1]                                               AS website,
    phones[1]                                                 AS phone,
    CASE WHEN len(emails) > 0 THEN emails[1] ELSE NULL END    AS email,
    '${country}'                                              AS country,
    addresses[1].locality                                     AS city,
    addresses[1].postcode                                     AS postcode,
    addresses[1].freeform                                     AS address,
    bbox.ymin                                                 AS latitude,
    bbox.xmin                                                 AS longitude,
    categories.primary                                        AS category,
    array_to_string(categories.alternate, '|')                AS category_raw,
    id                                                        AS source_id,
    confidence                                                AS confidence
  FROM read_parquet('${OVERTURE_PLACES}', filename=true, hive_partitioning=1)
  WHERE bbox.xmin BETWEEN ${minLon} AND ${maxLon}
    AND bbox.ymin BETWEEN ${minLat} AND ${maxLat}
    AND names.primary IS NOT NULL
    AND len(websites) > 0
    AND (confidence IS NULL OR confidence > 0)
    ${categoryFilter}
  LIMIT ${limit}
) TO '__OUT__' (FORMAT CSV, HEADER, DELIMITER ',');
`;

const outCsv = join(tmpdir(), `overture-${country}-${Date.now()}.csv`);
const sqlFile = join(tmpdir(), `overture-${country}-${Date.now()}.sql`);
writeFileSync(sqlFile, query.replace('__OUT__', outCsv));

console.error(`Extraction Overture ${OVERTURE_RELEASE} — ${country}${categories.length ? ` (${categories.join(', ')})` : ''}…`);
console.error('Première exécution : DuckDB télécharge les extensions et lit les fichiers distants, comptez plusieurs minutes.');

try {
  execFileSync('duckdb', ['-c', `.read ${sqlFile}`], { stdio: ['ignore', 'inherit', 'inherit'] });
} catch (err) {
  console.error('\nÉchec DuckDB. Vérifie qu il est installé : https://duckdb.org/docs/installation');
  process.exit(1);
} finally {
  try { unlinkSync(sqlFile); } catch {}
}

// Lecture du CSV produit, nettoyage, puis sortie SQL ou insertion Supabase.
const csv = readFileSync(outCsv, 'utf8').trim().split('\n');
const header = csv.shift().split(',');
const idx = (n) => header.indexOf(n);

const BAD_DOMAIN = /(facebook|instagram|linktr\.ee|linkedin|google|pagesjaunes|yelp|wix\.com|tripadvisor|booking\.com)/i;

const rows = [];
for (const line of csv) {
  // CSV simple produit par DuckDB : on utilise un parseur minimal tolérant aux
  // guillemets, suffisant ici (aucun champ ne contient de saut de ligne).
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);

  const domain = (cells[idx('raw_domain')] || '').split('/')[0].trim();
  if (!domain || BAD_DOMAIN.test(domain)) continue;
  const name = (cells[idx('name')] || '').trim();
  if (!name) continue;

  rows.push({
    name,
    domain,
    website: cells[idx('website')] || null,
    phone: cells[idx('phone')] || null,
    email: cells[idx('email')] || null,
    country,
    city: cells[idx('city')] || null,
    postcode: cells[idx('postcode')] || null,
    address: cells[idx('address')] || null,
    latitude: Number(cells[idx('latitude')]) || null,
    longitude: Number(cells[idx('longitude')]) || null,
    category: cells[idx('category')] || null,
    category_raw: cells[idx('category_raw')] || null,
    source: 'overture',
    source_license: 'CDLA-Permissive-2.0',
    source_id: cells[idx('source_id')] || null,
    confidence: Number(cells[idx('confidence')]) || null,
  });
}

// Un domaine = un établissement (une chaîne de magasins partage son site) :
// on garde le plus confiant.
const byDomain = new Map();
for (const r of rows) {
  const prev = byDomain.get(r.domain);
  if (!prev || (r.confidence || 0) > (prev.confidence || 0)) byDomain.set(r.domain, r);
}
const unique = [...byDomain.values()];

console.error(`${rows.length} établissements avec site web, ${unique.length} domaines uniques.`);

function sqlLiteral(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

if (sqlOnly) {
  const cols = ['name','domain','website','phone','email','country','city','postcode','address','latitude','longitude','category','category_raw','source','source_license','source_id','confidence'];
  const chunks = [];
  for (let i = 0; i < unique.length; i += 500) {
    const slice = unique.slice(i, i + 500);
    chunks.push(
      `insert into public.directory_companies (${cols.join(', ')}) values\n` +
      slice.map((r) => `  (${cols.map((c) => sqlLiteral(r[c])).join(', ')})`).join(',\n') +
      `\non conflict (domain) where domain is not null do update set\n` +
      `  name = excluded.name, website = excluded.website, phone = excluded.phone,\n` +
      `  city = excluded.city, postcode = excluded.postcode, address = excluded.address,\n` +
      `  category = excluded.category, confidence = excluded.confidence, updated_at = now();`
    );
  }
  process.stdout.write(`-- Overture ${OVERTURE_RELEASE} — ${country} — ${unique.length} établissements\n`);
  process.stdout.write(`-- Licence CDLA Permissive 2.0 : stockage et usage commercial autorisés.\n\n`);
  process.stdout.write(chunks.join('\n\n') + '\n');
  process.exit(0);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquants — relance avec --sql-only pour produire un fichier SQL.');
  process.exit(1);
}

let inserted = 0;
for (let i = 0; i < unique.length; i += 500) {
  const batch = unique.slice(i, i + 500);
  const res = await fetch(`${url}/rest/v1/directory_companies?on_conflict=domain`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(batch),
  });
  if (!res.ok) {
    console.error(`Lot ${i / 500 + 1} refusé :`, res.status, await res.text());
    process.exit(1);
  }
  inserted += batch.length;
  console.error(`  ${inserted}/${unique.length}`);
}
console.error(`Terminé : ${inserted} établissements dans directory_companies (${country}).`);
