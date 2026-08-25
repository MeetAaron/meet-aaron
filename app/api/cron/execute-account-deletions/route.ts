// app/api/cron/execute-account-deletions/route.ts
// Exécute réellement les suppressions de compte "Supprimer mon compte"
// (app/api/account/deletion) dont le délai de 24h est écoulé — voir
// vercel.json (toutes les 15 minutes) et lib/account-deletion.ts pour la
// logique de suppression elle-même (solo -> société entière + résiliation
// Stripe, équipe -> juste le profil personnel).
//
// GET plutôt que POST : convention Vercel Cron (appelle toujours en GET).

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { executeAccountDeletion } from '@/lib/account-deletion';

export async function GET() {
  const now = new Date().toISOString();

  const { data: dueUsers, error } = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, company_id')
    .not('deletion_scheduled_for', 'is', null)
    .lte('deletion_scheduled_for', now);

  if (error) {
    console.error('[execute-account-deletions] Erreur requête users:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let succeeded = 0;
  let failed = 0;

  for (const user of dueUsers || []) {
    try {
      await executeAccountDeletion(user as any);
      succeeded += 1;
    } catch (err: any) {
      // Une suppression en échec ne doit jamais bloquer les autres — on
      // continue la boucle et on log pour investigation manuelle. La ligne
      // "users" concernée garde deletion_scheduled_for dans le passé, donc
      // le prochain passage du cron retentera automatiquement.
      failed += 1;
      console.error('[execute-account-deletions] Échec suppression (user_id=' + user.id + '):', err.message);
    }
  }

  return NextResponse.json({ processed: (dueUsers || []).length, succeeded, failed });
}
