// app/api/cron/run-campaigns/route.ts
// Exécuté toutes les 10 minutes via Vercel Cron.
// Fait avancer UNE campagne "en_attente" ou "en_cours" PAR COMPTE COMMERCIAL,
// tous les comptes étant traités en parallèle (design validé pour le scaling :
// un commercial ne doit jamais attendre que la campagne d'un autre commercial
// soit passée avant que la sienne n'avance).
//
// IMPORTANT (corrigé le 14/08) : la sélection des "nouveaux" prospects à
// contacter utilisait `personality_type IS NULL`. C'est FAUX : Aaron ne
// détecte un profil de personnalité qu'APRÈS une réponse du prospect — sur
// un prospect déjà contacté mais qui n'a pas encore répondu, personality_type
// reste légitimement null. Résultat réel : tant qu'une campagne restait
// "en_cours", ce cron réenvoyait un message toutes les 10 minutes à tous ses
// prospects déjà contactés mais pas encore répondus (spam constaté en
// production). Le bon critère de "jamais contacté" est l'absence de tout
// message sortant dans sa conversation — c'est ce que ce cron vérifie
// désormais.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { processCampaignBatch } from '@/lib/sourcing';
import { generateAaronResponse } from '@/lib/aaron';
import { enqueueAaronBatch, applyAaronOutput, pendingBatchProspectIds, batchEnabled, type BatchItemInput } from '@/lib/aaron-batch';
import { hasReachedProspectingCap, DailySendCapExceededError, DomainNotDeliverableError } from '@/lib/messaging';
import { getPacing } from '@/lib/anthropic-client';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

