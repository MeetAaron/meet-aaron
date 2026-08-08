// app/api/team/route.ts
// GET -> pour un fondateur/patron, liste tous les commerciaux de sa société avec leurs stats clés.
// Refuse l'accès si l'utilisateur demandeur n'a pas le rôle "patron".

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const { data: requester } = await supabaseAdmin
    .from('users')
    .select('company_id, role')
    .eq('id', userId)
    .single();

  if (!requester) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  if (requester.role !== 'patron') {
    return NextResponse.json({ error: "Réservé au fondateur/patron de l'entreprise" }, { status: 403 });
  }

  const { data: members, error } = await supabaseAdmin
    .from('users')
    .select('id, full_name, email, role, created_at')
    .eq('company_id', requester.company_id)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Calcule les stats clés pour chaque membre de l'équipe
  const membersWithStats = await Promise.all(
    (members || []).map(async (member) => {
      const [prospectsRes, appointmentsRes, wonRes] = await Promise.all([
        supabaseAdmin
          .from('prospects')
          .select('id, status', { count: 'exact' })
          .eq('assigned_user_id', member.id)
          .eq('is_won', false),
        supabaseAdmin
          .from('appointments')
          .select('id', { count: 'exact' })
          .eq('user_id', member.id)
          .eq('status', 'validé'),
        supabaseAdmin
          .from('prospects')
          .select('id', { count: 'exact' })
          .eq('assigned_user_id', member.id)
          .eq('is_won', true),
      ]);

      return {
        ...member,
        prospects_actifs: prospectsRes.count || 0,
        rdv_valides: appointmentsRes.count || 0,
        clients_gagnes: wonRes.count || 0,
      };
    })
  );

  return NextResponse.json({ members: membersWithStats });
}
