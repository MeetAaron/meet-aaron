// lib/campaign-insights.ts
// CHANGEMENTS A FAIRE #15 : "Aaron doit pouvoir apprendre des campagnes
// terminées et en cours afin d'obtenir de meilleurs résultats futurs."
//
// Construit un résumé texte des campagnes TERMINÉES d'une société, avec leur
// taux de conversion (RDV obtenus / opportunités / clients gagnés par rapport
// aux contacts trouvés), trié des mieux performantes aux moins bonnes. Ce
// résumé est injecté dans les prompts Claude qui donnent un avis sur une
// campagne (app/api/campaigns/[id]/advice, app/api/campaigns/advice-global)
// et dans le prompt de création de campagne par chat
// (app/api/campaigns/chat) — pour qu'Aaron compare toujours ses
// recommandations à ce qui a réellement marché par le passé plutôt que de
// juger dans le vide à chaque fois.

import { supabaseAdmin } from './supabase-admin';

export interface PastCampaignStat {
  zone_label: string;
  sector_keywords: string[];
  contacts_found: number;
  won: number;
  active: number;
  lost: number;
  conversionRate: number; // gagnés / contacts trouvés
}

export async function getPastCampaignStats(companyId: string, excludeCampaignId?: string): Promise<PastCampaignStat[]> {
  let query = supabaseAdmin
    .from('prospecting_campaigns')
    .select('id, zone_label, sector_keywords, contacts_found')
    .eq('company_id', companyId)
    .eq('status', 'terminee');

  if (excludeCampaignId) query = query.neq('id', excludeCampaignId);

  const { data: campaigns } = await query;
  if (!campaigns || campaigns.length === 0) return [];

  const campaignIds = campaigns.map((c) => c.id);

  const { data: companies } = await supabaseAdmin
    .from('prospect_companies')
    .select('id, found_by_campaign_id')
    .in('found_by_campaign_id', campaignIds);

  const companyIdsByCampaign: Record<string, string[]> = {};
  (companies || []).forEach((c) => {
    if (!c.found_by_campaign_id) return;
    (companyIdsByCampaign[c.found_by_campaign_id] ||= []).push(c.id);
  });

  const allCompanyIds = (companies || []).map((c) => c.id);
  let prospectsByCompany: Record<string, { is_won: boolean; is_lost: boolean }[]> = {};
  if (allCompanyIds.length > 0) {
    const { data: prospects } = await supabaseAdmin
      .from('prospects')
      .select('prospect_company_id, is_won, is_lost')
      .in('prospect_company_id', allCompanyIds);
    (prospects || []).forEach((p) => {
      (prospectsByCompany[p.prospect_company_id] ||= []).push(p);
    });
  }

  return campaigns.map((c) => {
    const companyIds = companyIdsByCampaign[c.id] || [];
    let won = 0, lost = 0, active = 0;
    for (const cid of companyIds) {
      for (const p of prospectsByCompany[cid] || []) {
        if (p.is_won) won++;
        else if (p.is_lost) lost++;
        else active++;
      }
    }
    return {
      zone_label: c.zone_label,
      sector_keywords: c.sector_keywords || [],
      contacts_found: c.contacts_found || 0,
      won,
      active,
      lost,
      conversionRate: c.contacts_found > 0 ? won / c.contacts_found : 0,
    };
  });
}

// Formate un résumé texte prêt à insérer dans un prompt — vide si aucune
// campagne terminée n'existe encore (cas fréquent pour une jeune société).
export async function buildPastCampaignsSummary(companyId: string, excludeCampaignId?: string): Promise<string> {
  const stats = await getPastCampaignStats(companyId, excludeCampaignId);
  if (stats.length === 0) {
    return "Aucune campagne terminée dans l'historique de cette société pour l'instant — pas de comparaison possible, base-toi uniquement sur les chiffres ci-dessus.";
  }

  const sorted = [...stats].sort((a, b) => b.conversionRate - a.conversionRate).slice(0, 5);
  const lines = sorted.map(
    (s) =>
      `- "${s.zone_label}" (${s.sector_keywords.join(', ') || 'secteur non précisé'}) : ${s.contacts_found} contacts trouvés, ${s.won} gagnés, ${s.lost} perdus, ${s.active} encore actifs — taux de conversion ${(s.conversionRate * 100).toFixed(0)}%.`
  );
  return `Historique des campagnes terminées de cette société, de la mieux au moins bien convertie :\n${lines.join('\n')}`;
}
