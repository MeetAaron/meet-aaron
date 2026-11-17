// app/api/checkout/route.ts
// POST -> crée une session de paiement Stripe (abonnement) pour une nouvelle société.
// Les infos de la société sont passées en "metadata" pour que le webhook Stripe
// puisse créer la société + le profil utilisateur une fois le paiement confirmé.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedIdentity, unauthorizedResponse } from '@/lib/auth-helpers';
import { createSignupCheckoutSession, SignupCheckoutError } from '@/lib/signup-checkout';
import { readJsonBody, serverError } from '@/lib/http';

// Le calcul de la session (prix, devise, taxes, métadonnées lues par le
// webhook) vit dans lib/signup-checkout.ts depuis le 17/11/2026, partagé avec
// le lien d'activation envoyé par email (app/api/checkout/resume).

export async function POST(request: NextRequest) {
  const { first_name, full_name, company_name, country, locale, role, billing_interval } = await readJsonBody(request);

  if (!first_name || !full_name || !company_name || !country) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }

  // auth_user_id et email proviennent du token vérifié : sinon, quelqu'un pourrait
  // payer un abonnement en indiquant l'UUID Supabase Auth d'une autre personne dans
  // les metadata, et le webhook Stripe créerait alors un compte "patron" au nom de
  // cette victime sans son consentement (même faille que /api/auth/link).
  const identity = await getAuthedIdentity(request);
  if (!identity) return unauthorizedResponse();
  const { auth_user_id, email } = identity;

  try {
    const url = await createSignupCheckoutSession({
      auth_user_id,
      email,
      first_name,
      full_name,
      company_name,
      country,
      locale,
      role,
      billing_interval,
      origin: request.nextUrl.origin,
    });
    return NextResponse.json({ url });
  } catch (err: any) {
    if (err instanceof SignupCheckoutError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Erreur création session Stripe:', { type: (err as any)?.type || null, code: (err as any)?.code || null, requestId: (err as any)?.requestId || null }); // jamais l'objet d'erreur complet (CASA 6.5.1)
    return serverError(err, '/api/checkout');
  }
}
