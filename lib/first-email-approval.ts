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

export async function mustApproveFirstEmail(userId: string, requireApprovalPref: boolean | null | undefined): Promise<{ approve: boolean; reason: 'preference' | 'first_ever' | null }> {
  if (requireApprovalPref === true) return { approve: true, reason: 'preference' };
  try {
    const { data: pending } = await supabaseAdmin
      .from('prospects')
      .select('id')
      .eq('assigned_user_id', userId)
      .not('pending_first_email_subject', 'is', null)
      .limit(1);
    if (pending && pending.length) return { approve: false, reason: null };

    const { data: sent, error } = await supabaseAdmin
      .from('messages')
      .select('id, conversations!inner(prospects!inner(assigned_user_id))')
      .eq('direction', 'outbound')
      .eq('conversations.prospects.assigned_user_id', userId)
      .limit(1);
    if (error) {
      // Filtre imbriqué refusé (schéma différent) : on ne bloque personne.
      console.error('[first-email-approval] lecture impossible:', error.message);
      return { approve: false, reason: null };
    }
    if (!sent || sent.length === 0) return { approve: true, reason: 'first_ever' };
    return { approve: false, reason: null };
  } catch (err: any) {
    console.error('[first-email-approval]', err?.message || err);
    return { approve: false, reason: null };
  }
}
