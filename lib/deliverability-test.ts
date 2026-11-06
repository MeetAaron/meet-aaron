// lib/deliverability-test.ts
//
// TEST DE DÉLIVRABILITÉ RÉEL AVANT LE PREMIER ENVOI (Alex, 05/11/2026 :
// « oui go ! », à faire en premier parce que ça protège le tout premier
// client).
//
// Les vérifications DNS (SPF, DKIM, DMARC — lib/email-deliverability.ts)
// disent si la boîte est BIEN CONFIGURÉE. Elles ne disent pas où un email
// ARRIVE : une configuration correcte sur un domaine neuf peut quand même
// finir en spam, et l'inverse existe. Ici on fait ce qu'un humain ferait
// avant une campagne : envoyer un vrai email à une boîte qu'on possède et
// aller regarder où il est tombé.
//
// Mécanique :
//   1. startDeliverabilityTest : Aaron envoie, DEPUIS la boîte du commercial,
//      un email court et naturel aux boîtes témoins de Meet Aaron (variable
//      DELIVERABILITY_SEED_EMAILS, par défaut aaron@meetaaron.app ; chaque
//      témoin doit être une boîte Google ou Microsoft connectée à Meet
//      Aaron, sinon il est ignoré). Une référence (AT-XXXXX) dans l'objet
//      permet de retrouver l'email chez les témoins.
//   2. pollDeliverabilityTest : on cherche la référence dans chaque boîte
//      témoin, spam compris, et on lit : boîte de réception ou spam, et les
//      en-têtes Authentication-Results (spf / dkim / dmarc).
//   3. Verdict : « ok » si tous les témoins l'ont en boîte de réception ;
//      « spam » si un témoin l'a en spam ; « introuvable » si, après
//      MAX_WAIT_MINUTES, aucun témoin ne l'a reçu (rejeté avant même la
//      boîte) ; « erreur » si ce sont NOS boîtes témoins qu'on n'arrive pas à
//      lire — dans ce cas on ne bloque personne pour notre propre panne.
//   4. deliverabilityGate, appelé par run-campaigns AVANT tout premier email :
//      « pass » (verdict ok, ou erreur, ou verdict négatif explicitement
//      ignoré par le commercial), « wait » (en cours), « blocked » (spam ou
//      introuvable, action requise affichée dans les stories, notification
//      push — c'est une action requise, donc une des rares pushs permises).
//
// La recherche de prospects continue pendant l'attente : seul l'ENVOI est
// retenu. Le test ne consomme ni crédit ni appel IA.

import { randomBytes } from 'crypto';
import { supabaseAdmin } from './supabase-admin';
import { sendEmailForUser } from './messaging';
import { getGoogleAccessToken } from './google';
import { getValidAccessToken as getMicrosoftAccessToken, graphRequest } from './microsoft';
import { sendPushNotification } from './push';

export type DeliverabilityVerdict = 'en_attente' | 'ok' | 'spam' | 'introuvable' | 'erreur';

export interface SeedBox {
  email: string;
  provider: 'google' | 'microsoft';
  user_id: string;
}

export interface SeedResult {
  email: string;
  provider: 'google' | 'microsoft';
  placement: 'inbox' | 'spam' | 'autre' | 'absent' | 'illisible';
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  checked_at: string;
}

