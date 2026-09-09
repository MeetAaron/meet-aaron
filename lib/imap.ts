// lib/imap.ts
// Troisième fournisseur de boîte mail : « Autre boîte mail » via IMAP (lecture)
// et SMTP (envoi) — 09/09/2026.
//
// Pourquoi : le test Team System a montré que leur courrier est chez OVH (MX
// *.ovh.net), pas chez Microsoft — comme une grande partie des PME (OVH,
// Gandi, Ionos, Infomaniak, serveur d'entreprise…). Ni Google ni Microsoft ne
// peuvent donner accès à ces boîtes ; seuls les protocoles universels du
// courrier le peuvent, avec l'adresse et le mot de passe de la boîte, comme
// Outlook ou Thunderbird. Le mot de passe est saisi par le commercial dans
// l'app (jamais par un tiers), chiffré comme les jetons OAuth
// (lib/encryption.ts) et stocké dans oauth_connections.access_token ; les
// serveurs sont dans oauth_connections.settings (jsonb, voir
// migration_imap_connections_2026-09-09.sql).
//
// Même surface que lib/google.ts / lib/microsoft.ts pour que le reste de
// l'app (lib/messaging.ts, cron check-inbox, lib/manual-replies.ts) n'ait
// qu'un troisième branchement à faire :
//   sendImapEmail            ↔ sendGmailEmail / sendOutlookEmail
//   listNewImapMessages      ↔ listNewGmailMessages / listNewOutlookMessages
//   getImapMessage           ↔ getGmailMessage / getOutlookMessage
//   archiveImapMessage       ↔ archiveGmailThread / archiveOutlookMessage
//   listImapSentToProspect   ↔ listGmailThreadMessages / listOutlookConversationMessages
//
// Ce que l'IMAP ne sait pas faire : les libellés/catégories (le dossier
// « 🤖 Géré par Aaron » joue ce rôle, il se synchronise dans Outlook,
// Roundcube, téléphone…) et l'agenda (le lien ICS et les rappels suffisent).
//
// Le MIME est construit par nous (nodemailer), en UTF-8 + quoted-printable,
// exactement comme pour Gmail — donc pas de « [Message tronqué] » côté Gmail
// destinataire, contrairement aux envois délégués à Outlook.com.
//
// Dépendances : imapflow (client IMAP), nodemailer (SMTP + construction MIME),
// mailparser (lecture MIME). Importées en require() typé any : leurs
// définitions de types évoluent et ne doivent pas casser le build.

/* eslint-disable @typescript-eslint/no-var-requires */
import { supabaseAdmin } from './supabase-admin';
import { encryptToken, decryptToken } from './encryption';
import type { MailServerSettings } from './mail-autodiscover';

const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { simpleParser } = require('mailparser');

export const AARON_IMAP_FOLDER = '🤖 Géré par Aaron';
const AARON_IMAP_FOLDER_ASCII = 'Gere par Aaron';
export const AARON_SENT_HEADER = 'X-Aaron-Sent';
const CONNECT_TIMEOUT_MS = 20_000;

export type ImapSettings = Pick<
  MailServerSettings,
  'imap_host' | 'imap_port' | 'imap_secure' | 'smtp_host' | 'smtp_port' | 'smtp_secure'
> & { username?: string; aaron_folder?: string | null; sent_folder?: string | null };

interface ImapConnectionRow {
  id: string;
  user_id: string;
  provider_account_email: string;
  access_token: string; // mot de passe chiffré
  settings: ImapSettings | null;
}

export interface ImapCredentials {
  email: string;
  username: string;
  password: string;
  settings: ImapSettings;
}

async function getImapCredentials(userId: string): Promise<{ row: ImapConnectionRow; creds: ImapCredentials }> {
  const { data, error } = await supabaseAdmin
    .from('oauth_connections')
    .select('id, user_id, provider_account_email, access_token, settings')
    .eq('user_id', userId)
    .eq('provider', 'imap')
    .single<ImapConnectionRow>();
  if (error || !data || !data.settings) {
    throw new Error(`Aucune boîte IMAP configurée pour l'utilisateur ${userId}`);
  }
  return {
    row: data,
    creds: {
      email: data.provider_account_email,
      username: data.settings.username || data.provider_account_email,
      password: decryptToken(data.access_token),
      settings: data.settings,
    },
  };
}

