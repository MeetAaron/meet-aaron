// app/api/auth/send-verification/route.ts
// POST -> génère un code de vérification et envoie l'email de confirmation
// d'adresse via Gmail (aaron), à la place du mailer par défaut de Supabase
// (peu fiable / limite de débit).

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendSystemEmail } from '@/lib/google';

export async function POST(request: NextRequest) {
  const { auth_user_id, email } = await request.json();

  if (!auth_user_id || !email) {
    return NextResponse.json({ error: 'auth_user_id ou email manquant' }, { status: 400 });
  }

  const token = crypto.randomBytes(32).toString('hex');

  const { data: verificationRow, error: insertError } = await supabaseAdmin
    .from('email_verifications')
    .insert({ auth_user_id, email, token })
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
      `Bienvenue sur Meet Aaron !\n\nPour confirmer votre adresse email et activer votre compte, cliquez sur ce lien :\n${verifyUrl}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet email.`
    );
  } catch (err: any) {
    // On ne bloque pas l'inscription si l'envoi échoue (ex: token Google du
    // compte système expiré/révoqué, quota Gmail) — mais on stocke désormais
    // le message d'erreur RÉEL sur la ligne (bug remonté par Alex, 30/08/2026,
    // déjà vu la veille) pour pouvoir diagnostiquer sans accès aux logs
    // serveur — voir migration_email_verification_error_log_2026-08-30.sql.
    console.error('Erreur envoi email de vérification:', err.message);
    if (verificationRow?.id) {
      await supabaseAdmin
        .from('email_verifications')
        .update({ send_error: String(err.message || err), send_error_at: new Date().toISOString() })
        .eq('id', verificationRow.id);
    }
    return NextResponse.json({ error: "Impossible d'envoyer l'email de confirmation pour le moment" }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
