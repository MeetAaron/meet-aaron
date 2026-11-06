// lib/anthropic-admin.ts
//
// DÉPENSE RÉELLE, LUE CHEZ ANTHROPIC (Alex, 31/10/2026).
//
// Déclencheur : une alerte « il reste 1,43 $, soit 2 jours » alors que le
// solde réel était de 9,48 $. Panique inutile, et pire — une alerte qui crie
// au loup finit par ne plus être lue le jour où elle a raison.
//
// Deux sources de dérive dans l'ancien calcul. Côté dépense, il ADDITIONNAIT
// l'estimation maison (api_usage_daily), qui surestime volontairement par
// prudence. Côté solde, il partait d'un chiffre saisi à la main et ignorait
// tout rechargement survenu depuis — Alex avait rechargé 10,11 $ deux jours
// plus tôt sans le ressaisir.
//
// Ce module supprime la première dérive : l'API d'administration d'Anthropic
// expose le coût RÉEL par jour, en dollars. Plus d'estimation, plus de
// surestimation prudente, plus d'écart qui se creuse.
//
// Il N'EXISTE TOUJOURS PAS d'endpoint de solde restant (revérifié le
// 31/10/2026 : l'API d'administration expose l'usage et le coût, pas le
// solde). La seconde dérive se règle donc autrement — en détectant les
// emails de reçu d'Anthropic, voir le chantier suivant.
//
// CLÉ : ANTHROPIC_ADMIN_KEY, une clé Admin (sk-ant-admin01-...), distincte de
// la clé d'API normale. Une clé de workspace NE FONCTIONNE PAS. Sans elle,
// toutes les fonctions renvoient null et le calcul retombe sur l'estimation
// maison, exactement comme avant : rien ne casse, c'est juste moins précis.

const ADMIN_BASE = 'https://api.anthropic.com/v1/organizations';

// DERNIÈRE ERREUR, LISIBLE DEPUIS L'ÉCRAN FONDATEUR (05/11/2026).
//
// La clé est posée, elle est bien une clé Admin, le compte est bien une
// organisation — et la dépense reste « estimée ». Sans les journaux Vercel,
// impossible de savoir POURQUOI l'appel échoue. On garde donc la dernière
// erreur en mémoire (statut HTTP + début du corps, jamais la clé), et
// /api/admin/api-balance la montre au fondateur. Mémoire du processus :
// se vide à chaque redéploiement, ce qui suffit pour un diagnostic.
let lastError: string | null = null;
export function adminLastError(): string | null {
  return lastError;
}

export function adminApiConfigured(): boolean {
  return !!process.env.ANTHROPIC_ADMIN_KEY;
}

