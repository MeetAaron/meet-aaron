// app/api/auth/send-verification/route.ts
// POST -> génère un code de vérification et envoie l'email de confirmation
// d'adresse via Gmail (aaron), à la place du mailer par défaut de Supabase
// (peu fiable / limite de débit).

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendSystemEmail } from '@/lib/google';
import { checkRateLimit, callerKey, emailKey, tooManyRequestsResponse } from '@/lib/rate-limit';
import { readJsonBody, serverError } from '@/lib/http';
import { verificationEmail } from '@/lib/account-emails';
import { normalizeLocale } from '@/lib/locale-instruction';

export async function POST(request: NextRequest) {
  // `locale` (08/11/2026) : langue de l'interface au moment de l'inscription,
  // pour l'email et le nom d'expéditeur (il n'y a pas encore de ligne users).
  const { auth_user_id, email, locale } = await readJsonBody(request);
  const lang = normalizeLocale(typeof locale === 'string' ? locale : null);

  // Limitation de débit (15/10/2026, audit CASA). Cette route était la plus
  // exposée des trois : non authentifiée, elle fait confiance à un
  // auth_user_id et à un email fournis par l'appelant, et elle ENVOIE un
  // message. Sans compteur, elle offrait à n'importe qui un moyen d'envoyer
  // du courrier depuis notre domaine vers l'adresse de son choix — donc de
  // détruire notre réputation d'expéditeur, et avec elle la délivrabilité
  // des emails de prospection de tous les clients.
  const ipLimit = await checkRateLimit(callerKey(request, 'sendverif'), 10, 15 * 60 * 1000);
  if (!ipLimit.ok) return tooManyRequestsResponse(ipLimit.retryAfterSeconds);
  if (typeof email === 'string' && email.trim()) {
    const perEmail = await checkRateLimit(emailKey('sendverif', email), 3, 60 * 60 * 1000);
    if (!perEmail.ok) return tooManyRequestsResponse(perEmail.retryAfterSeconds);
  }

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
    return serverError(insertError, '/api/auth/send-verification');
  }

  const origin = request.nextUrl.origin;
  const verifyUrl = `${origin}/api/auth/verify-email?token=${token}`;

  try {
    const mail = verificationEmail(lang, verifyUrl);
    await sendSystemEmail(email, mail.subject, mail.body, lang);
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
