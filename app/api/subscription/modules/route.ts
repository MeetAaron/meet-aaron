// app/api/subscription/modules/route.ts
// POST -> active ou désactive un module d'abonnement (Aaron Prospect/AP,
// Aaron Opportunités/AS, Aaron Clients/AC) pour la société du patron connecté
// (docx item 31 + section STRIPE : "s'abonner à 1, 2 ou aux 3 abonnements
// aaron"). Réservé au patron, comme le reste de la gestion de facturation
// (voir app/api/checkout/credits/route.ts, app/api/billing-portal/route.ts).
//
// Les 3 modules sont des "subscription items" Stripe séparés sur UN SEUL
// abonnement (une facture, plusieurs lignes) plutôt que 3 abonnements
// distincts — voir lib/subscription.ts.
//
// Cas particuliers :
// - Désactiver le DERNIER module actif annule l'abonnement Stripe entier
//   (Stripe n'autorise pas un abonnement à 0 ligne). Le compte devient alors
//   totalement inactif — voir app/api/auth/link/route.ts pour le blocage à
//   la reconnexion tant qu'aucun module n'est réactivé, avec le message
//   "veuillez vous réabonner" demandé par le docx.
// - Activer un module alors qu'AUCUN abonnement Stripe n'existe (cas du
//   compte totalement désabonné ci-dessus) ne peut pas se faire par un
//   simple appel API : Stripe ne permet pas d'ajouter une ligne à un
//   abonnement annulé. Il faut repasser par une session Stripe Checkout
//   (comme à l'inscription initiale) ; cette route renvoie alors
//   { checkout_url } au lieu de { success: true }, et le frontend redirige
//   dessus. Le webhook (purpose: 'reactivate_subscription') termine le
//   travail une fois le paiement confirmé.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import {
  MODULE_CODES,
  ModuleCode,
  activeColumn,
  itemColumn,
  getModulePriceId,
  activeModuleCount,
  isModuleActive,
  resolveSubscriptionItemId,
} from '@/lib/subscription';
import { readJsonBody, serverError } from '@/lib/http';
import { scheduleCancellation, resumeSubscription } from '@/lib/subscription-cancel';

const MODULE_LABELS: Record<ModuleCode, string> = {
  AP: 'Aaron Prospect',
  AS: 'Aaron Opportunités',
  AC: 'Aaron Clients',
};

