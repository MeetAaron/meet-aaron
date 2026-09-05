// lib/aaron-batch.ts
//
// Batch API Anthropic pour les traitements d'Aaron qui n'ont aucune
// contrainte de temps réel (validé par Alex le 05/09/2026, « troisième
// levier : je valide batch api ») : premiers emails de campagne, relances
// après silence. −50 % sur tous les tokens, résultats en général sous
// l'heure (24 h maximum). Ce qui reste en temps réel : les réponses à un
// humain qui vient d'écrire (check-inbox) et le chat.
//
// Mécanique en deux temps, parce qu'une fonction serverless ne peut pas
// attendre :
//   1. enqueueAaronBatch(items) — construit la requête EXACTE du chemin
//      temps réel (lib/aaron.ts → buildAaronRequest), soumet un lot à
//      /v1/messages/batches, et mémorise chaque ligne dans aaron_batch_items
//      (migration_aaron_batches_2026-09-05.sql). Un prospect dont l'email
//      vient d'un modèle fixe (aucun appel IA) est traité immédiatement.
//   2. collectAaronBatches() — cron toutes les 10 min : interroge les lots en
//      cours, lit les résultats (JSONL), et applique CHAQUE sortie avec la
//      même logique que le chemin temps réel (applyAaronOutput) : envoi de
//      l'email ou mise en attente de validation, message enregistré, fiche
//      prospect mise à jour, sauvetage à valider, coût enregistré à moitié
//      prix.
// Les crons producteurs ignorent les prospects déjà dans un lot en cours
// (pendingBatchProspectIds), sinon ils les resoumettraient à chaque passage.

import { supabaseAdmin } from './supabase-admin';
import { buildAaronRequest, parseAaronOutput, convictionColumns, type AaronModel, type AaronOutput } from './aaron';
import { recordUsage, usageFromApi } from './anthropic-client';
import { sendEmailForUser, DailySendCapExceededError, DomainNotDeliverableError } from './messaging';
import { sendPushNotification } from './push';
import { getFirstEmailAttachment } from './first-email-attachment';

export type BatchKind = 'first_contact' | 'followup';

export interface BatchItemInput {
  prospectId: string;
  userId: string;
  companyId: string | null;
  conversationId: string;
  kind: BatchKind;
}

const ANTHROPIC_HEADERS = () => ({
  'Content-Type': 'application/json',
  'x-api-key': process.env.ANTHROPIC_API_KEY!,
  'anthropic-version': '2023-06-01',
  // Cache 1 h sur les blocs système (voir CACHE_TTL_1H, lib/anthropic-client).
  'anthropic-beta': 'extended-cache-ttl-2025-04-11',
});

// Prospects déjà dans un lot en attente : à exclure par les crons producteurs.
export async function pendingBatchProspectIds(): Promise<Set<string>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('aaron_batch_items')
      .select('prospect_id')
      .in('status', ['pending', 'deferred']);
    if (error) return new Set();
    return new Set((data || []).map((r: any) => r.prospect_id));
  } catch {
    return new Set();
  }
}

// Le Batch API est activé par défaut ; AARON_BATCH_DISABLED=1 le coupe (retour
// immédiat au temps réel) sans redéploiement, au cas où.
export function batchEnabled(): boolean {
  return process.env.AARON_BATCH_DISABLED !== '1' && !!process.env.ANTHROPIC_API_KEY;
}

