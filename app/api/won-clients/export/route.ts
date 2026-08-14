// app/api/won-clients/export/route.ts
// POST -> génère un CSV des clients gagnés et l'envoie par email au commercial

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', user_id).single();
  if (!user) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  const { data: clients } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name)')
    .eq('assigned_user_id', user_id)
    // Client à part entière = 1ère commande confirmée (pas juste "gagné" —
    // voir migration_first_order_confirmed_2026-08-14.sql).
    .not('first_order_confirmed_at', 'is', null)
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

  await sendEmailForUser(
    user_id,
    user.email,
    'Vos clients gagnés — Meet Aaron',
    `Voici la liste de vos clients gagnés :\n\n${csvBody}`
  );

  return NextResponse.json({ success: true });
}
