// app/api/email-health/route.ts
// GET -> diagnostic SPF/DMARC du domaine d'envoi de chaque boîte mail que le
// commercial a connectée (Gmail/Outlook), affiché dans Connexions. Voir
// lib/email-deliverability.ts pour ce qui est vérifié et pourquoi DKIM n'y
// figure pas.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { checkDomainHealth, isConsumerDomain } from '@/lib/email-deliverability';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: connections } = await supabaseAdmin
    .from('oauth_connections')
    .select('provider, provider_account_email')
    .eq('user_id', userId);

  const results = await Promise.all(
    (connections || [])
      .filter((c) => c.provider_account_email?.includes('@'))
      .map(async (c) => {
        const domain = c.provider_account_email.split('@')[1];
        if (isConsumerDomain(domain)) {
          return { provider: c.provider, domain, consumer_domain: true, health: null };
        }
        const health = await checkDomainHealth(domain);
        return { provider: c.provider, domain, consumer_domain: false, health };
      })
  );

  return NextResponse.json({ results });
}
