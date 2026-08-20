// lib/team-stats.ts
// CHANGEMENTS A FAIRE — Mon équipe (item 1) : calcule, pour un ou plusieurs
// commerciaux d'une société, les 6 statistiques demandées par Alex (prospects
// actifs, RDVs gagnés, opportunités actives, clients gagnés, clients actifs,
// clients perdus), toutes sensibles à une période optionnelle. Partagé entre
// app/api/team/route.ts (tableau de l'équipe) et app/api/team/report/route.ts
// (rapport de performances téléchargeable), pour ne calculer ces définitions
// qu'à un seul endroit.
//
// Définitions retenues (documentées ici car le docx ne les détaille pas) :
// - prospects_actifs : prospect assigné, pas encore gagné/perdu, et pas
//   encore une opportunité (deal_stage vide) — même logique que le filtrage
//   déjà appliqué sur app/app/prospects/page.jsx (NON_TERMINAL_DEAL_STAGES),
//   pour ne pas compter deux fois le même prospect dans "prospects actifs"
//   ET "opportunités actives". Filtré sur la date de création.
// - rdv_gagnes : rendez-vous confirmés (status "validé" ou "terminé"),
//   filtrés sur leur date proposée — même convention que "rdvConfirmes" dans
//   app/app/resultats/page.jsx (Lot 5).
// - opportunites_actives : prospects dont le deal_stage est une étape NON
//   terminale (rdv_fait/devis_envoye/en_negociation, donc ni signé ni
//   perdu), filtrés sur la date de dernière mise à jour d'étape.
// - clients_gagnes : prospects devenus clients à part entière (1ère commande
//   confirmée) pendant la période, filtrés sur leur date de gain (won_at) —
//   compte total, qu'ils soient encore actifs ou perdus depuis.
// - clients_actifs / clients_perdus : parmi les clients gagnés sur la
//   période (même ensemble que clients_gagnes ci-dessus), répartis selon
//   leur état ACTUEL (is_lost) — un client marqué "perdu" plus tard reste
//   compté dans clients_gagnes mais bascule de clients_actifs vers
//   clients_perdus. clients_actifs + clients_perdus = clients_gagnes,
//   toujours. Le champ is_lost/lost_at déjà utilisé pour les prospects
//   perdus avant signature est réutilisé tel quel pour les clients perdus
//   après signature (voir nouvelles actions marquer_client_perdu/
//   reactiver_client dans app/api/prospects/[id]/route.ts) — aucune
//   migration nécessaire.

import { supabaseAdmin } from './supabase-admin';

export const NON_TERMINAL_DEAL_STAGES = ['rdv_fait', 'devis_envoye', 'en_negociation'];

export interface MemberStats {
  prospects_actifs: number;
  rdv_gagnes: number;
  opportunites_actives: number;
  clients_gagnes: number;
  clients_actifs: number;
  clients_perdus: number;
}

export interface PeriodRange {
  since: Date | null;
  until: Date | null;
}

function withinPeriod(dateValue: string | null, range: PeriodRange): boolean {
  if (!range.since && !range.until) return true;
  if (!dateValue) return false;
  const d = new Date(dateValue);
  if (range.since && d < range.since) return false;
  if (range.until && d > range.until) return false;
  return true;
}

// Calcule les 6 stats pour une liste de commerciaux (company_id sert juste à
// documenter l'appelant — les requêtes filtrent sur assigned_user_id, déjà
// garanti appartenir à la société par l'appelant).
export async function computeStatsForMembers(
  memberIds: string[],
  range: PeriodRange
): Promise<Record<string, MemberStats>> {
  const result: Record<string, MemberStats> = {};
  if (memberIds.length === 0) return result;

  const [prospectsRes, appointmentsRes, dealsRes, clientsRes] = await Promise.all([
    supabaseAdmin
      .from('prospects')
      .select('id, assigned_user_id, created_at, deal_stage, is_won, is_lost')
      .in('assigned_user_id', memberIds)
      .eq('is_won', false)
      .eq('is_lost', false)
      .is('deal_stage', null),
    supabaseAdmin
      .from('appointments')
      .select('id, user_id, proposed_at, status')
      .in('user_id', memberIds)
      .in('status', ['validé', 'terminé'])
      // purpose = 'commercial' uniquement : un RDV de lancement (tâche
      // #141, client déjà signé) n'est pas un "RDV obtenu" au sens du
      // pipeline de prospection — voir migration_kickoff_rdv_2026-08-20.sql.
      .eq('purpose', 'commercial'),
    supabaseAdmin
      .from('prospects')
      .select('id, assigned_user_id, deal_stage, deal_stage_updated_at')
      .in('assigned_user_id', memberIds)
      .in('deal_stage', NON_TERMINAL_DEAL_STAGES),
    supabaseAdmin
      .from('prospects')
      .select('id, assigned_user_id, won_at, is_lost')
      .in('assigned_user_id', memberIds)
      .not('first_order_confirmed_at', 'is', null),
  ]);

  for (const memberId of memberIds) {
    result[memberId] = {
      prospects_actifs: 0,
      rdv_gagnes: 0,
      opportunites_actives: 0,
      clients_gagnes: 0,
      clients_actifs: 0,
      clients_perdus: 0,
    };
  }

  for (const p of prospectsRes.data || []) {
    if (!withinPeriod(p.created_at, range)) continue;
    if (result[p.assigned_user_id]) result[p.assigned_user_id].prospects_actifs += 1;
  }

  for (const a of appointmentsRes.data || []) {
    if (!withinPeriod(a.proposed_at, range)) continue;
    if (result[a.user_id]) result[a.user_id].rdv_gagnes += 1;
  }

  for (const d of dealsRes.data || []) {
    if (!withinPeriod(d.deal_stage_updated_at, range)) continue;
    if (result[d.assigned_user_id]) result[d.assigned_user_id].opportunites_actives += 1;
  }

  for (const c of clientsRes.data || []) {
    if (!withinPeriod(c.won_at, range)) continue;
    const bucket = result[c.assigned_user_id];
    if (!bucket) continue;
    bucket.clients_gagnes += 1;
    if (c.is_lost) {
      bucket.clients_perdus += 1;
    } else {
      bucket.clients_actifs += 1;
    }
  }

  return result;
}

// Sélecteur de période "Mon équipe" (item 1) : littéralement "depuis
// l'ouverture de compte, au mois, de telle à telle date" dans le docx —
// volontairement différent des 4 fenêtres 7j/30j/3mois/depuis toujours
// choisies pour Résultats (Lot 5), chaque page suit son propre texte. Le mode
// "custom" accepte une vraie plage (from ET to), pas juste une date de
// départ, pour coller au texte exact du docx ("de telle à telle date").
export function periodRangeFor(mode: string, customFrom?: string | null, customTo?: string | null): PeriodRange {
  if (mode === 'month') {
    const now = new Date();
    return { since: new Date(now.getFullYear(), now.getMonth(), 1), until: null };
  }
  if (mode === 'custom') {
    const since = customFrom ? new Date(customFrom) : null;
    const until = customTo ? new Date(customTo) : null;
    return {
      since: since && !isNaN(since.getTime()) ? since : null,
      until: until && !isNaN(until.getTime()) ? until : null,
    };
  }
  return { since: null, until: null }; // 'all' — depuis l'ouverture de compte, pas de filtre
}
