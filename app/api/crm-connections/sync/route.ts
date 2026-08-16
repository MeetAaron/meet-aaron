// app/api/crm-connections/sync/route.ts
// POST -> synchronise vers le CRM connecté (HubSpot, Salesforce, Pipedrive ou
// Axonaut) les prospects gagnés (deal_stage='signe' ou is_won=true) pas encore
// synchronisés (crm_synced_at IS NULL), déclenché à la demande depuis
// Connexions ("Synchroniser maintenant"). Voir lib/crm-sync.ts pour pourquoi
// ceci n'est PAS câblé à un déclencheur automatique en cron.
//
// CHANGEMENTS A FAIRE (2026-08-16) : généralisé pour supporter Salesforce et
// Pipedrive en plus de HubSpot — `provider` est maintenant passé dans le corps
// de la requête (chaque carte CRM dans Connexions connaît son propre
// provider), avec repli sur le CRM connecté de la société s'il n'est pas
// fourni, pour rester compatible avec un éventuel appel existant. Axonaut
// ajouté à la suite 15 (première société d'un chantier CRM plus large,
// architecture clé API statique plutôt qu'OAuth — voir lib/crm-sync.ts).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { syncWonProspectToCrm } from '@/lib/crm-sync';

// Plafond par appel : un déclenchement manuel reste rapide et lisible pour le
// commercial qui clique, et borne le pire cas si beaucoup de prospects
// s'étaient accumulés avant la première connexion CRM.
const MAX_PER_SYNC = 25;

const KNOWN_PROVIDERS = ['hubspot', 'salesforce', 'pipedrive', 'axonaut'];

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) return NextResponse.json({ error: 'Aucune société associée' }, { status: 400 });

  let requestedProvider: string | null = null;
  try {
    const body = await request.json();
    requestedProvider = body?.provider || null;
  } catch {
    // Corps vide accepté (appel historique sans provider) — repli ci-dessous.
  }

  let provider = requestedProvider;
  if (!provider || !KNOWN_PROVIDERS.includes(provider)) {
    const { data: connections } = await supabaseAdmin
      .from('crm_connections')
      .select('provider')
      .eq('company_id', authedUser.company_id)
      .in('provider', KNOWN_PROVIDERS);
    provider = connections?.[0]?.provider || null;
  }

  if (!provider) {
    return NextResponse.json({ error: 'Aucun CRM connecté — connectez-le d\'abord dans Connexions.' }, { status: 400 });
  }

  const { data: connection } = await supabaseAdmin
    .from('crm_connections')
    .select('id')
    .eq('company_id', authedUser.company_id)
    .eq('provider', provider)
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: 'CRM non connecté — connectez-le d\'abord dans Connexions.' }, { status: 400 });
  }

  const { data: wonProspects, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, job_title, prospect_companies(name)')
    .eq('company_id', authedUser.company_id)
    .or('deal_stage.eq.signe,is_won.eq.true')
    .is('crm_synced_at', null)
    .limit(MAX_PER_SYNC);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let synced = 0;
  const errors: string[] = [];

  for (const prospect of wonProspects || []) {
    try {
      await syncWonProspectToCrm(authedUser.company_id, provider, prospect as any);
      synced++;
    } catch (err: any) {
      console.error(`Erreur synchronisation ${provider} pour le prospect ${prospect.id}:`, err.message);
      errors.push(prospect.email);
    }
  }

  return NextResponse.json({
    synced,
    remaining_candidates: (wonProspects || []).length === MAX_PER_SYNC,
    failed: errors,
  });
}