export async function enqueueAaronBatch(
  items: BatchItemInput[],
  options?: { model?: AaronModel }
): Promise<{ batchId: string | null; submitted: number; appliedNow: number; errors: number }> {
  let appliedNow = 0;
  let errors = 0;
  const requests: { custom_id: string; params: Record<string, any> }[] = [];
  const rows: any[] = [];

  for (const item of items) {
    try {
      const req = await buildAaronRequest(item.prospectId, options);
      if (req.precomputed) {
        await applyAaronOutput(item, req.precomputed);
        appliedNow++;
        continue;
      }
      requests.push({ custom_id: item.prospectId, params: req.body! });
      rows.push({
        prospect_id: item.prospectId,
        user_id: item.userId,
        company_id: item.companyId,
        conversation_id: item.conversationId,
        kind: item.kind,
        model: req.body!.model,
        status: 'pending',
      });
    } catch (err: any) {
      errors++;
      console.error(`Batch Aaron — préparation impossible pour ${item.prospectId}:`, err?.message);
    }
  }

  if (requests.length === 0) return { batchId: null, submitted: 0, appliedNow, errors };

  // La ligne de suivi est créée AVANT de soumettre : si la table n'existe pas
  // (migration pas passée), on échoue ici, avant d'avoir payé un lot que
  // personne ne viendrait jamais lire.
  const placeholder = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: batchRow, error: batchErr } = await supabaseAdmin
    .from('aaron_batches')
    .insert({ anthropic_batch_id: placeholder, status: 'pending', item_count: requests.length })
    .select('id')
    .single();
  if (batchErr || !batchRow) {
    throw new Error(`Batch API : table aaron_batches indisponible (${batchErr?.message}) — migration_aaron_batches_2026-09-05.sql ?`);
  }

  let batch: any;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages/batches', {
      method: 'POST',
      headers: ANTHROPIC_HEADERS(),
      body: JSON.stringify({ requests }),
    });
    if (!res.ok) {
      throw new Error(`Batch API (création) : ${res.status} ${await res.text()}`);
    }
    batch = await res.json();
  } catch (err) {
    await supabaseAdmin.from('aaron_batches').delete().eq('id', batchRow.id);
    throw err;
  }

  await supabaseAdmin.from('aaron_batches').update({ anthropic_batch_id: batch.id }).eq('id', batchRow.id);
  await supabaseAdmin.from('aaron_batch_items').insert(rows.map((r) => ({ ...r, batch_id: batchRow.id })));

  return { batchId: batch.id, submitted: requests.length, appliedNow, errors };
}

