// app/api/auth/reset-password/route.ts
// POST { token, password } -> vérifie le jeton reçu par email
// (app/api/auth/request-password-reset) et change le mot de passe du compte
// via l'API admin Supabase. Jeton à usage unique, expiré après 1 h.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { readJsonBody } from '@/lib/http';

export async function POST(request: NextRequest) {
  const { token, password } = await readJsonBody(request);
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: 'Lien invalide' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Le mot de passe doit faire au moins 8 caractères' }, { status: 400 });
  }

  const { data: row } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('id, auth_user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Ce lien est expiré ou a déjà été utilisé — redemande un nouveau lien.' }, { status: 400 });
  }

  // Consommation ATOMIQUE du jeton avant tout changement (16/10/2026, CASA
  // 1.3.2) : deux requêtes simultanées avec le même lien ne peuvent plus
  // passer toutes les deux — seule celle qui fait passer used_at de NULL à
  // une date obtient la ligne en retour.
  const { data: claimed } = await supabaseAdmin
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .select('id')
    .maybeSingle();
  if (!claimed) {
    return NextResponse.json({ error: 'Ce lien est expiré ou a déjà été utilisé — redemande un nouveau lien.' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(row.auth_user_id, { password });
  if (error) {
    console.error('Erreur changement de mot de passe (reset):', error.message);
    return NextResponse.json({ error: 'Impossible de changer le mot de passe pour le moment' }, { status: 500 });
  }

  // Déconnexion de TOUS les appareils après le changement (16/10/2026, CASA
  // 2.2.2) : quelqu'un qui réinitialise son mot de passe le fait souvent
  // parce qu'il craint qu'un tiers ait accès au compte. Supprimer les
  // sessions Supabase Auth révoque tous les jetons de rafraîchissement ;
  // les jetons d'accès encore en circulation expirent d'eux-mêmes (1 h).
  // Fonction SQL revoke_all_sessions (migration_revocation_sessions_2026-10-16.sql),
  // exécutable par le service_role uniquement.
  const { error: revokeError } = await supabaseAdmin.rpc('revoke_all_sessions', { p_user_id: row.auth_user_id });
  if (revokeError) {
    console.error('Révocation des sessions après reset impossible:', revokeError.message);
  }

  return NextResponse.json({ success: true });
}
