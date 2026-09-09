// lib/mailbox-provider.ts
//
// Devine le fournisseur de messagerie ('google' | 'microsoft' | null) à partir
// d'une adresse email — voir app/api/mailbox-provider/route.ts pour le
// pourquoi. Séparé de la route : Next n'accepte que les handlers HTTP comme
// exports d'un fichier route.ts.

import { promises as dns } from 'dns';

const GOOGLE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const MICROSOFT_DOMAINS = new Set([
  'outlook.com', 'outlook.fr', 'outlook.de', 'outlook.it', 'outlook.es', 'outlook.pt', 'outlook.be',
  'hotmail.com', 'hotmail.fr', 'hotmail.de', 'hotmail.it', 'hotmail.es', 'hotmail.co.uk',
  'live.com', 'live.fr', 'live.de', 'live.it', 'live.nl', 'live.be', 'msn.com',
]);

// 'imap' (09/09/2026) : le domaine a des MX, mais ni chez Google ni chez
// Microsoft (OVH, Gandi, Ionos, serveur d'entreprise…) → connecteur « Autre
// boîte mail » (lib/imap.ts). null = impossible de savoir (pas de MX, DNS en
// erreur) : l'écran laisse choisir.
export type MailboxProvider = 'google' | 'microsoft' | 'imap' | null;

export async function detectMailboxProvider(email: string): Promise<MailboxProvider> {
  const domain = (email.split('@')[1] || '').trim().toLowerCase();
  if (!domain) return null;
  if (GOOGLE_DOMAINS.has(domain)) return 'google';
  if (MICROSOFT_DOMAINS.has(domain)) return 'microsoft';

  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      // Un DNS qui traîne ne doit pas retarder l'écran : au-delà de 2 s, on
      // répond « inconnu » et l'utilisateur choisit.
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('dns timeout')), 2000)),
    ]);
    const hosts = (records || []).map((r) => String(r.exchange || '').toLowerCase());
    if (hosts.some((h) => /(^|\.)(google|googlemail)\.com\.?$/.test(h) || /aspmx/.test(h))) return 'google';
    if (hosts.some((h) => /(^|\.)outlook\.com\.?$/.test(h) || /(^|\.)office365\.(com|us)\.?$/.test(h))) return 'microsoft';
    return hosts.length > 0 ? 'imap' : null;
  } catch {
    return null;
  }
}

