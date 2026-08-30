// lib/email-deliverability.ts
// Vérification best-effort de la configuration DNS d'un domaine d'envoi
// (SPF + DMARC) — protection délivrabilité demandée en complément du plafond
// quotidien de prospection (voir lib/messaging.ts). Aucune écriture, aucune
// dépendance externe : uniquement des lectures DNS publiques (TXT), rapides
// et gratuites, exposées à l'utilisateur dans Connexions pour qu'il puisse
// corriger lui-même si besoin (ajout d'un enregistrement DNS chez son
// hébergeur — action hors de portée d'Aaron, qui n'a aucun accès DNS).
//
// DKIM est volontairement absent de cette vérification : la vérifier
// nécessite de connaître le "sélecteur" DKIM utilisé (ex: google._domainkey,
// selector1._domainkey chez Microsoft...), propre à chaque fournisseur et non
// déductible de façon fiable depuis l'extérieur. On affiche donc une
// recommandation générique plutôt qu'un faux résultat.

import { promises as dns } from 'dns';
import { supabaseAdmin } from './supabase-admin';

export interface DomainHealthCheck {
  domain: string;
  spf: { found: boolean; record: string | null };
  dmarc: { found: boolean; record: string | null; policy: string | null };
  checked_at: string;
}

async function lookupTxt(hostname: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(hostname);
    return records.map((chunks) => chunks.join(''));
  } catch {
    // NXDOMAIN, pas d'enregistrement, timeout réseau... traité comme "absent"
    // plutôt que de faire remonter une erreur — un domaine sans SPF/DMARC est
    // un résultat normal à afficher, pas un bug de la vérification.
    return [];
  }
}

export async function checkDomainHealth(domain: string): Promise<DomainHealthCheck> {
  const cleanDomain = domain.trim().toLowerCase();

  const [rootTxt, dmarcTxt] = await Promise.all([
    lookupTxt(cleanDomain),
    lookupTxt(`_dmarc.${cleanDomain}`),
  ]);

  const spfRecord = rootTxt.find((r) => r.toLowerCase().startsWith('v=spf1')) || null;
  const dmarcRecord = dmarcTxt.find((r) => r.toLowerCase().startsWith('v=dmarc1')) || null;

  let dmarcPolicy: string | null = null;
  if (dmarcRecord) {
    const match = dmarcRecord.match(/p=(\w+)/i);
    dmarcPolicy = match ? match[1].toLowerCase() : null;
  }

  return {
    domain: cleanDomain,
    spf: { found: !!spfRecord, record: spfRecord },
    dmarc: { found: !!dmarcRecord, record: dmarcRecord, policy: dmarcPolicy },
    checked_at: new Date().toISOString(),
  };
}

// Domaines "grand public" (Gmail, Outlook.com...) : la vérification SPF/DMARC
// n'a pas de sens à afficher à l'utilisateur puisqu'il ne gère pas le DNS de
// ce domaine — seule une adresse pro sur un domaine propre à l'entreprise est
// concernée par ce diagnostic.
const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com',
  'hotmail.fr', 'live.com', 'live.fr', 'yahoo.com', 'yahoo.fr', 'icloud.com',
  'me.com', 'aol.com', 'gmx.com', 'gmx.fr', 'protonmail.com', 'proton.me',
]);

export function isConsumerDomain(domain: string): boolean {
  return CONSUMER_DOMAINS.has(domain.trim().toLowerCase());
}

// Vérification DKIM par sélecteurs connus (assistant délivrabilité,
// 30/08/2026). Le commentaire en tête de fichier disait à raison qu'un
// sélecteur DKIM n'est pas devinable "en général" — mais ici on connaît le
// FOURNISSEUR de la boîte connectée, et chaque fournisseur utilise des
// sélecteurs standards : "google" chez Google Workspace, "selector1"/
// "selector2" chez Microsoft 365. dns.resolveTxt suit les CNAME, donc la
// chaîne selector1._domainkey.domaine → ...onmicrosoft.com est résolue
// jusqu'au TXT final. Résultat : found=true si un enregistrement DKIM
// (v=DKIM1 / clé publique p=) répond pour au moins un sélecteur du
// fournisseur. NON BLOQUANT : c'est le "petit conseil" affiché dans
// Connexions (item 15 du docx Modifs Aaron) — SPF+DMARC alignés suffisent à
// passer DMARC, DKIM personnalisé est le bonus qui solidifie.
const DKIM_SELECTORS: Record<'google' | 'microsoft', string[]> = {
  google: ['google'],
  microsoft: ['selector1', 'selector2'],
};