// Les montants arrivent en chaînes décimales exprimées dans la plus petite
// unité (des cents). On ne suppose rien : on accepte aussi un nombre, et on
// ignore proprement ce qu'on ne sait pas lire plutôt que de produire un NaN
// qui contaminerait tout le calcul de solde.
function centsToUsd(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

export interface DailyCost {
  day: string;      // AAAA-MM-JJ (UTC)
  usd: number;
}

// Coût réel par jour entre deux dates. `endingAt` est EXCLUSIF côté Anthropic.
// Renvoie null — et non un tableau vide — quand la lecture est impossible :
// l'appelant doit pouvoir distinguer « zéro dépense » de « je ne sais pas »,
// sans quoi une panne d'API se lirait comme une journée gratuite.
export async function fetchDailyCosts(startingAt: Date, endingAt: Date): Promise<DailyCost[] | null> {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return null;

  // LIMITE PAR DÉFAUT : 7 SEAUX (03/11/2026, trouvé en relisant la doc).
  //
  // En granularité journalière, l'API renvoie SEPT jours par défaut et trente
  // et un au maximum. Nous ne passions pas `limit` : au-delà d'une semaine
  // sans nouvelle saisie de solde, la dépense était donc tronquée en silence,
  // donc SOUS-ESTIMÉE, donc le reste annoncé était trop élevé. C'est
  // exactement le genre de panne qu'on cherchait à éliminer — un chiffre faux
  // qui a l'air juste.
  //
  // On demande le maximum, et on pagine : `has_more` + `next_page`.
  // BORNES ALIGNÉES SUR DES JOURS ENTIERS (06/11/2026).
  //
  // Diagnostic lu dans Marge par Alex : « HTTP 400 — Invalid date range:
  // ending date must be after starting date ». Anthropic ramène les bornes
  // au début de leur journée UTC avant de les comparer, et la borne de fin
  // « demain à la même heure » pouvait retomber sur le jour du début. On
  // envoie des minuits UTC sans millisecondes, avec au moins un jour plein
  // d'écart ; si cette forme est encore refusée pour les dates, on retente
  // une seule fois avec « maintenant » comme fin (au cas où l'API refuse une
  // borne dans le futur). La dernière erreur garde les bornes envoyées :
  // sans elles, impossible de voir d'où vient un refus.
  const startDay = utcMidnight(startingAt);
  let endDay = utcMidnight(endingAt);
  if (endDay.getTime() <= startDay.getTime()) endDay = new Date(startDay.getTime() + 2 * 86400000);
  const startingParam = isoNoMs(startDay);
  const candidates = [isoNoMs(endDay), isoNoMs(new Date())].filter((v, i, a) => a.indexOf(v) === i && v > startingParam);

  try {
    for (const endingParam of candidates) {
      const days: DailyCost[] = [];
      let page: string | null = null;
      let seenBuckets = 0;
      let dateRefused = false;

      for (let i = 0; i < 6; i++) {
        const params = new URLSearchParams({
          starting_at: startingParam,
          ending_at: endingParam,
          limit: '31',
        });
        if (page) params.set('page', page);
        const res = await fetch(`${ADMIN_BASE}/cost_report?${params.toString()}`, {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          lastError = `HTTP ${res.status} (${startingParam} → ${endingParam}) : ${body.slice(0, 300)}`;
          console.error(`[admin] cost_report ${lastError}`);
          dateRefused = res.status === 400 && /date/i.test(body);
          break;
        }
        const json: any = await res.json();

        // La réponse est paginée en « buckets » journaliers, chacun contenant
        // une liste de résultats à additionner. On lit défensivement : la forme
        // exacte a déjà changé une fois côté Anthropic, et une alerte de solde
        // ne doit pas tomber en panne parce qu'un champ a été renommé.
        const buckets: any[] = json?.data || json?.buckets || [];
        seenBuckets += buckets.length;
        for (const bucket of buckets) {
          const day = String(bucket?.starting_at || bucket?.start || '').slice(0, 10);
          if (!day) continue;
          const results: any[] = bucket?.results || bucket?.items || [];
          let usd = 0;
          for (const r of results) {
            usd += centsToUsd(r?.amount ?? r?.cost ?? r?.amount_cents);
          }
          days.push({ day, usd: Math.round(usd * 10000) / 10000 });
        }
        if (!json?.has_more || !json?.next_page) {
          if (days.length === 0 && seenBuckets > 0) {
            // Des buckets mais rien de lisible dedans : la forme a changé. On
            // le dit et on renvoie null pour retomber sur l'estimation, plutôt
            // que d'annoncer une dépense nulle qui ferait croire à un solde intact.
            lastError = 'forme de réponse inattendue (seaux présents, rien de lisible)';
            console.error('[admin] cost_report : forme de réponse inattendue, repli sur l\'estimation maison.');
            return null;
          }
          lastError = null;
          return days;
        }
        page = String(json.next_page);
      }
      // Une page a échoué. Si ce n'est pas un refus de dates, inutile de
      // retenter avec une autre borne.
      if (!dateRefused) return null;
    }
    return null;
  } catch (err: any) {
    lastError = `injoignable : ${err?.message || err}`;
    console.error('[admin] cost_report injoignable :', err?.message || err);
    return null;
  }
}

function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Somme dépensée depuis un instant donné, d'après Anthropic. null = inconnu.
export async function realSpendSince(since: Date): Promise<number | null> {
  // On part du JOUR de la saisie, inclus : Anthropic agrège par journée UTC,
  // et compter la journée entière va dans le sens prudent pour une alerte.
  // Fin : après-demain minuit UTC, pour que la journée en cours soit comprise
  // quelle que soit l'heure de l'appel (fetchDailyCosts aligne de toute façon).
  const start = utcMidnight(since);
  const end = new Date(utcMidnight(new Date()).getTime() + 2 * 86400000);
  const days = await fetchDailyCosts(start, end);
  if (days === null) return null;
  return days.reduce((sum, d) => sum + d.usd, 0);
}