function imapClient(creds: ImapCredentials): any {
  return new ImapFlow({
    host: creds.settings.imap_host,
    port: creds.settings.imap_port,
    secure: creds.settings.imap_secure,
    auth: { user: creds.username, pass: creds.password },
    logger: false,
    emitLogs: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: 60_000,
    tls: { servername: creds.settings.imap_host },
  });
}

function smtpTransport(creds: ImapCredentials): any {
  return nodemailer.createTransport({
    host: creds.settings.smtp_host,
    port: creds.settings.smtp_port,
    secure: creds.settings.smtp_secure,
    requireTLS: !creds.settings.smtp_secure,
    auth: { user: creds.username, pass: creds.password },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: 60_000,
    tls: { servername: creds.settings.smtp_host },
  });
}

async function withImap<T>(creds: ImapCredentials, fn: (client: any) => Promise<T>): Promise<T> {
  const client = imapClient(creds);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close?.();
    }
  }
}

// ---------------------------------------------------------------------------
// Dossiers
// ---------------------------------------------------------------------------

const SENT_NAMES = ['Sent', 'Sent Items', 'Sent Messages', 'Éléments envoyés', 'Elements envoyes', 'Envoyés', 'Envoyes', 'INBOX.Sent', 'INBOX/Sent', 'INBOX.Sent Items', 'INBOX/Sent Items', 'INBOXSent Messages', 'Gesendet', 'Inviati', 'Enviados', 'Verzonden'];

async function listMailboxes(client: any): Promise<any[]> {
  try {
    return (await client.list()) || [];
  } catch {
    return [];
  }
}

async function findSentFolder(client: any, boxes?: any[]): Promise<string | null> {
  const list = boxes || (await listMailboxes(client));
  const special = list.find((b: any) => String(b.specialUse || '').toLowerCase() === '\\sent');
  if (special) return special.path;
  const lower = SENT_NAMES.map((n) => n.toLowerCase());
  const byName = list.find((b: any) => lower.includes(String(b.path).toLowerCase()) || lower.includes(String(b.name).toLowerCase()));
  return byName ? byName.path : null;
}

// Renvoie le chemin du dossier « 🤖 Géré par Aaron », en le créant au besoin.
// Le nom avec emoji est encodé en UTF-7 modifié par imapflow (norme IMAP) ;
// si le serveur le refuse, repli sur un nom ASCII — les deux sont mémorisés
// dans settings.aaron_folder pour ne plus avoir à chercher.
export async function ensureAaronImapFolder(client: any, preferred?: string | null): Promise<string> {
  const boxes = await listMailboxes(client);
  const existing = (name: string) => boxes.find((b: any) => b.path === name || b.name === name || String(b.path).endsWith(`${b.delimiter || '.'}${name}`));
  for (const name of [preferred, AARON_IMAP_FOLDER, AARON_IMAP_FOLDER_ASCII]) {
    if (!name) continue;
    const found = existing(name);
    if (found) return found.path;
  }
  // Certains serveurs (Dovecot avec namespace « INBOX. ») exigent un préfixe :
  // on l'apprend de la boîte de réception.
  const inbox = boxes.find((b: any) => String(b.path).toUpperCase() === 'INBOX');
  const prefixed = boxes.find((b: any) => /^INBOX[./]/i.test(String(b.path)) && String(b.path).toUpperCase() !== 'INBOX');
  const prefix = prefixed ? `INBOX${prefixed.delimiter || String(prefixed.path).charAt(5)}` : '';
  for (const name of [AARON_IMAP_FOLDER, AARON_IMAP_FOLDER_ASCII]) {
    for (const path of Array.from(new Set([name, prefix ? `${prefix}${name}` : null, inbox && !prefix ? `INBOX${inbox.delimiter || '.'}${name}` : null].filter(Boolean) as string[]))) {
      try {
        const created = await client.mailboxCreate(path);
        const finalPath = created?.path || path;
        try {
          await client.mailboxSubscribe(finalPath);
        } catch {
          // l'abonnement est un confort d'affichage (Outlook/Thunderbird), pas une nécessité
        }
        return finalPath;
      } catch (err: any) {
        console.error(`[IMAP] création du dossier ${path} refusée:`, err?.message || err);
      }
    }
  }
  throw new Error('Impossible de créer le dossier « Géré par Aaron » sur ce serveur IMAP');
}

