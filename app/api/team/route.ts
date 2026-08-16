// app/api/team/route.ts
// GET -> pour un fondateur/patron, liste tous les commerciaux de sa société avec leurs stats clés.
// Refuse l'accès si l'utilisateur demandeur n'a pas le rôle "patron".
//
// CHANGEMENTS A FAIRE — Mon équipe (item 1, 2026-08-16) : les 3 anciennes
// colonnes (prospects actifs / RDV validés / clients gagnés) deviennent 6
// (prospects actifs, RDVs gagnés, opportunités actives, clients gagnés,
// clients actifs, clients perdus), calculées par lib/team-stats.ts et
// sensibles à un sélecteur de période optionnel (?period=all|month|custom
// &since=ISO). Voir lib/team-stats.ts pour les définitions exactes.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateInviteCode } from '@/lib/invite-code';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { computeStatsForMembers, periodRangeFor } from '@/lib/team-stats';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }
  const periodMode = request.nextUrl.searchParams.get('period') || 'all';
  const customFrom = request.nextUrl.searchParams.get('since');
  const customTo = request.nextUrl.searchParams.get('until');

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

  // Calcule les 6 stats clés pour chaque membre de l'équipe, en une seule
  // passe groupée (lib/team-stats.ts) plutôt qu'un aller-retour DB par
  // membre — plus rapide pour les équipes à plusieurs commerciaux.
  const memberIds = (members || []).map((m: any) => m.id);
  const range = periodRangeFor(periodMode, customFrom, customTo);
  const statsByMember = await computeStatsForMembers(memberIds, range);

  const membersWithStats = (members || []).map((member: any) => ({
    ...member,
    ...(statsByMember[member.id] || {
      prospects_actifs: 0,
      rdv_gagnes: 0,
      opportunites_actives: 0,
      clients_gagnes: 0,
      clients_actifs: 0,
      clients_perdus: 0,
    }),
  }));

  return NextResponse.json({ members: membersWithStats, invite_code: inviteCode });
}
