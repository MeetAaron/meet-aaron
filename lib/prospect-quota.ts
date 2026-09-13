// lib/prospect-quota.ts
//
// QUOTA DE NOUVEAUX PROSPECTS PAR MOIS (décision Alex, 08/09/2026).
//
// Ce que le client voit et achète : « 150 nouveaux prospects par mois et par
// siège », boosts en plus. Une seule règle, lisible, qui remplace le solde de
// crédits que personne ne savait interpréter. Elle vit ICI, pas dans
// l'affichage : les trois portes d'entrée d'un prospect (campagne, ajout
// manuel, import CSV) l'appliquent toutes, sinon « 150 » serait un slogan.
// 13/09/2026 : 300 -> 150, voir PROSPECTS_PER_SEAT_PER_MONTH dans boost-tiers.
//
// Le plafond de dépense en dollars (lib/anthropic-client.ts) reste en place
// derrière, comme filet de sécurité — mais c'est ce quota-ci qui parle au
// commercial, et c'est lui qui arrête une campagne proprement plutôt que de
// la laisser mourir à mi-parcours faute de budget.
//
// Comptage : tout prospect créé dans le mois calendaire (UTC) pour la
// société, quelle que soit sa source. Un prospect supprimé puis recréé compte
// deux fois — assumé, c'est ce qui empêche de contourner le quota en
// supprimant.

import { supabaseAdmin } from './supabase-admin';
import { listActiveBoosts } from './credit-boosts';
import { PROSPECTS_PER_SEAT_PER_MONTH, PROSPECTS_PER_CREDIT, USD_PER_CREDIT } from './boost-tiers';

export interface ProspectQuota {
  seats: number;
  included: number; // sièges × PROSPECTS_PER_SEAT_PER_MONTH
  boostExtra: number; // prospects restants apportés par les boosts actifs
  total: number; // included + boostExtra
  used: number; // prospects créés ce mois-ci
  remaining: number; // max(0, total − used)
  periodStart: string; // ISO, début du mois UTC
}

function monthStartUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getProspectQuota(companyId: string): Promise<ProspectQuota> {
  const periodStart = monthStartUTC();
  const [{ count: seats }, { count: used }, boosts] = await Promise.all([
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabaseAdmin
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', periodStart.toISOString()),
    listActiveBoosts(companyId),
  ]);

  const seatCount = Math.max(1, seats || 0);
  const included = seatCount * PROSPECTS_PER_SEAT_PER_MONTH;
  // Un boost est stocké en dollars de budget ; ce qu'il en reste se
  // reconvertit en prospects avec la même équivalence que l'affichage.
  const boostExtra = Math.floor(
    boosts.reduce((sum, b) => sum + (Number(b.remaining_usd) || 0), 0) / USD_PER_CREDIT * PROSPECTS_PER_CREDIT
  );
  const total = included + boostExtra;
  const usedCount = used || 0;
  return {
    seats: seatCount,
    included,
    boostExtra,
    total,
    used: usedCount,
    remaining: Math.max(0, total - usedCount),
    periodStart: periodStart.toISOString(),
  };
}

export class ProspectQuotaExceededError extends Error {
  quota: ProspectQuota;
  constructor(quota: ProspectQuota) {
    super(
      `Quota de nouveaux prospects atteint pour ce mois (${quota.used}/${quota.total}). ` +
        `Un boost permet d'en ajouter sans attendre le mois prochain.`
    );
    this.name = 'ProspectQuotaExceededError';
    this.quota = quota;
  }
}

// À appeler AVANT de créer `count` prospects. Lève si le quota ne les couvre
// pas. Best-effort sur les erreurs de lecture : une panne de comptage ne doit
// jamais empêcher un commercial d'ajouter un contact — l'erreur coûteuse ici
// serait le faux positif.
export async function assertProspectQuotaAllows(companyId: string, count = 1): Promise<ProspectQuota | null> {
  let quota: ProspectQuota;
  try {
    quota = await getProspectQuota(companyId);
  } catch (err: any) {
    console.error('Quota prospects illisible, on laisse passer :', err?.message);
    return null;
  }
  if (quota.remaining < count) throw new ProspectQuotaExceededError(quota);
  return quota;
}
