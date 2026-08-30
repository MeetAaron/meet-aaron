// app/api/email-health/route.ts
// GET -> diagnostic complet de délivrabilité du domaine d'envoi de chaque
// boîte mail connectée (Gmail/Outlook), affiché par l'assistant délivrabilité
// de Connexions. Voir lib/email-deliverability.ts.
//
// Enrichi le 30/08/2026 (assistant "clé en main" demandé par Alex — un email
// de prospection teamsystem sans DMARC est parti en spam, d'où le blocage
// strict ajouté dans lib/messaging.ts) :
//   - DKIM vérifié via les sélecteurs standards du fournisseur (conseil non
//     bloquant, voir checkDkim) ;
//   - détection de l'hébergeur DNS (NS lookup) pour guider "où cliquer" ;
//   - ÉCRITURE DU CACHE domain_health_ok/domain_health_checked_at à chaque
//     appel : le bouton "Vérifier maintenant" de Connexions passe par ici,
//     donc dès que l'utilisateur a corrigé son DNS, un clic re-vérifie ET
//     débloque immédiatement les envois (sendEmailForUser lit ce cache) —
//     sans attendre l'expiration des 24h.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import {
  checkDomainHealth,
  checkDkim,
  detectDnsProvider,
  isConsumerDomain,
  suggestedSpfRecord,
  suggestedDmarcRecord,
} from '@/lib/email-deliverability';

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
    .select('id, provider, provider_account_email')
    .eq('user_id', userId);

  const results = await Promise.all(
    (connections || [])
      .filter((c) => c.provider_account_email?.includes('@'))
      .map(async (c) => {
        const domain = c.provider_account_email.split('@')[1];
        if (isConsumerDomain(domain)) {
          return { provider: c.provider, domain, consumer_domain: true, health: null };
        }
        const provider = (c.provider === 'microsoft' ? 'microsoft' : 'google') as 'google' | 'microsoft';
        const [health, dkim, dnsProvider] = await Promise.all([
          checkDomainHealth(domain),
          checkDkim(domain, provider),
          detectDnsProvider(domain),
        ]);

        // Enregistrements prêts à copier-coller, seulement pour ce qui manque.
        const suggested: { spf?: string; dmarc?: string } = {};
        if (!health.spf.found) {
          suggested.spf = suggestedSpfRecord(provider);
        }
        if (!health.dmarc.found) {
          suggested.dmarc = suggestedDmarcRecord(c.provider_account_email);
        }

        // Rafraîchit le cache lu par le blocage strict des envois (voir
        // isDomainHealthyForSending, lib/email-deliverability.ts). Best-effort.
        // 31/08/2026 : seul SPF est bloquant (règles Gmail < 5000/jour :
        // "SPF ou DKIM" — DMARC recommandé, pas requis) ; DMARC/DKIM sont
        // des conseils non bloquants dans l'assistant.
        const healthy = health.spf.found;
        try {
          await supabaseAdmin
            .from('oauth_connections')
            .update({ domain_health_ok: healthy, domain_health_checked_at: new Date().toISOString() })
            .eq('id', c.id);
        } catch {
          // Non bloquant : la migration domain_health_cache peut ne pas encore
          // être passée — le diagnostic reste affichable.
        }

        return {
          provider: c.provider,
          domain,
          consumer_domain: false,
          health,
          dkim,
          dns_provider: dnsProvider,
          sending_blocked: !healthy,
          suggested,
        };
      })
  );

  return NextResponse.json({ results });
}
