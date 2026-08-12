// app/api/auth/link/route.ts
// POST -> appelé juste après une connexion réussie via Supabase Auth (Google).
// Retrouve (ou refuse) le profil "users" Meet Aaron correspondant à l'email connecté,
// et lie définitivement auth_user_id à ce profil pour les prochaines connexions.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const { auth_user_id, email } = await request.json();

  if (!auth_user_id || !email) {
    return NextResponse.json({ error: 'auth_user_id ou email manquant' }, { status: 400 });
  }

  const { data: alreadyLinked } = await supabaseAdmin
    .from('users')
    .select('id, company_id, first_name, full_name, role')
    .eq('auth_user_id', auth_user_id)
    .maybeSingle();

  if (alreadyLinked) {
    return NextResponse.json({ user: alreadyLinked });
  }

  const { data: byEmail } = await supabaseAdmin
    .from('users')
    .select('id, company_id, first_name, full_name, role, auth_user_id')
    .eq('email', email)
    .maybeSingle();

  if (byEmail) {
    if (byEmail.auth_user_id) {
      return NextResponse.json({ error: 'Ce profil est déjà lié à un autre compte' }, { status: 409 });
    }
    const { data: updated, error } = await supabaseAdmin
      .from('users')
      .update({ auth_user_id })
      .eq('id', byEmail.id)
      .select('id, company_id, first_name, full_name, role')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ user: updated });
  }

  return NextResponse.json(
    { error: "Aucun profil Meet Aaron n'est associé à cette adresse email. Contactez votre administrateur." },
    { status: 404 }
  );
}