export async function checkDkim(domain: string, provider: 'google' | 'microsoft'): Promise<{
  found: boolean;
  selector: string | null;
}> {
  const cleanDomain = domain.trim().toLowerCase();
  for (const selector of DKIM_SELECTORS[provider]) {
    const records = await lookupTxt(`${selector}._domainkey.${cleanDomain}`);
    const dkim = records.find((r) => /v=DKIM1/i.test(r) || /(^|;)\s*p=/i.test(r));
    if (dkim) return { found: true, selector };
  }
  return { found: false, selector: null };
}

// Détection de l'hébergeur DNS du domaine (via ses serveurs de noms) pour
// afficher des instructions "où cliquer" personnalisées dans l'assistant
// délivrabilité — un utilisateur non technique ne sait généralement même pas
// chez qui son domaine est géré. Best-effort : null si les NS ne matchent
// aucun hébergeur connu (l'assistant affiche alors les instructions
// génériques).
const DNS_PROVIDERS: { match: RegExp; name: string; recordsUrl: string }[] = [
  { match: /ovh\.net$|ovh\.ca$/i, name: 'OVH', recordsUrl: 'https://www.ovh.com/manager/#/web/domain' },
  { match: /gandi\.net$/i, name: 'Gandi', recordsUrl: 'https://admin.gandi.net/domain' },
  { match: /ionos\.(com|fr|de)$|ui-dns\./i, name: 'IONOS (1&1)', recordsUrl: 'https://my.ionos.fr/domain-dns-settings' },
  { match: /godaddy\.com$|domaincontrol\.com$/i, name: 'GoDaddy', recordsUrl: 'https://dcc.godaddy.com/manage/dns' },
  { match: /cloudflare\.com$/i, name: 'Cloudflare', recordsUrl: 'https://dash.cloudflare.com' },
  { match: /wixdns\.net$/i, name: 'Wix', recordsUrl: 'https://manage.wix.com/account/domains' },
  { match: /o2switch\.net$/i, name: 'o2switch', recordsUrl: 'https://www.o2switch.fr/connexion-cpanel/' },
  { match: /hostinger|niagahoster/i, name: 'Hostinger', recordsUrl: 'https://hpanel.hostinger.com/domains' },
  { match: /infomaniak\.com$/i, name: 'Infomaniak', recordsUrl: 'https://manager.infomaniak.com' },
  { match: /amen\.fr$|secureserver/i, name: 'Amen', recordsUrl: 'https://www.amen.fr/login/' },
  { match: /namecheap|registrar-servers\.com$/i, name: 'Namecheap', recordsUrl: 'https://ap.www.namecheap.com/domains/list/' },
  { match: /squarespacedns\.com$|googledomains\.com$/i, name: 'Squarespace Domains', recordsUrl: 'https://account.squarespace.com/domains' },
  { match: /bookmyname\.com$/i, name: 'BookMyName', recordsUrl: 'https://www.bookmyname.com/manager.cgi' },
  { match: /online\.net$|scaleway/i, name: 'Scaleway / Online.net', recordsUrl: 'https://console.scaleway.com/domains/external' },
  { match: /azure-dns\./i, name: 'Azure DNS', recordsUrl: 'https://portal.azure.com' },
  { match: /awsdns/i, name: 'Amazon Route 53', recordsUrl: 'https://console.aws.amazon.com/route53/' },
];

export async function detectDnsProvider(domain: string): Promise<{ name: string; recordsUrl: string } | null> {
  try {
    const ns = await dns.resolveNs(domain.trim().toLowerCase());
    for (const server of ns) {
      const found = DNS_PROVIDERS.find((p) => p.match.test(server.replace(/\.$/, '')));
      if (found) return { name: found.name, recordsUrl: found.recordsUrl };
    }
    return null;
  } catch {
    return null;
  }
}

// Suggestion de valeur SPF prête à copier-coller, selon le fournisseur
// connecté — seul l'include change (Google Workspace vs Microsoft 365), le
// reste de la syntaxe est standard. Ne sert que quand SPF est absent : si un
// SPF existe déjà mais est mal formé, on ne tente pas de le corriger
// automatiquement (risque de casser un include existant vers un autre
// service d'envoi que le commercial utiliserait par ailleurs).
export function suggestedSpfRecord(provider: 'google' | 'microsoft'): string {
  return provider === 'microsoft'
    ? 'v=spf1 include:spf.protection.outlook.com ~all'
    : 'v=spf1 include:_spf.google.com ~all';
}

// Suggestion de valeur DMARC prête à copier-coller — rua pointe vers
// l'adresse connectée elle-même (le commercial reçoit les rapports agrégés
// sur la boîte qu'il vient de connecter, pas de configuration supplémentaire
// nécessaire). p=quarantine est un bon compromis par défaut : protège sans
// bloquer complètement en cas de faux positif pendant la mise en route.
export function suggestedDmarcRecord(reportEmail: string): string {
  return `v=DMARC1; p=quarantine; rua=mailto:${reportEmail}; adkim=r; aspf=r`;
}

