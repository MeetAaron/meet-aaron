// app/api/customers/[id]/invoices/[invoiceId]/route.ts
// PATCH -> change le statut d'une facture (payée / annulée). [id] = id du
// PROSPECT (client gagné), [invoiceId] = id de la facture (client_invoices).
// Tâche #141 sous-item 2.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function PATCH(request: NextRequest, { params }: { params: { id: string; invoiceId: string } }) {
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
  if (authedUser.id !== prospect.assigned_user_id) return forbiddenResponse();

  const { data: invoice, error: invError } = await supabaseAdmin
    .from('client_invoices')
    .select('id, prospect_id, status')
    .eq('id', invoiceId)
    .single();

  if (invError || !invoice || invoice.prospect_id !== prospectId) {
    return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });
  }

  const { status } = await request.json();
  if (!['payee', 'annulee'].includes(status)) {
    return NextResponse.json({ error: 'Statut invalide (attendu : payee ou annulee).' }, { status: 400 });
  }

  if (invoice.status === 'payee' || invoice.status === 'annulee') {
    return NextResponse.json({ error: 'Cette facture est déjà réglée ou annulée, son statut ne peut plus être modifié.' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { status };
  if (status === 'payee') updates.paid_at = new Date().toISOString();

  const { error: updateError } = await supabaseAdmin.from('client_invoices').update(updates).eq('id', invoiceId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, status });
}
