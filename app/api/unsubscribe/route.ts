// app/api/unsubscribe/route.ts
// POST -> envoie une demande de résiliation par email (notification manuelle en attendant Stripe)

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendGmailEmail } from '@/lib/google';

export async function POST(request: NextRequest) {
  const { user_id, reason } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('full_name, email, company_id, companies(name)')
    .eq('id', user_id)
    .single();

  if (!user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  try {
    await sendGmailEmail(
      user_id,
      'aaron@meetaaron.app',
      'Demande de résiliation Meet Aaron',
      `${user.full_name} (${user.email}), société "${(user.companies as any)?.name || 'inconnue'}", souhaite résilier son abonnement Meet Aaron.\n\nRaison indiquée :\n${reason || 'Aucune raison précisée.'}`
    );
  } catch (err) {
    console.error('Erreur envoi email de résiliation:', err);
  }

  return NextResponse.json({ success: true });
}
