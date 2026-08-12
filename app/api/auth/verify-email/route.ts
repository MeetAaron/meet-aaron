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

  const { data: verification } = await supabaseAdmin
    .from('email_verifications')
    .select('id, auth_user_id, verified')
    .eq('token', token)
    .maybeSingle();

  if (!verification) {
    return NextResponse.redirect(`${origin}/login?verified=error`);
  }

  if (!verification.verified) {
    await supabaseAdmin
      .from('email_verifications')
      .update({ verified: true, verified_at: new Date().toISOString() })
      .eq('id', verification.id);
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