async function rememberFolders(rowId: string, settings: ImapSettings, patch: Partial<ImapSettings>) {
  const changed = Object.keys(patch).some((k) => (settings as any)[k] !== (patch as any)[k]);
  if (!changed) return;
  try {
    await supabaseAdmin
      .from('oauth_connections')
      .update({ settings: { ...settings, ...patch } })
      .eq('id', rowId);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Test de connexion (formulaire Connexions) — ne stocke rien
// ---------------------------------------------------------------------------

export async function testImapSmtp(creds: ImapCredentials): Promise<{ ok: true; sentFolder: string | null; aaronFolder: string } | { ok: false; step: 'imap' | 'smtp'; error: string }> {
  let sentFolder: string | null = null;
  let aaronFolder = '';
  try {
    await withImap(creds, async (client) => {
      const boxes = await listMailboxes(client);
      sentFolder = await findSentFolder(client, boxes);
      aaronFolder = await ensureAaronImapFolder(client, creds.settings.aaron_folder);
    });
  } catch (err: any) {
    return { ok: false, step: 'imap', error: String(err?.responseText || err?.message || err) };
  }
  try {
    const transport = smtpTransport(creds);
    await transport.verify();
    transport.close?.();
  } catch (err: any) {
    return { ok: false, step: 'smtp', error: String(err?.response || err?.message || err) };
  }
  return { ok: true, sentFolder, aaronFolder };
}

// Enregistre (ou remplace) la boîte IMAP d'un commercial. Une seule boîte
// par siège : la ligne (user_id, provider='imap') est unique.
export async function saveImapConnection(userId: string, creds: ImapCredentials, folders: { sentFolder: string | null; aaronFolder: string }) {
  const settings: ImapSettings = {
    ...creds.settings,
    username: creds.username,
    sent_folder: folders.sentFolder,
    aaron_folder: folders.aaronFolder,
  };
  const { error } = await supabaseAdmin.from('oauth_connections').upsert(
    {
      user_id: userId,
      provider: 'imap',
      provider_account_email: creds.email.toLowerCase(),
      access_token: encryptToken(creds.password),
      refresh_token: '',
      scopes: ['imap', 'smtp'],
      expires_at: '2099-12-31T00:00:00.000Z',
      settings,
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------

export async function sendImapEmail(
  userId: string,
  to: string,
  subject: string,
  body: string,
  opts?: {
    html?: boolean;
    textAlternative?: string;
    attachment?: { filename: string; contentBase64: string; mimeType: string };
    skipAaronLabel?: boolean;
    // Copie de l'envoi rangée directement dans « Géré par Aaron » (option
    // « Aaron range les fils qu'il gère ») plutôt que dans Éléments envoyés.
    archiveToAaronFolder?: boolean;
    fromName?: string | null;
  }
) {
  const { row, creds } = await getImapCredentials(userId);
  const domain = creds.email.split('@')[1] || 'meetaaron.app';
  const messageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}@${domain}>`;

  const mail: any = {
    from: opts?.fromName ? { name: opts.fromName, address: creds.email } : creds.email,
    to,
    subject,
    messageId,
    date: new Date(),
    headers: { [AARON_SENT_HEADER]: '1' },
    textEncoding: 'quoted-printable',
  };
  if (opts?.html) {
    mail.html = body;
    mail.text = opts.textAlternative || body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  } else {
    mail.text = body;
  }
  if (opts?.attachment) {
    mail.attachments = [
      {
        filename: opts.attachment.filename,
        content: Buffer.from(opts.attachment.contentBase64, 'base64'),
        contentType: opts.attachment.mimeType,
      },
    ];
  }

  // Le MÊME MIME part par SMTP et est copié dans la boîte : le commercial
  // retrouve exactement ce qui a été envoyé, avec le même Message-ID.
  const raw: Buffer = await new MailComposer(mail).compile().build();

  const transport = smtpTransport(creds);
  try {
    await transport.sendMail({ envelope: { from: creds.email, to: [to] }, raw });
  } finally {
    transport.close?.();
  }

  // Copie dans la boîte (SMTP seul ne laisse aucune trace, contrairement à
  // Gmail/Graph qui rangent d'eux-mêmes dans Éléments envoyés). Non bloquant :
  // l'email est parti, une copie manquante ne doit pas faire échouer l'envoi.
  try {
    await withImap(creds, async (client) => {
      let target: string | null = null;
      if (!opts?.skipAaronLabel && opts?.archiveToAaronFolder) {
        target = await ensureAaronImapFolder(client, creds.settings.aaron_folder);
        await rememberFolders(row.id, creds.settings, { aaron_folder: target });
      } else {
        target = creds.settings.sent_folder || (await findSentFolder(client));
        if (target) await rememberFolders(row.id, creds.settings, { sent_folder: target });
      }
      if (target) await client.append(target, raw, ['\\Seen'], new Date());
    });
  } catch (err: any) {
    console.error('[IMAP] copie de l’envoi dans la boîte impossible:', err?.message || err);
  }

  return { sent: true, id: messageId, internetMessageId: messageId };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export interface ImapListedMessage {
  id: string; // "INBOX:<uid>" — identifiant interne stable pour cette boîte
  internetMessageId: string | null;
  fromEmail: string;
  subject: string | null;
  internalDate: string | null;
  inReplyTo: string | null;
}

function parseId(id: string): { mailbox: string; uid: number } {
  const idx = id.lastIndexOf(':');
  return { mailbox: idx > 0 ? id.slice(0, idx) : 'INBOX', uid: Number(id.slice(idx + 1)) };
}

// Nouveaux messages de la boîte de réception depuis afterTimestamp. IMAP
// SEARCH SINCE travaille au jour près : on filtre ensuite sur la date
// interne, et la clé anti-doublon du cron (Message-ID) fait le reste.
export async function listNewImapMessages(userId: string, afterTimestamp: number): Promise<ImapListedMessage[]> {
  const { creds } = await getImapCredentials(userId);
  const since = new Date(afterTimestamp);
  const sinceDay = new Date(since.getFullYear(), since.getMonth(), since.getDate());
  return withImap(creds, async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      let uids: number[] = (await client.search({ since: sinceDay }, { uid: true })) || [];
      if (uids.length === 0) return [];
      uids = uids.sort((a, b) => b - a).slice(0, 100);
      const out: ImapListedMessage[] = [];
      // fetchAll (tableau) plutôt que l'itérateur asynchrone de fetch : la
      // cible ES5 du projet ne compile pas `for await`.
      const fetched: any[] = (await client.fetchAll(uids.join(','), { uid: true, envelope: true, internalDate: true }, { uid: true })) || [];
      for (const msg of fetched) {
        const env = msg.envelope || {};
        const internal = msg.internalDate ? new Date(msg.internalDate) : null;
        if (internal && internal.getTime() < afterTimestamp - 60_000) continue;
        out.push({
          id: `INBOX:${msg.uid}`,
          internetMessageId: env.messageId || null,
          fromEmail: (env.from?.[0]?.address || '').toLowerCase(),
          subject: env.subject || null,
          internalDate: internal ? internal.toISOString() : null,
          inReplyTo: env.inReplyTo || null,
        });
      }
      return out;
    } finally {
      lock.release();
    }
  });
}

export interface ImapParsedMessage {
  id: string;
  internetMessageId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  text: string;
  html: string | null;
  date: string | null;
  inReplyTo: string | null;
  references: string[];
  // Racine du fil : premier Message-ID des References, sinon In-Reply-To,
  // sinon le message lui-même — l'équivalent du threadId Gmail.
  threadRootId: string | null;
  headers: Record<string, string>;
}

function parsedToMessage(id: string, parsed: any): ImapParsedMessage {
  const headers: Record<string, string> = {};
  try {
    (parsed.headers as Map<string, any>).forEach((v: any, k: string) => {
      headers[k.toLowerCase()] = typeof v === 'string' ? v : v?.text || v?.value || JSON.stringify(v);
    });
  } catch {
    // en-têtes illisibles : on continue sans
  }
  const refs: string[] = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
  const inReplyTo: string | null = parsed.inReplyTo || null;
  const messageId: string | null = parsed.messageId || null;
  return {
    id,
    internetMessageId: messageId,
    fromEmail: (parsed.from?.value?.[0]?.address || '').toLowerCase(),
    fromName: parsed.from?.value?.[0]?.name || null,
    subject: parsed.subject || null,
    text: parsed.text || (parsed.html ? String(parsed.html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '') : ''),
    html: parsed.html || null,
    date: parsed.date ? new Date(parsed.date).toISOString() : null,
    inReplyTo,
    references: refs,
    threadRootId: refs[0] || inReplyTo || messageId,
    headers,
  };
}

export async function getImapMessage(userId: string, id: string): Promise<ImapParsedMessage> {
  const { creds } = await getImapCredentials(userId);
  const { mailbox, uid } = parseId(id);
  return withImap(creds, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!msg?.source) throw new Error(`Message IMAP ${id} introuvable`);
      const parsed = await simpleParser(msg.source);
      return parsedToMessage(id, parsed);
    } finally {
      lock.release();
    }
  });
}

// Déplace un message de la boîte de réception vers « 🤖 Géré par Aaron »
// (équivalent d'archiveGmailThread / archiveOutlookMessage). Rien n'est
// supprimé. Non bloquant.
export async function archiveImapMessage(userId: string, id: string | null | undefined) {
  if (!id) return;
  try {
    const { row, creds } = await getImapCredentials(userId);
    const { mailbox, uid } = parseId(id);
    await withImap(creds, async (client) => {
      const target = await ensureAaronImapFolder(client, creds.settings.aaron_folder);
      await rememberFolders(row.id, creds.settings, { aaron_folder: target });
      if (target === mailbox) return;
      const lock = await client.getMailboxLock(mailbox);
      try {
        await client.messageMove(String(uid), target, { uid: true });
      } finally {
        lock.release();
      }
    });
  } catch (err: any) {
    console.error('[IMAP] rangement du message impossible:', err?.message || err);
  }
}

// Messages envoyés PAR le commercial à un prospect donné (réponses manuelles,
// lib/manual-replies.ts). Sans fil au sens Gmail ni conversationId Outlook,
// on cherche par destinataire dans Éléments envoyés et dans le dossier
// Géré par Aaron, sur les 60 derniers jours. [] en cas d'échec.
export async function listImapSentToProspect(userId: string, prospectEmail: string): Promise<ImapParsedMessage[]> {
  try {
    const { creds } = await getImapCredentials(userId);
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    return await withImap(creds, async (client) => {
      const boxes = await listMailboxes(client);
      const sent = creds.settings.sent_folder || (await findSentFolder(client, boxes));
      const aaron = creds.settings.aaron_folder || boxes.find((b: any) => b.name === AARON_IMAP_FOLDER || b.name === AARON_IMAP_FOLDER_ASCII)?.path || null;
      const out: ImapParsedMessage[] = [];
      for (const box of Array.from(new Set([sent, aaron].filter(Boolean) as string[]))) {
        const lock = await client.getMailboxLock(box);
        try {
          const uids: number[] = (await client.search({ since, to: prospectEmail }, { uid: true })) || [];
          for (const uid of uids.slice(-30)) {
            const msg = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
            if (!msg?.source) continue;
            const parsed = await simpleParser(msg.source);
            out.push(parsedToMessage(`${box}:${uid}`, parsed));
          }
        } catch (err: any) {
          console.error(`[IMAP] lecture du dossier ${box} impossible:`, err?.message || err);
        } finally {
          lock.release();
        }
      }
      return out;
    });
  } catch (err: any) {
    console.error('[IMAP] recherche des réponses manuelles impossible:', err?.message || err);
    return [];
  }
}
