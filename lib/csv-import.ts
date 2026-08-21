// lib/csv-import.ts
//
// Import CSV "intelligent" (Prospects / Opportunités / Clients) — voir
// components/CsvImportModal.jsx pour l'UI et app/api/csv-import/analyze/route.ts
// pour la seule partie assistée par IA.
//
// Principe de sécurité (repris de la conception du module Marketing) :
// ce fichier ne fait QUE de l'analyse déterministe — parsing, correspondance
// de colonnes, validation. Rien n'est inventé ici. La complétion par IA
// (suggestion de nom d'entreprise déduit du domaine email, détection de
// lignes de test, correction de casse) est strictement isolée dans la route
// API, avec un schéma de sortie qui interdit structurellement d'inventer
// téléphone/poste/email/LinkedIn — et même ce que l'IA renvoie reste une
// SUGGESTION affichée dans un champ éditable, jamais appliqué en silence :
// l'import final passe toujours par une relecture humaine avant écriture.

export const IMPORT_FIELDS = ['full_name', 'first_name', 'last_name', 'email', 'phone', 'company_name', 'job_title'];

// Alias déterministes (minuscules, sans accents) pour l'auto-mapping des
// en-têtes du fichier importé — aucune IA impliquée ici, juste une liste de
// correspondances courantes en français/anglais.
const HEADER_ALIASES = {
  full_name: ['nom complet', 'nom et prenom', 'name', 'full name', 'fullname', 'contact', 'nom prenom', 'prenom nom'],
  first_name: ['prenom', 'first name', 'firstname', 'given name'],
  last_name: ['nom', 'nom de famille', 'last name', 'lastname', 'surname', 'family name'],
  email: ['email', 'e-mail', 'mail', 'adresse email', 'courriel', 'adresse e-mail'],
  phone: ['telephone', 'tel', 'phone', 'numero de telephone', 'mobile', 'portable', 'tel.'],
  company_name: ['entreprise', 'societe', 'company', 'company name', 'organisation', 'organization'],
  job_title: ['poste', 'fonction', 'job title', 'titre', 'position', 'metier'],
};

function normalizeHeader(h) {
  return (h || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

// Détecte le séparateur (virgule ou point-virgule — export Excel FR courant)
// en comptant les occurrences sur la première ligne non vide.
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

// Parsing CSV robuste (guillemets, virgules/points-virgules et retours à la
// ligne dans les cellules, BOM UTF-8 en tête de fichier) — écrit à la main
// pour éviter une dépendance côté navigateur pour un format simple.
export function parseCsv(text) {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(s);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c === '\r') {
      // ignoré, géré par le \n qui suit (ou par la fin de fichier ci-dessous)
    } else {
      cell += c;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Auto-mapping déterministe des en-têtes détectées vers les champs cibles —
// chaque colonne du fichier n'est utilisée qu'une seule fois. Correspondance
// exacte d'abord, puis correspondance partielle (ex: "adresse e-mail pro").
export function autoMapColumns(headers) {
  const normalized = headers.map(normalizeHeader);
  const usedCols = new Set();
  const mapping = {};

  IMPORT_FIELDS.forEach((field) => {
    const aliases = HEADER_ALIASES[field] || [];
    let foundIdx = null;
    for (let i = 0; i < normalized.length; i++) {
      if (usedCols.has(i)) continue;
      if (aliases.includes(normalized[i])) {
        foundIdx = i;
        break;
      }
    }
    if (foundIdx === null) {
      for (let i = 0; i < normalized.length; i++) {
        if (usedCols.has(i)) continue;
        if (aliases.some((a) => normalized[i].includes(a))) {
          foundIdx = i;
          break;
        }
      }
    }
    mapping[field] = foundIdx;
    if (foundIdx !== null) usedCols.add(foundIdx);
  });

  return mapping;
}

export function buildFullName({ full_name, first_name, last_name }) {
  if (full_name && full_name.trim()) return full_name.trim();
  return `${first_name || ''} ${last_name || ''}`.trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Retourne la liste des erreurs de validation d'une ligne déjà mappée (objet
// {full_name, email, phone, company_name, job_title}) — vide si la ligne est
// importable telle quelle.
export function validateRow(row) {
  const errors = [];
  if (!row.full_name || !row.full_name.trim()) errors.push('Nom manquant');
  if (!row.email || !row.email.trim()) errors.push('Email manquant');
  else if (!EMAIL_RE.test(row.email.trim())) errors.push('Email invalide');
  return errors;
}

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.fr', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr',
  'icloud.com', 'live.com', 'live.fr', 'aol.com', 'protonmail.com', 'gmx.com', 'gmx.fr',
  'free.fr', 'orange.fr', 'wanadoo.fr', 'laposte.net', 'sfr.fr', 'bbox.fr', 'yandex.com', 'mail.com',
]);

export function isGenericEmailDomain(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase().trim();
  return !domain || GENERIC_EMAIL_DOMAINS.has(domain);
}

// Construit les lignes exploitables (mappées + validées) à partir des lignes
// brutes du CSV et du mapping colonne -> champ choisi par l'utilisateur.
export function buildMappedRows(rawRows, mapping) {
  return rawRows.map((raw, idx) => {
    const get = (field) => {
      const col = mapping[field];
      return col === null || col === undefined ? '' : (raw[col] || '').trim();
    };
    const row = {
      idx,
      full_name: buildFullName({ full_name: get('full_name'), first_name: get('first_name'), last_name: get('last_name') }),
      email: get('email'),
      phone: get('phone'),
      company_name: get('company_name'),
      job_title: get('job_title'),
    };
    return { ...row, errors: validateRow(row) };
  });
}
