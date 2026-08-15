// app/api/crm-connections/sync/route.ts
// POST -> synchronise vers HubSpot les prospects gagnés (deal_stage='signe' ou
// is_won=true) pas encore synchronisés (crm_synced_at IS NULL), déclenché à la
// demande depuis Préférences ("Synchroniser maintenant"). Voir lib/crm-sync.ts
// pour pourquoi ceci n'est PAS câblé à un déclencheur automatique en cron.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { syncWonProspectToHubspot } from '@/lib/crm-sync';

// Plafond par appel : un déclenchement manuel reste rapide et lisible pour le
// commercial qui clique, et borne le pire cas si beaucoup de prospects
// s'étaient accumulés avant la première connexion HubSpot.
const MAX_PER_SYNC = 25;

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) return NextResponse.json({ error: 'Aucune société associée' }, { status: 400 });

  const { data: connection } = await supabaseAdmin
    .from('crm_connections')
    .select('id')
    .eq('company_id', authedUser.company_id)
    .eq('provider', 'hubspot')
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: 'HubSpot non connecté — connectez-le d\'abord dans Préférences.' }, { status: 400 });
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
      await syncWonProspectToHubspot(authedUser.company_id, prospect as any);
      synced++;
    } catch (err: any) {
      console.error(`Erreur synchronisation HubSpot pour le prospect ${prospect.id}:`, err.message);
      errors.push(prospect.email);
    }
  }

  return NextResponse.json({
    synced,
    remaining_candidates: (wonProspects || []).length === MAX_PER_SYNC,
    failed: errors,
  });
}
