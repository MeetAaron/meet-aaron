// app/api/campaigns/route.ts
// POST -> le commercial crée une nouvelle campagne de prospection (zone + secteur)
// GET  -> liste les campagnes du commercial, avec leur avancement

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { selectInChunks } from '@/lib/chunked-in';
import { assertProspectQuotaAllows, ProspectQuotaExceededError } from '@/lib/prospect-quota';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { canViewUserData } from '@/lib/user-access';
import { LOCALE_NAMES } from '@/lib/locale-instruction';
import { readJsonBody, serverError } from '@/lib/http';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  // Soi-même, ou le patron de la même société (lecture seule, voir lib/user-access.ts).
  if (!(await canViewUserData(authedUser, userId))) return forbiddenResponse();

  const { data: campaigns, error } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('*')
    .eq('assigned_user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return serverError(error, '/api/campaigns');
  }

  // Petit récapitulatif par campagne (gagnés / perdus / en cours) — permet au
  // commercial de voir en un coup d'œil comment chaque campagne performe
  // quand plusieurs tournent en même temps, sans avoir à aller dans Prospects.
  const campaignIds = (campaigns || []).map((c) => c.id);
  const statsByCampaign: Record<string, { won: number; lost: number; active: number; contacted: number; replied: number }> = {};
  // prospect_id -> campagne, pour compter ensuite les contactés et les
  // répondants (refonte de la carte campagne, 03/11/2026 : « est-ce que ça
  // marche » ne se lit pas dans « 23 contacts trouvés »).
  const campaignIdByProspectId: Record<string, string> = {};

  if (campaignIds.length > 0) {
    const { data: companies } = await selectInChunks(campaignIds, (part) => supabaseAdmin
      .from('prospect_companies')
      .select('id, found_by_campaign_id')
      .in('found_by_campaign_id', part));

    const campaignIdByCompanyId: Record<string, string> = {};
    (companies || []).forEach((c) => {
      if (c.found_by_campaign_id) campaignIdByCompanyId[c.id] = c.found_by_campaign_id;
    });
    const companyIds = Object.keys(campaignIdByCompanyId);

    if (companyIds.length > 0) {
      const { data: prospects } = await selectInChunks(companyIds, (part) => supabaseAdmin
        .from('prospects')
        .select('id, prospect_company_id, is_won, is_lost')
        .in('prospect_company_id', part));

      (prospects || []).forEach((p) => {
        const campaignId = campaignIdByCompanyId[p.prospect_company_id];
        if (!campaignId) return;
        if (!statsByCampaign[campaignId]) {
          statsByCampaign[campaignId] = { won: 0, lost: 0, active: 0, contacted: 0, replied: 0 };
        }
        if (p.is_won) statsByCampaign[campaignId].won++;
        else if (p.is_lost) statsByCampaign[campaignId].lost++;
        else statsByCampaign[campaignId].active++;
        if (p.id) campaignIdByProspectId[p.id] = campaignId;
      });

      // CONTACTÉS ET RÉPONSES (03/11/2026). Un prospect compte une seule fois,
      // quel que soit le nombre d'emails échangés — sinon le « taux de
      // réponse » affiché sur la carte dépasserait 100 %, exactement le bug
      // du rapport mensuel corrigé la veille.
      //
      // Non bloquant : si cette lecture échoue, la carte affiche le reste et
      // perd seulement deux chiffres.
      try {
        const prospectIds = Object.keys(campaignIdByProspectId);
        if (prospectIds.length > 0) {
          const { data: conversations } = await selectInChunks(prospectIds, (part) => supabaseAdmin
            .from('conversations')
            .select('id, prospect_id')
            .in('prospect_id', part));
          const prospectIdByConversationId: Record<string, string> = {};
          (conversations || []).forEach((cv: any) => {
            if (cv.prospect_id) prospectIdByConversationId[cv.id] = cv.prospect_id;
          });
          const conversationIds = Object.keys(prospectIdByConversationId);
          if (conversationIds.length > 0) {
            const { data: messages } = await selectInChunks(conversationIds, (part) => supabaseAdmin
              .from('messages')
              .select('conversation_id, direction')
              .in('conversation_id', part));
            const contactedProspects = new Set<string>();
            const repliedProspects = new Set<string>();
            (messages || []).forEach((m: any) => {
              const prospectId = prospectIdByConversationId[m.conversation_id];
              if (!prospectId) return;
              if (m.direction === 'outbound') contactedProspects.add(prospectId);
              else if (m.direction === 'inbound') repliedProspects.add(prospectId);
            });
            for (const prospectId of contactedProspects) {
              const campaignId = campaignIdByProspectId[prospectId];
              if (campaignId && statsByCampaign[campaignId]) statsByCampaign[campaignId].contacted++;
            }
            for (const prospectId of repliedProspects) {
              const campaignId = campaignIdByProspectId[prospectId];
              if (campaignId && statsByCampaign[campaignId]) statsByCampaign[campaignId].replied++;
            }
          }
        }
      } catch (err: any) {
        console.error('Contactés/réponses par campagne — lecture impossible (non bloquant):', err?.message || err);
      }
    }
  }

  const campaignsWithStats = (campaigns || []).map((c) => ({
    ...c,
    stats: statsByCampaign[c.id] || { won: 0, lost: 0, active: 0, contacted: 0, replied: 0 },
  }));

  return NextResponse.json({ campaigns: campaignsWithStats });
}

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  const {
    company_id,
    assigned_user_id,
    zone_label,
    zone_type,
    zone_codes,
    sector_keywords,
    company_sizes,
    target_count,
    context_notes,
    target_role,
    target_locale,
  } = body;

  if (!company_id || !assigned_user_id || !zone_label || !zone_type || !zone_codes || !sector_keywords) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== assigned_user_id || authedUser.company_id !== company_id) return forbiddenResponse();

  // Quota de nouveaux prospects du mois (08/09/2026). On ne bloque que si
  // plus RIEN n'est disponible : une campagne dont l'objectif dépasse le
  // reste démarre quand même et se met en pause au quota (lib/sourcing.ts),
  // puis repart au mois suivant ou dès qu'un boost est acheté — c'est
  // exactement « 2 campagnes de 150, c'est pareil ».
  try {
    await assertProspectQuotaAllows(company_id, 1);
  } catch (err: any) {
    if (err instanceof ProspectQuotaExceededError) {
      return NextResponse.json(
        { error: err.message, code: 'prospect_quota_exceeded', quota: err.quota },
        { status: 409 }
      );
    }
    throw err;
  }

  const { data: campaign, error } = await supabaseAdmin
    .from('prospecting_campaigns')
    .insert({
      company_id,
      assigned_user_id,
      zone_label,
      zone_type,
      zone_codes,
      sector_keywords,
      company_sizes: Array.isArray(company_sizes) ? company_sizes : [],
      target_count: target_count || 20,
      context_notes: context_notes || null,
      target_role: target_role || null,
      // Langue cible du 1er email de prospection (avant toute réponse du
      // prospect) — voir migration_campaign_target_locale_2026-08-21.sql et
      // lib/aaron.ts. null = comportement inchangé (langue du commercial).
      target_locale: target_locale && LOCALE_NAMES[target_locale] ? target_locale : null,
      status: 'en_attente',
    })
    .select()
    .single();

  if (error) {
    return serverError(error, '/api/campaigns');
  }

  return NextResponse.json({ campaign });
}
