// app/api/auth/reset-password/route.ts
// POST { token, password } -> vérifie le jeton reçu par email
// (app/api/auth/request-password-reset) et change le mot de passe du compte
// via l'API admin Supabase. Jeton à usage unique, expiré après 1 h.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { readJsonBody } from '@/lib/http';
import { resetCodeToken } from '@/lib/password-reset-code';
import { checkRateLimit, callerKey, emailKey, tooManyRequestsResponse } from '@/lib/rate-limit';
import { passwordPolicyError, passwordPolicyMessage } from '@/lib/password-policy';
import { isDemoCompany, DEMO_PASSWORD_MESSAGE } from '@/lib/demo-guard';

export async function POST(request: NextRequest) {
  const { token: linkToken, email, code, password } = await readJsonBody(request);

  // Deux façons de prouver qu'on a reçu l'email (14/11/2026) : le jeton du
  // lien, ou l'adresse + le code à 6 chiffres (lib/password-reset-code.ts).
  let token: string;
  let viaCode = false;
  if (typeof linkToken === 'string' && linkToken) {
    if (!/^[a-f0-9]{64}$/.test(linkToken)) {
      return NextResponse.json({ error: 'Lien invalide' }, { status: 400 });
    }
    token = linkToken;
  } else if (typeof email === 'string' && typeof code === 'string') {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || !/^\d{6}$/.test(code.trim())) {
      return NextResponse.json({ error: 'Code invalide — vérifie les 6 chiffres reçus par email.' }, { status: 400 });
    }
    // 1 million de codes possibles : au plus 6 essais par adresse et par
    // heure (durée de vie du code), et 20 par appareil, sinon on pourrait
    // tous les essayer.
    const perEmail = await checkRateLimit(emailKey('pwreset-code', normalized), 6, 60 * 60 * 1000);
    if (!perEmail.ok) return tooManyRequestsResponse(perEmail.retryAfterSeconds);
    const perIp = await checkRateLimit(callerKey(request, 'pwreset-code'), 20, 60 * 60 * 1000);
    if (!perIp.ok) return tooManyRequestsResponse(perIp.retryAfterSeconds);
    token = resetCodeToken(normalized, code.trim());
    viaCode = true;
  } else {
    return NextResponse.json({ error: 'Lien invalide' }, { status: 400 });
  }
  const expiredMessage = viaCode
    ? 'Ce code est incorrect, expiré ou déjà utilisé — vérifie-le ou redemande un email.'
    : 'Ce lien est expiré ou a déjà été utilisé — redemande un nouveau lien.';
  // Politique de mot de passe (CASA 1.1.1) — lib/password-policy.js.
  if (passwordPolicyError(password)) {
    return NextResponse.json({ error: passwordPolicyMessage('fr') }, { status: 400 });
  }

  const { data: row } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('id, auth_user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: expiredMessage }, { status: 400 });
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
    return NextResponse.json({ error: expiredMessage }, { status: 400 });
  }

  // Second filet : jamais de nouveau mot de passe pour le compte démo, même
  // avec un lien valide (lien demandé avant le 17/11/2026, par exemple).
  const { data: owner } = await supabaseAdmin.from('users').select('company_id').eq('auth_user_id', row.auth_user_id).maybeSingle();
  if (owner && (await isDemoCompany((owner as any).company_id))) {
    return NextResponse.json({ error: DEMO_PASSWORD_MESSAGE.fr, demo: true }, { status: 403 });
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
  // Le lien et le code du même email (et toute demande plus ancienne) ne
  // servent plus : un seul changement de mot de passe par demande.
  await supabaseAdmin
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('auth_user_id', row.auth_user_id)
    .is('used_at', null);

  const { error: revokeError } = await supabaseAdmin.rpc('revoke_all_sessions', { p_user_id: row.auth_user_id });
  if (revokeError) {
    console.error('Révocation des sessions après reset impossible:', revokeError.message);
  }

  return NextResponse.json({ success: true });
}
