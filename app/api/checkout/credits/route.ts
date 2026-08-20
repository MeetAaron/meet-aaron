// app/api/checkout/credits/route.ts
// POST -> crée une session de paiement Stripe EN UNE FOIS (pas un abonnement)
// pour l'achat d'un pack de crédits ("boost", voir migration_credits_2026-08-14.sql
// et lib/credits.ts).
//
// CHANGEMENTS A FAIRE #91-93 (2026-08-16, item 31) : le docx précise
// explicitement le tarif "booster Aaron" — packs de 20/40/60/80/100 crédits
// (ou un montant personnalisé), 30€ pour 20 crédits, soit 1,50€/crédit. Ceci
// remplace le tarif 1 crédit = 1 € décidé le 14/08/2026 (avant que ce tarif
// précis soit communiqué par écrit) — voir statut projet pour la note sur ce
// changement de tarif. Le solde stocké (`companies.credit_balance_eur`,
// lib/credits.ts) reste un solde en EUROS ; c'est uniquement le prix
// d'achat par crédit affiché/facturé qui change (1,50€ au lieu de 1€), ce qui
// ne nécessite aucune migration ni changement de lib/credits.ts (spend/solde
// inchangés).
//
// Utilise price_data (tarif défini à la volée) plutôt qu'un Price ID Stripe
// préexistant : pas besoin de créer les packs dans le dashboard Stripe au
// préalable, le prix est calculé à partir du nombre de crédits choisi.
//
// Réservé au patron de la société : c'est une dépense engagée pour toute
// l'équipe, pas une action qu'un commercial devrait pouvoir déclencher seul
// (même logique que /api/team, réservé au patron).
//
// Tâche #140 (2026-08-20) : accepte désormais un `module` optionnel
// ('ap'|'as'|'ac') pour acheter des crédits réservés à UN module (Aaron
// Prospect / Sales / Customer) plutôt que le pool général — voir
// lib/credits.ts et migration_credits_per_module_2026-08-20.sql. Omis, le
// comportement est identique à avant (pool général).

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

// 30€ pour 20 crédits (tarif docx CHANGEMENTS A FAIRE, item 31).
const CREDIT_PRICE_EUR = 1.5;
const MIN_CREDITS = 1;
const MAX_CREDITS = 5000;

const MODULE_LABELS: Record<string, string> = {
  ap: 'Aaron Prospect',
  as: 'Aaron Sales',
  ac: 'Aaron Customer',
};

export async function POST(request: NextRequest) {
  const { credits, module } = await request.json();
  const creditsNum = Number(credits);
  const moduleKey = typeof module === 'string' && module in MODULE_LABELS ? module : undefined;

  if (!Number.isInteger(creditsNum) || creditsNum < MIN_CREDITS || creditsNum > MAX_CREDITS) {
    return NextResponse.json({ error: 'Nombre de crédits invalide' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.role !== 'patron') return forbiddenResponse();
  if (!authedUser.company_id) {
    return NextResponse.json({ error: 'Aucune société associée à ce compte' }, { status: 400 });
  }

  const origin = request.nextUrl.origin;
  // Arrondi au centime pour éviter les montants Stripe à virgule flottante
  // imprécise (ex. 0.1 + 0.2 en JS) — unit_amount de Stripe est en centimes.
  const amountEur = Math.round(creditsNum * CREDIT_PRICE_EUR * 100) / 100;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: authedUser.email,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: moduleKey ? `${creditsNum} crédits ${MODULE_LABELS[moduleKey]}` : `${creditsNum} crédits Aaron`,
              description: moduleKey
                ? `Crédits pour continuer à utiliser ${MODULE_LABELS[moduleKey]} au-delà du plafond inclus dans l'abonnement`
                : "Crédits pour continuer à utiliser Aaron au-delà du plafond inclus dans l'abonnement",
            },
            unit_amount: Math.round(amountEur * 100),
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      success_url: `${origin}/app/preferences?user_id=${authedUser.id}&credits_success=1`,
      cancel_url: `${origin}/app/preferences?user_id=${authedUser.id}`,
      metadata: {
        purpose: 'credits_purchase',
        company_id: authedUser.company_id,
        amount_eur: String(amountEur),
        credits: String(creditsNum),
        ...(moduleKey ? { module: moduleKey } : {}),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('Erreur création session Stripe (crédits):', err);
    return NextResponse.json({ error: err.message || 'Erreur Stripe inconnue' }, { status: 500 });
  }
}
