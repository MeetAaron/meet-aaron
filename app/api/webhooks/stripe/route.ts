// app/api/webhooks/stripe/route.ts
// Écoute les événements Stripe. À la confirmation d'un paiement ("checkout.session.completed"),
// crée automatiquement la société + le profil utilisateur (patron) dans Supabase.
//
// Important (bug corrigé le 2026-08-12) : cette route ignorait auparavant les
// erreurs d'insertion Supabase — si la création de la société ou de
// l'utilisateur échouait pour une raison quelconque, la route renvoyait quand
// même 200 "received" à Stripe (donc pas de nouvelle tentative de sa part), et
// la page app/onboarding/success restait bloquée sur "Ça prend un peu plus de
// temps que prévu" indéfiniment, sans aucune trace exploitable côté logs. La
// route est maintenant :
//  1. Idempotente sur DEUX clés (auth_user_id ET stripe_customer_id), pas
//     seulement auth_user_id — un même client Stripe qui redéclenche l'event
//     (retry Stripe, ou nouvelle tentative de paiement) ne crée plus de société
//     en double si la société existe déjà mais que la création de l'utilisateur
//     avait précédemment échoué.
//  2. Verbeuse sur les erreurs : toute erreur d'insertion est loguée ET fait
//     échouer la requête (statut 500) pour que Stripe retente automatiquement
//     l'envoi de l'event plutôt que de l'abandonner silencieusement.

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

    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('auth_user_id', auth_user_id)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json({ received: true, already_processed: true });
    }

    // Réutilise une société déjà créée pour ce client Stripe si une tentative
    // précédente avait échoué APRÈS la création de la société mais AVANT celle
    // de l'utilisateur (sinon : société en double à chaque relance).
    let companyId: string | null = null;
    const { data: existingCompany } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('stripe_customer_id', session.customer)
      .maybeSingle();

    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const { data: company, error: companyError } = await supabaseAdmin
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

      if (companyError || !company) {
        console.error('Erreur création société (webhook Stripe):', companyError?.message, {
          auth_user_id,
          email,
          company_name,
          stripe_customer: session.customer,
        });
        return NextResponse.json({ error: 'Erreur création société' }, { status: 500 });
      }
      companyId = company.id;
    }

    const { error: userError } = await supabaseAdmin.from('users').insert({
      auth_user_id,
      email,
      first_name: first_name || null,
      full_name,
      role: 'patron',
      company_id: companyId,
    });

    if (userError) {
      console.error('Erreur création utilisateur (webhook Stripe):', userError.message, {
        auth_user_id,
        email,
        company_id: companyId,
      });
      return NextResponse.json({ error: 'Erreur création utilisateur' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
