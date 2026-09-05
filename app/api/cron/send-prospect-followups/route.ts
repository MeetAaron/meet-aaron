// app/api/cron/send-prospect-followups/route.ts
// Exécuté une fois par jour via Vercel Cron.
//
// Jusqu'ici, AUCUN cron ne gérait réellement les relances espacées décrites
// dans lib/aaron_system_prompt.md ("Relances (si silence) : espacées
// intelligemment, ex. J+3, J+7, J+14"). Seuls deux crons envoyaient des
// messages sortants sans réponse du prospect (run-campaigns et
// retry-uncontacted-prospects), et tous deux ne géraient que le TOUT premier
// contact — une fois ce premier message envoyé et resté sans réponse, rien
// ne relançait jamais le prospect. Ce cron comble ce manque : il repère les
// prospects déjà contactés, toujours sans réponse, et dont le délai avant la
// prochaine relance est atteint, puis fait générer et envoyer cette relance
// par Aaron.
//
// Calendrier de relance (à partir de la date du tout premier message envoyé) :
//   1 message envoyé (premier contact) -> relance n°1 due à J+3
//   2 messages envoyés (1 relance déjà faite) -> relance n°2 due à J+7
//   3 messages envoyés (2 relances déjà faites) -> relance n°3 (dernière) due à J+14
//   4 messages envoyés ou plus -> on arrête les relances automatiques.
//
// Si à cette occasion Aaron estime qu'il faut faire passer le prospect au
// statut rouge, il renvoie une "tentative de sauvetage" (rescue_proposal)
// au lieu d'un email_draft — comme pour check-inbox, cette tentative n'est
// JAMAIS envoyée automatiquement et attend une validation du commercial.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateAaronResponse } from '@/lib/aaron';
import { enqueueAaronBatch, applyAaronOutput, pendingBatchProspectIds, batchEnabled, type BatchItemInput } from '@/lib/aaron-batch';
import { sendEmailForUser, hasReachedProspectingCap, DailySendCapExceededError, DomainNotDeliverableError } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

// Statuts sur lesquels une relance automatique a du sens : conversation en
// cours sans signal fort dans un sens ou l'autre (jaune), ou signaux de
// désintérêt qu'une relance à angle différent peut encore débloquer (orange).
// "vert" est exclu : un prospect qui montre un intérêt clair mérite d'être
// laissé répondre à son rythme plutôt que sur un calendrier automatique.
// "bleu" (RDV en attente/confirmé) et "rouge" (déjà géré/perdu) sont exclus.
const RELANCE_ELIGIBLE_STATUSES = ['jaune', 'orange'];

const RELANCE_SCHEDULE_DAYS = [3, 7, 14]; // due day, indexé par (nb de messages sortants déjà envoyés - 1)
const MAX_PER_USER_PER_RUN = 30;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: candidates, error } = await supabaseAdmin
    .from('prospects')
    .select(
      'id, email, assigned_user_id, status, conversations(id, messages(id, direction, sent_at))'
    )
    .eq('is_won', false)
    .eq('is_lost', false)
    .in('status', RELANCE_ELIGIBLE_STATUSES);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const perUserCount: Record<string, number> = {};
  // Voir même cache dans retry-uncontacted-prospects/route.ts : évite de revérifier
  // le plafond quotidien (lib/messaging.ts) à chaque prospect du même commercial.
  const cappedUsers = new Map<string, boolean>();
  const pendingIds = await pendingBatchProspectIds();
  const companyByUser = new Map<string, string | null>();
  const items: BatchItemInput[] = [];

  for (const prospect of candidates || []) {
    const conversation = (prospect as any).conversations?.[0];
    const messages: { id: string; direction: string; sent_at: string }[] = conversation?.messages || [];
    if (!conversation || messages.length === 0) continue; // jamais contacté -> pas une relance, géré par d'autres crons

    const outbound = messages.filter((m) => m.direction === 'outbound').sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    const inbound = messages.filter((m) => m.direction === 'inbound').sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    if (outbound.length === 0) continue;

    const lastOutbound = outbound[outbound.length - 1];
    const lastInbound = inbound[inbound.length - 1];
    // Le prospect a répondu après notre dernier message : ce n'est pas une
    // situation de silence, check-inbox s'en occupe déjà (ou vient de le faire).
    if (lastInbound && lastInbound.sent_at > lastOutbound.sent_at) continue;

    const scheduleIndex = outbound.length - 1; // combien de messages sortants déjà envoyés
    if (scheduleIndex >= RELANCE_SCHEDULE_DAYS.length) continue; // calendrier de relance épuisé

    const dueDay = RELANCE_SCHEDULE_DAYS[scheduleIndex];
    const firstOutbound = outbound[0];
    const daysSinceFirstContact = (now - new Date(firstOutbound.sent_at).getTime()) / 86_400_000;
    if (daysSinceFirstContact < dueDay) continue; // pas encore le moment

    if (!cappedUsers.has(prospect.assigned_user_id)) {
      cappedUsers.set(prospect.assigned_user_id, await hasReachedProspectingCap(prospect.assigned_user_id));
    }
    if (cappedUsers.get(prospect.assigned_user_id)) continue;

    perUserCount[prospect.assigned_user_id] = (perUserCount[prospect.assigned_user_id] || 0) + 1;
    if (perUserCount[prospect.assigned_user_id] > MAX_PER_USER_PER_RUN) continue;
    if (pendingIds.has(prospect.id)) continue; // relance déjà dans un lot en cours

    if (!companyByUser.has(prospect.assigned_user_id)) {
      const { data: u } = await supabaseAdmin.from('users').select('company_id').eq('id', prospect.assigned_user_id).single();
      companyByUser.set(prospect.assigned_user_id, u?.company_id || null);
    }
    items.push({
      prospectId: prospect.id,
      userId: prospect.assigned_user_id,
      companyId: companyByUser.get(prospect.assigned_user_id) || null,
      conversationId: conversation.id,
      kind: 'followup',
    });
  }

  // Batch API (05/09/2026, validé par Alex) : les relances partent par lot à
  // moitié prix, sur Haiku (voir AaronModel dans lib/aaron.ts), et sont
  // envoyées quand le lot revient (collect-aaron-batches). Repli temps réel
  // si le lot ne peut pas être soumis.
  if (items.length > 0 && batchEnabled()) {
    try {
      const enq = await enqueueAaronBatch(items, { model: 'claude-haiku-4-5' });
      return NextResponse.json({ batched: enq.submitted, followed_up: enq.appliedNow, batch_id: enq.batchId });
    } catch (err: any) {
      console.error('Batch Aaron indisponible, passage en temps réel :', err?.message);
    }
  }

  let followedUp = 0;
  for (const item of items) {
    try {
      const aaronOutput = await generateAaronResponse(item.prospectId, { model: 'claude-haiku-4-5' });
      await applyAaronOutput(item, aaronOutput);
      followedUp++;
    } catch (err: any) {
      if (
        !(err instanceof MonthlyCapExceededError) &&
        !(err instanceof DailySendCapExceededError) &&
        !(err instanceof DomainNotDeliverableError)
      ) {
        console.error(`Erreur relance programmée pour prospect ${item.prospectId}:`, err.message);
      }
    }
  }

  return NextResponse.json({ followed_up: followedUp });
}
