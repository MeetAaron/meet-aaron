// lib/become-client.ts
// UNE SEULE FAÇON DE DEVENIR CLIENT (28/10/2026, validé par Alex).
//
// Avant, huit chemins faisaient passer un contact en client (bouton Gagné,
// 1re commande, ligne de progression, Opportunités « Signé », Youtrust,
// devis signé par email, accord écrit détecté, paiement) et chacun oubliait
// quelque chose : l'un ne repassait pas le contact en « géré par moi »,
// l'autre ne synchronisait pas le CRM. Désormais tous appellent cette
// fonction, qui fait TOUJOURS la même chose :
//
//   1. colonnes de la fiche (deal_stage = signe, is_won, won_at,
//      first_order_confirmed_at si la commande est confirmée, raison) ;
//   2. accueil automatique du client (Aaron Clients) si la commande est
//      confirmée pour la première fois ;
//   3. passage de relais « géré par moi » ;
//   4. synchro vers le CRM (un seul sens, Aaron → CRM).
//
// Les effets 2 à 4 sont lancés sans attendre (fire-and-forget), comme
// avant : le clic répond tout de suite.

import { supabaseAdmin } from './supabase-admin';
import { triggerAutomaticOnboarding } from './aaron-customer';
import { autoSyncWonProspect } from './crm-sync';
import { handOverWonProspect } from './prospect-handover';

export type ClientSource =
  | 'bouton_gagne'
  | 'premiere_commande'
  | 'progression'
  | 'opportunites'
  | 'youtrust'
  | 'devis_email'
  | 'accord_email'
  | 'paiement'
  | 'signature_plateforme'
  | 'confirmation_signal';

export async function markProspectAsClient(
  prospectId: string,
  options: {
    source: ClientSource;
    reason?: string | null;
    // true = une commande/un paiement/une signature est acquis : le contact
    // devient client à part entière (Aaron Clients, Résultats). false = gagné
    // en attente de 1re commande (bouton « Gagné » sans la case cochée).
    firstOrderConfirmed: boolean;
    // false quand l'appelant envoie lui-même un push de félicitations.
    notify?: boolean;
  }
): Promise<{ ok: boolean; wasClient: boolean; wasWon: boolean }> {
  const { data: before } = await supabaseAdmin
    .from('prospects')
    .select('id, is_won, won_at, first_order_confirmed_at')
    .eq('id', prospectId)
    .maybeSingle();
  if (!before) return { ok: false, wasClient: false, wasWon: false };

  const now = new Date().toISOString();
  const wasWon = !!before.is_won;
  const wasClient = !!before.first_order_confirmed_at;

  const update: Record<string, any> = {
    deal_stage: 'signe',
    deal_stage_updated_at: now,
    is_won: true,
    won_at: before.won_at || now,
    is_lost: false,
    lost_at: null,
    pipeline_lost_reason: null,
    pipeline_lost_at_stage: null,
    // Signal « à confirmer » éventuel : réglé.
    client_signal_detected_at: null,
    client_signal_source: null,
    client_signal_reason: null,
    client_signal_dismissed_at: null,
  };
  if (options.reason) update.won_reason = options.reason;
  if (options.firstOrderConfirmed && !wasClient) update.first_order_confirmed_at = now;

  let { error } = await supabaseAdmin.from('prospects').update(update).eq('id', prospectId);
  if (error && error.code === '42703') {
    // Une colonne optionnelle manque (migration pas encore passée) : on
    // réessaie sans les colonnes récentes plutôt que d'échouer.
    const { pipeline_lost_reason, pipeline_lost_at_stage, client_signal_detected_at, client_signal_source, client_signal_reason, client_signal_dismissed_at, ...core } = update;
    ({ error } = await supabaseAdmin.from('prospects').update(core).eq('id', prospectId));
  }
  if (error) {
    console.error(`[devenir client] mise à jour impossible pour ${prospectId} (${options.source}) :`, error.message);
    return { ok: false, wasClient, wasWon };
  }

  if (options.firstOrderConfirmed && !wasClient) {
    triggerAutomaticOnboarding(prospectId).catch((err: any) =>
      console.error(`[devenir client] accueil automatique ${prospectId} :`, err?.message || err)
    );
  }
  handOverWonProspect(prospectId, { notify: options.notify !== false }).catch((err: any) =>
    console.error(`[devenir client] passage de relais ${prospectId} :`, err?.message || err)
  );
  autoSyncWonProspect(prospectId).catch(() => {});

  return { ok: true, wasClient, wasWon };
}

// Signal « ce contact est peut-être devenu client » (accord écrit lu dans
// un email, notification de paiement ou de signature reçue dans la boîte du
// commercial). Rien ne bascule tout seul : une story « Client à confirmer »
// demande au commercial, qui confirme ou rejette (PATCH confirmer_client /
// rejeter_signal_client). Décision d'Alex du 28/10/2026 : un faux positif
// enverrait l'email de bienvenue à quelqu'un qui n'a rien signé.
export async function flagClientSignal(
  prospectId: string,
  signal: { source: string; reason: string | null; messageId?: string | null }
): Promise<boolean> {
  const { data: p } = await supabaseAdmin
    .from('prospects')
    .select('id, first_order_confirmed_at, client_signal_message_id, client_signal_detected_at, client_signal_dismissed_at')
    .eq('id', prospectId)
    .maybeSingle();
  if (!p) return false;
  const row: any = p;
  if (row.first_order_confirmed_at) return false;
  // Même message déjà vu (confirmé ou rejeté) : on ne recrée pas le signal.
  if (signal.messageId && row.client_signal_message_id === signal.messageId) return false;
  // Un signal encore en attente : on garde le premier, on ne l'écrase pas.
  if (row.client_signal_detected_at && !row.client_signal_dismissed_at) return false;

  const { error } = await supabaseAdmin
    .from('prospects')
    .update({
      client_signal_detected_at: new Date().toISOString(),
      client_signal_source: signal.source,
      client_signal_reason: signal.reason ? signal.reason.slice(0, 500) : null,
      client_signal_message_id: signal.messageId || null,
      client_signal_dismissed_at: null,
    })
    .eq('id', prospectId);
  if (error) {
    console.error(`[signal client] ${prospectId} :`, error.message);
    return false;
  }
  return true;
}
