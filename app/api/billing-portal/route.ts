// app/api/billing-portal/route.ts
// POST -> crée une session Stripe Billing Portal pour la société du patron
// connecté : factures téléchargeables (avec TVA/GST/sales tax si Stripe Tax
// est activé — voir app/api/checkout/route.ts), moyen de paiement, résiliation.
// Seul le patron (rôle 'patron') peut y accéder, comme pour le reste de la
// gestion de facturation (voir app/api/checkout/credits/route.ts).

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('stripe_customer_id')
    .eq('id', authedUser.company_id)
    .single();

  if (!company?.stripe_customer_id) {
    return NextResponse.json({ error: "Aucun abonnement Stripe trouvé pour cette société" }, { status: 404 });
  }

  const origin = request.nextUrl.origin;

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: company.stripe_customer_id,
      return_url: `${origin}/app/connexions?tab=subscription`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err: any) {
    console.error('Erreur création session Billing Portal Stripe:', err);
    return NextResponse.json({ error: err.message || 'Erreur Stripe inconnue' }, { status: 500 });
  }
}
