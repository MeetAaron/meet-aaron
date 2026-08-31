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

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 heure

export async function POST(request: NextRequest) {
  const { email } = await request.json();
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return NextResponse.json({ error: 'Adresse email invalide' }, { status: 400 });
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, first_name, email')
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
    const body =
      `Bonjour${user.first_name ? ' ' + user.first_name : ''},\n\n` +
      `Tu as demandé à réinitialiser le mot de passe de ton compte Meet Aaron. Clique sur ce lien (valable 1 heure) pour en choisir un nouveau :\n\n` +
      `${link}\n\n` +
      `Si tu n'es pas à l'origine de cette demande, ignore simplement cet email : ton mot de passe reste inchangé.\n\n` +
      `Aaron`;
    try {
      await sendSystemEmail(user.email || normalized, 'Réinitialise ton mot de passe Meet Aaron', body);
    } catch (err: any) {
      console.error('Email de réinitialisation non envoyé:', err?.message || err);
      return NextResponse.json({ error: "Impossible d'envoyer le lien pour le moment — écris-nous à aaron@meetaaron.app" }, { status: 502 });
    }
  }

  return NextResponse.json({ success: true });
}
