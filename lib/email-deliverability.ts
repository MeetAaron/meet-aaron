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
