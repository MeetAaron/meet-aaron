// lib/mail-autodiscover.ts
// Devine les serveurs IMAP/SMTP d'une adresse email (09/09/2026, connecteur
// « Autre boîte mail » — voir lib/imap.ts). Objectif : que le commercial ne
// saisisse que son adresse et son mot de passe, comme dans Outlook ou sur un
// iPhone, sans jamais avoir à chercher « imap.monhebergeur.fr » lui-même.
//
// Trois sources, dans l'ordre :
//   1. une table des hébergeurs courants (FR/EU surtout), reconnus par le
//      domaine de l'adresse OU par les MX du domaine (un domaine d'entreprise
//      hébergé chez OVH a des MX *.ovh.net) — avec, en bonus, l'include SPF
//      à conseiller ;
//   2. la base publique de Thunderbird (autoconfig.thunderbird.net), qui
//      couvre des milliers de fournisseurs ;
//   3. à défaut, les noms conventionnels imap.<domaine> / mail.<domaine> —
//      testés au moment de la connexion (lib/imap.ts::testImapSmtp).
//
// Uniquement côté serveur (DNS Node). Aucune donnée personnelle : on ne
// regarde que le domaine.

import { promises as dns } from 'dns';

export interface MailServerSettings {
  imap_host: string;
  imap_port: number;
  imap_secure: boolean; // true = TLS implicite (993), false = STARTTLS (143)
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean; // true = TLS implicite (465), false = STARTTLS (587)
  username_is_email: boolean;
  provider_name: string | null; // libellé humain (« OVH », « Gandi »…)
  spf_include: string | null; // include SPF à conseiller si le domaine n'en a pas
  source: 'table' | 'thunderbird' | 'guess';
}

interface KnownProvider {
  name: string;
  match: RegExp; // testé sur le domaine de l'adresse ET sur chaque hôte MX
  imap: [string, number, boolean];
  smtp: [string, number, boolean];
  spf?: string;
}

