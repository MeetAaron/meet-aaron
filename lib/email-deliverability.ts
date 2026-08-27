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
