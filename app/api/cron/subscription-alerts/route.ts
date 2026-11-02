// app/api/cron/subscription-alerts/route.ts
//
// PRÉVENIR LE CLIENT AVANT DE LUI COUPER QUOI QUE CE SOIT (Alex, 02/11/2026).
//
// Deux questions d'Alex, et le même trou dans les deux :
//
//   « quand un client ne paye pas il est coupé des services ? »
//        → oui : 7 jours de grâce (lib/subscription-status.ts), puis l'IA
//          s'arrête. Mais personne ne le prévenait HORS de l'application.
//          Le bandeau existait bien dans l'onglet Abonnement — il fallait
//          donc aller le lire pour apprendre qu'on allait être coupé.
//
//   « pour le coupon il faut prévenir quelques jours avant en disant que le
//     compte sera débité automatiquement »
//        → la carte est enregistrée dès l'inscription, même avec un code
//          promo à 100 % (Stripe Checkout en mode abonnement l'exige), donc
//          le prélèvement reprend tout seul à la fin de la remise. Mais là
//          non plus rien ne l'annonçait : le client voyait 0 € pendant trois
//          mois puis 30 €. C'est le genre de surprise qui produit un litige
//          bancaire, pas un client.
//
// Une fois par jour :
//   1. sociétés en impayé → email au patron à J0, J+3 et J+6 de la grâce,
//      avec ce qui s'arrête et quand ;
//   2. sociétés dont la remise Stripe se termine dans ≤ 5 jours → email
//      annonçant la date, le montant et le fait que la carte déjà
//      enregistrée sera débitée.
//
// Par EMAIL seulement, pas de notification push : règle d'Alex du 01/11/2026,
// « chaque notification push provient d'actions requises » — et la
// facturation n'est pas une action requise au sens des stories.
//
// Chaque alerte part UNE SEULE FOIS (colonnes de marquage, voir
// migration_alertes_abonnement_2026-11-02.sql). Une société billing_exempt
// (compte interne) est ignorée : getSubscriptionState la dit toujours à jour.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { stripe } from '@/lib/stripe';
import { sendSystemEmail } from '@/lib/google';
import { GRACE_PERIOD_DAYS } from '@/lib/subscription-status';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

// Paliers de relance, en jours écoulés depuis le premier refus.
const DUNNING_STAGES: { stage: number; afterDays: number }[] = [
  { stage: 1, afterDays: 0 },
  { stage: 2, afterDays: 3 },
  { stage: 3, afterDays: 6 },
];

// On prévient de la fin d'une remise cinq jours avant : assez tôt pour
// résilier sans être débité, assez tard pour que l'information soit utile.
const DISCOUNT_WARNING_DAYS = 5;

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