// ── Collecte ────────────────────────────────────────────────────────────────
export async function collectAaronBatches(): Promise<{ checked: number; completed: number; applied: number; failed: number; retried: number }> {
  // Envois différés (plafond du jour, DNS) : on retente d'abord, sans
  // regénérer — la sortie d'Aaron est stockée sur la ligne.
  let retried = 0;
  const { data: deferred } = await supabaseAdmin
    .from('aaron_batch_items')
    .select('id, prospect_id, user_id, company_id, conversation_id, kind, output')
    .eq('status', 'deferred')
    .not('output', 'is', null)
    .limit(100);
  for (const it of deferred || []) {
    try {
      await applyAaronOutput(
        { prospectId: it.prospect_id, userId: it.user_id, companyId: it.company_id, conversationId: it.conversation_id, kind: it.kind },
        it.output as AaronOutput
      );
      await supabaseAdmin.from('aaron_batch_items').update({ status: 'done', error: null, applied_at: new Date().toISOString() }).eq('id', it.id);
      retried++;
    } catch (err: any) {
      const soft = err instanceof DailySendCapExceededError || err instanceof DomainNotDeliverableError;
      if (!soft) {
        await supabaseAdmin.from('aaron_batch_items').update({ status: 'error', error: String(err?.message || err).slice(0, 500) }).eq('id', it.id);
      }
    }
  }

  const { data: batches, error } = await supabaseAdmin
    .from('aaron_batches')
    .select('id, anthropic_batch_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20);
  if (error || !batches) return { checked: 0, completed: 0, applied: 0, failed: 0, retried };

  let completed = 0;
  let applied = 0;
  let failed = 0;

  for (const b of batches) {
    const statusRes = await fetch(`https://api.anthropic.com/v1/messages/batches/${b.anthropic_batch_id}`, { headers: ANTHROPIC_HEADERS() });
    if (!statusRes.ok) {
      console.error('Batch API (statut) :', statusRes.status, await statusRes.text().catch(() => ''));
      continue;
    }
    const status = await statusRes.json();
    if (status.processing_status !== 'ended' || !status.results_url) continue;

    const resultsRes = await fetch(status.results_url, { headers: ANTHROPIC_HEADERS() });
    if (!resultsRes.ok) {
      console.error('Batch API (résultats) :', resultsRes.status);
      continue;
    }
    const text = await resultsRes.text();
    const lines = text.split('\n').filter((l) => l.trim());

    const { data: items } = await supabaseAdmin
      .from('aaron_batch_items')
      .select('id, prospect_id, user_id, company_id, conversation_id, kind, model, status')
      .eq('batch_id', b.id)
      .eq('status', 'pending');
    const byProspect = new Map<string, any>((items || []).map((it: any) => [it.prospect_id, it]));

    for (const line of lines) {
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const item = byProspect.get(parsed.custom_id);
      if (!item) continue;

      let lastOutput: AaronOutput | null = null;
      try {
        if (parsed.result?.type !== 'succeeded') {
          throw new Error(`résultat ${parsed.result?.type || 'inconnu'}: ${JSON.stringify(parsed.result?.error || {}).slice(0, 300)}`);
        }
        const message = parsed.result.message;
        if (item.company_id && message?.usage) {
          await recordUsage(item.company_id, item.model || message.model, usageFromApi(message.usage), item.user_id, 0.5);
        }
        const output = parseAaronOutput(message);
        lastOutput = output;
        await applyAaronOutput(
          { prospectId: item.prospect_id, userId: item.user_id, companyId: item.company_id, conversationId: item.conversation_id, kind: item.kind },
          output
        );
        await supabaseAdmin.from('aaron_batch_items').update({ status: 'done', applied_at: new Date().toISOString() }).eq('id', item.id);
        applied++;
      } catch (err: any) {
        // Plafond d'envoi ou domaine non délivrable : le prospect reste sans
        // message, les crons producteurs le reprendront (comme en temps réel).
        // Plafond d'envoi du jour atteint : on GARDE la sortie d'Aaron (déjà
        // payée) et on réessaie l'envoi aux passages suivants, sans
        // regénérer. Domaine non délivrable : idem, le DNS peut être corrigé.
        const soft = err instanceof DailySendCapExceededError || err instanceof DomainNotDeliverableError;
        await supabaseAdmin
          .from('aaron_batch_items')
          .update({
            status: soft ? 'deferred' : 'error',
            error: String(err?.message || err).slice(0, 500),
            applied_at: new Date().toISOString(),
            ...(soft && lastOutput ? { output: lastOutput } : {}),
          })
          .eq('id', item.id);
        failed++;
        if (!soft) console.error(`Batch Aaron — application impossible pour ${item.prospect_id}:`, err?.message);
      }
    }

    // Lignes jamais renvoyées (ne devrait pas arriver) : on libère le prospect.
    const returned = new Set(lines.map((l) => { try { return JSON.parse(l).custom_id; } catch { return null; } }));
    for (const it of items || []) {
      if (!returned.has(it.prospect_id)) {
        await supabaseAdmin.from('aaron_batch_items').update({ status: 'error', error: 'sans résultat' }).eq('id', it.id);
      }
    }

    await supabaseAdmin.from('aaron_batches').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', b.id);
    completed++;
  }

  return { checked: batches.length, completed, applied, failed, retried };
}

// ── Application d'une sortie d'Aaron (commune au temps réel et au lot) ──────
//
// Reprend, à l'identique, ce que faisaient run-campaigns,
// retry-uncontacted-prospects et send-prospect-followups après
// generateAaronResponse. Une seule version pour trois crons : ce qui change
// ici change partout.
export async function applyAaronOutput(item: BatchItemInput, aaronOutput: AaronOutput): Promise<void> {
  const { data: prospect } = await supabaseAdmin
    .from('prospects')
    .select('id, email, full_name, assigned_user_id, company_id, is_lost, is_won, ai_managed')
    .eq('id', item.prospectId)
    .single();
  if (!prospect) return;
  // Le prospect a pu changer de main pendant l'attente du lot : on n'écrit
  // rien pour un contact repris par le commercial, perdu ou déjà client.
  if (prospect.ai_managed === false || prospect.is_lost || prospect.is_won) return;

  const baseUpdate = {
    status: aaronOutput.prospect_status,
    status_updated_at: new Date().toISOString(),
    personality_type: aaronOutput.personality_type,
    personality_notes: aaronOutput.personality_notes,
    aaron_advice: aaronOutput.aaron_advice,
    ...convictionColumns(aaronOutput),
    ...(aaronOutput.detected_phone ? { phone: aaronOutput.detected_phone } : {}),
  };

  // Tentative de sauvetage (relances) : jamais envoyée automatiquement.
  if (aaronOutput.rescue_proposal) {
    await supabaseAdmin
      .from('prospects')
      .update({
        ...baseUpdate,
        rescue_proposal_subject: aaronOutput.rescue_proposal.subject,
        rescue_proposal_body: aaronOutput.rescue_proposal.body,
        rescue_proposal_pending: true,
      })
      .eq('id', prospect.id);
    try {
      await sendPushNotification(prospect.assigned_user_id, {
        title: 'Prospect en risque de perte',
        body: `Silence prolongé de ${prospect.email} après plusieurs relances. Aaron propose une tentative de sauvetage à valider.`,
        url: `/app/prospects?user_id=${prospect.assigned_user_id}`,
      });
    } catch {
      // push best-effort
    }
    return;
  }

  const hasEmailToSend = !!(aaronOutput.email_draft?.subject?.trim() && aaronOutput.email_draft?.body?.trim());

  if (hasEmailToSend && item.kind === 'first_contact') {
    // Premier email : relecture avant envoi (option) et pièce jointe.
    const { data: owner } = await supabaseAdmin
      .from('users')
      .select('require_first_email_approval, company_id, email')
      .eq('id', prospect.assigned_user_id)
      .single();
    if (owner?.require_first_email_approval === true) {
      await supabaseAdmin
        .from('prospects')
        .update({
          ...baseUpdate,
          pending_first_email_subject: aaronOutput.email_draft.subject,
          pending_first_email_body: aaronOutput.email_draft.body,
          pending_first_email_generated_at: new Date().toISOString(),
        })
        .eq('id', prospect.id);
      try {
        await sendPushNotification(prospect.assigned_user_id, {
          title: 'Premier email prêt à valider',
          body: `Aaron a préparé le premier email pour ${prospect.email}. À relire avant envoi.`,
          url: `/app/prospects?user_id=${prospect.assigned_user_id}`,
        });
      } catch {
        // push best-effort
      }
      return;
    }
    const attachment = owner?.company_id ? await getFirstEmailAttachment(owner.company_id) : null;
    await sendEmailForUser(prospect.assigned_user_id, prospect.email, aaronOutput.email_draft.subject, aaronOutput.email_draft.body, {
      emailType: 'prospecting',
      attachment: attachment || undefined,
    });
    await supabaseAdmin.from('messages').insert({
      conversation_id: item.conversationId,
      direction: 'outbound',
      sender_email: owner?.email || '',
      recipient_email: prospect.email,
      body: aaronOutput.email_draft.body,
    });
  } else if (hasEmailToSend) {
    await sendEmailForUser(prospect.assigned_user_id, prospect.email, aaronOutput.email_draft.subject, aaronOutput.email_draft.body, {
      emailType: 'prospecting',
    });
    const { data: senderUser } = await supabaseAdmin.from('users').select('email').eq('id', prospect.assigned_user_id).single();
    await supabaseAdmin.from('messages').insert({
      conversation_id: item.conversationId,
      direction: 'outbound',
      sender_email: senderUser?.email || '',
      recipient_email: prospect.email,
      body: aaronOutput.email_draft.body,
    });
  }

  await supabaseAdmin.from('prospects').update(baseUpdate).eq('id', prospect.id);
}
