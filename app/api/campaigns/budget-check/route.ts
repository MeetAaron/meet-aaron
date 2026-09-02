// app/api/campaigns/budget-check/route.ts
// GET ?target_count=N -> estime ce que va consommer une campagne de N
// prospects et le compare à ce qu'il reste de crédits à la société.
//
// Appelé par l'écran Campagnes AVANT le lancement (décision Alex,
// 01/09/2026). C'est le seul moment où l'alerte sert vraiment : une campagne
// qui s'arrête à mi-parcours laisse des prospects contactés une seule fois et
// jamais relancés — pire que de ne pas les avoir contactés.
//
// Purement informatif : cette route ne bloque rien. Le commercial reste libre
// de lancer quand même (il peut vouloir démarrer et acheter un boost plus
// tard), il sait juste à quoi s'attendre.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { checkCampaignBudget, listActiveBoosts } from '@/lib/credit-boosts';

// Même base que DEFAULT_MONTHLY_CAP_USD dans lib/anthropic-client.ts.
const DEFAULT_PER_USER_CAP_USD = 21.5;

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  const targetCount = parseInt(request.nextUrl.searchParams.get('target_count') || '0', 10);

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const companyId = authedUser.company_id;

  const [{ data: companyRow }, { count: userCount }, { data: usageRow }, boosts] = await Promise.all([
    supabaseAdmin.from('companies').select('monthly_api_cap_usd').eq('id', companyId).maybeSingle(),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabaseAdmin
      .from('api_usage_monthly')
      .select('cost_usd')
      .eq('company_id', companyId)
      .eq('year_month', currentYearMonth())
      .maybeSingle(),
    listActiveBoosts(companyId),
  ]);

  const perUserCap = Number((companyRow as any)?.monthly_api_cap_usd) || DEFAULT_PER_USER_CAP_USD;
  const subscriptionCap = perUserCap * Math.max(1, userCount || 1);
  const boostCap = boosts.reduce((n, b) => n + Number(b.cap_usd || 0), 0);
  const spent = Number((usageRow as any)?.cost_usd) || 0;

  const check = checkCampaignBudget(targetCount, subscriptionCap + boostCap, spent);

  return NextResponse.json({
    target_count: targetCount,
    ...check,
    // Exposé pour que l'écran puisse dire « il t'en reste de quoi en faire N »
    // plutôt qu'un pourcentage abstrait.
    boost_cap_usd: boostCap,
    subscription_cap_usd: subscriptionCap,
  });
}
