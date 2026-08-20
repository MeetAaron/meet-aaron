// app/api/company-legal-info/route.ts
// GET   -> lit les informations légales de l'entreprise (utilisées comme
//          en-tête "émetteur" sur les factures générées, voir lib/invoice-pdf.ts).
// PATCH -> les met à jour.
// Affiché dans Préférences → onglet "Mon Entreprise". Tâche #141 sous-item 2.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('siret, legal_address, legal_form, vat_number, vat_exempt_mention')
    .eq('id', user.company_id)
    .single();

  return NextResponse.json({
    legal_info: {
      siret: company?.siret || '',
      legal_address: company?.legal_address || '',
      legal_form: company?.legal_form || '',
      vat_number: company?.vat_number || '',
      vat_exempt_mention: company?.vat_exempt_mention || '',
    },
  });
}

export async function PATCH(request: NextRequest) {
  const { user_id, siret, legal_address, legal_form, vat_number, vat_exempt_mention } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from('companies')
    .update({
      siret: (siret ?? '').trim() || null,
      legal_address: (legal_address ?? '').trim() || null,
      legal_form: (legal_form ?? '').trim() || null,
      vat_number: (vat_number ?? '').trim() || null,
      vat_exempt_mention: (vat_exempt_mention ?? '').trim() || null,
    })
    .eq('id', user.company_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