function days(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

function formatDate(d: Date, locale: string): string {
  try {
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function formatAmount(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

// Le patron de la société : c'est lui qui a la carte, pas les commerciaux.
async function findPatron(companyId: string): Promise<{ id: string; email: string; locale: string } | null> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, email, role, locale, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  const rows = (data as any[]) || [];
  const patron = rows.find((u) => u.role === 'patron') || rows[0];
  if (!patron?.email) return null;
  return { id: patron.id, email: patron.email, locale: patron.locale || 'fr' };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const now = new Date();
  let dunningSent = 0;
  let discountSent = 0;
  const problems: string[] = [];

  try {
    // ─────────────────────────────────────────────────────────────────────
    // 1. IMPAYÉS
    // ─────────────────────────────────────────────────────────────────────
    const { data: unpaid } = await supabaseAdmin
      .from('companies')
      .select('id, name, billing_exempt, subscription_status, subscription_past_due_since, subscription_grace_ends_at, subscription_last_failure_reason, dunning_alert_stage')
      .in('subscription_status', ['past_due', 'unpaid']);

    for (const c of ((unpaid as any[]) || [])) {
      if (c.billing_exempt === true) continue;
      const since = c.subscription_past_due_since ? new Date(c.subscription_past_due_since) : null;
      if (!since) continue;
      const elapsed = days(now.getTime() - since.getTime());

      // Palier le plus avancé atteint, et pas encore envoyé.
      let target: number | null = null;
      for (const s of DUNNING_STAGES) {
        if (elapsed >= s.afterDays) target = s.stage;
      }
      if (target === null) continue;
      if ((c.dunning_alert_stage || 0) >= target) continue;

      const patron = await findPatron(c.id);
      if (!patron) continue;

      const graceEnds = c.subscription_grace_ends_at ? new Date(c.subscription_grace_ends_at) : null;
      const daysLeft = graceEnds ? Math.max(0, days(graceEnds.getTime() - now.getTime())) : null;
      const suspended = c.subscription_status === 'unpaid' || daysLeft === 0;

      const subject = suspended
        ? "Meet Aaron — Aaron est en pause, votre paiement n'est pas passé"
        : "Meet Aaron — votre paiement n'est pas passé";

      const lines = suspended
        ? [
            'Bonjour,',
            '',
            'Le prélèvement de votre abonnement Meet Aaron a été refusé, et le délai de ' +
              `${GRACE_PERIOD_DAYS} jours est écoulé : Aaron ne prospecte plus et ne répond plus ` +
              'automatiquement pour vous.',
            '',
            "Rien n'est perdu : vos contacts, vos rendez-vous et vos échanges sont intacts, et vous " +
              "gardez l'accès à l'application. Dès qu'un paiement passe, Aaron reprend exactement " +
              "où il s'était arrêté.",
            '',
            "Pour mettre votre carte à jour : ouvrez l'application, Préférences puis Abonnement.",
          ]
        : [
            'Bonjour,',
            '',
            'Le prélèvement de votre abonnement Meet Aaron a été refusé' +
              (c.subscription_last_failure_reason ? ` (${c.subscription_last_failure_reason})` : '') + '.',
            '',
            'Votre banque et nous allons réessayer automatiquement dans les jours qui viennent : ' +
              "il n'y a peut-être rien à faire de votre côté.",
            '',
            daysLeft !== null && graceEnds
              ? `Si aucun paiement ne passe d'ici ${daysLeft} jour${daysLeft > 1 ? 's' : ''} ` +
                `(${formatDate(graceEnds, patron.locale)}), Aaron se mettra en pause : plus de ` +
                'prospection ni de réponses automatiques. Vos données restent en place et tout ' +
                'redémarre dès le paiement.'
              : "Sans paiement, Aaron se mettra en pause ; vos données restent en place.",
            '',
            "Pour vérifier ou changer votre carte : ouvrez l'application, Préférences puis Abonnement.",
          ];

      try {
        await sendSystemEmail(patron.email, subject, lines.join('\n'), patron.locale);
      } catch (err: any) {
        problems.push(`impayé ${c.id} : ${err?.message}`);
        continue;
      }

      await supabaseAdmin
        .from('companies')
        .update({ dunning_alert_stage: target, dunning_alert_sent_at: now.toISOString() })
        .eq('id', c.id);
      dunningSent += 1;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. FIN DE REMISE (code promo)
    // ─────────────────────────────────────────────────────────────────────
    const { data: subscribed } = await supabaseAdmin
      .from('companies')
      .select('id, name, billing_exempt, stripe_subscription_id, discount_end_alerted_for')
      .not('stripe_subscription_id', 'is', null);

    for (const c of ((subscribed as any[]) || [])) {
      if (c.billing_exempt === true) continue;
      let subscription: any;
      try {
        subscription = await stripe.subscriptions.retrieve(c.stripe_subscription_id, { expand: ['discounts'] });
      } catch (err: any) {
        problems.push(`abonnement ${c.stripe_subscription_id} illisible : ${err?.message}`);
        continue;
      }
      if (subscription.status === 'canceled') continue;

      // Stripe a remplacé `discount` (objet) par `discounts` (tableau) : on
      // lit les deux, sinon la remise passe inaperçue selon la version d'API.
      const discounts: any[] = Array.isArray(subscription.discounts) && subscription.discounts.length
        ? subscription.discounts.filter((d: any) => d && typeof d === 'object')
        : subscription.discount
          ? [subscription.discount]
          : [];

      // `end` n'est renseigné que sur une remise à durée limitée. Une remise
      // « à vie » n'a pas de fin : il n'y a rien à annoncer.
      const ends = discounts
        .map((d) => (typeof d.end === 'number' ? d.end : null))
        .filter((e): e is number => e !== null)
        .sort((a, b) => a - b);
      if (ends.length === 0) continue;

      const endDate = new Date(ends[0] * 1000);
      const daysUntil = days(endDate.getTime() - now.getTime());
      if (daysUntil < 0 || daysUntil > DISCOUNT_WARNING_DAYS) continue;

      const endDay = endDate.toISOString().slice(0, 10);
      if (c.discount_end_alerted_for === endDay) continue;

      const patron = await findPatron(c.id);
      if (!patron) continue;

      // Montant du prochain prélèvement : on le demande à Stripe plutôt que
      // de le recalculer, pour que taxes et devise soient justes. S'il reste
      // introuvable, l'email part SANS montant — mieux vaut annoncer la date
      // sans le prix qu'annoncer un prix faux.
      let amountLabel = '';
      try {
        const price = subscription.items?.data?.[0]?.price?.unit_amount ?? null;
        const currency = subscription.currency || subscription.items?.data?.[0]?.price?.currency || 'eur';
        if (price) amountLabel = formatAmount(price, currency, patron.locale);
      } catch {
        /* sans montant */
      }

      const lines = [
        'Bonjour,',
        '',
        `Votre remise sur Meet Aaron se termine le ${formatDate(endDate, patron.locale)}.`,
        '',
        amountLabel
          ? "À partir de cette date, l'abonnement sera prélevé automatiquement sur la carte déjà " +
            `enregistrée : ${amountLabel} par mois, taxes éventuelles en plus. Vous n'avez rien à ` +
            'faire pour continuer.'
          : "À partir de cette date, l'abonnement sera prélevé automatiquement sur la carte déjà " +
            "enregistrée. Vous n'avez rien à faire pour continuer.",
        '',
        "Si vous préférez ne pas continuer, résiliez avant cette date depuis l'application : " +
          'Préférences puis Abonnement. Aucun prélèvement ne sera fait.',
        '',
        'À bientôt,',
        "L'équipe Meet Aaron",
      ];

      try {
        await sendSystemEmail(
          patron.email,
          `Meet Aaron — votre remise se termine le ${formatDate(endDate, patron.locale)}`,
          lines.join('\n'),
          patron.locale
        );
      } catch (err: any) {
        problems.push(`fin de remise ${c.id} : ${err?.message}`);
        continue;
      }

      await supabaseAdmin
        .from('companies')
        .update({ discount_end_alerted_for: endDay })
        .eq('id', c.id);
      discountSent += 1;
    }

    return NextResponse.json({ dunningSent, discountSent, problems });
  } catch (err: any) {
    return serverError(err, 'Alertes abonnement');
  }
}
