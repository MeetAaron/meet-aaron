// app/api/customers/[id]/invoices/route.ts
// GET  -> liste les factures émises pour ce client (prospect gagné).
// POST -> crée une nouvelle facture. [id] = id du PROSPECT (client gagné).
// Tâche #141 sous-item 2 — voir lib/client-invoices.ts, lib/invoice-pdf.ts,
// migration_invoicing_2026-08-20.sql, app/app/customer/page.jsx.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { getNextInvoiceNumber, computeInvoiceTotals, lineItemsFromDevisRecap, DEFAULT_PAYMENT_TERMS_FR, InvoiceLineItem } from '@/lib/client-invoices';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, is_won, assigned_user_id, company_id')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return forbiddenResponse();
  }

  const { data: invoices, error: invError } = await supabaseAdmin
    .from('client_invoices')
    .select('id, invoice_number, issue_date, due_date, status, total_ht_eur, total_ttc_eur, source, paid_at')
    .eq('prospect_id', prospectId)
    .order('issue_date', { ascending: false });

  if (invError) {
    return NextResponse.json({ error: invError.message }, { status: 500 });
  }

  return NextResponse.json({ invoices: invoices || [] });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const prospectId = params.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, is_won, assigned_user_id, company_id, full_name, email, devis_recap, prospect_companies (name)')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  if (!prospect.is_won) {
    return NextResponse.json({ error: "Ce prospect n'est pas (encore) un client gagné" }, { status: 400 });
  }

  const body = await request.json();
  const {
    line_items: rawLineItems,
    prefill_from_devis,
    due_date,
    vat_rate,
    payment_terms,
    buyer_address,
  } = body || {};

  let lineItems: InvoiceLineItem[];
  if (prefill_from_devis) {
    if (!prospect.devis_recap) {
      return NextResponse.json({ error: 'Aucun devis disponible pour ce client à pré-remplir.' }, { status: 400 });
    }
    lineItems = lineItemsFromDevisRecap(prospect.devis_recap as any);
    if (lineItems.length === 0) {
      return NextResponse.json({ error: "Le devis de ce client n'a aucun poste chiffré à facturer." }, { status: 400 });
    }
  } else {
    if (!Array.isArray(rawLineItems) || rawLineItems.length === 0) {
      return NextResponse.json({ error: 'Au moins une ligne de facturation est requise.' }, { status: 400 });
    }
    const parsedLineItems: InvoiceLineItem[] = [];
    for (const l of rawLineItems) {
      const quantite = Number(l?.quantite);
      const prix_unitaire_ht_eur = Number(l?.prix_unitaire_ht_eur);
      if (!l?.designation || !Number.isFinite(quantite) || quantite <= 0 || !Number.isFinite(prix_unitaire_ht_eur) || prix_unitaire_ht_eur < 0) {
        return NextResponse.json({ error: 'Chaque ligne doit avoir une désignation, une quantité > 0 et un prix unitaire HT ≥ 0.' }, { status: 400 });
      }
      parsedLineItems.push({
        designation: l.designation,
        description: l.description || null,
        quantite,
        prix_unitaire_ht_eur,
        total_ligne_ht_eur: Math.round(quantite * prix_unitaire_ht_eur * 100) / 100,
      });
    }
    lineItems = parsedLineItems;
  }

  const vatRate = vat_rate !== undefined && vat_rate !== null && vat_rate !== '' ? Number(vat_rate) : null;
  if (vatRate !== null && (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1)) {
    return NextResponse.json({ error: 'Taux de TVA invalide (attendu entre 0 et 1, ex. 0.20 pour 20%).' }, { status: 400 });
  }

  const { total_ht_eur, total_ttc_eur } = computeInvoiceTotals(lineItems, vatRate);

  // Le numéro est attribué (et le compteur avancé) AVANT l'insertion de la
  // facture elle-même. Limite connue et acceptée : si l'INSERT ci-dessous
  // échouait pour une raison imprévue après cette attribution (ex. coupure
  // réseau), ce numéro resterait consommé sans facture correspondante — un
  // trou dans la séquence sans trace. Toutes les validations (lignes, TVA)
  // sont faites AVANT cet appel pour rendre ce cas aussi rare que possible ;
  // un vrai verrou transactionnel nécessiterait une fonction SQL dédiée,
  // non mise en place dans ce lot.
  let invoiceNumber: string;
  try {
    invoiceNumber = await getNextInvoiceNumber(prospect.company_id);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const { data: invoice, error: insertError } = await supabaseAdmin
    .from('client_invoices')
    .insert({
      company_id: prospect.company_id,
      prospect_id: prospectId,
      invoice_number: invoiceNumber,
      due_date: due_date || null,
      line_items: lineItems,
      total_ht_eur,
      vat_rate: vatRate,
      total_ttc_eur,
      payment_terms: payment_terms || DEFAULT_PAYMENT_TERMS_FR,
      buyer_name: prospect.full_name,
      buyer_company: (prospect as any).prospect_companies?.name || null,
      buyer_address: buyer_address || null,
      source: 'interne',
      created_by: authedUser.id,
    })
    .select('id, invoice_number, issue_date, due_date, status, total_ht_eur, total_ttc_eur, source')
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ invoice });
}
