// lib/notifications.ts
// « Stories » de notifications (docx « mon avis » d'Alex, 31/08/2026) : tout
// ce qui attend une action du commercial, regroupé par type et trié par
// urgence — la demande de devis la plus ANCIENNE d'abord, le RDV le plus
// PROCHE d'abord. Consommé par GET /api/notifications (bandeau de stories du
// tableau de bord et de Prospects, cloche du rail d'icônes) et par le cron
// de relance des devis non envoyés (app/api/cron/quote-reminders).
//
// Aucune table dédiée : tout est dérivé des colonnes existantes de prospects
// et appointments, donc une notification disparaît d'elle-même dès que
// l'action est faite (devis envoyé, RDV validé, bilan rempli…).

import { supabaseAdmin } from './supabase-admin';
import { derivePipelinePosition } from './pipeline';

export type NotificationType =
  | 'devis_a_faire'
  | 'rdv_a_valider'
  | 'rdv_aujourdhui'
  | 'rdv_manque'
  | 'rdv_annule'
  | 'sauvetage_a_valider'
  | 'email_a_valider'
  | 'bilan_a_faire'
  | 'commande_a_confirmer'
  | 'a_risque';

// Ordre d'urgence des groupes (ordre d'affichage des stories).
export const NOTIFICATION_TYPE_ORDER: NotificationType[] = [
  'devis_a_faire',
  'rdv_a_valider',
  'rdv_aujourdhui',
  'rdv_manque',
  'rdv_annule',
  'sauvetage_a_valider',
  'email_a_valider',
  'bilan_a_faire',
  'commande_a_confirmer',
  'a_risque',
];

export interface NotificationItem {
  id: string; // unique : `${type}:${prospect_id|appointment_id}`
  type: NotificationType;
  prospect_id: string | null;
  appointment_id: string | null;
  prospect_name: string;
  company_name: string | null;
  personality_type: string | null;
  at: string | null; // date de référence (demande de devis, RDV…)
  days_waiting: number | null; // devis : jours depuis la demande
  meta: Record<string, any>; // champs spécifiques au type (heure du RDV, objet de l'email…)
}

export interface NotificationGroup {
  type: NotificationType;
  count: number;
  items: NotificationItem[];
}

function daysBetween(fromIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / (24 * 60 * 60 * 1000)));
}

// Conseil d'Aaron de plus en plus pressant selon le nombre de jours écoulés
// depuis la demande de devis (relance quotidienne, docx « mon avis »).
export function quoteAdviceLevel(days: number): 0 | 1 | 2 | 3 {
  if (days <= 1) return 0;
  if (days <= 3) return 1;
  if (days <= 6) return 2;
  return 3;
}

export const QUOTE_ADVICE_FR: Record<0 | 1 | 2 | 3, string> = {
  0: "Il attend ta proposition — une réponse rapide montre que tu es fiable. Dépose ton devis sur sa fiche dès qu'il est prêt.",
  1: "Deux jours déjà. Un prospect chaud refroidit vite : envoie au moins un mot pour dire que ça arrive, et une date.",
  2: "Ça fait plusieurs jours. À ce stade, le silence lui fait douter — envoie le devis aujourd'hui, même s'il n'est pas parfait, tu ajusteras après.",
  3: "Plus d'une semaine sans proposition. Il a très probablement demandé ailleurs. Envoie le devis maintenant et appelle-le pour le présenter de vive voix.",
};

