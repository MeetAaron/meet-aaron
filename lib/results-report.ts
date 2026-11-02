// lib/results-report.ts
// Calcule le résumé chiffré d'une période donnée pour un commercial, côté
// serveur — utilisé par app/api/results/report/route.ts (téléchargement PDF/
// XLS d'un rapport depuis la page Résultats, CHANGEMENTS A FAIRE #137 / item
// A1). Recalculé depuis la base (et non transmis par le client) pour que le
// contenu du rapport téléchargé fasse foi même si l'écran a été rafraîchi
// entre-temps.
//
// Reprend exactement la même logique de filtrage/étiquetage que
// app/app/resultats/page.jsx (périodRangeFor/withinRange/opportunityBucketFor
// côté client) mais en requêtes Supabase ciblées sur la période demandée,
// plutôt que de tout charger puis filtrer en mémoire.

import { supabaseAdmin } from './supabase-admin';

export interface PeriodSummary {
  prospectsContactes: number;
  rdvObtenus: number;
  rdvEnAttente: number;
  tauxConversion: number; // pourcentage arrondi
  opportunitesGagnees: number;
  opportunitesPerdues: number;
  clientsGagnes: number;
}

export async function computePeriodSummary(
  userId: string,
  start: Date | null,
  end: Date | null
): Promise<PeriodSummary> {
  // Prospects contactés pendant la période (date de création).
  // On garde les IDENTIFIANTS, pas seulement le compte : le taux de
  // conversion plus bas doit se calculer sur CES prospects-là (voir le bug
  // des 150 %).
  let prospectsQuery = supabaseAdmin
    .from('prospects')
    .select('id')
    .eq('assigned_user_id', userId);
  if (start) prospectsQuery = prospectsQuery.gte('created_at', start.toISOString());
  if (end) prospectsQuery = prospectsQuery.lte('created_at', end.toISOString());
  const { data: prospectsRows } = await prospectsQuery;
  const prospectIdsInRange = new Set<string>(((prospectsRows as any[]) || []).map((p) => p.id));
  const prospectsContactes = prospectIdsInRange.size;

  // RDV proposés sur la période (date du RDV, pas date de création).
  // purpose = 'commercial' uniquement : un RDV de lancement (tâche #141,
  // client déjà signé) fausserait le taux de conversion prospection — voir
  // migration_kickoff_rdv_2026-08-20.sql.
  let apptQuery = supabaseAdmin
    .from('appointments')
    .select('id, status, prospect_id')
    .eq('user_id', userId)
    .eq('purpose', 'commercial');
  if (start) apptQuery = apptQuery.gte('proposed_at', start.toISOString());
  if (end) apptQuery = apptQuery.lte('proposed_at', end.toISOString());
  const { data: appts } = await apptQuery;
  const rdvObtenus = (appts || []).filter((a: any) => a.status === 'validé' || a.status === 'terminé').length;
  const rdvEnAttente = (appts || []).filter((a: any) => a.status === 'proposé').length;

  // ───────────────────────────────────────────────────────────────────────
  // TAUX DE CONVERSION : 150 % (bug signalé par Alex, 02/11/2026).
  //
  // Le rapport mensuel affichait « 2 prospects contactés, 3 RDV obtenus,
  // taux de conversion 150 % ». La division portait sur DEUX POPULATIONS
  // DIFFÉRENTES : au numérateur les RDV dont la DATE tombe dans la période,
  // au dénominateur les prospects CRÉÉS dans la période. Un RDV obtenu ce
  // mois-ci avec un prospect contacté le mois dernier gonflait donc le
  // numérateur sans rien ajouter au dénominateur — et le taux pouvait
  // dépasser 100 % sans que rien ne soit faux dans les données.
  //
  // Un taux n'a de sens que sur une seule population : on compte les
  // prospects CONTACTÉS DANS LA PÉRIODE qui ont décroché un RDV. Un
  // prospect qui en a décroché deux compte une fois (sinon on repasse
  // au-dessus de 100 %). « RDV obtenus » reste affiché tel quel : c'est un
  // décompte d'activité du mois, pas le numérateur du taux.
  const prospectsAvecRdv = new Set<string>();
  for (const a of ((appts as any[]) || [])) {
    if (a.status !== 'validé' && a.status !== 'terminé') continue;
    if (a.prospect_id && prospectIdsInRange.has(a.prospect_id)) prospectsAvecRdv.add(a.prospect_id);
  }
  const tauxConversion =
    prospectsContactes > 0 ? Math.round((prospectsAvecRdv.size / prospectsContactes) * 100) : 0;

  // Opportunités dont l'étape a bougé sur la période (mêmes conventions que
  // /api/sales/pipeline : deal_stage renseigné = "affaire").
  let dealsQuery = supabaseAdmin
    .from('prospects')
    .select('deal_stage')
    .eq('assigned_user_id', userId)
    .not('deal_stage', 'is', null);
  if (start) dealsQuery = dealsQuery.gte('deal_stage_updated_at', start.toISOString());
  if (end) dealsQuery = dealsQuery.lte('deal_stage_updated_at', end.toISOString());
  const { data: deals } = await dealsQuery;
  const opportunitesGagnees = (deals || []).filter((d: any) => d.deal_stage === 'signe').length;
  const opportunitesPerdues = (deals || []).filter((d: any) => d.deal_stage === 'perdu').length;

  // Clients gagnés sur la période (date de gain), mêmes conventions que
  // /api/customers/pipeline (1ère commande confirmée = client à part entière).
  let customersQuery = supabaseAdmin
    .from('prospects')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_user_id', userId)
    .not('first_order_confirmed_at', 'is', null);
  if (start) customersQuery = customersQuery.gte('won_at', start.toISOString());
  if (end) customersQuery = customersQuery.lte('won_at', end.toISOString());
  const { count: clientsGagnes } = await customersQuery;

  return {
    prospectsContactes,
    rdvObtenus,
    rdvEnAttente,
    tauxConversion,
    opportunitesGagnees,
    opportunitesPerdues,
    clientsGagnes: clientsGagnes || 0,
  };
}
