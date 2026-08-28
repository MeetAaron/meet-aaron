// app/api/cron/sync-external-calendar/route.ts
// Exécuté toutes les 30 minutes via Vercel Cron. Remonte, pour chaque
// commercial ayant connecté Google et/ou Microsoft, les événements déjà
// présents sur son calendrier (perso, médical, etc.) comme indisponibilité
// générique dans son agenda Aaron — voir lib/calendar-sync.ts pour le détail
// du mécanisme (libellé "Rdv géré par {prénom}" ou "Rdv médical", exclusion
// des événements déjà créés par Aaron lui-même, réconciliation des
// suppressions/déplacements).
//
// Demande Alex, 28/08/2026 : "aaron saura exactement les indisponibilités sur
// l'agenda iphone du commercial" — ce cron est ce qui rend ça vrai en continu,
// plutôt qu'un calcul à la volée à chaque fois qu'on affiche l'agenda (plus
// simple pour l'UI, et permet de détecter les conflits de créneau sans
// ré-interroger Google/Outlook à chaque clic).
//
// Best-effort par commercial : un échec (token expiré, API en erreur) ne
// bloque jamais les autres commerciaux du passage en cours.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { syncExternalCalendarForUser } from '@/lib/calendar-sync';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // Un seul SELECT distinct sur oauth_connections plutôt que de boucler sur
  // tous les users de la table (beaucoup n'ont ni Google ni Microsoft
  // connecté — inutile de les interroger).
  const { data: connections, error } = await supabaseAdmin
    .from('oauth_connections')
    .select('user_id')
    .in('provider', ['google', 'microsoft']);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((connections || []).map((c) => c.user_id)));

  const results = [];
  for (const userId of userIds) {
    try {
      results.push(await syncExternalCalendarForUser(userId));
    } catch (err: any) {
      results.push({ userId, synced: 0, removed: 0, errors: [err.message] });
    }
  }

  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);
  const withErrors = results.filter((r) => r.errors.length > 0);

  return NextResponse.json({
    usersProcessed: userIds.length,
    totalSynced,
    totalRemoved,
    errors: withErrors,
  });
}