const KNOWN: KnownProvider[] = [
  { name: 'OVH', match: /(^|\.)ovh\.(net|com)\.?$/i, imap: ['ssl0.ovh.net', 993, true], smtp: ['ssl0.ovh.net', 465, true], spf: 'include:mx.ovh.com' },
  { name: 'Gandi', match: /(^|\.)gandi\.net\.?$/i, imap: ['mail.gandi.net', 993, true], smtp: ['mail.gandi.net', 465, true], spf: 'include:_mailcust.gandi.net' },
  { name: 'IONOS', match: /(^|\.)(ionos|1and1|kundenserver|schlund)\.(fr|com|de|es|it|co\.uk)\.?$/i, imap: ['imap.ionos.fr', 993, true], smtp: ['smtp.ionos.fr', 465, true], spf: 'include:_spf-eu.ionos.com' },
  { name: 'Infomaniak', match: /(^|\.)infomaniak\.(ch|com)\.?$/i, imap: ['mail.infomaniak.com', 993, true], smtp: ['mail.infomaniak.com', 465, true], spf: 'include:spf.infomaniak.ch' },
  { name: 'o2switch', match: /(^|\.)o2switch\.net\.?$/i, imap: ['mail.o2switch.net', 993, true], smtp: ['mail.o2switch.net', 465, true] },
  { name: 'Hostinger', match: /(^|\.)hostinger\.(com|fr)\.?$/i, imap: ['imap.hostinger.com', 993, true], smtp: ['smtp.hostinger.com', 465, true], spf: 'include:_spf.mail.hostinger.com' },
  { name: 'Zoho', match: /(^|\.)zoho\.(eu|com)\.?$/i, imap: ['imap.zoho.eu', 993, true], smtp: ['smtp.zoho.eu', 465, true], spf: 'include:zohomail.eu' },
  { name: 'Orange', match: /(^|\.)(orange|wanadoo)\.fr\.?$/i, imap: ['imap.orange.fr', 993, true], smtp: ['smtp.orange.fr', 465, true] },
  { name: 'Free', match: /(^|\.)free\.fr\.?$/i, imap: ['imap.free.fr', 993, true], smtp: ['smtp.free.fr', 465, true] },
  { name: 'SFR', match: /(^|\.)(sfr|neuf)\.fr\.?$/i, imap: ['imap.sfr.fr', 993, true], smtp: ['smtp.sfr.fr', 465, true] },
  { name: 'La Poste', match: /(^|\.)laposte\.net\.?$/i, imap: ['imap.laposte.net', 993, true], smtp: ['smtp.laposte.net', 465, true] },
  { name: 'Bouygues', match: /(^|\.)(bbox|bouyguestelecom)\.fr\.?$/i, imap: ['imap.bbox.fr', 993, true], smtp: ['smtp.bbox.fr', 465, true] },
  { name: 'GMX', match: /(^|\.)gmx\.(net|com|fr|de)\.?$/i, imap: ['imap.gmx.net', 993, true], smtp: ['mail.gmx.net', 465, true] },
  { name: 'WEB.DE', match: /(^|\.)web\.de\.?$/i, imap: ['imap.web.de', 993, true], smtp: ['smtp.web.de', 465, true] },
  { name: 'Strato', match: /(^|\.)strato\.(de|com)\.?$/i, imap: ['imap.strato.de', 993, true], smtp: ['smtp.strato.de', 465, true] },
  { name: 'Yahoo', match: /(^|\.)(yahoo|ymail|rocketmail)\.(com|fr|de|it|es|co\.uk)\.?$/i, imap: ['imap.mail.yahoo.com', 993, true], smtp: ['smtp.mail.yahoo.com', 465, true] },
  { name: 'iCloud', match: /(^|\.)(icloud|me|mac)\.com\.?$/i, imap: ['imap.mail.me.com', 993, true], smtp: ['smtp.mail.me.com', 587, false] },
  { name: 'Aruba', match: /(^|\.)aruba\.it\.?$/i, imap: ['imaps.aruba.it', 993, true], smtp: ['smtps.aruba.it', 465, true] },
  { name: 'Register.it', match: /(^|\.)register\.it\.?$/i, imap: ['imap.register.it', 993, true], smtp: ['authsmtp.register.it', 465, true] },
  { name: 'TransIP', match: /(^|\.)transip\.(nl|email)\.?$/i, imap: ['imap.transip.email', 993, true], smtp: ['smtp.transip.email', 465, true] },
  { name: 'Mailbox.org', match: /(^|\.)mailbox\.org\.?$/i, imap: ['imap.mailbox.org', 993, true], smtp: ['smtp.mailbox.org', 465, true] },
  { name: 'Fastmail', match: /(^|\.)(fastmail|messagingengine)\.com\.?$/i, imap: ['imap.fastmail.com', 993, true], smtp: ['smtp.fastmail.com', 465, true] },
];

export async function resolveMxHosts(domain: string): Promise<string[]> {
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('dns timeout')), 3000)),
    ]);
    return (records || [])
      .sort((a: any, b: any) => a.priority - b.priority)
      .map((r: any) => String(r.exchange || '').toLowerCase().replace(/\.$/, ''));
  } catch {
    return [];
  }
}

function fromKnown(domain: string, mxHosts: string[]): MailServerSettings | null {
  for (const k of KNOWN) {
    if (k.match.test(domain) || mxHosts.some((h) => k.match.test(h))) {
      return {
        imap_host: k.imap[0],
        imap_port: k.imap[1],
        imap_secure: k.imap[2],
        smtp_host: k.smtp[0],
        smtp_port: k.smtp[1],
        smtp_secure: k.smtp[2],
        username_is_email: true,
        provider_name: k.name,
        spf_include: k.spf || null,
        source: 'table',
      };
    }
  }
  return null;
}