export interface DeliverabilityTest {
  id: string;
  user_id: string;
  company_id: string | null;
  campaign_id: string | null;
  token: string;
  subject: string;
  seeds: SeedBox[];
  sent_at: string | null;
  resolved_at: string | null;
  verdict: DeliverabilityVerdict;
  results: SeedResult[];
  error: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

// Au-delà, un email qui n'est arrivé chez aucun témoin ne viendra plus.
const MAX_WAIT_MINUTES = 30;
// Un verdict favorable reste valable : on ne reteste pas à chaque campagne.
// Un domaine qui arrivait en boîte de réception il y a deux mois peut avoir
// changé, mais c'est le rôle des vérifications DNS quotidiennes, pas de ce
// test, de le voir.
const VERDICT_VALID_DAYS = 90;

const TOKEN_PREFIX = 'AT-';

export function isDeliverabilityTestSubject(subject: string | null | undefined): boolean {
  return new RegExp(`\\b${TOKEN_PREFIX}[A-Z0-9]{6}\\b`).test(String(subject || ''));
}

function newToken(): string {
  // 6 caractères lisibles, sans ambiguïté 0/O ni 1/I.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return TOKEN_PREFIX + out;
}

// Email naturel, dans la langue du commercial. Pas de mention « test de
// délivrabilité » ni de mot technique : les filtres jugent le message comme
// n'importe quel autre, c'est le but.
const TEXTS: Record<string, { subject: string; body: string }> = {
  fr: {
    subject: 'Un petit test avant de lancer — réf. {token}',
    body: 'Bonjour,\n\nAvant de démarrer les envois, je vérifie simplement que mes emails arrivent bien chez vous. Pas besoin de répondre.\n\nMerci et bonne journée,\n{name}',
  },
  en: {
    subject: 'A quick check before we start — ref. {token}',
    body: 'Hello,\n\nBefore we start sending, I am simply checking that my emails reach you properly. No reply needed.\n\nThanks and have a good day,\n{name}',
  },
  de: {
    subject: 'Ein kurzer Test vor dem Start — Ref. {token}',
    body: 'Guten Tag,\n\nbevor es losgeht, prüfe ich nur, ob meine E-Mails richtig bei Ihnen ankommen. Keine Antwort nötig.\n\nDanke und einen schönen Tag,\n{name}',
  },
  it: {
    subject: 'Una piccola verifica prima di partire — rif. {token}',
    body: 'Buongiorno,\n\nprima di iniziare gli invii, verifico semplicemente che le mie email vi arrivino correttamente. Non serve rispondere.\n\nGrazie e buona giornata,\n{name}',
  },
  es: {
    subject: 'Una pequeña prueba antes de empezar — ref. {token}',
    body: 'Hola,\n\nAntes de empezar los envíos, simplemente compruebo que mis correos os llegan bien. No hace falta responder.\n\nGracias y buen día,\n{name}',
  },
  pt: {
    subject: 'Um pequeno teste antes de começar — ref. {token}',
    body: 'Olá,\n\nAntes de começar os envios, estou apenas a verificar que os meus emails vos chegam bem. Não é preciso responder.\n\nObrigado e bom dia,\n{name}',
  },
  nl: {
    subject: 'Even testen voordat we starten — ref. {token}',
    body: 'Hallo,\n\nVoordat ik begin met versturen, controleer ik alleen even of mijn e-mails goed bij je aankomen. Je hoeft niet te antwoorden.\n\nBedankt en een fijne dag,\n{name}',
  },
};

// Boîtes témoins : des boîtes Google ou Microsoft connectées à Meet Aaron,
// désignées par leur adresse. Le commercial testé est exclu de ses propres
// témoins (s'envoyer un email à soi-même arrive toujours en boîte de
// réception, ça ne prouve rien).
export async function resolveSeedBoxes(excludeEmails: string[] = []): Promise<SeedBox[]> {
  const raw = process.env.DELIVERABILITY_SEED_EMAILS || 'aaron@meetaaron.app';
  const wanted = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const excluded = new Set(excludeEmails.map((e) => String(e || '').toLowerCase()));
  if (wanted.length === 0) return [];
  const { data } = await supabaseAdmin
    .from('oauth_connections')
    .select('user_id, provider, provider_account_email')
    .in('provider', ['google', 'microsoft']);
  const seeds: SeedBox[] = [];
  for (const email of wanted) {
    if (excluded.has(email)) continue;
    const conn = (data || []).find((c: any) => String(c.provider_account_email || '').toLowerCase() === email);
    if (!conn) continue;
    seeds.push({ email, provider: conn.provider as 'google' | 'microsoft', user_id: conn.user_id });
  }
  return seeds;
}

async function senderInfo(userId: string): Promise<{ name: string; locale: string; emails: string[]; companyId: string | null }> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('first_name, full_name, email, locale, company_id')
    .eq('id', userId)
    .maybeSingle();
  const { data: conns } = await supabaseAdmin
    .from('oauth_connections')
    .select('provider_account_email')
    .eq('user_id', userId);
  const emails = [user?.email, ...((conns || []).map((c: any) => c.provider_account_email))].filter(Boolean) as string[];
  const name = String((user as any)?.first_name || (user as any)?.full_name || '').trim();
  return { name, locale: String((user as any)?.locale || 'fr'), emails, companyId: (user as any)?.company_id || null };
}

export async function latestTestFor(userId: string): Promise<DeliverabilityTest | null> {
  const { data, error } = await supabaseAdmin
    .from('deliverability_tests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Table absente (migration pas encore passée) : on se comporte comme
    // avant le test — rien ne doit casser.
    return null;
  }
  return (data as DeliverabilityTest) || null;
}

