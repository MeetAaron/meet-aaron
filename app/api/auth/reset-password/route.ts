// app/api/auth/reset-password/route.ts
// POST { token, password } -> vérifie le jeton reçu par email
// (app/api/auth/request-password-reset) et change le mot de passe du compte
// via l'API admin Supabase. Jeton à usage unique, expiré après 1 h.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const { token, password } = await request.json();
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: 'Lien invalide' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return NextResponse.json({ error: 'Le mot de passe doit faire au moins 6 caractères' }, { status: 400 });
  }

  const { data: row } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('id, auth_user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Ce lien est expiré ou a déjà été utilisé — redemande un nouveau lien.' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(row.auth_user_id, { password });
  if (error) {
    console.error('Erreur changement de mot de passe (reset):', error.message);
    return NextResponse.json({ error: 'Impossible de changer le mot de passe pour le moment' }, { status: 500 });
  }

  await supabaseAdmin.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('id', row.id);

  return NextResponse.json({ success: true });
}
