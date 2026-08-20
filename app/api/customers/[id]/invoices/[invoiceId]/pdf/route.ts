// app/api/customers/[id]/invoices/[invoiceId]/pdf/route.ts
// GET -> génère et renvoie le PDF de la facture (voir lib/invoice-pdf.ts).
// Tâche #141 sous-item 2.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { buildInvoicePdf } from '@/lib/invoice-pdf';

export async function GET(request: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
  const { id: prospectId, invoiceId } = params;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, assigned_user_id, company_id')
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

  const { data: invoice, error: invError } = await supabaseAdmin
    .from('client_invoices')
    .select('*')
    .eq('id', invoiceId)
    .single();

  if (invError || !invoice || invoice.prospect_id !== prospectId) {
    return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('name, siret, legal_address, legal_form, vat_number, vat_exempt_mention')
    .eq('id', prospect.company_id)
    .maybeSingle();

  const pdfBuffer = await buildInvoicePdf({
    invoiceNumber: invoice.invoice_number,
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    lineItems: invoice.line_items || [],
    totalHtEur: invoice.total_ht_eur || 0,
    vatRate: invoice.vat_rate,
    totalTtcEur: invoice.total_ttc_eur || 0,
    paymentTerms: invoice.payment_terms || '',
    seller: {
      name: company?.name || 'Entreprise',
      siret: company?.siret || null,
      legalAddress: company?.legal_address || null,
      legalForm: company?.legal_form || null,
      vatNumber: company?.vat_number || null,
      vatExemptMention: company?.vat_exempt_mention || null,
    },
    buyer: {
      name: invoice.buyer_name || '',
      company: invoice.buyer_company || null,
      address: invoice.buyer_address || null,
    },
  });

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="facture-${invoice.invoice_number}.pdf"`,
    },
  });
}
