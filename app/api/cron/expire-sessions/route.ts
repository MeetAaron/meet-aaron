// app/api/cron/expire-sessions/route.ts
// Toutes les heures (vercel.json) : expiration côté serveur des sessions
// Supabase Auth — plus de 30 jours, ou 7 jours sans rafraîchissement — et,
// avec elles, de leurs jetons de rafraîchissement (CASA 2.2.1). Voir
// migration_expiration_sessions_2026-10-19.sql (fonction
// expire_stale_sessions, service_role uniquement).
//
// Pourquoi ici et pas dans Supabase : les réglages « Time-box user
// sessions » / « Inactivity timeout » n'existent que sur l'offre Pro. La
// politique est la même, appliquée par nous.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const SESSION_MAX_AGE_DAYS = 30;
const SESSION_INACTIVE_DAYS = 7;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin.rpc('expire_stale_sessions', {
    p_max_age_days: SESSION_MAX_AGE_DAYS,
    p_inactive_days: SESSION_INACTIVE_DAYS,
  });
  if (error) {
    // Fonction absente (migration pas jouée) : on le dit sans détail interne.
    console.error('[expire-sessions]', error.message);
    return NextResponse.json({ error: 'expire_stale_sessions indisponible' }, { status: 500 });
  }
  const { data: stats } = await supabaseAdmin.rpc('session_stats');
  const row = Array.isArray(stats) ? stats[0] : stats;
  return NextResponse.json({
    expired: data ?? 0,
    policy: { max_age_days: SESSION_MAX_AGE_DAYS, inactive_days: SESSION_INACTIVE_DAYS },
    active_sessions: row?.active_sessions ?? null,
    oldest_session: row?.oldest_session ?? null,
  });
}