export async function buildNotifications(userId: string, now: Date = new Date()): Promise<NotificationGroup[]> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const [{ data: prospects }, { data: appointments }] = await Promise.all([
    supabaseAdmin
      .from('prospects')
      .select(
        'id, full_name, personality_type, status, deal_stage, is_won, is_lost, first_order_confirmed_at, quote_requested_at, devis_generated_at, devis_sent_at, pending_first_email_subject, pending_first_email_body, rescue_proposal_pending, rescue_proposal_subject, rescue_proposal_body, pipeline_stage, pipeline_risk, pipeline_lost_at_stage, pipeline_lost_reason, aaron_advice, prospect_companies(name)'
      )
      .eq('assigned_user_id', userId),
    supabaseAdmin
      .from('appointments')
      .select('id, prospect_id, proposed_at, type, status, outcome, purpose, cancelled_by, client_cancel_acknowledged, missed_action_acknowledged, meet_link, prospects(full_name, personality_type, prospect_companies(name))')
      .eq('user_id', userId)
      .gt('proposed_at', new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order('proposed_at', { ascending: true }),
  ]);

  const byType: Record<string, NotificationItem[]> = {};
  function push(item: NotificationItem) {
    (byType[item.type] ||= []).push(item);
  }

  for (const p of (prospects || []) as any[]) {
    const pos = derivePipelinePosition(p);
    const base = {
      prospect_id: p.id,
      appointment_id: null,
      prospect_name: p.full_name,
      company_name: p.prospect_companies?.name || null,
      personality_type: p.personality_type || null,
    };
    if (!pos.lost && pos.stage !== 'client' && p.quote_requested_at && !p.devis_sent_at) {
      const days = daysBetween(p.quote_requested_at, now);
      push({
        ...base,
        id: `devis_a_faire:${p.id}`,
        type: 'devis_a_faire',
        at: p.quote_requested_at,
        days_waiting: days,
        meta: { advice_level: quoteAdviceLevel(days), has_draft: !!p.devis_generated_at },
      });
    }
    if (p.rescue_proposal_pending) {
      push({ ...base, id: `sauvetage_a_valider:${p.id}`, type: 'sauvetage_a_valider', at: null, days_waiting: null, meta: { subject: p.rescue_proposal_subject, body: p.rescue_proposal_body } });
    }
    if (p.pending_first_email_subject) {
      push({ ...base, id: `email_a_valider:${p.id}`, type: 'email_a_valider', at: null, days_waiting: null, meta: { subject: p.pending_first_email_subject, body: p.pending_first_email_body } });
    }
    if (p.is_won && !p.first_order_confirmed_at && !pos.lost) {
      push({ ...base, id: `commande_a_confirmer:${p.id}`, type: 'commande_a_confirmer', at: null, days_waiting: null, meta: {} });
    }
    if (pos.risk && !pos.lost) {
      push({ ...base, id: `a_risque:${p.id}`, type: 'a_risque', at: null, days_waiting: null, meta: { stage: pos.stage, advice: p.aaron_advice || null } });
    }
  }

  for (const a of (appointments || []) as any[]) {
    const at = new Date(a.proposed_at);
    const base = {
      prospect_id: a.prospect_id,
      appointment_id: a.id,
      prospect_name: a.prospects?.full_name || '',
      company_name: a.prospects?.prospect_companies?.name || null,
      personality_type: a.prospects?.personality_type || null,
      at: a.proposed_at,
      days_waiting: null,
    };
    const meta = { appt_type: a.type, meet_link: a.meet_link || null, purpose: a.purpose };
    if (a.status === 'proposé' && at >= now) {
      push({ ...base, id: `rdv_a_valider:${a.id}`, type: 'rdv_a_valider', meta });
    } else if (a.status === 'proposé' && at < now && !a.missed_action_acknowledged) {
      push({ ...base, id: `rdv_manque:${a.id}`, type: 'rdv_manque', meta });
    } else if (a.status === 'validé' && at >= now && at < endOfToday) {
      push({ ...base, id: `rdv_aujourdhui:${a.id}`, type: 'rdv_aujourdhui', meta });
    } else if (a.status === 'validé' && at < now && !a.outcome && a.purpose !== 'lancement') {
      push({ ...base, id: `bilan_a_faire:${a.id}`, type: 'bilan_a_faire', meta });
    } else if (a.status === 'annulé' && !a.client_cancel_acknowledged && ((a.cancelled_by === 'client' && at >= now) || a.cancelled_by === 'commercial')) {
      push({ ...base, id: `rdv_annule:${a.id}`, type: 'rdv_annule', meta: { ...meta, cancelled_by: a.cancelled_by } });
    }
  }

  // Tri interne : devis le plus ancien d'abord ; RDV le plus proche d'abord ;
  // le reste dans l'ordre de lecture.
  if (byType.devis_a_faire) byType.devis_a_faire.sort((x, y) => new Date(x.at!).getTime() - new Date(y.at!).getTime());
  for (const t of ['rdv_a_valider', 'rdv_aujourdhui', 'rdv_annule'] as NotificationType[]) {
    if (byType[t]) byType[t].sort((x, y) => new Date(x.at!).getTime() - new Date(y.at!).getTime());
  }
  for (const t of ['rdv_manque', 'bilan_a_faire'] as NotificationType[]) {
    if (byType[t]) byType[t].sort((x, y) => new Date(y.at!).getTime() - new Date(x.at!).getTime());
  }

  return NOTIFICATION_TYPE_ORDER.filter((t) => byType[t]?.length).map((t) => ({ type: t, count: byType[t].length, items: byType[t] }));
}

export function countNotifications(groups: NotificationGroup[]): number {
  return groups.reduce((n, g) => n + g.count, 0);
}
