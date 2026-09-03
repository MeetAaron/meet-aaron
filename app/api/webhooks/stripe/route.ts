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
import { boostEndsAt } from '@/lib/credit-boosts';
import { getSubscriptionState, setSubscriptionState, graceEndFrom } from '@/lib/subscription-status';
import { convertMatchingProspectsToClients } from '@/lib/prospect-conversion';

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

    // Pays de facturation : Stripe le collecte au Checkout
    // (billing_address_collection: 'required'). On le mémorise sur la société
    // pour pouvoir facturer les achats suivants dans SA devise — demande
    // d'Alex du 04/09/2026. Voir migration_billing_country_2026-09-04.sql.
    // Best-effort : une colonne absente ou une écriture ratée ne doit jamais
    // faire échouer un paiement déjà encaissé.
    const billingCountry = session.customer_details?.address?.country || null;
    const companyIdForCountry = session.metadata?.company_id || null;
    if (billingCountry && companyIdForCountry) {
      try {
        await supabaseAdmin
          .from('companies')
          .update({ billing_country: billingCountry })
          .eq('id', companyIdForCountry);
      } catch (err) {
        console.error('Enregistrement du pays de facturation impossible (non bloquant):', err);
      }
    }

    // ACHAT DE BOOST — BUG CORRIGÉ LE 04/09/2026, ET IL ÉTAIT GRAVE.
    //
    // La route /api/credits/boost créait bien la session Stripe et encaissait
    // le paiement, mais AUCUN code n'insérait jamais de ligne dans
    // credit_boosts. Le client payait donc son boost… et ne recevait
    // strictement rien : listActiveBoosts renvoyait toujours une liste vide,
    // le plafond n'était jamais relevé, et le solde affiché ne bougeait pas.
    // Le webhook importait même `boostEndsAt` sans jamais s'en servir — le
    // traitement avait été oublié en cours de route.
    //
    // Idempotent sur l'identifiant de paiement Stripe : Stripe rejoue ses
    // événements, et un boost crédité deux fois pour un seul paiement serait
    // aussi grave que l'inverse.
    if (session.metadata?.purpose === 'boost_purchase') {
      const { company_id, user_id, tier, credits, cap_usd } = session.metadata;
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || session.id;

      if (!company_id || !tier) {
        console.error('Boost payé mais metadata incomplètes:', session.metadata);
        return NextResponse.json({ error: 'Metadata de boost incomplètes' }, { status: 500 });
      }

      const { data: already } = await supabaseAdmin
        .from('credit_boosts')
        .select('id')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .maybeSingle();

      if (!already) {
        const startsAt = new Date();
        const { error: boostError } = await supabaseAdmin.from('credit_boosts').insert({
          company_id,
          purchased_by: user_id || null,
          tier,
          credits: Number(credits) || 0,
          cap_usd: Number(cap_usd) || 0,
          // La colonne s'appelle price_eur pour raisons historiques ; elle
          // porte désormais le montant dans la devise réellement facturée
          // (metadata.currency dit laquelle).
          price_eur: Number(session.metadata?.price ?? session.metadata?.price_eur ?? 0),
          starts_at: startsAt.toISOString(),
          ends_at: boostEndsAt(startsAt).toISOString(),
          stripe_payment_intent_id: paymentIntentId,
        });
        if (boostError) {
          // On renvoie 500 pour que Stripe retente : un paiement encaissé sans
          // crédits livrés doit être rattrapé, pas ignoré en silence.
          console.error('Boost payé mais non enregistré:', boostError.message, session.metadata);
          return NextResponse.json({ error: 'Enregistrement du boost impossible' }, { status: 500 });
        }
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

    const { auth_user_id, email, first_name, full_name, company_name, country, modules, role } = session.metadata;
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
          // Abonnement unique Aaron (décision Alex, 31/08/2026) : un seul
          // abonnement à 30 € qui inclut tout — les 3 drapeaux passent à
          // true quelle que soit la liste de modules reçue (anciennes
          // sessions Checkout comprises). Les colonnes offer_*_active
          // restent en base pour ne rien casser en aval, voir
          // migration_single_plan_2026-08-31.sql pour les sociétés existantes.
          offer_ap_active: true,
          offer_as_active: true,
          offer_ac_active: true,
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
      // Lu depuis les metadata Stripe (voir app/api/checkout/route.ts) —
      // 'commercial' pour un commercial solo qui paie lui-même son propre
      // espace (pas de code d'activation entreprise), 'patron' sinon.
      // Repli sur 'patron' si absent (anciennes sessions Stripe créées avant
      // cette évolution du 25/08, encore en cours au moment du paiement).
      role: role === 'commercial' ? 'commercial' : 'patron',
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

    // Cas "dogfooding" (voir lib/prospect-conversion.ts) : ce nouvel inscrit
    // meetaaron.app est peut-être lui-même un prospect démarché par Aaron
    // Prospect (ex: Alex vend meetaaron.app à ses propres prospects). Fire-and
    // -forget, ne doit jamais retarder ni faire échouer la réponse au webhook
    // Stripe — la création du compte ci-dessus est l'action critique.
    if (email) {
      convertMatchingProspectsToClients(email).catch((err: any) => {
        console.error('Erreur convertMatchingProspectsToClients (webhook Stripe):', err.message);
      });
    }
  }

  // ── Paiements récurrents (question Alex, 01/09/2026 : « et si le paiement
  // est refusé ? »). Avant, ces événements n'étaient pas traités du tout : un
  // client dont la carte expirait gardait un accès complet indéfiniment, sans
  // que personne — lui compris — ne soit prévenu. Voir
  // migration_subscription_dunning_2026-09-01.sql et lib/subscription-status.ts.

  // Prélèvement refusé : on ne coupe RIEN tout de suite. Une période de grâce
  // de 7 jours démarre, pendant laquelle Stripe relance automatiquement la
  // carte et le client voit un bandeau l'invitant à la mettre à jour.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as any;
    const companyId = await companyIdFromStripeCustomer(invoice.customer);
    if (companyId) {
      const state = await getSubscriptionState(companyId);
      // Si la grâce court déjà (2e, 3e relance échouée), on NE la redémarre
      // pas : sinon un client en échec permanent aurait une grâce infinie.
      const startedAt = state.pastDueSince ? new Date(state.pastDueSince) : new Date();
      await setSubscriptionState(companyId, {
        status: 'past_due',
        pastDueSince: startedAt.toISOString(),
        graceEndsAt: graceEndFrom(startedAt).toISOString(),
        failureReason: invoice.last_finalization_error?.message || 'Le paiement a été refusé.',
      });
    }
    return NextResponse.json({ received: true });
  }

  // Paiement passé (relance automatique réussie, ou nouvelle carte saisie) :
  // retour à la normale, sans aucune action du client.
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as any;
    const companyId = await companyIdFromStripeCustomer(invoice.customer);
    if (companyId) {
      await setSubscriptionState(companyId, {
        status: 'active',
        pastDueSince: null,
        graceEndsAt: null,
        failureReason: null,
      });
    }
    return NextResponse.json({ received: true });
  }

  // Abonnement annulé côté Stripe (par le client via le portail, ou après
  // épuisement des relances).
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as any;
    const companyId = await companyIdFromStripeCustomer(subscription.customer);
    if (companyId) {
      await setSubscriptionState(companyId, { status: 'canceled' });
    }
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}

// Retrouve la société à partir de l'identifiant client Stripe présent dans
// l'événement. Renvoie null si aucune correspondance (client Stripe créé
// hors application, société supprimée...) — dans ce cas on ignore
// l'événement plutôt que de faire échouer le webhook.
async function companyIdFromStripeCustomer(customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await supabaseAdmin
    .from('companies')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return (data as any)?.id || null;
}
