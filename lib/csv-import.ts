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

export const IMPORT_FIELDS = [
  'full_name', 'first_name', 'last_name', 'email', 'phone', 'company_name', 'job_title', 'pipeline_stage',
  // 22/10/2026 : les colonnes société du modèle téléchargeable (adresse,
  // SIRET, site, secteur, taille, CA) étaient proposées dans le fichier
  // vierge mais JAMAIS importées. Elles le sont désormais, avec les liens
  // LinkedIn/Instagram ; ce qui reste vide, Aaron le complète lui-même
  // (recherche société, voir lib/prospect-research.ts). La page LinkedIn de
  // l'ENTREPRISE est cherchée avant le LinkedIn du CONTACT, pour que la
  // colonne « LinkedIn » seule aille bien au contact.
  'address', 'siret', 'website', 'industry', 'company_size', 'estimated_revenue',
  'company_linkedin_url', 'company_instagram_url', 'linkedin_url',
];

// Alias déterministes (minuscules, sans accents) pour l'auto-mapping des
// en-têtes du fichier importé — aucune IA impliquée ici, juste une liste de
// correspondances courantes en français/anglais.
const HEADER_ALIASES = {
  full_name: ['nom complet', 'nom et prenom', 'name', 'full name', 'fullname', 'contact', 'nom prenom', 'prenom nom', 'nombre', 'nome', 'naam', 'nombre completo', 'nome completo', 'volledige naam'],
  first_name: ['prenom', 'first name', 'firstname', 'given name'],
  last_name: ['nom', 'nom de famille', 'last name', 'lastname', 'surname', 'family name'],
  email: ['email', 'e-mail', 'mail', 'adresse email', 'courriel', 'adresse e-mail'],
  phone: ['telephone', 'tel', 'phone', 'numero de telephone', 'mobile', 'portable', 'tel.', 'telefono', 'telefoon', 'telefon', 'telemovel', 'handy', 'cellulare', 'movil'],
  company_name: ['entreprise', 'societe', 'company', 'company name', 'organisation', 'organization', 'empresa', 'azienda', 'firma', 'unternehmen', 'bedrijf', 'societa'],
  job_title: ['poste', 'fonction', 'job title', 'titre', 'position', 'metier', 'puesto', 'cargo', 'funzione', 'ruolo', 'functie', 'funktion', 'title', 'job', 'role'],
  // Colonne d'étape (demande Alex, 01/09/2026) : le fichier d'un commercial
  // contient rarement que des prospects froids — il mélange ses clients
  // actuels (à ne JAMAIS redémarcher), ses affaires en cours et ses contacts
  // perdus. Sans cette colonne, tout entrait en « en cours » et Aaron
  // risquait d'envoyer un email de prospection à un client existant.
  pipeline_stage: ['progression', 'etape', 'statut', 'stage', 'status', 'categorie', 'category', 'type de contact', 'pipeline', 'etapa', 'fase', 'phase'],
  address: ['adresse', 'address', 'adresse postale', 'indirizzo', 'direccion', 'morada', 'adres', 'anschrift', 'street'],
  siret: ['siret', 'siren', 'numero siret', 'registration number', 'company number', 'abn', 'handelsregisternummer', 'numero di registrazione', 'numero de registro', 'numero de registo', 'registratienummer', 'kvk'],
  website: ['site web', 'site internet', 'website', 'webseite', 'sito web', 'sitio web', 'site'],
  industry: ["secteur d'activite", 'secteur', 'activite', 'industry', 'branche', 'settore', 'sector', 'setor'],
  company_size: ["taille de l'entreprise", 'taille', 'effectif', 'company size', 'size', 'employees', 'unternehmensgrosse', 'dimensione azienda', 'tamano de la empresa', 'dimensao da empresa', 'bedrijfsgrootte'],
  estimated_revenue: ['ca estime', "chiffre d'affaires", 'estimated revenue', 'revenue', 'turnover', 'umsatz', 'fatturato', 'facturacion', 'faturacao', 'omzet'],
  // Toutes les variantes du modèle téléchargeable (7 langues), puis des
  // mots « société » : une colonne LinkedIn qui parle de l'entreprise est la
  // page de l'entreprise, toute autre colonne LinkedIn est celle du contact.
  company_linkedin_url: ["page linkedin de l'entreprise", 'company linkedin page', 'linkedin seite der firma', "pagina linkedin dell'azienda", 'pagina de linkedin de la empresa', 'pagina linkedin da empresa', 'linkedin pagina van het bedrijf', 'page linkedin', 'linkedin entreprise', 'linkedin societe', 'company linkedin', 'linkedin company', 'linkedin page', 'entreprise', 'societe', 'company', 'firma', 'azienda', 'empresa', 'bedrijf'],
  company_instagram_url: ["instagram de l'entreprise", 'instagram', 'compte instagram', 'instagram entreprise', 'company instagram'],
  linkedin_url: ['linkedin (contact)', 'linkedin', 'profil linkedin', 'linkedin contact', 'linkedin profile', 'linkedin url', 'linkedin profil', 'profilo linkedin', 'perfil de linkedin', 'perfil linkedin', 'linkedin profiel'],
};

