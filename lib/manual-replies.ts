// lib/manual-replies.ts
//
// RÉPONSES MANUELLES DU COMMERCIAL dans un fil géré par Aaron.
//
// Le problème (question Alex, 08/09/2026 : « si un utilisateur va dans
// l'archive "géré par Aaron" et décide malgré tout de répondre à un email,
// qu'est-ce que ça fait ? ») : rien, et c'est ça le bug. Aaron n'enregistrait
// que les messages ENTRANTS (ceux du prospect) et ses PROPRES envois. Un email
// que le commercial tape lui-même depuis Gmail ou Outlook n'existait nulle
// part dans l'historique. À la réponse suivante du prospect, Aaron croyait que
// le dernier mot était le sien, et répondait à côté — en reproposant, en
// contredisant, ou en remerciant pour quelque chose qui n'avait pas eu lieu.
//
// Décision Alex : garder le bouton « je reprends la main » (ai_managed) comme
// interrupteur explicite, ET tolérer l'erreur d'un commercial qui répond sans
// l'avoir basculé. Donc : quand le cron traite un message entrant, il relit le
// fil chez le fournisseur, repère les messages écrits par le commercial que
// nous ne connaissons pas, et les enregistre comme sortants — Aaron répond
// ensuite en sachant ce qui a été dit. Le commercial est prévenu une fois,
// avec le rappel du bouton s'il préfère qu'Aaron se retire.
//
// Comment on distingue un envoi d'Aaron d'une réponse manuelle : par
// l'en-tête X-Aaron-Sent posé sur tout ce qu'Aaron envoie (lib/google.ts,
// lib/microsoft.ts). Comparer des corps de texte aurait été fragile.
//
// Coût : une lecture de fil par message entrant traité, côté Gmail/Graph
// uniquement — zéro appel d'IA. Best-effort : un échec ici ne doit jamais
// empêcher le traitement du message entrant.

import { supabaseAdmin } from './supabase-admin';
import { sendPushNotification } from './push';
import { listGmailThreadMessages, AARON_SENT_HEADER } from './google';
import { listOutlookConversationMessages } from './microsoft';

const NOTICE: Record<string, { title: string; body: string }> = {
  fr: { title: 'J\'ai vu ta réponse', body: 'Tu as répondu toi-même à {name} : j\'en tiens compte dans la suite. Si tu préfères gérer cette conversation seul, bascule « je reprends la main » sur sa fiche.' },
  en: { title: 'I saw your reply', body: 'You replied to {name} yourself: I\'ll take it into account from here. If you\'d rather handle this conversation alone, switch "I\'ll take over" on their card.' },
  de: { title: 'Ich habe Ihre Antwort gesehen', body: 'Sie haben {name} selbst geantwortet: Ich berücksichtige das ab jetzt. Wenn Sie dieses Gespräch lieber allein führen, setzen Sie auf der Karte „Ich übernehme".' },
  it: { title: 'Ho visto la tua risposta', body: 'Hai risposto tu stesso a {name}: ne terrò conto d\'ora in poi. Se preferisci gestire da solo questa conversazione, attiva « riprendo io » sulla sua scheda.' },
  es: { title: 'He visto tu respuesta', body: 'Has respondido tú mismo a {name}: lo tendré en cuenta a partir de ahora. Si prefieres llevar esta conversación solo, activa «me encargo yo» en su ficha.' },
  pt: { title: 'Vi a sua resposta', body: 'Respondeu você mesmo a {name}: vou tê-lo em conta daqui em diante. Se preferir gerir esta conversa sozinho, ative «eu trato disto» na ficha.' },
  nl: { title: 'Ik heb uw antwoord gezien', body: 'U hebt {name} zelf geantwoord: ik houd er vanaf nu rekening mee. Wilt u dit gesprek liever alleen voeren, zet dan „ik neem het over" op de fiche.' },
};

// Coupe la partie citée d'une réponse (« Le … a écrit : », « On … wrote: »,
// lignes commençant par « > »). On ne garde que ce que le commercial a
// réellement tapé : le reste est déjà dans l'historique.
const QUOTE_MARKERS = [
  /^On .+ wrote:/i,
  /^Le .+ a écrit ?:/i,
  /^Am .+ schrieb .+:/i,
  /^Il .+ ha scritto:/i,
  /^El .+ escribió:/i,
  /^Em .+ escreveu:/i,
  /^Op .+ schreef .+:/i,
  /^-----Original Message-----/i,
  /^-----Message d'origine-----/i,
  /^From: .+/i,
  /^De : .+/i,
  /^>/,
];

export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex((line) => QUOTE_MARKERS.some((re) => re.test(line.trim())));
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  return kept.join('\n').trim();
}

