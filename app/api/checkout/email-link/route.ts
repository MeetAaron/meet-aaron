// app/api/checkout/email-link/route.ts
// POST — inscription faite DANS L'APPLICATION iPhone / Android (17/11/2026).
//
// Même formulaire que sur le site, mais au lieu d'ouvrir le paiement Stripe
// (interdit dans l'app : Apple 3.1.1, Google Payments), on envoie à la
// personne un email avec un lien d'activation. Le paiement se fait ensuite
// dans le navigateur ; au retour dans l'app, le compte est prêt (le webhook
// Stripe crée la société et le profil, comme pour une inscription web).
// Voir lib/signup-activation.ts et app/api/checkout/resume.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedIdentity, unauthorizedResponse } from '@/lib/auth-helpers';
import { readJsonBody } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendSystemEmail } from '@/lib/google';
import { activationEmail } from '@/lib/account-emails';
import { normalizeLocale } from '@/lib/locale-instruction';
import { makeActivationToken } from '@/lib/signup-activation';
import { checkRateLimit, emailKey, tooManyRequestsResponse } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const identity = await getAuthedIdentity(request);
  if (!identity) return unauthorizedResponse();
  const { auth_user_id, email } = identity;

  const { first_name, full_name, company_name, country, locale, role, billing_interval } = await readJsonBody(request);
  const clean = (v: any, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const firstName = clean(first_name, 80);
  const fullName = clean(full_name, 160);
  const companyName = clean(company_name, 160);
  const countryName = clean(country, 80);
  if (!firstName || !fullName || !companyName || !countryName) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }

  // Trois emails par heure au plus pour une même adresse.
  const limit = await checkRateLimit(emailKey('activation', email), 3, 60 * 60 * 1000);
  if (!limit.ok) return tooManyRequestsResponse(limit.retryAfterSeconds);

  // Déjà un espace : rien à activer.
  const { data: existing } = await supabaseAdmin.from('users').select('id').eq('auth_user_id', auth_user_id).maybeSingle();
  if (existing) return NextResponse.json({ already: true });

  const lang = normalizeLocale(typeof locale === 'string' ? locale : null);
  const token = makeActivationToken({
    auth_user_id,
    email,
    first_name: firstName,
    full_name: fullName,
    company_name: companyName,
    country: countryName,
    locale: lang,
    role: role === 'commercial' ? 'commercial' : 'patron',
    billing_interval: billing_interval === 'year' ? 'year' : 'month',
  });
  const link = `${request.nextUrl.origin}/api/checkout/resume?t=${encodeURIComponent(token)}`;
  const mail = activationEmail(lang, link, firstName);
  try {
    await sendSystemEmail(email, mail.subject, mail.body, lang);
  } catch (err: any) {
    console.error('Email d’activation non envoyé:', err?.message || err);
    return NextResponse.json({ error: "Impossible d'envoyer l'email pour le moment — écris-nous à aaron@meetaaron.app" }, { status: 502 });
  }
  return NextResponse.json({ sent: true, email });
}
