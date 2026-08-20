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
import { addCredits } from '@/lib/credits';

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

    // Achat de crédits ("boost") : paiement unique, pas une création de
    // société/compte — traité à part de l'onboarding ci-dessous. addCredits
    // est idempotent sur session.id (voir lib/credits.ts) : un retry Stripe
    // du même événement ne crédite pas deux fois.
    if (session.metadata?.purpose === 'credits_purchase') {
      const { company_id, amount_eur, module } = session.metadata;
      const moduleKey = module === 'ap' || module === 'as' || module === 'ac' ? module : undefined;
      const result = await addCredits(
        company_id,
        parseFloat(amount_eur),
        `Achat de ${amount_eur} crédits (Stripe)`,
        session.id,
        moduleKey
      );
      if (!result.added) {
        console.log(`Achat de crédits déjà traité pour la session Stripe ${session.id}, ignoré.`);
      }
      return NextResponse.json({ received: true });
    }

    // Réactivation d'un abonnement pour une société qui avait désactivé son
    // DERNIER module (voir app/api/subscription/modules/route.ts) : pas une
    // création de société/compte, la société existe déjà. On relie le
    // nouvel abonnement Stripe (un nouvel id, l'ancien avait été annulé) et
    // on marque le(s) module(s) demandé(s) comme actifs, en retrouvant le
    // subscription_item créé pour chacun.
    if (session.metadata?.purpose === 'reactivate_subscription') {
      const { company_id, modules } = session.metadata;
      const moduleList = (modules || '').split(',').filter(Boolean);

      try {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string, {
          expand: ['items'],
        });

        const updates: Record<string, unknown> = { stripe_subscription_id: subscription.id };
        for (const mod of moduleList) {
          const priceEnvKey = { AP: 'STRIPE_PRICE_ID_AARON_PROSPECT', AS: 'STRIPE_PRICE_ID_AARON_SALES', AC: 'STRIPE_PRICE_ID_AARON_CUSTOMER' }[mod as 'AP' | 'AS' | 'AC'];
          const priceId = priceEnvKey ? process.env[priceEnvKey] : null;
          const matchedItem = subscription.items.data.find((item: any) => item.price.id === priceId);
          updates[`offer_${mod.toLowerCase()}_active`] = true;
          if (matchedItem) {
            updates[`stripe_subscription_item_${mod.toLowerCase()}`] = matchedItem.id;
          }
        }

        const { error: reactivateError } = await supabaseAdmin.from('companies').update(updates).eq('id', company_id);
        if (reactivateError) {
          console.error('Erreur réactivation abonnement (webhook Stripe):', reactivateError.message, { company_id, modules });
          return NextResponse.json({ error: 'Erreur réactivation abonnement' }, { status: 500 });
        }
      } catch (err: any) {
        console.error('Erreur réactivation abonnement (webhook Stripe):', err.message, { company_id, modules });
        return NextResponse.json({ error: 'Erreur réactivation abonnement' }, { status: 500 });
      }

      return NextResponse.json({ received: true });
    }

    const { auth_user_id, email, first_name, full_name, company_name, country, modules } = session.metadata;
    // Modules choisis à l'inscription (voir app/api/checkout/route.ts) — repli
    // sur ['AP'] si absent (anciennes sessions Stripe créées avant cette
    // évolution, encore en cours au moment du paiement).
    const moduleList: string[] = (modules || 'AP').split(',').filter(Boolean);

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
          // Abonnement multi-module (docx item 31 + section STRIPE, étendu au
          // choix dès l'inscription le 2026-08-17) : la société démarre avec
          // les modules choisis par le patron dans l'onboarding (1, 2 ou les
          // 3), au lieu d'imposer Aaron Prospect seul comme avant — modules
          // toujours ajustables ensuite depuis Préférences & abonnement
          // (app/api/subscription/modules), voir lib/subscription.ts.
          offer_ap_active: moduleList.includes('AP'),
          offer_as_active: moduleList.includes('AS'),
          offer_ac_active: moduleList.includes('AC'),
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
      // Par défaut, un nouveau compte reçoit les notifications par email ET
      // push (RDV proposé par un client, RDV annulé, etc.) — modifiable
      // ensuite dans Préférences.
      notify_channel: 'both',
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
