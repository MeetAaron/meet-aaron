// app/api/billing/invoices/route.ts
// GET -> liste des factures Aaron (abonnement + achats de crédits) de la
// société du patron connecté, directement depuis Stripe (docx item
// Préférences/Abonnement, tâche #140 : "factures téléchargeables directement
// dans l'appli", en plus du Billing Portal déjà en place — voir
// app/api/billing-portal/route.ts).
//
// Choix volontaire de ne PAS créer de nouvelle table ni de nouveau webhook :
// Stripe est déjà la source de vérité des factures (voir Billing Portal), un
// appel `stripe.invoices.list` en lecture suffit et reste toujours à jour
// sans synchronisation à maintenir.
//
// Seul le patron peut y accéder — même logique que /api/billing-portal et
// /api/checkout/credits (dépense engagée pour toute la société).

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
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
    // Pas encore de client Stripe (société pas encore passée par le
    // checkout initial) : liste vide, pas une erreur.
    return NextResponse.json({ invoices: [] });
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: company.stripe_customer_id,
      limit: 24,
    });

    const simplified = invoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      created: inv.created,
      amount_paid: inv.amount_paid,
      currency: inv.currency,
      status: inv.status,
      hosted_invoice_url: inv.hosted_invoice_url,
      invoice_pdf: inv.invoice_pdf,
    }));

    return NextResponse.json({ invoices: simplified });
  } catch (err: any) {
    console.error('Erreur récupération factures Stripe:', err);
    return NextResponse.json({ error: err.message || 'Erreur Stripe inconnue' }, { status: 500 });
  }
}