async function runOneCampaign(campaignId: string, assignedUserId: string) {
  await supabaseAdmin
    .from('prospecting_campaigns')
    .update({ status: 'en_cours' })
    .eq('id', campaignId)
    .eq('status', 'en_attente');

  // Le commercial propriétaire (une campagne = un commercial = une société) :
  // sert au rythme de consommation ci-dessous. La relecture avant envoi et la
  // pièce jointe du premier email sont gérées au moment de l'application de
  // la sortie d'Aaron (applyAaronOutput, lib/aaron-batch.ts).
  const { data: campaignOwner } = await supabaseAdmin
    .from('users')
    .select('company_id')
    .eq('id', assignedUserId)
    .single();

  // Rythme de consommation (décision Alex, 05/09/2026 : « Aaron doit utiliser
  // au plus possible l'abonnement… se rapprocher de 0 ou une marge de 1,5
  // crédit ; le boost, essayer de l'effectuer dans le mois »). getPacing
  // (lib/anthropic-client) dit combien de nouveaux prospects Aaron peut
  // encore aller chercher AUJOURD'HUI pour finir le mois près de zéro : un
  // mois bien entamé accélère, un mois en avance ralentit. Le lot de
  // sourcing suit cette allocation (au plus 5 par passage de cron, comme
  // avant) ; à 0, on ne cherche pas de nouvelles sociétés mais on contacte
  // quand même celles déjà trouvées (leur premier email est déjà budgété).
  const pacing = campaignOwner?.company_id ? await getPacing(campaignOwner.company_id) : null;
  const sourcingBatch = pacing ? Math.max(0, Math.min(5, pacing.prospectsAllowedToday)) : 5;
  const result = sourcingBatch > 0
    ? await processCampaignBatch(campaignId, sourcingBatch)
    : { skipped_pacing: true, daily_target_usd: pacing?.dailyTargetUsd, day_spend_usd: pacing?.daySpendUsd };

  const { data: newProspectCompanies } = await supabaseAdmin
    .from('prospect_companies')
    .select('id')
    .eq('found_by_campaign_id', campaignId);

  const companyIds = (newProspectCompanies || []).map((c) => c.id);

  const { data: candidateProspects } = await supabaseAdmin
    .from('prospects')
    .select('id, email, assigned_user_id, pending_first_email_subject, conversations(id, messages(id))')
    .in('prospect_company_id', companyIds.length > 0 ? companyIds : ['00000000-0000-0000-0000-000000000000']);

  // Vraiment "jamais contacté" = aucun message dans aucune de ses
  // conversations — voir la note en tête de fichier. ET pas déjà un premier
  // email en attente de validation (voir requireApproval ci-dessus) : sans ce
  // second filtre, un prospect en attente de relecture n'a toujours aucun
  // message inséré, donc il repasserait "nouveau" à CHAQUE cycle de 10 min —
  // générant un nouvel appel Claude et une nouvelle notification push à
  // chaque fois tant que le commercial n'a pas validé (bug trouvé lors de la
  // relecture de cette fonctionnalité, corrigé avant tout déploiement en
  // production).
  const newProspects = (candidateProspects || []).filter((p: any) => {
    if (p.pending_first_email_subject) return false;
    const totalMessages = (p.conversations || []).reduce(
      (sum: number, c: any) => sum + (c.messages?.length || 0),
      0
    );
    return totalMessages === 0;
  });

  // Protection délivrabilité (voir lib/messaging.ts) : une campagne appartient
  // à un seul commercial, donc si son plafond quotidien de prospection est déjà
  // atteint, aucun des nouveaux prospects de cette campagne ne pourra être
  // contacté aujourd'hui — sauter tout le lot ici évite de dépenser un appel
  // Claude par prospect pour rien (l'envoi échouerait de toute façon).
  if (newProspects.length > 0 && (await hasReachedProspectingCap(assignedUserId))) {
    return { campaign_id: campaignId, batch_result: result, first_contacts_sent: 0, skipped_daily_cap: true };
  }

  // Batch API (05/09/2026, validé par Alex) : les premiers emails partent
  // par lot à moitié prix et sont envoyés quand le lot revient (en général
  // sous l'heure) par app/api/cron/collect-aaron-batches. La logique
  // d'application (validation avant envoi, pièce jointe, message enregistré,
  // fiche mise à jour) est la même que le chemin temps réel : voir
  // applyAaronOutput dans lib/aaron-batch.ts. Si le lot ne peut pas être
  // soumis (table absente, API en erreur), on retombe sur le temps réel,
  // séquentiel PAR campagne pour ne pas déclencher trop d'envois Gmail d'un
  // coup depuis un même compte.
  const pendingIds = await pendingBatchProspectIds();
  const items: BatchItemInput[] = [];
  for (const prospect of newProspects) {
    if (pendingIds.has(prospect.id)) continue;
    let conversationId = (prospect as any).conversations?.[0]?.id;
    if (!conversationId) {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .insert({ prospect_id: prospect.id, channel: 'email' })
        .select('id')
        .single();
      conversationId = conv?.id;
    }
    if (!conversationId) continue;
    items.push({
      prospectId: prospect.id,
      userId: prospect.assigned_user_id,
      companyId: campaignOwner?.company_id || null,
      conversationId,
      kind: 'first_contact',
    });
  }

  if (items.length > 0 && batchEnabled()) {
    try {
      const enq = await enqueueAaronBatch(items);
      return { campaign_id: campaignId, batch_result: result, first_contacts_batched: enq.submitted, first_contacts_sent: enq.appliedNow, batch_id: enq.batchId };
    } catch (err: any) {
      console.error('Batch Aaron indisponible, passage en temps réel :', err?.message);
    }
  }

  let sent = 0;
  for (const item of items) {
    try {
      const aaronOutput = await generateAaronResponse(item.prospectId);
      await applyAaronOutput(item, aaronOutput);
      sent++;
    } catch (err: any) {
      // DailySendCapExceededError / DomainNotDeliverableError : le prospect
      // reste sans message, donc run-campaigns (ce lot) ou
      // retry-uncontacted-prospects le retenteront automatiquement au
      // prochain passage — inutile de bruiter les logs pour un cas déjà géré.
      if (!(err instanceof DailySendCapExceededError) && !(err instanceof DomainNotDeliverableError)) {
        console.error(`Erreur lors du premier contact pour le prospect ${item.prospectId}:`, err);
      }
    }
  }

  return { campaign_id: campaignId, batch_result: result, first_contacts_sent: sent };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: activeCampaigns } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('id, assigned_user_id')
    .in('status', ['en_attente', 'en_cours'])
    .order('created_at', { ascending: true });

  if (!activeCampaigns || activeCampaigns.length === 0) {
    return NextResponse.json({ message: 'Aucune campagne active' });
  }

  // TOUTES les campagnes actives d'un commercial avancent désormais (plus
  // seulement la plus ancienne) — un commercial peut lancer plusieurs
  // campagnes en même temps (ex: plusieurs zones géographiques) et les voir
  // progresser en parallèle plutôt qu'en file d'attente. On garde en
  // revanche le traitement SÉQUENTIEL des campagnes D'UN MÊME commercial
  // (boucle for, pas Promise.all) pour ne pas envoyer trop d'emails Gmail
  // d'un coup depuis un même compte — seul le traitement ENTRE commerciaux
  // différents reste parallélisé.
  const campaignIdsByUser = new Map<string, string[]>();
  for (const c of activeCampaigns) {
    const list = campaignIdsByUser.get(c.assigned_user_id) || [];
    list.push(c.id);
    campaignIdsByUser.set(c.assigned_user_id, list);
  }

  const results = await Promise.all(
    Array.from(campaignIdsByUser.entries()).map(async ([assignedUserId, campaignIds]) => {
      const userResults = [];
      for (const campaignId of campaignIds) {
        try {
          userResults.push(await runOneCampaign(campaignId, assignedUserId));
        } catch (err: any) {
          userResults.push({ campaign_id: campaignId, error: err.message });
        }
      }
      return userResults;
    })
  );

  const flatResults = results.flat();
  return NextResponse.json({ campaigns_processed: flatResults.length, results: flatResults });
}
