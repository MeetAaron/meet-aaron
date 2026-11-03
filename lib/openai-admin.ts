// lib/openai-admin.ts
//
// DÉPENSE RÉELLE, LUE CHEZ OPENAI (Alex, 03/11/2026 : « sois au courant du
// solde actuel, dépenses etc, comme pour Anthropic »).
//
// Jumeau de lib/anthropic-admin.ts. Aaron ne tourne pas que sur Anthropic :
// quand OPENAI_API_KEY est posée (c'est le cas en production depuis le
// 07/09/2026), tout le palier « cheap » part chez OpenAI — tri,
// classification, extraction, relances. Cette dépense-là existait dans
// api_usage_daily MÉLANGÉE à celle d'Anthropic, donc impossible de dire qui
// dépensait quoi, et impossible de surveiller le solde OpenAI.
//
// Trois différences avec Anthropic, toutes des pièges :
//   - les dates sont en SECONDES Unix, pas en ISO ;
//   - le montant est en DOLLARS (amount.value), pas en cents ;
//   - la réponse est paginée par `next_page` et plafonnée à 180 seaux :
//     sans pagination, une longue période serait silencieusement tronquée,
//     donc sous-estimée — exactement l'erreur qui fait croire à un solde
//     intact.
//
// CLÉ : OPENAI_ADMIN_KEY, une clé d'administration d'organisation
// (sk-admin-…), distincte de OPENAI_API_KEY. Sans elle, tout renvoie null et
// l'appelant sait qu'il ne sait pas — il n'invente pas une dépense nulle.

const COSTS_URL = 'https://api.openai.com/v1/organization/costs';

export function openAiAdminConfigured(): boolean {
  return !!process.env.OPENAI_ADMIN_KEY;
}

export interface DailyCost {
  day: string; // AAAA-MM-JJ (UTC)
  usd: number;
}

function dayFromUnix(seconds: unknown): string {
  const n = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(n)) return '';
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function toUsd(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

export async function fetchDailyCosts(startingAt: Date, endingAt: Date): Promise<DailyCost[] | null> {
  const key = process.env.OPENAI_ADMIN_KEY;
  if (!key) return null;

  const days: DailyCost[] = [];
  let page: string | null = null;
  let seenBuckets = 0;

  try {
    // Au plus 6 pages de 180 seaux : largement de quoi couvrir n'importe
    // quelle période utile, et une borne dure contre une boucle infinie si
    // `next_page` se mettait à pointer sur lui-même.
    for (let i = 0; i < 6; i++) {
      const params = new URLSearchParams({
        start_time: String(Math.floor(startingAt.getTime() / 1000)),
        end_time: String(Math.floor(endingAt.getTime() / 1000)),
        limit: '180',
      });
      if (page) params.set('page', page);

      const res: Response = await fetch(`${COSTS_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[openai-admin] costs ${res.status} : ${body.slice(0, 200)}`);
        return null;
      }
      const json: any = await res.json();
      const buckets: any[] = json?.data || [];
      seenBuckets += buckets.length;

      for (const bucket of buckets) {
        const day = dayFromUnix(bucket?.start_time);
        if (!day) continue;
        let usd = 0;
        for (const r of (bucket?.results || [])) {
          usd += toUsd(r?.amount?.value ?? r?.amount);
        }
        days.push({ day, usd: Math.round(usd * 10000) / 10000 });
      }

      if (!json?.has_more || !json?.next_page) break;
      page = String(json.next_page);
    }

    if (days.length === 0 && seenBuckets > 0) {
      // Des seaux mais rien de lisible : la forme a changé. On le dit et on
      // renvoie null, plutôt que d'annoncer une dépense nulle.
      console.error('[openai-admin] costs : forme de réponse inattendue, dépense inconnue.');
      return null;
    }
    return days;
  } catch (err: any) {
    console.error('[openai-admin] costs injoignable :', err?.message || err);
    return null;
  }
}

// Somme dépensée depuis un instant donné, d'après OpenAI. null = inconnu.
export async function realSpendSince(since: Date): Promise<number | null> {
  // Le JOUR de la saisie compte en entier : OpenAI agrège par journée UTC, et
  // surestimer légèrement va dans le bon sens pour une alerte de solde.
  const start = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const end = new Date(Date.now() + 86400000);
  const days = await fetchDailyCosts(start, end);
  if (days === null) return null;
  return days.reduce((sum, d) => sum + d.usd, 0);
}
