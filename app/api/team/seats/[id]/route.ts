// app/api/team/seats/[id]/route.ts
// PATCH -> deux usages distincts (voir body) :
//   - { action: 'cancel' } : résilie l'abonnement de ce siège (retire les
//     lignes Stripe actives, status -> 'cancelled') mais garde la ligne en
//     base pour historique (voir migration_team_seats_2026-08-28.sql).
//   - sinon, champs à mettre à jour (first_name/last_name/job_title/email/
//     modules) : "modifier" un compte équipe. `modules` est la liste
//     COMPLÈTE désirée (pas un diff) — les modules retirés font supprimer
//     leur ligne Stripe, les modules ajoutés en créent une nouvelle.
// DELETE -> supprime définitivement le compte équipe (retire d'abord les
//   lignes Stripe encore actives si besoin).
//
// Réservé au patron de la société propriétaire du siège.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { MODULE_CODES, ModuleCode, getModulePriceId, describeStripeSubscriptionError } from '@/lib/subscription';

function moduleColumn(module: ModuleCode) {
  return {
    active: `${module.toLowerCase()}_active` as const,
    item: `stripe_subscription_item_${module.toLowerCase()}` as const,
  };
}

async function loadSeat(id: string, companyId: string) {
  const { data: seat } = await supabaseAdmin
    .from('team_seats')
    .select('id, company_id, status, ap_active, as_active, ac_active, stripe_subscription_item_ap, stripe_subscription_item_as, stripe_subscription_item_ac')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  return seat;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
  }

  const seat = await loadSeat(params.id, authedUser.company_id);
  if (!seat) return NextResponse.json({ error: 'Compte équipe introuvable' }, { status: 404 });

  const body = await request.json();

  if (body.action === 'cancel') {
    if (seat.status === 'cancelled') {
      return NextResponse.json({ error: 'Ce compte équipe est déjà annulé' }, { status: 400 });
    }

    const updates: Record<string, any> = { status: 'cancelled', cancelled_at: new Date().toISOString() };
    for (const module of MODULE_CODES) {
      const cols = moduleColumn(module);
      const itemId = (seat as any)[cols.item];
      if (itemId) {
        try {
          await stripe.subscriptionItems.del(itemId);
        } catch (err: any) {
          // Ligne déjà retirée côté Stripe (ex: annulation manuelle dans le
          // Dashboard) -> pas bloquant, on continue quand même la mise à
          // jour côté base pour ne pas rester coincé.
          console.error(`Annulation siège ${params.id} : suppression ligne Stripe ${itemId} (module ${module}) a échoué`, err.message);
        }
      }
      updates[cols.active] = false;
      updates[cols.item] = null;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('team_seats')
      .update(updates)
      .eq('id', params.id)
      .select('id, status')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ seat: updated });
  }

  // Modification standard (champs + éventuellement modules).
  const updates: Record<string, any> = {};
  if (typeof body.first_name === 'string' && body.first_name.trim()) updates.first_name = body.first_name.trim();
  if (typeof body.last_name === 'string' && body.last_name.trim()) updates.last_name = body.last_name.trim();
  if (typeof body.job_title === 'string') updates.job_title = body.job_title.trim() || null;
  if (typeof body.email === 'string' && body.email.trim()) updates.email = body.email.trim();

  if (Array.isArray(body.modules)) {
    if (seat.status === 'cancelled') {
      return NextResponse.json({ error: 'Ce compte équipe est annulé — supprime-le pour en recréer un plutôt que de modifier ses modules.' }, { status: 400 });
    }
    const desired = new Set(body.modules.filter((m: string) => MODULE_CODES.includes(m as ModuleCode)));
    if (desired.size === 0) {
      return NextResponse.json({ error: 'Au moins un module doit rester actif' }, { status: 400 });
    }

    for (const module of MODULE_CODES) {
      const cols = moduleColumn(module);
      const currentlyActive = Boolean((seat as any)[cols.active]);
      const wantsActive = desired.has(module);

      if (currentlyActive && !wantsActive) {
        const itemId = (seat as any)[cols.item];
        if (itemId) {
          try {
            await stripe.subscriptionItems.del(itemId);
          } catch (err: any) {
            console.error(`Modification siège ${params.id} : suppression ligne Stripe ${itemId} (module ${module}) a échoué`, err.message);
            return NextResponse.json({ error: `Erreur Stripe en retirant le module ${module} : ${err.message}` }, { status: 500 });
          }
        }
        updates[cols.active] = false;
        updates[cols.item] = null;
      } else if (!currentlyActive && wantsActive) {
        const priceId = getModulePriceId(module);
        if (!priceId) {
          return NextResponse.json({ error: `Module ${module} pas encore configuré côté serveur (Price ID Stripe manquant).` }, { status: 501 });
        }
        try {
          const { data: company } = await supabaseAdmin
            .from('companies')
            .select('stripe_subscription_id')
            .eq('id', authedUser.company_id)
            .single();
          if (!company?.stripe_subscription_id) {
            return NextResponse.json({ error: 'Aucun abonnement Stripe actif pour cette société' }, { status: 400 });
          }
          const item = await stripe.subscriptionItems.create({ subscription: company.stripe_subscription_id, price: priceId });
          updates[cols.active] = true;
          updates[cols.item] = item.id;
        } catch (err: any) {
          // Même bug que app/api/team/seats/route.ts (débrief "Modifs Aaron"
          // section 7) : message Stripe brut illisible si le prix a été
          // désactivé/archivé — traduit désormais via describeStripeSubscriptionError.
          console.error(`Modification siège ${params.id} : ajout ligne Stripe (module ${module}) a échoué`, err.message);
          return NextResponse.json({ error: describeStripeSubscriptionError(err, module) }, { status: 500 });
        }
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Rien à modifier' }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('team_seats')
    .update(updates)
    .eq('id', params.id)
    .select('id, first_name, last_name, job_title, email, status, ap_active, as_active, ac_active')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ seat: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
  }

  const seat = await loadSeat(params.id, authedUser.company_id);
  if (!seat) return NextResponse.json({ error: 'Compte équipe introuvable' }, { status: 404 });

  for (const module of MODULE_CODES) {
    const cols = moduleColumn(module);
    const itemId = (seat as any)[cols.item];
    if (itemId) {
      try {
        await stripe.subscriptionItems.del(itemId);
      } catch (err: any) {
        console.error(`Suppression siège ${params.id} : suppression ligne Stripe ${itemId} (module ${module}) a échoué`, err.message);
      }
    }
  }

  // Le commercial éventuellement déjà rattaché (seat.user_id) garde son
  // compte `users` — on ne le supprime jamais automatiquement ici (voir
  // règle générale du projet : pas de suppression permanente de données
  // sans action explicite dédiée, voir lib/account-deletion.ts). Il perd
  // simplement son rattachement à ce siège.
  const { error } = await supabaseAdmin.from('team_seats').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
