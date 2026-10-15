// app/api/auth/verify-email/route.ts
// GET -> valide le token reçu par email, marque l'adresse comme vérifiée dans
// notre table de suivi ET confirme l'email côté Supabase Auth (admin API),
// puis redirige vers la page de connexion.
//
// Avant ce correctif, cette route ne mettait à jour QUE notre table
// email_verifications — jamais le champ email_confirmed_at du compte Supabase
// Auth lui-même. Résultat : tant que le projet Supabase a "Confirm email"
// activé (réglage par défaut), signInWithPassword() échouait indéfiniment pour
// tout compte créé par email/mot de passe, quel que soit le lien cliqué — seule
// la connexion Google/Microsoft (qui ne passe pas par cette vérification)
// fonctionnait. Voir aussi app/login/page.jsx ("vous pouvez déjà vous
// connecter en attendant"), qui suppose à tort que la connexion par mot de
// passe marche avant confirmation.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const origin = request.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(`${origin}/login?verified=error`);
  }

  // Format vérifié avant d'interroger la base : les jetons font 64
  // caractères hexadécimaux (crypto.randomBytes(32)). Tout le reste est
  // écarté sans requête.
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.redirect(`${origin}/login?verified=error`);
  }

  // expires_at est lu dans un select séparé, toléré absent : si
  // migration_verif_email_expiration_2026-10-15.sql n'est pas encore
  // passée, la colonne n'existe pas et Postgrest répond 42703. Dans ce cas
  // on retombe sur l'ancien comportement plutôt que d'empêcher tout le
  // monde de confirmer son adresse.
  let res: any = await supabaseAdmin
    .from('email_verifications')
    .select('id, auth_user_id, verified, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (res.error && res.error.code === '42703') {
    res = await supabaseAdmin
      .from('email_verifications')
      .select('id, auth_user_id, verified')
      .eq('token', token)
      .maybeSingle();
  }
  const verification: any = res.data;

  if (!verification) {
    return NextResponse.redirect(`${origin}/login?verified=error`);
  }

  // USAGE UNIQUE (CASA 1.3.2). Jusqu'au 15/10/2026 cette route acceptait un
  // jeton déjà utilisé et reconfirmait le compte — un lien de confirmation
  // retrouvé dans une vieille boîte mail restait éternellement valable.
  if (verification.verified) {
    return NextResponse.redirect(`${origin}/login?verified=expired`);
  }

  // EXPIRATION (CASA 1.3.1). Le même message que pour un jeton déjà
  // utilisé : l'utilisateur n'a pas à savoir laquelle des deux raisons
  // s'applique, et dans les deux cas le geste est identique — redemander un
  // lien depuis la page de connexion.
  if (verification.expires_at && new Date(verification.expires_at) < new Date()) {
    return NextResponse.redirect(`${origin}/login?verified=expired`);
  }

  // Marquage AVANT la confirmation côté Supabase Auth, et conditionné à
  // `verified` encore faux : deux clics simultanés sur le même lien ne
  // peuvent pas passer tous les deux.
  const { data: claimed } = await supabaseAdmin
    .from('email_verifications')
    .update({ verified: true, verified_at: new Date().toISOString() })
    .eq('id', verification.id)
    .is('verified', false)
    .select('id')
    .maybeSingle();

  if (!claimed) {
    return NextResponse.redirect(`${origin}/login?verified=expired`);
  }

  // Confirme réellement l'email côté Supabase Auth — sans ça, signInWithPassword
  // reste bloqué par "Email not confirmed" indéfiniment si le réglage "Confirm
  // email" du projet est activé.
  const { error: confirmError } = await supabaseAdmin.auth.admin.updateUserById(verification.auth_user_id, {
    email_confirm: true,
  });

  if (confirmError) {
    console.error('Erreur confirmation email (Supabase Auth):', confirmError.message);
    return NextResponse.redirect(`${origin}/login?verified=error`);
  }

  return NextResponse.redirect(`${origin}/login?verified=1`);
}
