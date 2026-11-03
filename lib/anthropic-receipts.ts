// lib/anthropic-receipts.ts
//
// CRÉDITER UNE RECHARGE TOUT SEUL (Alex, 31/10/2026 : « c'est ridicule,
// change ça en automatique, je ne vais pas le faire manuellement à chaque
// fois »).
//
// Depuis la clé admin Anthropic, la DÉPENSE est lue directement chez
// Anthropic (lib/anthropic-admin.ts). Il restait une saisie manuelle : le
// SOLDE après chaque recharge, parce qu'Anthropic ne publie aucune API du
// solde restant — seulement la dépense.
//
// Mais une recharge laisse une trace : un reçu par email. On le lit, on en
// extrait le montant payé, et on enregistre un nouveau solde =
// (reste estimé juste avant la recharge) + (montant rechargé). Le compteur
// d'ancienneté repart à zéro par la même occasion, donc l'alerte « solde à
// revérifier » ne se déclenche plus pour rien.
//
// ── CE QUI EST VOLONTAIREMENT PRUDENT ────────────────────────────────────
//
// Un montant mal lu corromprait le solde en silence, et on reproduirait en
// pire le bug du 31/10 (une alerte fondée sur un chiffre faux). Donc :
//
//   - l'expéditeur doit être un domaine Anthropic connu ;
//   - le montant doit être ÉTIQUETÉ dans le texte (« amount paid », « total
//     paid »...). Le plus gros nombre de la page ne suffit pas : un reçu
//     contient aussi des identifiants, des numéros de carte tronqués et des
//     sous-totaux ;
//   - sans montant étiqueté, on ne crédite RIEN et on prévient Alex de
//     saisir à la main. Ne rien faire est toujours préférable à écrire un
//     chiffre inventé ;
//   - chaque reçu est marqué par son identifiant de message, donc jamais
//     compté deux fois ;
//   - et dans tous les cas Alex reçoit un email disant ce qui a été crédité,
//     pour qu'une erreur se voie le jour même et pas trois semaines après.

import { supabaseAdmin } from './supabase-admin';
import { searchGmailMessages, getGmailMessage, getGmailMessageMetadata } from './google';
import { gmailBodyText } from './manual-replies';
import { getBalanceStatus } from './api-balance';

// Domaines dont un reçu est accepté. Une adresse hors de cette liste est
// ignorée, quel que soit le sujet du message.
const TRUSTED_SENDER_DOMAINS = ['anthropic.com', 'claude.com', 'stripe.com'];

// Un reçu Stripe ne suffit pas : Stripe envoie aussi les reçus des autres
// abonnements d'Alex. Le corps doit parler d'Anthropic.
const MUST_MENTION = /anthropic|claude\.ai|claude\.com/i;

// Montants ÉTIQUETÉS seulement. L'ordre compte : on garde la première
// étiquette trouvée, de la plus explicite à la plus générale.
const AMOUNT_PATTERNS: RegExp[] = [
  /amount\s+paid[^0-9$]{0,40}\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  /total\s+paid[^0-9$]{0,40}\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  /montant\s+(?:pay[ée]|r[ée]gl[ée])[^0-9$]{0,40}\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  /(?:^|\n)\s*total[^0-9$\n]{0,30}\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
];

// Garde-fou de bon sens : une recharge Anthropic d'Alex se compte en
// dizaines de dollars. En dehors de cette fourchette, on préfère ne rien
// écrire et le lui dire.
const MIN_PLAUSIBLE_USD = 1;
const MAX_PLAUSIBLE_USD = 2000;

export interface ReceiptOutcome {
  messageId: string;
  amountUsd: number | null;
  credited: boolean;
  newBalanceUsd?: number;
  reason?: 'deja_traite' | 'montant_introuvable' | 'montant_aberrant' | 'colonne_absente';
}

function headerValue(meta: any, name: string): string {
  const headers = meta?.payload?.headers || [];
  const found = headers.find((h: any) => String(h.name).toLowerCase() === name.toLowerCase());
  return found?.value || '';
}

