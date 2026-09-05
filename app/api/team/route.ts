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
import { listActiveBoosts } from '@/lib/credit-boosts';
import { USD_PER_CREDIT } from '@/lib/boost-tiers';

// Même valeur que DEFAULT_MONTHLY_CAP_USD dans lib/anthropic-client.ts
// (21,5 USD ≈ 20 € par utilisateur et par mois) — utilisée quand la société
// n'a pas de plafond personnalisé en base.
const DEFAULT_PER_USER_CAP_USD = 21.5;

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

  // Jauge de crédits par commercial (demande Alex, 01/09/2026) : combien du
  // budget API mensuel inclus dans l'abonnement chaque commercial a
  // consommé ce mois-ci. Le PLAFOND reste commun à la société (personne
  // n'est coupé à cause d'un collègue) — c'est une répartition, pas un
  // quota individuel. Table optionnelle : tant que
  // migration_api_usage_per_user_2026-09-01.sql n'est pas passée, on renvoie
  // simplement des montants nuls et l'écran masque la section.
  const yearMonth = new Date().toISOString().slice(0, 7);
  let creditsByMember: Record<string, number> = {};
  let creditsAvailable = false;
  try {
    const { data: usageRows, error: usageError } = await supabaseAdmin
      .from('api_usage_user_monthly')
      .select('user_id, cost_usd')
      .eq('company_id', requester.company_id)
      .eq('year_month', yearMonth);
    if (!usageError) {
      creditsAvailable = true;
      for (const row of usageRows || []) {
        creditsByMember[(row as any).user_id] = Number((row as any).cost_usd) || 0;
      }
    }
  } catch {
    // table absente : jauge simplement non affichée
  }

  const [{ data: companyUsage }, { data: companyRow }] = await Promise.all([
    supabaseAdmin
      .from('api_usage_monthly')
      .select('cost_usd')
      .eq('company_id', requester.company_id)
      .eq('year_month', yearMonth)
      .maybeSingle(),
    supabaseAdmin
      .from('companies')
      .select('monthly_api_cap_usd')
      .eq('id', requester.company_id)
      .maybeSingle(),
  ]);

  const membersWithCredits = membersWithStats.map((m: any) => ({
    ...m,
    credits_used_usd: creditsByMember[m.id] || 0,
  }));

  const companyTotal = Number((companyUsage as any)?.cost_usd) || 0;
  const attributed = Object.values(creditsByMember).reduce((a, b) => a + b, 0);

  // Plafond RÉEL de la société (01/09/2026). Deux corrections ici :
  //   1. companies.monthly_api_cap_usd est une base PAR UTILISATEUR (voir
  //      getMonthlyCapUsd dans lib/anthropic-client.ts) : l'afficher tel quel
  //      face à une consommation de toute la société donnait un pourcentage
  //      faux dès qu'une équipe comptait plus d'un commercial.
  //   2. les boosts actifs s'ajoutent au plafond — sans eux, une société qui
  //      vient d'acheter un boost se serait vue à 130 % de son plafond.
  const perUserCap = Number((companyRow as any)?.monthly_api_cap_usd) || DEFAULT_PER_USER_CAP_USD;
  const subscriptionCapUsd = perUserCap * Math.max(1, membersWithStats.length);
  const activeBoosts = await listActiveBoosts(requester.company_id);
  // Reste des boosts + part consommée ce mois-ci (même règle que
  // app/api/api-usage/route.ts, depuis que les boosts n'expirent plus).
  const boostRemainingUsd = activeBoosts.reduce((n, b) => n + Number(b.remaining_usd || 0), 0);
  const boostCapUsd = boostRemainingUsd + Math.max(0, companyTotal - subscriptionCapUsd);
  const boostCredits = Math.round((boostRemainingUsd / USD_PER_CREDIT) * 10) / 10;

  return NextResponse.json({
    members: membersWithCredits,
    invite_code: inviteCode,
    credits: {
      available: creditsAvailable,
      year_month: yearMonth,
      // cap_usd = ce dont la société dispose réellement, boosts compris.
      cap_usd: subscriptionCapUsd + boostCapUsd,
      subscription_cap_usd: subscriptionCapUsd,
      boost_cap_usd: boostCapUsd,
      boost_credits: boostCredits,
      active_boosts: activeBoosts,
      company_total_usd: companyTotal,
      // Part non rattachable à un commercial (crons société, traitements
      // globaux) — affichée à part plutôt qu'attribuée au hasard.
      shared_usd: Math.max(0, companyTotal - attributed),
    },
  });
}
