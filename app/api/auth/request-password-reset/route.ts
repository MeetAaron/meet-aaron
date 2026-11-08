// app/api/auth/request-password-reset/route.ts
// POST { email } -> envoie un lien de réinitialisation du mot de passe
// (« Mot de passe oublié ? » sur /login, ajouté le 31/08/2026 : jusqu'ici un
// utilisateur ayant perdu son mot de passe n'avait aucun moyen de rentrer).
//
// Flux entièrement maison, comme la confirmation d'email (voir
// app/api/auth/send-verification et verify-email) : jeton aléatoire à usage
// unique (1 h) dans password_reset_tokens, email envoyé par Aaron
// (sendSystemEmail, pas le SMTP Supabase peu fiable), puis
// app/api/auth/reset-password change réellement le mot de passe via l'API
// admin Supabase. Aucune dépendance à la liste d'URL de redirection
// Supabase Auth.
//
// Réponse toujours 200, même si l'adresse est inconnue : ne pas révéler
// quelles adresses ont un compte (énumération).

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendSystemEmail } from '@/lib/google';
import { checkRateLimit, callerKey, emailKey, tooManyRequestsResponse } from '@/lib/rate-limit';
import { passwordResetEmail } from '@/lib/account-emails';
import { normalizeLocale } from '@/lib/locale-instruction';
import { readJsonBody } from '@/lib/http';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 heure

export async function POST(request: NextRequest) {
  const { email, locale } = await readJsonBody(request);

  // Limitation de débit (15/10/2026, audit CASA). Deux compteurs, parce
  // qu'ils arrêtent deux abus différents : par IP, quelqu'un qui balaye des
  // adresses ; par adresse, quelqu'un qui harcèle UNE personne de mails de
  // réinitialisation depuis plusieurs machines.
  //
  // La réponse reste un 429 au message générique, comme le 200 générique
  // plus bas : dire « trop de demandes POUR CETTE ADRESSE » révélerait que
  // l'adresse existe, ce que tout le reste de cette route s'applique à taire.
  const ipLimit = await checkRateLimit(callerKey(request, 'pwreset'), 5, 15 * 60 * 1000);
  if (!ipLimit.ok) return tooManyRequestsResponse(ipLimit.retryAfterSeconds);
  if (typeof email === 'string' && email.trim()) {
    const perEmail = await checkRateLimit(emailKey('pwreset', email), 3, 60 * 60 * 1000);
    if (!perEmail.ok) return tooManyRequestsResponse(perEmail.retryAfterSeconds);
  }
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return NextResponse.json({ error: 'Adresse email invalide' }, { status: 400 });
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, first_name, email, locale')
    .ilike('email', normalized)
    .not('auth_user_id', 'is', null)
    .maybeSingle();

  if (user?.auth_user_id) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    const { error } = await supabaseAdmin.from('password_reset_tokens').insert({
      auth_user_id: user.auth_user_id,
      email: user.email || normalized,
      token,
      expires_at: expiresAt,
    });
    if (error) {
      console.error('Erreur création jeton de réinitialisation:', error.message);
      return NextResponse.json({ error: "Impossible d'envoyer le lien pour le moment" }, { status: 500 });
    }

    const origin = request.nextUrl.origin;
    const link = `${origin}/login?reset=${token}`;
    // Langue : celle du compte (users.locale), sinon celle envoyée par la
    // page de connexion, sinon le français (08/11/2026).
    const lang = normalizeLocale((user as any).locale || (typeof locale === 'string' ? locale : null));
    const mail = passwordResetEmail(lang, link, user.first_name);
    try {
      await sendSystemEmail(user.email || normalized, mail.subject, mail.body, lang);
    } catch (err: any) {
      console.error('Email de réinitialisation non envoyé:', err?.message || err);
      return NextResponse.json({ error: "Impossible d'envoyer le lien pour le moment — écris-nous à aaron@meetaaron.app" }, { status: 502 });
    }
  }

  return NextResponse.json({ success: true });
}
