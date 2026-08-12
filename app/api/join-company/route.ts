// app/api/join-company/route.ts
// POST -> un commercial rejoint la société d'un patron déjà abonné, via un code
// d'invitation (pas de paiement : la société est déjà abonnée via Stripe).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedIdentity, unauthorizedResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const { first_name, full_name, invite_code } = await request.json();

  if (!first_name || !full_name || !invite_code) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
  }

  // auth_user_id et email proviennent du token vérifié, jamais du corps de la
  // requête — sinon n'importe qui connaissant l'UUID Supabase Auth d'une autre
  // personne pourrait rattacher SON compte à une société via un simple code
  // d'invitation (même faille que /api/auth/link avant correctif).
  const identity = await getAuthedIdentity(request);
  if (!identity) return unauthorizedResponse();
  const { auth_user_id, email } = identity;

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_user_id', auth_user_id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'Ce compte est déjà rattaché à une société' }, { status: 409 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, name')
    .eq('invite_code', invite_code.trim().toUpperCase())
    .maybeSingle();

  if (!company) {
    return NextResponse.json({ error: 'Code d\'invitation invalide. Vérifiez-le auprès de votre responsable.' }, { status: 404 });
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .insert({
      auth_user_id,
      email,
      first_name,
      full_name,
      role: 'commercial',
      company_id: company.id,
    })
    .select('id, company_id, first_name, full_name, role')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user, company_name: company.name });
}