// Best-effort, appelée juste après qu'un commercial connecte Gmail ou
// Outlook (voir app/api/auth/google/callback et .../microsoft/callback) :
// si son domaine pro n'a ni SPF ni DMARC correct, le prévient tout de suite
// par notification push plutôt que de compter sur lui pour aller regarder le
// badge dans Connexions — la majorité des utilisateurs ne reviennent jamais
// sur cet écran une fois la connexion faite. Ne bloque jamais le flux OAuth
// (fire-and-forget côté appelant) et ne fait rien pour un domaine grand
// public (Gmail, Outlook.com...) puisque l'utilisateur n'en gère pas le DNS.
export async function notifyIfDeliverabilityIssue(userId: string, email: string): Promise<void> {
  try {
    const domain = email.split('@')[1];
    if (!domain || isConsumerDomain(domain)) return;

    const health = await checkDomainHealth(domain);
    if (health.spf.found && health.dmarc.found) return;

    // Import différé pour éviter une dépendance circulaire potentielle
    // (lib/push.ts n'importe pas ce fichier, mais on reste prudent puisque
    // les deux vivent dans lib/ et pourraient évoluer).
    const { sendPushNotification } = await import('./push');
    const missing = [!health.spf.found && 'SPF', !health.dmarc.found && 'DMARC'].filter(Boolean).join(' et ');
    await sendPushNotification(userId, {
      title: 'Domaine à sécuriser',
      body: `${domain} n'a pas de ${missing} configuré — tes emails de prospection risquent le spam. Aaron te propose le correctif dans Connexions.`,
      url: '/app/connexions',
    });
  } catch (err: any) {
    console.error('Erreur notification délivrabilité (non bloquant):', err.message);
  }
}

// Demande Alex (30/08/2026, test réel : un email de prospection envoyé depuis
// teamsystem-paris.fr, domaine sans DMARC, est parti tout droit en spam côté
// prospect) : "je veux un vrai blocage... que j'utilise un email pro avec
// google ou outlook je veux que ça fonctionne à chaque fois". Un email de
// prospection qui part systématiquement en spam ne sert à rien et abîme la
// réputation d'Aaron aux yeux du prospect — mieux vaut bloquer l'envoi et
// rediriger vers le correctif DNS (Connexions) que d'envoyer dans le vide.
//
// Résultat mis en cache sur oauth_connections (domain_health_ok/
// domain_health_checked_at, voir migration_domain_health_cache_2026-08-30.sql)
// plutôt que vérifié en direct à CHAQUE envoi : une campagne peut contacter
// des dizaines de prospects d'affilée, et interroger le DNS à chaque email
// serait à la fois lent et fragile (un simple aléa réseau ferait passer un
// domaine parfaitement sain pour en panne). Rafraîchi si absent ou vieux de
// plus de 24h — largement suffisant, un enregistrement DNS ne change pas
// d'une heure à l'autre.
const DOMAIN_HEALTH_CACHE_MS = 24 * 60 * 60 * 1000; // 24h

export async function isDomainHealthyForSending(connection: {
  id: string;
  provider_account_email: string;
  domain_health_ok?: boolean | null;
  domain_health_checked_at?: string | null;
}): Promise<{ healthy: boolean; domain: string | null }> {
  const domain = connection.provider_account_email?.split('@')[1] || null;
  // Domaine grand public (gmail.com, outlook.com...) : jamais de blocage,
  // l'utilisateur n'a de toute façon aucune main sur ce DNS — voir
  // isConsumerDomain plus haut.
  if (!domain || isConsumerDomain(domain)) return { healthy: true, domain };

  const checkedAtMs = connection.domain_health_checked_at
    ? new Date(connection.domain_health_checked_at).getTime()
    : 0;
  const isStale = Date.now() - checkedAtMs > DOMAIN_HEALTH_CACHE_MS;

  if (!isStale && connection.domain_health_ok !== null && connection.domain_health_ok !== undefined) {
    return { healthy: connection.domain_health_ok, domain };
  }

  const health = await checkDomainHealth(domain);
  const healthy = health.spf.found && health.dmarc.found;

  try {
    await supabaseAdmin
      .from('oauth_connections')
      .update({ domain_health_ok: healthy, domain_health_checked_at: new Date().toISOString() })
      .eq('id', connection.id);
  } catch (err: any) {
    // Non-bloquant : au pire le prochain envoi revérifiera en direct au lieu
    // de lire un cache pas encore posé — jamais pire que le comportement
    // "toujours en direct" d'avant cette fonctionnalité.
    console.error('Erreur mise en cache santé domaine (non bloquant):', err.message);
  }

  return { healthy, domain };
}
