// app/api/team/route.ts
// GET -> pour un fondateur/patron, liste tous les commerciaux de sa société avec leurs stats clés.
// Refuse l'accès si l'utilisateur demandeur n'a pas le rôle "patron".

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateInviteCode } from '@/lib/invite-code';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

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

  // Récupère (ou génère si absent — sociétés créées avant ce chantier) le code
  // d'invitation permettant aux commerciaux de rejoindre la société.
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, name, invite_code')
    .eq('id', requester.company_id)
    .single();

  let inviteCode = company?.invite_code || null;
  if (company && !inviteCode) {
    inviteCode = generateInviteCode(company.name);
    await supabaseAdmin.from('companies').update({ invite_code: inviteCode }).eq('id', company.id);
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
          // Client à part entière seulement (voir migration_first_order_confirmed_2026-08-14.sql).
          .not('first_order_confirmed_at', 'is', null),
      ]);

      return {
        ...member,
        prospects_actifs: prospectsRes.count || 0,
        rdv_valides: appointmentsRes.count || 0,
        clients_gagnes: wonRes.count || 0,
      };
    })
  );

  return NextResponse.json({ members: membersWithStats, invite_code: inviteCode });
}
