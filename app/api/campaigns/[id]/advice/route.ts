// app/api/campaigns/[id]/advice/route.ts
// POST -> génère (ou régénère) l'avis d'Aaron sur UNE campagne précise
// (CHANGEMENTS A FAIRE #14 : "conseil d'Aaron" à côté de chaque campagne pour
// savoir comment resserrer le ciblage et obtenir de meilleurs résultats).
//
// Mis en cache sur prospecting_campaigns.advice (voir
// migration_campaigns_advice_2026-08-16.sql) plutôt que régénéré à chaque
// affichage de la page — un appel Claude par clic sur "Régénérer", pas par
// chargement de page.
//
// #15 (Aaron apprend des campagnes passées) : le prompt inclut, en plus des
// chiffres de CETTE campagne, un résumé des campagnes TERMINÉES précédentes
// de la même société (secteur, zone, taux de conversion en RDV/opportunités)
// — Aaron compare explicitement la campagne actuelle à ce qui a le mieux
// marché par le passé plutôt que de juger dans le vide.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { buildPastCampaignsSummary } from '@/lib/campaign-insights';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const campaignId = params.id;

  const { data: campaign, error } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (error || !campaign) {
    return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.assigned_user_id) return forbiddenResponse();

  // Stats de conversion de CETTE campagne (mêmes requêtes que GET /api/campaigns).
  const { data: companies } = await supabaseAdmin
    .from('prospect_companies')
    .select('id')
    .eq('found_by_campaign_id', campaignId);
  const companyIds = (companies || []).map((c) => c.id);

  let won = 0, lost = 0, active = 0, totalProspects = 0;
  if (companyIds.length > 0) {
    const { data: prospects } = await supabaseAdmin
      .from('prospects')
      .select('is_won, is_lost')
      .in('prospect_company_id', companyIds);
    totalProspects = (prospects || []).length;
    (prospects || []).forEach((p) => {
      if (p.is_won) won++;
      else if (p.is_lost) lost++;
      else active++;
    });
  }

  const pastSummary = await buildPastCampaignsSummary(campaign.company_id, campaignId);

  const prompt = `Tu es Aaron, copilote commercial IA. Voici les chiffres d'une campagne de prospection du commercial :
- Zone : ${campaign.zone_label}
- Secteurs visés : ${(campaign.sector_keywords || []).join(', ') || 'non précisé'}
- Tailles d'entreprise visées : ${(campaign.company_sizes || []).length ? campaign.company_sizes.join(', ') : 'toutes tailles'}
- Rôle visé chez le prospect : ${campaign.target_role || 'peu importe'}
- Statut : ${campaign.status}
- Objectif de contacts : ${campaign.target_count}, contacts trouvés : ${campaign.contacts_found}, entreprises analysées : ${campaign.companies_found}
- Sur les ${totalProspects} prospects trouvés par cette campagne : ${won} gagnés (clients), ${lost} perdus, ${active} encore actifs dans le pipeline.

${pastSummary}

Donne un avis concret en 3-4 phrases maximum sur cette campagne : comment resserrer le ciblage (secteur, zone, taille, rôle) pour obtenir de meilleurs résultats la prochaine fois, en te basant sur les campagnes passées les plus performantes ci-dessus si elles apportent une comparaison utile. Sois direct et actionnable, pas générique. Réponds uniquement avec ce texte, en français, sans préambule ni titre.`;

  let advice: string;
  try {
    const data = await callClaude(
      { model: 'claude-sonnet-4-6', max_tokens: 250, messages: [{ role: 'user', content: prompt }] },
      campaign.company_id
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    advice = textBlock?.text?.trim() || "Aaron n'a pas pu générer d'avis cette fois — réessaie dans un instant.";
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? 'Plafond de dépense API du jour atteint pour votre société — ça repart automatiquement demain.'
              : 'Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.',
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }

  const generatedAt = new Date().toISOString();
  await supabaseAdmin
    .from('prospecting_campaigns')
    .update({ advice, advice_generated_at: generatedAt })
    .eq('id', campaignId);

  return NextResponse.json({ advice, advice_generated_at: generatedAt });
}