// Lance un test : enregistre la ligne, puis envoie. L'envoi passe par
// sendEmailForUser en « transactional » : hors plafond de prospection et hors
// blocage DNS, puisque c'est justement l'état réel qu'on veut mesurer.
export async function startDeliverabilityTest(
  userId: string,
  opts?: { campaignId?: string | null }
): Promise<DeliverabilityTest | null> {
  const info = await senderInfo(userId);
  const seeds = await resolveSeedBoxes(info.emails);
  const token = newToken();
  const texts = TEXTS[info.locale] || TEXTS.fr;
  const subject = texts.subject.replace('{token}', token);
  const body = texts.body.replace('{name}', info.name || '').trimEnd();

  const { data: row, error } = await supabaseAdmin
    .from('deliverability_tests')
    .insert({
      user_id: userId,
      company_id: info.companyId,
      campaign_id: opts?.campaignId || null,
      token,
      subject,
      seeds,
      verdict: seeds.length === 0 ? 'erreur' : 'en_attente',
      error: seeds.length === 0 ? 'aucune boîte témoin connectée' : null,
      resolved_at: seeds.length === 0 ? new Date().toISOString() : null,
    })
    .select('*')
    .single();
  if (error || !row) {
    console.error('[délivrabilité] création du test impossible :', error?.message);
    return null;
  }
  if (seeds.length === 0) return row as DeliverabilityTest;

  const failures: string[] = [];
  for (const seed of seeds) {
    try {
      await sendEmailForUser(userId, seed.email, subject, body, { emailType: 'transactional' });
    } catch (err: any) {
      failures.push(`${seed.email} : ${err?.message || err}`);
    }
  }
  if (failures.length === seeds.length) {
    // L'envoi lui-même échoue : boîte non connectée, jeton révoqué… Ce n'est
    // pas un problème de délivrabilité, et la boîte en panne est déjà
    // signalée ailleurs (lib/mailbox-health.ts). On ne bloque pas.
    await supabaseAdmin
      .from('deliverability_tests')
      .update({ verdict: 'erreur', error: failures.join(' | ').slice(0, 500), resolved_at: new Date().toISOString() })
      .eq('id', row.id);
    return { ...(row as DeliverabilityTest), verdict: 'erreur', error: failures.join(' | ') };
  }
  const { data: sent } = await supabaseAdmin
    .from('deliverability_tests')
    .update({ sent_at: new Date().toISOString(), error: failures.length ? failures.join(' | ').slice(0, 500) : null })
    .eq('id', row.id)
    .select('*')
    .single();
  return (sent as DeliverabilityTest) || (row as DeliverabilityTest);
}

function parseAuth(headerValues: string[]): { spf: string | null; dkim: string | null; dmarc: string | null } {
  const joined = headerValues.join(' ');
  const pick = (k: string) => {
    const m = joined.match(new RegExp(`\\b${k}=([a-z]+)`, 'i'));
    return m ? m[1].toLowerCase() : null;
  };
  return { spf: pick('spf'), dkim: pick('dkim'), dmarc: pick('dmarc') };
}

