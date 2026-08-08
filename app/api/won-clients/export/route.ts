// app/api/won-clients/export/route.ts
// POST -> génère un CSV des clients gagnés et l'envoie par email au commercial

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendGmailEmail } from '@/lib/google';

export async function POST(request: NextRequest) {
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', user_id).single();
  if (!user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const { data: clients } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name)')
    .eq('assigned_user_id', user_id)
    .eq('is_won', true)
    .order('won_at', { ascending: false });

  const headers = ['Nom', 'Société', 'Email', 'Téléphone', 'Client depuis'];
  const rows = (clients || []).map((c) => [
    c.full_name,
    c.prospect_companies?.name || '',
    c.email,
    c.phone || '',
    c.won_at ? new Date(c.won_at).toLocaleDateString('fr-FR') : '',
  ]);
  const csvBody = [headers, ...rows].map((row) => row.join(' | ')).join('\n');

  await sendGmailEmail(
    user_id,
    user.email,
    'Vos clients gagnés — Meet Aaron',
    `Voici la liste de vos clients gagnés :\n\n${csvBody}`
  );

  return NextResponse.json({ success: true });
}
