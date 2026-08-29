// lib/company-stats.ts
// Calcule les statistiques clés d'activité d'une société pour la section
// "Statistiques clés" du profil d'entreprise (demande Alex, 29/08/2026 —
// "génération de graphiques dans le document"). Contrairement au reste du
// profil (rédigé par Aaron à partir du questionnaire de découverte, voir
// app/api/business-summary/route.ts), ces chiffres ne sont JAMAIS générés
// par le modèle : ils sont recalculés en direct depuis les vraies données de
// la société à CHAQUE export (jamais mis en cache/stockés) — poussée à son
// maximum de la règle "n'invente rien" du reste du document, puisqu'ici il
// n'y a même pas de génération IA impliquée, juste de l'agrégation SQL.
//
// Réutilise les définitions déjà validées par Alex pour "Mon équipe" (voir
// lib/team-stats.ts) plutôt que d'inventer de nouvelles règles de comptage —
// avec un scope volontairement différent : team-stats calcule des stats
// "actives"/period-sensitive par commercial, ici on veut des totaux
// "depuis toujours" au niveau de toute la société, pour une fiche de
// présentation (pas un tableau de pilotage).

import { supabaseAdmin } from './supabase-admin';

export interface PipelineStageCount {
  label: string;
  count: number;
}

export interface CompanyKeyStats {
  prospectsDemarches: number;
  clientsConvertis: number;
  tauxConversionRdv: number; // pourcentage arrondi (RDV obtenus / prospects démarchés)
  pipelineParEtape: PipelineStageCount[];
  campagnesMenees: number;
  // false si la société n'a encore aucune activité commerciale enregistrée
  // (compte tout juste créé) — la section "Statistiques clés" doit alors
  // être omise entièrement du document, pas affichée avec des zéros partout.
  hasAnyData: boolean;
}

const DEAL_STAGE_LABELS: Record<string, string> = {
  rdv_fait: 'RDV fait',
  devis_envoye: 'Devis envoyé',
  en_negociation: 'En négociation',
  signe: 'Signé',
  perdu: 'Perdu',
};
// Ordre d'affichage volontairement aligné sur la progression du pipeline
// (voir DEAL_STAGE_LABELS dans app/api/team/results/route.ts pour la même
// convention de libellés).
const DEAL_STAGE_ORDER = ['rdv_fait', 'devis_envoye', 'en_negociation', 'signe', 'perdu'];

export async function computeCompanyKeyStats(companyId: string): Promise<CompanyKeyStats> {
  const empty: CompanyKeyStats = {
    prospectsDemarches: 0,
    clientsConvertis: 0,
    tauxConversionRdv: 0,
    pipelineParEtape: [],
    campagnesMenees: 0,
    hasAnyData: false,
  };

  const { data: members } = await supabaseAdmin.from('users').select('id').eq('company_id', companyId);
  const memberIds = (members || []).map((m: any) => m.id);
  if (memberIds.length === 0) return empty;

  const [prospectsCountRes, appointmentsRes, dealsRes, clientsCountRes, campaignsCountRes] = await Promise.all([
    supabaseAdmin.from('prospects').select('id', { count: 'exact', head: true }).in('assigned_user_id', memberIds),
    // RDV obtenus (validé/terminé), purpose = 'commercial' uniquement : même
    // convention que lib/results-report.ts et lib/team-stats.ts — un RDV de
    // lancement (client déjà signé) fausserait le taux de conversion.
    supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .in('user_id', memberIds)
      .in('status', ['validé', 'terminé'])
      .eq('purpose', 'commercial'),
    supabaseAdmin.from('prospects').select('deal_stage').in('assigned_user_id', memberIds).not('deal_stage', 'is', null),
    // Client à part entière = 1ère commande confirmée, même convention que
    // /api/customers/pipeline et lib/results-report.ts (distinct de is_won).
    supabaseAdmin
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .in('assigned_user_id', memberIds)
      .not('first_order_confirmed_at', 'is', null),
    supabaseAdmin.from('prospecting_campaigns').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
  ]);

  const prospectsDemarches = prospectsCountRes.count || 0;
  if (prospectsDemarches === 0) return empty;

  const rdvObtenus = appointmentsRes.count || 0;
  const tauxConversionRdv = Math.round((rdvObtenus / prospectsDemarches) * 100);

  const stageCounts: Record<string, number> = {};
  for (const d of dealsRes.data || []) {
    if (!d.deal_stage) continue;
    stageCounts[d.deal_stage] = (stageCounts[d.deal_stage] || 0) + 1;
  }
  const pipelineParEtape = DEAL_STAGE_ORDER.filter((stage) => stageCounts[stage] > 0).map((stage) => ({
    label: DEAL_STAGE_LABELS[stage],
    count: stageCounts[stage],
  }));

  return {
    prospectsDemarches,
    clientsConvertis: clientsCountRes.count || 0,
    tauxConversionRdv,
    pipelineParEtape,
    campagnesMenees: campaignsCountRes.count || 0,
    hasAnyData: true,
  };
}
