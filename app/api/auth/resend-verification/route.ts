// app/api/auth/resend-verification/route.ts
// POST -> renvoie l'email de confirmation d'adresse pour un compte déjà créé
// (voir app/api/auth/send-verification/route.ts, appelé une seule fois à
// l'inscription). Nécessaire depuis /app/login quand ce premier envoi a
// échoué (ex: connexion Gmail système temporairement invalide, voir
// lib/google.ts -> sendSystemEmail) et que "Confirm email" est activé côté
// projet Supabase Auth : sans lien cliqué, signInWithPassword échoue
// indéfiniment avec "Email not confirmed" (voir verify-email/route.ts) — sans
// cette route, la personne resterait bloquée sans aucun moyen de s'en sortir
// seule (bug remonté par Alex, 27/08/2026, compte de son père).

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendSystemEmail } from '@/lib/google';

export async function POST(request: NextRequest) {
  const { email } = await request.json();

  if (!email) {
    return NextResponse.json({ error: 'email manquant' }, { status: 400 });
  }

  // Retrouve le compte via email_verifications (une ligne y est créée pour
  // TOUT compte passé par l'inscription email/mot de passe, voir
  // send-verification) plutôt que via l'API admin Supabase (pas de recherche
  // par email directe côté admin.listUsers) — la plus récente pour cette
  // adresse, qu'elle soit déjà vérifiée ou non (un renvoi reste inoffensif
  // dans les deux cas, ça crée juste un nouveau lien valide).
  const { data: verification } = await supabaseAdmin
    .from('email_verifications')
    .select('auth_user_id')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Réponse volontairement identique (succès) que le compte existe ou non —
  // évite de révéler par ce biais si une adresse donnée est déjà inscrite.
  if (!verification) {
    return NextResponse.json({ success: true });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const { data: verificationRow, error: insertError } = await supabaseAdmin
    .from('email_verifications')
    .insert({ auth_user_id: verification.auth_user_id, email, token })
    .select('id')
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const verifyUrl = `${origin}/api/auth/verify-email?token=${token}`;

  try {
    await sendSystemEmail(
      email,
      'Confirmez votre adresse email — Meet Aaron',
      `Voici un nouveau lien pour confirmer votre adresse email et activer votre compte Meet Aaron :\n${verifyUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.`
    );
  } catch (err: any) {
    // Même cause possible que le premier envoi (voir sendSystemEmail) — on
    // le signale clairement plutôt que de renvoyer un faux succès, et on
    // stocke désormais le message d'erreur RÉEL (bug remonté par Alex,
    // 30/08/2026, déjà vu la veille — voir
    // migration_email_verification_error_log_2026-08-30.sql) pour
    // diagnostiquer sans accès aux logs serveur.
    console.error('Erreur renvoi email de vérification:', err.message);
    if (verificationRow?.id) {
      await supabaseAdmin
        .from('email_verifications')
        .update({ send_error: String(err.message || err), send_error_at: new Date().toISOString() })
        .eq('id', verificationRow.id);
    }
    return NextResponse.json(
      { error: "Impossible d'envoyer l'email pour le moment — réessaie dans quelques minutes." },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
