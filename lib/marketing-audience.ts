// lib/marketing-audience.ts
// Résout l'audience d'une campagne Aaron Marketing à partir de son filtre
// (voir migration_marketing_campaigns_2026-08-21.sql) — utilisé à la fois par
// l'aperçu d'audience (avant envoi) et par le figeage des destinataires
// (marketing_campaign_recipients). Centralisé pour que les deux ne divergent
// jamais silencieusement.

import { supabaseAdmin } from './supabase-admin';

export interface MarketingCampaignRow {
  id: string;
  company_id: string;
  created_by_user_id: string;
  audience_health_filter: string[] | null;
  audience_min_days_since_won: number | null;
}

export interface AudienceProspect {
  id: string;
  full_name: string;
  email: string;
  customer_health_label: string | null;
  customer_health_score: number | null;
  won_at: string | null;
}

// Clients gagnés (1ère commande confirmée) DU COMMERCIAL qui a créé la
// campagne — même logique de rattachement (assigned_user_id) que partout
// ailleurs dans l'app (Prospects/Opportunités/Clients) : un email de
// campagne part de la boîte mail du commercial, donc seuls SES clients à lui
// sont une audience cohérente, pas ceux d'un collègue. Qui n'ont pas
// explicitement demandé à ne plus recevoir d'emails marketing, filtrés selon
// le score de santé et l'ancienneté de gain choisis pour cette campagne.
export async function resolveAudience(campaign: MarketingCampaignRow): Promise<AudienceProspect[]> {
  let query = supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, customer_health_label, customer_health_score, won_at')
    .eq('company_id', campaign.company_id)
    .eq('assigned_user_id', campaign.created_by_user_id)
    .not('first_order_confirmed_at', 'is', null)
    .not('email', 'is', null)
    .eq('marketing_opt_out', false);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let prospects = (data || []) as AudienceProspect[];

  if (campaign.audience_health_filter && campaign.audience_health_filter.length > 0) {
    const allowed = new Set(campaign.audience_health_filter);
    prospects = prospects.filter((p) => p.customer_health_label && allowed.has(p.customer_health_label));
  }

  if (campaign.audience_min_days_since_won && campaign.audience_min_days_since_won > 0) {
    const cutoff = Date.now() - campaign.audience_min_days_since_won * 24 * 60 * 60 * 1000;
    prospects = prospects.filter((p) => p.won_at && new Date(p.won_at).getTime() <= cutoff);
  }

  return prospects;
}
