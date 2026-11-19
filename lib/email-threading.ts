// lib/email-threading.ts
//
// RÉPONDRE DANS LE FIL, et non à côté (11/09/2026).
//
// Avant : chaque email envoyé par Aaron partait avec un objet neuf et sans
// aucun en-tête de rattachement. Résultat mesuré par Alex sur ses boîtes de
// test — quatre conversations distinctes dans Outlook pour deux échanges
// réels. Le commercial perdait l'historique, le prospect recevait une suite
// de messages sans lien, et les filtres anti-spam voyaient une « réponse »
// qui ne répondait à rien.
//
// Ce module retrouve, pour une adresse donnée, le dernier message déjà
// échangé avec elle. Les expéditeurs (lib/google.ts, lib/microsoft.ts,
// lib/imap.ts) s'en servent pour poser « In-Reply-To » / « References » et
// reprendre l'objet d'origine.
//
// Best-effort de bout en bout : si on ne retrouve rien, l'email part comme
// avant. Ne jamais empêcher un envoi pour une question de fil.

import { supabaseAdmin } from './supabase-admin';

export interface ReplyContext {
  // Message-ID RFC 5322 du dernier message du fil (« <abc@domaine> ») :
  // c'est LUI qui recoud le fil chez le destinataire, quel que soit son
  // logiciel de messagerie.
  internetMessageId: string | null;
  // Identifiant propre au fournisseur (Gmail / Graph) du même message :
  // sert à retrouver le fil côté boîte du commercial.
  providerMessageId: string | null;
  // Objet d'origine, sans le « Re: » (ajouté au moment de l'envoi).
  subject: string | null;
}

// Normalise un objet : « Re: Re: RE : Objet » → « Objet ».
export function stripReplyPrefixes(subject: string): string {
  let s = (subject || '').trim();
  // Boucle plutôt qu'une seule passe : les clients de messagerie empilent
  // volontiers les préfixes, et en plusieurs langues.
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/^\s*(re|ré|rép|resp|aw|antw|antwort|rif|res)\s*(\[\d+\])?\s*:\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

// Ajoute « Re: » une seule fois, sur l'objet d'origine nettoyé.
export function replySubject(originalSubject: string): string {
  return `Re: ${stripReplyPrefixes(originalSubject)}`;
}

// Les prospects de CE commercial qui portent cette adresse, du plus récent
// au plus ancien.
//
// 19/11/2026 : la recherche filtrait sur prospects.user_id, alors que tout le
// reste du code rattache un prospect à son commercial par assigned_user_id.
// Si la colonne user_id n'existe pas, la requête échouait sans bruit et
// findReplyContext répondait toujours « aucun fil » : les réponses d'Aaron
// repartaient alors hors du fil. On essaie donc assigned_user_id d'abord, et
// user_id seulement si la première lecture est refusée.
async function prospectIdsFor(userId: string, email: string, limit: number): Promise<string[]> {
  for (const column of ['assigned_user_id', 'user_id']) {
    const { data, error } = await supabaseAdmin
      .from('prospects')
      .select('id')
      .eq(column, userId)
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error(`prospectIdsFor (${column}):`, error.message);
      continue;
    }
    return ((data || []) as any[]).map((p) => p.id);
  }
  return [];
}

// Dernier message échangé avec cette adresse, pour CE commercial.
//
// Le filtrage passe par le prospect : une adresse email ne suffit pas, deux
// commerciaux d'une même société pouvant démarcher le même contact — on ne
// veut jamais rattacher la réponse de l'un au fil de l'autre.
export async function findReplyContext(userId: string, toEmail: string): Promise<ReplyContext | null> {
  const email = (toEmail || '').trim().toLowerCase();
  if (!userId || !email.includes('@')) return null;

  try {
    const prospectIds = await prospectIdsFor(userId, email, 1);
    const prospect = prospectIds.length ? { id: prospectIds[0] } : null;
    if (!prospect) return null;

    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('prospect_id', (prospect as any).id)
      .eq('channel', 'email')
      .maybeSingle();
    if (!conversation) return null;

    // Le dernier message qui porte un Message-ID exploitable. On accepte
    // aussi bien un message entrant (réponse du prospect) que sortant (notre
    // propre envoi) : dans les deux cas, s'y rattacher garde un seul fil.
    const { data: messages } = await supabaseAdmin
      .from('messages')
      .select('internet_message_id, provider_message_id, subject, created_at')
      .eq('conversation_id', (conversation as any).id)
      .order('created_at', { ascending: false })
      .limit(20);

    const rows = (messages || []) as any[];
    const withId = rows.find((m) => m.internet_message_id || m.provider_message_id);
    // L'objet peut manquer sur les messages antérieurs au 11/09 (colonne
    // ajoutée ce jour-là) : on remonte le fil jusqu'à en trouver un.
    const withSubject = rows.find((m) => (m.subject || '').trim());

    if (!withId && !withSubject) return null;
    return {
      internetMessageId: withId?.internet_message_id || null,
      providerMessageId: withId?.provider_message_id || null,
      subject: (withSubject?.subject || '').trim() || null,
    };
  } catch (err: any) {
    // Colonne absente (migration_messages_sujet_fil_2026-09-11.sql pas encore
    // jouée) ou toute autre erreur : on n'empêche pas l'envoi.
    console.error('findReplyContext:', err?.message || err);
    return null;
  }
}

// CE PROSPECT A-T-IL DÉJÀ ÉCRIT ? (19/11/2026)
//
// Sert à décider si l'image de signature et le bandeau accompagnent un email
// de prospection (lib/messaging.ts). Même filtrage que findReplyContext :
// par le prospect de CE commercial, jamais par l'adresse seule.
//
// En cas de doute (prospect introuvable, erreur de lecture), on répond
// « non » : un email sans image arrive mieux qu'un email avec, et l'image
// reviendra d'elle-même à la première réponse.
export async function hasProspectReplied(userId: string, toEmail: string): Promise<boolean> {
  const email = (toEmail || '').trim().toLowerCase();
  if (!userId || !email.includes('@')) return false;
  try {
    const prospectIds = await prospectIdsFor(userId, email, 5);
    if (prospectIds.length === 0) return false;

    const { data: conversations } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .in('prospect_id', prospectIds);
    const conversationIds = ((conversations || []) as any[]).map((c) => c.id);
    if (conversationIds.length === 0) return false;

    const { count, error } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', conversationIds)
      .eq('direction', 'inbound');
    if (error) return false;
    return (count || 0) > 0;
  } catch (err: any) {
    console.error('hasProspectReplied:', err?.message || err);
    return false;
  }
}