export async function POST(request: NextRequest) {
  const { module, action } = await readJsonBody(request);

  // « Se désabonner » en un geste (18/11/2026), y compris depuis l'app :
  // résiliation de tout l'abonnement en fin de période, sans viser un module.
  if (action === 'cancel') {
    const authed = await getAuthedUser(request);
    if (!authed) return unauthorizedResponse();
    if (authed.role !== 'patron') return forbiddenResponse();
    if (!authed.company_id) {
      return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
    }
    const { data: co } = await supabaseAdmin
      .from('companies')
      .select('stripe_subscription_id')
      .eq('id', authed.company_id)
      .maybeSingle();
    if (!co?.stripe_subscription_id) {
      return NextResponse.json({ error: 'Aucun abonnement Stripe actif pour cette société' }, { status: 400 });
    }
    try {
      const state = await scheduleCancellation(co.stripe_subscription_id);
      return NextResponse.json({ success: true, scheduled: true, cancel_at: state.cancelAt });
    } catch (err: any) {
      return serverError(err, '/api/subscription/modules');
    }
  }

  if (!MODULE_CODES.includes(module)) {
    return NextResponse.json({ error: 'Module invalide' }, { status: 400 });
  }
  if (action !== 'activate' && action !== 'deactivate' && action !== 'resume') {
    return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select(
      'id, stripe_customer_id, stripe_subscription_id, offer_ap_active, offer_as_active, offer_ac_active, stripe_subscription_item_ap, stripe_subscription_item_as, stripe_subscription_item_ac'
    )
    .eq('id', authedUser.company_id)
    .single();

  if (companyError || !company) {
    return NextResponse.json({ error: 'Société introuvable' }, { status: 404 });
  }

  // Annuler une résiliation programmée (18/11/2026).
  if (action === 'resume') {
    if (!company.stripe_subscription_id) {
      return NextResponse.json({ error: 'Aucun abonnement Stripe actif pour cette société' }, { status: 400 });
    }
    try {
      const state = await resumeSubscription(company.stripe_subscription_id);
      return NextResponse.json({ success: true, cancel_at: state.cancelAt });
    } catch (err: any) {
      return serverError(err, '/api/subscription/modules');
    }
  }

  if (action === 'deactivate') {
    if (!isModuleActive(company as any, module)) {
      return NextResponse.json({ error: 'Ce module est déjà inactif' }, { status: 400 });
    }
    if (!company.stripe_subscription_id) {
      return NextResponse.json({ error: 'Aucun abonnement Stripe actif pour cette société' }, { status: 400 });
    }

    const remaining = activeModuleCount(company as any);

    try {
      if (remaining <= 1) {
        // Dernier module actif -> résiliation EN FIN DE PÉRIODE (18/11/2026).
        // Avant, l'abonnement était annulé sur-le-champ et l'accès coupé le
        // jour même, même avec un code gratuit encore valable des semaines.
        // Désormais tout reste actif jusqu'à la date renvoyée ; c'est le
        // webhook customer.subscription.deleted qui désactive les modules ce
        // jour-là. Rien n'est prélevé après.
        const state = await scheduleCancellation(company.stripe_subscription_id);
        return NextResponse.json({ success: true, scheduled: true, cancel_at: state.cancelAt });
      } else {
        const itemId = await resolveSubscriptionItemId(company as any, module as ModuleCode);
        if (!itemId) {
          return NextResponse.json(
            { error: "Impossible de retrouver la ligne d'abonnement Stripe pour ce module — contactez le support." },
            { status: 500 }
          );
        }
        await stripe.subscriptionItems.del(itemId);
        const { error: updateError } = await supabaseAdmin
          .from('companies')
          .update({ [activeColumn(module as ModuleCode)]: false, [itemColumn(module as ModuleCode)]: null })
          .eq('id', company.id);
        // Même correctif que ci-dessus (2026-08-23).
        if (updateError) {
          console.error(`Désactivation module ${module} : ligne Stripe supprimée mais mise à jour Supabase échouée`, updateError.message, { company_id: company.id });
          return NextResponse.json(
            { error: "La ligne d'abonnement Stripe a bien été retirée mais la mise à jour n'a pas pu être enregistrée — contactez le support." },
            { status: 500 }
          );
        }
      }
    } catch (err: any) {
      console.error(`Erreur désactivation module ${module} (Stripe):`, err.message);
      return serverError(err, '/api/subscription/modules');
    }

    return NextResponse.json({ success: true });
  }

  // action === 'activate'
  if (isModuleActive(company as any, module)) {
    return NextResponse.json({ error: 'Ce module est déjà actif' }, { status: 400 });
  }

  const priceId = getModulePriceId(module as ModuleCode);
  if (!priceId) {
    return NextResponse.json(
      { error: `Module ${MODULE_LABELS[module as ModuleCode]} pas encore configuré côté serveur (Price ID Stripe manquant) — voir lib/subscription.ts.` },
      { status: 501 }
    );
  }

  try {
    if (company.stripe_subscription_id) {
      // Abonnement déjà actif (au moins un autre module) -> on ajoute une
      // ligne à l'abonnement existant. Pas de paiement à confirmer
      // séparément : Stripe facture le prorata automatiquement sur la
      // prochaine facture.
      const item = await stripe.subscriptionItems.create({
        subscription: company.stripe_subscription_id,
        price: priceId,
      });
      const { error: updateError } = await supabaseAdmin
        .from('companies')
        .update({ [activeColumn(module as ModuleCode)]: true, [itemColumn(module as ModuleCode)]: item.id })
        .eq('id', company.id);
      // Bug corrigé le 2026-08-23 (signalé par Alex : compte réellement
      // abonné aux 3 modules côté Stripe, mais cadenas toujours affichés) —
      // c'est très probablement CE bug : cette mise à jour Supabase
      // n'était jamais vérifiée, donc si elle échouait silencieusement
      // (RLS, réseau, contrainte...), la route répondait quand même
      // { success: true } — Stripe facture le module, mais
      // offer_xx_active ne passe jamais à true en base, et le cadenas ne
      // disparaît plus jamais tant que personne ne le corrige à la main.
      if (updateError) {
        console.error(`Activation module ${module} : ligne Stripe créée (${item.id}) mais mise à jour Supabase échouée`, updateError.message, { company_id: company.id });
        return NextResponse.json(
          {
            error:
              "Le module a bien été ajouté à votre abonnement Stripe (vous serez facturé au prorata), mais l'activation n'a pas pu être enregistrée côté application — contactez le support avant de réessayer, pour éviter de payer deux fois la même ligne.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true });
    }

    // Aucun abonnement actif (société totalement désabonnée, voir cas
    // "dernier module désactivé" plus haut) -> impossible d'ajouter une
    // ligne à un abonnement qui n'existe plus, il faut une nouvelle session
    // Checkout.
    if (!company.stripe_customer_id) {
      return NextResponse.json({ error: 'Aucun client Stripe associé à cette société — contactez le support.' }, { status: 400 });
    }

    const origin = request.nextUrl.origin;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: company.stripe_customer_id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}/app/connexions?user_id=${authedUser.id}&tab=subscription&subscription_reactivated=1`,
      cancel_url: `${origin}/app/connexions?user_id=${authedUser.id}&tab=subscription`,
      metadata: {
        purpose: 'reactivate_subscription',
        company_id: company.id,
        modules: module,
      },
    });

    return NextResponse.json({ checkout_url: session.url });
  } catch (err: any) {
    console.error(`Erreur activation module ${module} (Stripe):`, err.message);
    return serverError(err, '/api/subscription/modules');
  }
}