function emailOf(headerValue: string | null | undefined): string {
  if (!headerValue) return '';
  const match = headerValue.match(/<([^>]+)>/);
  return (match ? match[1] : headerValue).trim().toLowerCase();
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function gmailBodyText(payload: any): string {
  if (!payload) return '';
  const decode = (data: string) => Buffer.from(data, 'base64').toString('utf-8');
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decode(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data) return htmlToText(decode(payload.body.data));
  for (const part of payload.parts || []) {
    const found = gmailBodyText(part);
    if (found) return found;
  }
  return '';
}

type ManualCandidate = { providerMessageId: string; text: string; sentAt: string | null };

async function gmailCandidates(userId: string, threadId: string, userEmail: string): Promise<ManualCandidate[]> {
  const messages = await listGmailThreadMessages(userId, threadId);
  const out: ManualCandidate[] = [];
  for (const m of messages) {
    const headers: any[] = m.payload?.headers || [];
    const header = (name: string) => headers.find((h) => String(h.name).toLowerCase() === name.toLowerCase())?.value || null;
    if (emailOf(header('From')) !== userEmail) continue;
    if (header(AARON_SENT_HEADER)) continue;
    // Brouillon jamais envoyé : n'a rien à faire dans l'historique.
    if ((m.labelIds || []).includes('DRAFT')) continue;
    const text = stripQuotedReply(gmailBodyText(m.payload));
    if (!text) continue;
    out.push({
      providerMessageId: m.id,
      text,
      sentAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    });
  }
  return out;
}

async function outlookCandidates(userId: string, conversationId: string, userEmail: string): Promise<ManualCandidate[]> {
  const messages = await listOutlookConversationMessages(userId, conversationId);
  const out: ManualCandidate[] = [];
  for (const m of messages) {
    if (m.isDraft) continue;
    if ((m.from?.emailAddress?.address || '').toLowerCase() !== userEmail) continue;
    const ih: any[] = m.internetMessageHeaders || [];
    if (ih.some((h) => String(h.name).toLowerCase() === AARON_SENT_HEADER.toLowerCase())) continue;
    const raw = m.body?.content || '';
    const text = stripQuotedReply(m.body?.contentType === 'html' || /<[a-z][\s\S]*>/i.test(raw) ? htmlToText(raw) : raw);
    if (!text) continue;
    out.push({ providerMessageId: m.id, text, sentAt: m.sentDateTime || null });
  }
  return out;
}

export async function ingestManualReplies(params: {
  provider: 'google' | 'microsoft';
  userId: string;
  userEmail: string | null | undefined;
  conversationId: string; // conversations.id (base), pas celui du fournisseur
  providerThreadId: string | null | undefined; // Gmail threadId ou Outlook conversationId
  prospectId: string;
  prospectName: string | null | undefined;
  prospectEmail: string;
}): Promise<number> {
  try {
    const userEmail = (params.userEmail || '').toLowerCase();
    if (!userEmail || !params.providerThreadId) return 0;

    const candidates =
      params.provider === 'google'
        ? await gmailCandidates(params.userId, params.providerThreadId, userEmail)
        : await outlookCandidates(params.userId, params.providerThreadId, userEmail);
    if (candidates.length === 0) return 0;

    // Déjà connus : un passage précédent les a enregistrés. La colonne
    // provider_message_id sert exactement à ça (voir
    // migration_oauth_catchup_2026-08-27.sql).
    const { data: known } = await supabaseAdmin
      .from('messages')
      .select('provider_message_id')
      .eq('conversation_id', params.conversationId)
      .in('provider_message_id', candidates.map((c) => c.providerMessageId));
    const knownIds = new Set((known || []).map((k: any) => k.provider_message_id));
    const fresh = candidates.filter((c) => !knownIds.has(c.providerMessageId));
    if (fresh.length === 0) return 0;

    const rows = fresh.map((c) => ({
      conversation_id: params.conversationId,
      direction: 'outbound',
      sender_email: userEmail,
      recipient_email: params.prospectEmail,
      body: c.text,
      provider_message_id: c.providerMessageId,
      ...(c.sentAt ? { sent_at: c.sentAt } : {}),
    }));
    const { error } = await supabaseAdmin.from('messages').insert(rows);
    if (error) {
      console.error('Enregistrement des réponses manuelles:', error.message);
      return 0;
    }

    // Une seule notification par passage, même si plusieurs réponses manuelles
    // sont découvertes d'un coup : c'est le même fait pour le commercial.
    const { data: user } = await supabaseAdmin.from('users').select('locale').eq('id', params.userId).maybeSingle();
    const texts = NOTICE[(user as any)?.locale] || NOTICE.fr;
    await sendPushNotification(params.userId, {
      title: texts.title,
      body: texts.body.replace('{name}', params.prospectName || params.prospectEmail),
      url: `/app/prospects?user_id=${params.userId}`,
    }).catch(() => {});

    console.log(`Réponses manuelles enregistrées : ${fresh.length} pour le prospect ${params.prospectId}.`);
    return fresh.length;
  } catch (err: any) {
    console.error('ingestManualReplies:', params.prospectId, err?.message);
    return 0;
  }
}