// Base publique Thunderbird : XML minimal, lu à la regex (pas de parseur XML
// côté serveur). On prend le premier serveur IMAP et le premier SMTP en TLS.
async function fromThunderbird(domain: string): Promise<MailServerSettings | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const xml = await res.text();
    const pick = (type: 'incomingServer' | 'outgoingServer', proto: 'imap' | 'smtp') => {
      const re = new RegExp(`<${type}[^>]*type="${proto}"[^>]*>([\\s\\S]*?)</${type}>`, 'gi');
      let m: RegExpExecArray | null;
      let fallback: { host: string; port: number; secure: boolean } | null = null;
      while ((m = re.exec(xml))) {
        const block = m[1];
        const host = block.match(/<hostname>([^<]+)<\/hostname>/i)?.[1]?.trim();
        const port = Number(block.match(/<port>(\d+)<\/port>/i)?.[1]);
        const socket = (block.match(/<socketType>([^<]+)<\/socketType>/i)?.[1] || '').trim().toUpperCase();
        if (!host || !port) continue;
        const entry = { host, port, secure: socket === 'SSL' };
        if (socket === 'SSL') return entry; // TLS implicite préféré
        if (!fallback && socket === 'STARTTLS') fallback = entry;
      }
      return fallback;
    };
    const imap = pick('incomingServer', 'imap');
    const smtp = pick('outgoingServer', 'smtp');
    if (!imap || !smtp) return null;
    const name = xml.match(/<displayShortName>([^<]+)<\/displayShortName>/i)?.[1]?.trim() || xml.match(/<displayName>([^<]+)<\/displayName>/i)?.[1]?.trim() || null;
    const usernameTpl = xml.match(/<username>([^<]+)<\/username>/i)?.[1]?.trim() || '%EMAILADDRESS%';
    return {
      imap_host: imap.host,
      imap_port: imap.port,
      imap_secure: imap.secure,
      smtp_host: smtp.host,
      smtp_port: smtp.port,
      smtp_secure: smtp.secure,
      username_is_email: /EMAILADDRESS/i.test(usernameTpl),
      provider_name: name,
      spf_include: null,
      source: 'thunderbird',
    };
  } catch {
    return null;
  }
}

export async function autodiscoverMailServers(email: string): Promise<MailServerSettings> {
  const domain = (email.split('@')[1] || '').trim().toLowerCase();
  const mxHosts = domain ? await resolveMxHosts(domain) : [];

  const known = fromKnown(domain, mxHosts);
  if (known) return known;

  // Thunderbird : d'abord le domaine lui-même, puis le domaine de l'hébergeur
  // déduit du MX (ex. mx1.mail.example-host.com → example-host.com).
  const candidates = [domain];
  for (const h of mxHosts) {
    const parts = h.split('.');
    if (parts.length >= 2) candidates.push(parts.slice(-2).join('.'));
  }
  for (const c of Array.from(new Set(candidates))) {
    if (!c) continue;
    const tb = await fromThunderbird(c);
    if (tb) return tb;
  }

  return {
    imap_host: `imap.${domain}`,
    imap_port: 993,
    imap_secure: true,
    smtp_host: `smtp.${domain}`,
    smtp_port: 465,
    smtp_secure: true,
    username_is_email: true,
    provider_name: null,
    spf_include: null,
    source: 'guess',
  };
}

// Variantes à essayer quand la première tentative de connexion échoue avec
// des serveurs devinés (source 'guess') : mail.<domaine>, puis STARTTLS.
export function guessVariants(domain: string): Array<Pick<MailServerSettings, 'imap_host' | 'imap_port' | 'imap_secure' | 'smtp_host' | 'smtp_port' | 'smtp_secure'>> {
  return [
    { imap_host: `mail.${domain}`, imap_port: 993, imap_secure: true, smtp_host: `mail.${domain}`, smtp_port: 465, smtp_secure: true },
    { imap_host: `imap.${domain}`, imap_port: 143, imap_secure: false, smtp_host: `smtp.${domain}`, smtp_port: 587, smtp_secure: false },
    { imap_host: `mail.${domain}`, imap_port: 143, imap_secure: false, smtp_host: `mail.${domain}`, smtp_port: 587, smtp_secure: false },
  ];
}