function senderTrusted(from: string): boolean {
  const lower = from.toLowerCase();
  return TRUSTED_SENDER_DOMAINS.some((d) => lower.includes(`@${d}`) || lower.includes(`.${d}>`));
}

export function extractPaidAmountUsd(text: string): number | null {
  for (const re of AMOUNT_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const value = Number(String(m[1]).replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

// Identifiant de la boîte à lire. Par défaut celle qui envoie déjà les
// emails système — c'est la boîte Meet Aaron. ANTHROPIC_RECEIPTS_USER_ID
// permet d'en désigner une autre sans toucher au code, si le compte
// Anthropic est rattaché à une autre adresse.
export function receiptsMailboxUserId(): string | null {
  return (
    (process.env.ANTHROPIC_RECEIPTS_USER_ID || '').trim() ||
    (process.env.SYSTEM_EMAIL_SENDER_USER_ID || '').trim() ||
    null
  );
}

export async function scanAnthropicReceipts(): Promise<{
  scanned: number;
  outcomes: ReceiptOutcome[];
  mailbox: string | null;
}> {
  const userId = receiptsMailboxUserId();
  if (!userId) return { scanned: 0, outcomes: [], mailbox: null };

  const query =
    'newer_than:30d (from:anthropic.com OR from:claude.com OR from:stripe.com) ' +
    '(subject:receipt OR subject:invoice OR subject:reçu OR subject:facture OR subject:payment)';
  const messages = await searchGmailMessages(userId, query, 25);

  const outcomes: ReceiptOutcome[] = [];

  for (const m of messages) {
    const meta = await getGmailMessageMetadata(userId, m.id);
    if (!meta) continue;
    if (!senderTrusted(headerValue(meta, 'From'))) continue;

    // Déjà traité ? La colonne peut ne pas exister (migration pas passée) :
    // dans ce cas on s'arrête net plutôt que de risquer un double crédit.
    const seen = await supabaseAdmin
      .from('api_balance_snapshots')
      .select('id')
      .eq('source_message_id', m.id)
      .limit(1)
      .maybeSingle();
    if (seen.error) {
      outcomes.push({ messageId: m.id, amountUsd: null, credited: false, reason: 'colonne_absente' });
      break;
    }
    if (seen.data) {
      outcomes.push({ messageId: m.id, amountUsd: null, credited: false, reason: 'deja_traite' });
      continue;
    }

    let full: any;
    try {
      full = await getGmailMessage(userId, m.id);
    } catch {
      continue;
    }
    const text = gmailBodyText(full?.payload);
    if (!text || !MUST_MENTION.test(`${headerValue(meta, 'Subject')}\n${text}`)) continue;

    const amountUsd = extractPaidAmountUsd(text);
    if (amountUsd === null) {
      outcomes.push({ messageId: m.id, amountUsd: null, credited: false, reason: 'montant_introuvable' });
      continue;
    }
    if (amountUsd < MIN_PLAUSIBLE_USD || amountUsd > MAX_PLAUSIBLE_USD) {
      outcomes.push({ messageId: m.id, amountUsd, credited: false, reason: 'montant_aberrant' });
      continue;
    }

    // Reste estimé AVANT la recharge. Si le solde est périmé, remainingUsd
    // vaut null : on repart alors du montant rechargé seul, ce qui
    // sous-estime — on préfère sous-estimer un solde que le gonfler.
    const before = await getBalanceStatus();
    const remainingBefore = before.remainingUsd !== null ? Math.max(0, before.remainingUsd) : 0;
    const newBalanceUsd = Math.round((remainingBefore + amountUsd) * 100) / 100;

    const { error: insertError } = await supabaseAdmin.from('api_balance_snapshots').insert({
      provider: 'anthropic',
      balance_usd: newBalanceUsd,
      as_of: new Date().toISOString(),
      source_message_id: m.id,
    });
    if (insertError) {
      outcomes.push({ messageId: m.id, amountUsd, credited: false, reason: 'colonne_absente' });
      break;
    }

    outcomes.push({ messageId: m.id, amountUsd, credited: true, newBalanceUsd });
  }

  return { scanned: messages.length, outcomes, mailbox: userId };
}
