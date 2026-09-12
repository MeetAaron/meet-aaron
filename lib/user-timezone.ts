// lib/user-timezone.ts
//
// FUSEAU HORAIRE DU COMMERCIAL (12/09/2026).
//
// Demande d'Alex : « je suis en Australie, donc le rapport doit être envoyé à
// minuit une, et ce pour chaque pays selon le fuseau horaire ».
//
// Jusqu'ici le cron des rapports tournait à 00h10 UTC pour tout le monde :
// minuit dix à Paris en hiver, mais huit heures du matin à Perth — le
// « rapport d'hier » arrivait au milieu de la matinée, après que le
// commercial ait déjà commencé sa journée. Il perd tout son sens.
//
// Trois sources, de la plus fiable à la plus grossière :
//   1. users.timezone — l'identifiant IANA relevé dans le navigateur
//      (Intl.DateTimeFormat().resolvedOptions().timeZone). C'est la seule
//      vraie réponse : elle tient compte de la ville, pas du pays.
//   2. le pays de facturation, quand le fuseau y est sans ambiguïté ;
//   3. Europe/Paris par défaut — la majorité des utilisateurs visés.
//
// Le cas australien illustre pourquoi le pays ne suffit pas : Perth est à
// UTC+8, Adélaïde à UTC+9:30, Sydney à UTC+10 et passe à l'heure d'été.
// D'où le relevé navigateur en source principale.

// Pays dont le fuseau est unique (ou dont la quasi-totalité de la population
// vit dans un seul fuseau). Volontairement limité : un pays à plusieurs
// fuseaux réels n'a rien à faire ici, il retombe sur le défaut jusqu'à ce
// que le navigateur donne la vraie valeur.
const COUNTRY_TIMEZONE: Record<string, string> = {
  FR: 'Europe/Paris',
  BE: 'Europe/Brussels',
  LU: 'Europe/Luxembourg',
  CH: 'Europe/Zurich',
  MC: 'Europe/Monaco',
  DE: 'Europe/Berlin',
  AT: 'Europe/Vienna',
  IT: 'Europe/Rome',
  ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon',
  NL: 'Europe/Amsterdam',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  MA: 'Africa/Casablanca',
  TN: 'Africa/Tunis',
  SN: 'Africa/Dakar',
  CI: 'Africa/Abidjan',
  SG: 'Asia/Singapore',
  JP: 'Asia/Tokyo',
  NZ: 'Pacific/Auckland',
  // AU, US, CA, BR, RU : plusieurs fuseaux → volontairement absents.
};

export const DEFAULT_TIMEZONE = 'Europe/Paris';

// Vrai si l'identifiant est un fuseau IANA que le runtime sait manipuler.
// Une valeur venue du navigateur n'est jamais digne de confiance en l'état.
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveUserTimeZone(user: {
  timezone?: string | null;
  billing_country?: string | null;
}): string {
  if (isValidTimeZone(user?.timezone)) return user.timezone as string;
  const country = (user?.billing_country || '').trim().toUpperCase();
  const fromCountry = COUNTRY_TIMEZONE[country];
  if (fromCountry) return fromCountry;
  return DEFAULT_TIMEZONE;
}

// Heure locale (0-23) et date locale (YYYY-MM-DD) du commercial, à partir
// d'un instant donné. Intl fait tout le travail, heure d'été comprise —
// aucun décalage codé en dur nulle part.
export function localParts(instant: Date, timeZone: string): {
  hour: number;
  date: string;
  weekday: number; // 1 = lundi … 7 = dimanche
  dayOfMonth: number;
} {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // 'hour' peut valoir « 24 » à minuit selon le runtime avec hour12:false.
  const hour = Number(get('hour')) % 24;
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    hour,
    date: `${year}-${month}-${day}`,
    weekday: weekdayMap[get('weekday')] || 1,
    dayOfMonth: Number(day),
  };
}
