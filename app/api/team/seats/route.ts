// app/api/team/seats/route.ts
// GET  -> liste des comptes équipe (sièges commerciaux) de la société du
//         patron connecté.
// POST -> crée un nouveau compte équipe : le fondateur choisit prénom/nom/
//         poste/email du commercial + les modules Aaron souscrits pour ce
//         siège (1, 2 ou 3 parmi Prospect/Opportunités/Clients), au même
//         prix qu'un compte classique — voir migration_team_seats_2026-08-28.sql
//         pour le détail de l'architecture (et sa limite assumée : le choix
//         de modules ici ne fixe QUE le prix Stripe du siège, pas encore un
//         accès restreint par utilisateur dans l'app).
//
// Réservé au patron — même logique que /api/team, /api/checkout/credits.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { generateSeatActivationCode } from '@/lib/invite-code';
import { MODULE_CODES, ModuleCode, getModulePriceId } from '@/lib/subscription';

function moduleColumn(module: ModuleCode) {
  return {
    active: `${module.toLowerCase()}_active`,
    item: `stripe_subscription_item_${module.toLowerCase()}`,
  };
}

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
  }

  const { data: seats, error } = await supabaseAdmin
    .from('team_seats')
    .select('id, first_name, last_name, job_title, email, activation_code, status, user_id, ap_active, as_active, ac_active, email_sent_at, created_at, activated_at')
    .eq('company_id', authedUser.company_id)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ seats: seats || [] });
}

export async function POST(request: NextRequest) {
  const { first_name, last_name, job_title, email, modules } = await request.json();

  if (!first_name || !last_name || !email) {
    return NextResponse.json({ error: 'Prénom, nom et email sont requis' }, { status: 400 });
  }

  const selectedModules: ModuleCode[] = Array.isArray(modules)
    ? (modules.filter((m: string) => MODULE_CODES.includes(m as ModuleCode)) as ModuleCode[])
    : [];
  if (selectedModules.length === 0) {
    return NextResponse.json({ error: 'Choisis au moins un module pour ce compte équipe' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('id, stripe_customer_id, stripe_subscription_id')
    .eq('id', authedUser.company_id)
    .single();

  if (companyError || !company) {
    return NextResponse.json({ error: 'Société introuvable' }, { status: 404 });
  }

  // Pas de gestion du cas "société totalement désabonnée" ici (contrairement
  // à /api/subscription/modules) : ajouter un premier commercial suppose que
  // le fondateur a déjà lui-même un abonnement actif — cas très improbable
  // en pratique, et un message clair vaut mieux qu'un flux Checkout dédié
  // pour ce cas limite.
  if (!company.stripe_subscription_id) {
    return NextResponse.json(
      { error: "Aucun abonnement actif pour ta société — abonne-toi d'abord toi-même (Mon compte > Mon abonnement) avant d'ajouter des comptes équipe." },
      { status: 400 }
    );
  }

  // Crée une ligne Stripe par module choisi. Si l'une échoue en cours de
  // route, on retire celles déjà créées pour ne pas laisser le fondateur
  // payer des lignes orphelines sans siège correspondant en base.
  const createdItems: { module: ModuleCode; itemId: string }[] = [];
  try {
    for (const module of selectedModules) {
      const priceId = getModulePriceId(module);
      if (!priceId) {
        throw new Error(`Module ${module} pas encore configuré côté serveur (Price ID Stripe manquant).`);
      }
      const item = await stripe.subscriptionItems.create({
        subscription: company.stripe_subscription_id,
        price: priceId,
      });
      createdItems.push({ module, itemId: item.id });
    }
  } catch (err: any) {
    for (const created of createdItems) {
      try {
        await stripe.subscriptionItems.del(created.itemId);
      } catch (cleanupErr: any) {
        console.error('Nettoyage ligne Stripe orpheline (création siège échouée) :', cleanupErr.message);
      }
    }
    console.error('Erreur création siège équipe (Stripe) :', err.message);
    return NextResponse.json({ error: err.message || 'Erreur Stripe' }, { status: 500 });
  }

  const row: Record<string, any> = {
    company_id: authedUser.company_id,
    first_name,
    last_name,
    job_title: job_title || null,
    email,
    activation_code: generateSeatActivationCode(),
  };
  for (const { module, itemId } of createdItems) {
    const cols = moduleColumn(module);
    row[cols.active] = true;
    row[cols.item] = itemId;
  }

  const { data: seat, error: insertError } = await supabaseAdmin
    .from('team_seats')
    .insert(row)
    .select('id, first_name, last_name, job_title, email, activation_code, status, ap_active, as_active, ac_active, created_at')
    .single();

  if (insertError) {
    // Ligne(s) Stripe créées mais l'enregistrement du siège a échoué — même
    // classe de bug que celui corrigé le 2026-08-23 sur /api/subscription/modules
    // (voir ce fichier) : ne jamais répondre succès silencieux dans ce cas,
    // et ne PAS nettoyer Stripe automatiquement ici (contrairement au cas
    // ci-dessus) car on ne sait pas si la ligne DB existe partiellement —
    // mieux vaut un support humain qu'un nettoyage automatique qui pourrait
    // supprimer une ligne Stripe déjà correctement rattachée.
    console.error('Siège équipe : lignes Stripe créées mais insertion team_seats échouée', insertError.message, { company_id: authedUser.company_id, createdItems });
    return NextResponse.json(
      { error: "Les lignes d'abonnement Stripe ont bien été créées mais l'enregistrement du compte équipe a échoué — contactez le support avant de réessayer." },
      { status: 500 }
    );
  }

  return NextResponse.json({ seat });
}
