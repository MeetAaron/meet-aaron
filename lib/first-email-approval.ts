// lib/first-email-approval.ts
//
// QUAND LE PREMIER EMAIL ATTEND LE COMMERCIAL.
//
// Règle d'Alex (docx du 08/11/2026) : « par défaut Aaron envoie de lui-même,
// sauf vraiment le tout premier email » — celui du tout premier prospect du
// compte, pour être certain que la fiche entreprise et le ton sont bons. Les
// suivants partent seuls, à moins que le commercial n'ait coché « je valide
// chaque premier email » dans Préférences (users.require_first_email_approval).
//
// « Tout premier » = aucun email de prospection jamais parti depuis ce compte
// ET aucun brouillon déjà en attente de validation (sinon un lot de 20
// prospects traité d'un coup produirait 20 brouillons « tout premiers »).

import { supabaseAdmin } from './supabase-admin';

// A-t-il déjà envoyé au moins un email de prospection ? null si la lecture
// échoue (schéma différent) : dans ce cas on ne bloque personne.
export async function hasEverSentProspecting(userId: string): Promise<boolean | null> {
  const { data: sent, error } = await supabaseAdmin
    .from('messages')
    .select('id, conversations!inner(prospects!inner(assigned_user_id))')
    .eq('direction', 'outbound')
    .eq('conversations.prospects.assigned_user_id', userId)
    .limit(1);
  if (error) {
    console.error('[first-email-approval] lecture impossible:', error.message);
    return null;
  }
  return !!(sent && sent.length);
}

// Le compte attend-il la validation de son tout premier email ? Vrai tant
// que rien n'est jamais parti. Sert aux brouillons « retenus » (hold) et à
// la liste « à valider » (lib/notifications.ts).
export async function awaitingFirstApproval(userId: string): Promise<boolean> {
  try {
    return (await hasEverSentProspecting(userId)) === false;
  } catch {
    return false;
  }
}

// 20/11/2026 (campagnes de James et Charlotte) : pendant que le tout premier
// email attendait Alex, les suivants partaient seuls (8 envois chez
// Charlotte), et le tout premier lui-même serait parti tout seul au créneau
// suivant (lib/first-email-deferred.ts ne distinguait pas). Désormais :
//   - approve : brouillon à relire, notification ;
//   - hold : le tout premier attend déjà ; celui-ci est rangé en brouillon
//     sans notification, et ne partira qu'une fois le premier validé.
export async function mustApproveFirstEmail(
  userId: string,
  requireApprovalPref: boolean | null | undefined
): Promise<{ approve: boolean; reason: 'preference' | 'first_ever' | null; hold?: boolean }> {
  if (requireApprovalPref === true) return { approve: true, reason: 'preference' };
  try {
    const everSent = await hasEverSentProspecting(userId);
    if (everSent !== false) return { approve: false, reason: null };
    const { data: pending } = await supabaseAdmin
      .from('prospects')
      .select('id')
      .eq('assigned_user_id', userId)
      .not('pending_first_email_subject', 'is', null)
      .limit(1);
    if (pending && pending.length) return { approve: false, reason: null, hold: true };
    return { approve: true, reason: 'first_ever' };
  } catch (err: any) {
    console.error('[first-email-approval]', err?.message || err);
    return { approve: false, reason: null };
  }
}
