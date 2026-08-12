// app/api/webhooks/stripe/route.ts
// Écoute les événements Stripe. À la confirmation d'un paiement ("checkout.session.completed"),
// crée automatiquement la société + le profil utilisateur (patron) dans Supabase.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateInviteCode } from '@/lib/invite-code';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Signature manquante' }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return NextResponse.json({ error: `Signature invalide: ${err.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;
    const { auth_user_id, email, first_name, full_name, company_name, country } = session.metadata;

    // Adresse de facturation complète collectée par Stripe Checkout
    // (billing_address_collection: 'required' dans /api/checkout) — stockée
    // telle quelle pour affichage/export, Stripe restant la source de vérité
    // pour la facturation elle-même.
    const billingAddress = session.customer_details?.address || null;

    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('auth_user_id', auth_user_id)
      .maybeSingle();

    if (!existing) {
      const { data: company } = await supabaseAdmin
        .from('companies')
        .insert({
          name: company_name,
          country,
          offer: 'AP',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          invite_code: generateInviteCode(company_name),
          billing_address: billingAddress,
        })
        .select()
        .single();

      if (company) {
        await supabaseAdmin.from('users').insert({
          auth_user_id,
          email,
          first_name: first_name || null,
          full_name,
          role: 'patron',
          company_id: company.id,
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
