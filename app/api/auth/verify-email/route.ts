// app/api/auth/verify-email/route.ts
// GET -> valide le token reçu par email et marque l'adresse comme vérifiée,
// puis redirige vers la page de connexion.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const origin = request.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(`${origin}/login?verified=error`);
  }

  const { data: verification } = await supabaseAdmin
    .from('email_verifications')
    .select('id, verified')
    .eq('token', token)
    .maybeSingle();

  if (!verification) {
    return NextResponse.redirect(`${origin}/login?verified=error`);
  }

  if (!verification.verified) {
    await supabaseAdmin
      .from('email_verifications')
      .update({ verified: true, verified_at: new Date().toISOString() })
      .eq('id', verification.id);
  }

  return NextResponse.redirect(`${origin}/login?verified=1`);
}