async function readGmailSeed(seed: SeedBox, token: string): Promise<SeedResult> {
  const now = new Date().toISOString();
  const accessToken = await getGoogleAccessToken(seed.user_id);
  const q = `in:anywhere newer_than:3d "${token}"`;
  const list = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!list.ok) throw new Error(`Gmail ${list.status}`);
  const data = await list.json();
  const first = (data.messages || [])[0];
  if (!first) return { email: seed.email, provider: 'google', placement: 'absent', spf: null, dkim: null, dmarc: null, checked_at: now };
  const msg = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${first.id}?format=metadata&metadataHeaders=Authentication-Results&metadataHeaders=ARC-Authentication-Results&metadataHeaders=Subject`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!msg.ok) throw new Error(`Gmail ${msg.status}`);
  const full = await msg.json();
  const labels: string[] = full.labelIds || [];
  const headers: { name: string; value: string }[] = full.payload?.headers || [];
  const auth = parseAuth(headers.filter((h) => /authentication-results/i.test(h.name)).map((h) => h.value));
  const placement: SeedResult['placement'] = labels.includes('SPAM') ? 'spam' : labels.includes('INBOX') ? 'inbox' : 'autre';
  return { email: seed.email, provider: 'google', placement, ...auth, checked_at: now };
}

async function readOutlookSeed(seed: SeedBox, token: string): Promise<SeedResult> {
  const now = new Date().toISOString();
  const accessToken = await getMicrosoftAccessToken(seed.user_id);
  const search = await graphRequest<any>(
    seed.user_id,
    accessToken,
    'GET',
    `/me/messages?$search=${encodeURIComponent(`"${token}"`)}&$select=id,parentFolderId,subject,internetMessageHeaders&$top=5`,
    { label: 'délivrabilité : recherche témoin' }
  );
  if (!search.ok) throw new Error(`Graph ${search.status}`);
  const first = (search.data?.value || [])[0];
  if (!first) return { email: seed.email, provider: 'microsoft', placement: 'absent', spf: null, dkim: null, dmarc: null, checked_at: now };
  const [junk, inbox] = await Promise.all([
    graphRequest<any>(seed.user_id, accessToken, 'GET', '/me/mailFolders/junkemail?$select=id', { label: 'délivrabilité : dossier spam' }),
    graphRequest<any>(seed.user_id, accessToken, 'GET', '/me/mailFolders/inbox?$select=id', { label: 'délivrabilité : boîte de réception' }),
  ]);
  const headers: { name: string; value: string }[] = first.internetMessageHeaders || [];
  const auth = parseAuth(headers.filter((h) => /authentication-results/i.test(h.name)).map((h) => h.value));
  const placement: SeedResult['placement'] =
    junk.ok && first.parentFolderId === junk.data?.id ? 'spam'
      : inbox.ok && first.parentFolderId === inbox.data?.id ? 'inbox'
        : 'autre';
  return { email: seed.email, provider: 'microsoft', placement, ...auth, checked_at: now };
}

// Relit les témoins et met le verdict à jour. Renvoie la ligne à jour.
export async function pollDeliverabilityTest(test: DeliverabilityTest): Promise<DeliverabilityTest> {
  if (test.verdict !== 'en_attente') return test;
  if (!test.sent_at) return test;

  const results: SeedResult[] = [];
  let unreadable = 0;
  for (const seed of test.seeds || []) {
    try {
      results.push(seed.provider === 'google' ? await readGmailSeed(seed, test.token) : await readOutlookSeed(seed, test.token));
    } catch (err: any) {
      unreadable++;
      results.push({ email: seed.email, provider: seed.provider, placement: 'illisible', spf: null, dkim: null, dmarc: null, checked_at: new Date().toISOString() });
      console.error(`[délivrabilité] témoin ${seed.email} illisible :`, err?.message || err);
    }
  }

  const minutes = (Date.now() - new Date(test.sent_at).getTime()) / 60000;
  const found = results.filter((r) => r.placement === 'inbox' || r.placement === 'spam' || r.placement === 'autre');
  const missing = results.filter((r) => r.placement === 'absent');

  let verdict: DeliverabilityVerdict = 'en_attente';
  let error: string | null = null;
  if (found.some((r) => r.placement === 'spam')) {
    verdict = 'spam';
  } else if (found.length > 0 && missing.length === 0) {
    verdict = 'ok';
  } else if (minutes >= MAX_WAIT_MINUTES) {
    if (found.length > 0) verdict = 'ok'; // ceux qui l'ont reçu l'ont en boîte de réception
    else if (unreadable > 0 && unreadable === results.length) {
      verdict = 'erreur';
      error = 'boîtes témoins illisibles';
    } else verdict = 'introuvable';
  }

  const patch: any = { results };
  if (verdict !== 'en_attente') {
    patch.verdict = verdict;
    patch.resolved_at = new Date().toISOString();
    patch.error = error;
  }
  const { data } = await supabaseAdmin
    .from('deliverability_tests')
    .update(patch)
    .eq('id', test.id)
    .select('*')
    .single();
  const updated = ((data as DeliverabilityTest) || { ...test, ...patch }) as DeliverabilityTest;

  if ((verdict === 'spam' || verdict === 'introuvable') && test.verdict === 'en_attente') {
    await notifyBadVerdict(updated);
  }
  return updated;
}

const PUSH_TEXT: Record<string, { spam: string; introuvable: string; title: string }> = {
  fr: { title: 'Tes emails arrivent en spam', spam: 'Le test d\'envoi est tombé dans les spams. Aaron attend ta correction avant d\'écrire au premier prospect.', introuvable: 'Le test d\'envoi n\'est jamais arrivé. Aaron attend ta correction avant d\'écrire au premier prospect.' },
  en: { title: 'Your emails land in spam', spam: 'The test email went to spam. Aaron is waiting for your fix before writing to the first prospect.', introuvable: 'The test email never arrived. Aaron is waiting for your fix before writing to the first prospect.' },
  de: { title: 'Deine E-Mails landen im Spam', spam: 'Die Test-E-Mail ist im Spam gelandet. Aaron wartet auf deine Korrektur, bevor er den ersten Interessenten anschreibt.', introuvable: 'Die Test-E-Mail ist nie angekommen. Aaron wartet auf deine Korrektur, bevor er den ersten Interessenten anschreibt.' },
  it: { title: 'Le tue email finiscono nello spam', spam: 'L\'email di prova è finita nello spam. Aaron attende la tua correzione prima di scrivere al primo contatto.', introuvable: 'L\'email di prova non è mai arrivata. Aaron attende la tua correzione prima di scrivere al primo contatto.' },
  es: { title: 'Tus correos llegan a spam', spam: 'El correo de prueba cayó en spam. Aaron espera tu corrección antes de escribir al primer contacto.', introuvable: 'El correo de prueba nunca llegó. Aaron espera tu corrección antes de escribir al primer contacto.' },
  pt: { title: 'Os teus emails vão para o spam', spam: 'O email de teste caiu no spam. O Aaron aguarda a tua correção antes de escrever ao primeiro contacto.', introuvable: 'O email de teste nunca chegou. O Aaron aguarda a tua correção antes de escrever ao primeiro contacto.' },
  nl: { title: 'Je e-mails komen in de spam', spam: 'De test-e-mail is in de spam beland. Aaron wacht op je correctie voordat hij de eerste prospect schrijft.', introuvable: 'De test-e-mail is nooit aangekomen. Aaron wacht op je correctie voordat hij de eerste prospect schrijft.' },
};

async function notifyBadVerdict(test: DeliverabilityTest) {
  try {
    const info = await senderInfo(test.user_id);
    const texts = PUSH_TEXT[info.locale] || PUSH_TEXT.fr;
    await sendPushNotification(test.user_id, {
      title: texts.title,
      body: test.verdict === 'spam' ? texts.spam : texts.introuvable,
      url: `/app/connexions?user_id=${test.user_id}`,
    });
  } catch (err: any) {
    console.error('[délivrabilité] notification impossible :', err?.message || err);
  }
}

export type GateStatus = 'pass' | 'wait' | 'blocked';

// Appelé par run-campaigns avant tout premier email d'un commercial.
// Ne lève jamais : en cas de doute (table absente, lecture impossible), on
// laisse passer — le test protège, il ne doit jamais paralyser.
export async function deliverabilityGate(
  userId: string,
  campaignId?: string | null
): Promise<{ status: GateStatus; test: DeliverabilityTest | null }> {
  try {
    let test = await latestTestFor(userId);
    if (!test) {
      test = await startDeliverabilityTest(userId, { campaignId });
      if (!test) return { status: 'pass', test: null }; // table absente ou insertion impossible
      return { status: test.verdict === 'erreur' ? 'pass' : 'wait', test };
    }
    if (test.verdict === 'en_attente') {
      test = await pollDeliverabilityTest(test);
      if (test.verdict === 'en_attente') return { status: 'wait', test };
    }
    if (test.verdict === 'ok') {
      const ageDays = (Date.now() - new Date(test.resolved_at || test.created_at).getTime()) / 86400000;
      if (ageDays <= VERDICT_VALID_DAYS) return { status: 'pass', test };
      // Verdict trop ancien : on reteste, sans bloquer (l'ancien verdict
      // était bon ; si le nouveau est mauvais, il bloquera à son tour).
      const fresh = await startDeliverabilityTest(userId, { campaignId });
      return { status: 'pass', test: fresh || test };
    }
    if (test.verdict === 'erreur') return { status: 'pass', test };
    // spam ou introuvable
    if (test.acknowledged_at) return { status: 'pass', test };
    return { status: 'blocked', test };
  } catch (err: any) {
    console.error('[délivrabilité] garde-fou en erreur, on laisse passer :', err?.message || err);
    return { status: 'pass', test: null };
  }
}

// Résumé lisible pour les écrans (Connexions, Campagnes, stories).
export function summarizeTest(test: DeliverabilityTest | null) {
  if (!test) return null;
  return {
    id: test.id,
    verdict: test.verdict,
    sent_at: test.sent_at,
    resolved_at: test.resolved_at,
    acknowledged_at: test.acknowledged_at,
    error: test.error,
    seeds: (test.seeds || []).map((s) => ({ email: s.email, provider: s.provider })),
    results: (test.results || []).map((r) => ({
      email: r.email,
      provider: r.provider,
      placement: r.placement,
      spf: r.spf,
      dkim: r.dkim,
      dmarc: r.dmarc,
    })),
  };
}