// Valeurs acceptées dans la colonne d'étape, en français et en anglais.
// Tout ce qui n'est pas reconnu est ignoré (la ligne part en « en cours »,
// comportement historique) — jamais d'erreur bloquante sur un import.
const STAGE_VALUE_ALIASES: { match: string[]; stage: string; lost?: boolean }[] = [
  { match: ['perdu', 'perdus', 'perdue', 'lost', 'closed lost', 'abandonne', 'abandon'], stage: 'en_cours', lost: true },
  { match: ['client', 'clients', 'customer', 'gagne', 'gagnes', 'won', 'closed won', 'signe'], stage: 'client' },
  { match: ['en negociation', 'negociation', 'negotiation', 'negotiating'], stage: 'en_negociation' },
  { match: ['proposition demandee', 'proposition', 'devis demande', 'devis', 'quote', 'quote requested', 'proposal'], stage: 'proposition_demandee' },
  { match: ['rdv obtenu', 'rdv', 'rendez vous', 'meeting', 'meeting booked', 'appointment'], stage: 'rdv_obtenu' },
  { match: ['en bonne voie', 'bonne voie', 'interesse', 'engaged', 'warm', 'opportunite', 'opportunity'], stage: 'en_bonne_voie' },
  { match: ['en cours', 'prospect', 'prospects', 'nouveau', 'new', 'cold', 'froid', 'jamais contacte'], stage: 'en_cours' },
];

// Traduit la valeur brute d'une cellule d'étape en { stage, lost }.
// Renvoie null si la colonne est absente, vide ou non reconnue.
export function parsePipelineStageValue(raw: string): { stage: string; lost: boolean } | null {
  const v = normalizeHeader(raw);
  if (!v) return null;
  // Correspondance exacte d'abord (« client » ne doit pas matcher
  // « ancien client perdu »), puis partielle.
  for (const entry of STAGE_VALUE_ALIASES) {
    if (entry.match.includes(v)) return { stage: entry.stage, lost: !!entry.lost };
  }
  for (const entry of STAGE_VALUE_ALIASES) {
    if (entry.match.some((a) => v.includes(a))) return { stage: entry.stage, lost: !!entry.lost };
  }
  return null;
}

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

  // 22/10/2026 (relecture) : les colonnes LinkedIn/Instagram sont réservées
  // AVANT tout le reste. Sans ça, l'alias « contact » du nom complet prenait
  // la colonne « LinkedIn (contact) » du modèle téléchargeable (le lien
  // atterrissait dans le nom du contact). Les autres champs ne peuvent plus
  // prendre une colonne qui parle de LinkedIn ou d'Instagram.
  const SOCIAL_FIELDS = ['company_linkedin_url', 'company_instagram_url', 'linkedin_url'];
  const isSocialHeader = (h) => h.includes('linkedin') || h.includes('instagram');
  const order = [...SOCIAL_FIELDS, ...IMPORT_FIELDS.filter((f) => !SOCIAL_FIELDS.includes(f))];

  // Deux passes GLOBALES (22/10/2026) : d'abord toutes les correspondances
  // exactes, puis les partielles. Avant, le nom complet prenait « First
  // name » par correspondance partielle (alias « name ») avant même que le
  // prénom n'ait cherché sa correspondance exacte.
  order.forEach((field) => { mapping[field] = null; });
  for (const exact of [true, false]) {
    order.forEach((field) => {
      if (mapping[field] !== null) return;
      const aliases = HEADER_ALIASES[field] || [];
      const social = SOCIAL_FIELDS.includes(field);
      for (let i = 0; i < normalized.length; i++) {
        if (usedCols.has(i)) continue;
        if (social ? !isSocialHeader(normalized[i]) : isSocialHeader(normalized[i])) continue;
        const hit = exact ? aliases.includes(normalized[i]) : aliases.some((a) => normalized[i].includes(a));
        if (hit) {
          mapping[field] = i;
          usedCols.add(i);
          break;
        }
      }
    });
  }

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
      address: get('address'),
      siret: get('siret'),
      website: get('website'),
      industry: get('industry'),
      company_size: get('company_size'),
      estimated_revenue: get('estimated_revenue'),
      company_linkedin_url: get('company_linkedin_url'),
      company_instagram_url: get('company_instagram_url'),
      linkedin_url: get('linkedin_url'),
      // null si colonne absente/vide/non reconnue -> comportement historique.
      pipeline: parsePipelineStageValue(get('pipeline_stage')),
    };
    return { ...row, errors: validateRow(row) };
  });
}
