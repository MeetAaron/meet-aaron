// lib/subscription-stakes.ts
//
// CE QUI EST EN PAUSE (Alex, 03/11/2026).
//
// « J'aimerais bien ajouter un truc après les 6 jours. Par exemple un email
// du genre : réabonnez-vous, sinon nous aurons perdu des efforts de travail
// sur 20 opportunités et 20 prospects actifs (Aaron se basera sur le fichier
// contact réel de l'utilisateur). »
//
// L'idée est juste, à une condition : les chiffres doivent être VRAIS. Un
// email qui annonce « 20 opportunités » à quelqu'un qui en a deux ne motive
// personne, il apprend juste au client que Meet Aaron raconte n'importe quoi
// au moment de lui demander de l'argent. Tout vient donc de ses données, et
// quand il n'y a rien à dire, on ne dit rien — l'email part sans ce
// paragraphe plutôt qu'avec des zéros.
//
// Trois mesures, choisies parce qu'elles représentent du travail DÉJÀ FAIT
// qui dort, pas une promesse :
//   - prospects actifs : contactés par Aaron, ni gagnés ni perdus ;
//   - opportunités : affaires en cours, hors signées et perdues ;
//   - rendez-vous à venir.

import { supabaseAdmin } from './supabase-admin';
import { NON_TERMINAL_DEAL_STAGES } from './team-stats';
import { selectInChunks } from './chunked-in';

export interface SubscriptionStakes {
  activeProspects: number;
  opportunities: number;
  upcomingAppointments: number;
  total: number;
}

const EMPTY: SubscriptionStakes = {
  activeProspects: 0,
  opportunities: 0,
  upcomingAppointments: 0,
  total: 0,
};

export async function computeStakes(companyId: string): Promise<SubscriptionStakes> {
  try {
    const { data: users } = await supabaseAdmin.from('users').select('id').eq('company_id', companyId);
    const userIds = ((users as any[]) || []).map((u) => u.id).filter(Boolean);
    if (userIds.length === 0) return EMPTY;

    const { data: prospects } = await selectInChunks(userIds, (part) => supabaseAdmin
      .from('prospects')
      .select('id, is_won, is_lost, deal_stage')
      .in('assigned_user_id', part));
    const rows = (prospects as any[]) || [];

    const opportunities = rows.filter(
      (p) => p.deal_stage && NON_TERMINAL_DEAL_STAGES.includes(p.deal_stage)
    ).length;

    // « Actif » = Aaron lui a vraiment écrit. Un contact importé jamais
    // démarché ne représente aucun travail en cours : le compter serait
    // gonfler le chiffre, exactement ce qu'on veut éviter ici.
    const openIds = rows.filter((p) => !p.is_won && !p.is_lost).map((p) => p.id);
    let activeProspects = 0;
    if (openIds.length > 0) {
      const { data: conversations } = await selectInChunks(openIds, (part) => supabaseAdmin
        .from('conversations')
        .select('id, prospect_id')
        .in('prospect_id', part));
      const prospectIdByConversationId: Record<string, string> = {};
      ((conversations as any[]) || []).forEach((cv) => {
        if (cv.prospect_id) prospectIdByConversationId[cv.id] = cv.prospect_id;
      });
      const conversationIds = Object.keys(prospectIdByConversationId);
      if (conversationIds.length > 0) {
        const { data: messages } = await selectInChunks(conversationIds, (part) => supabaseAdmin
          .from('messages')
          .select('conversation_id, direction')
          .in('conversation_id', part));
        const engaged = new Set<string>();
        ((messages as any[]) || []).forEach((m) => {
          if (m.direction !== 'outbound') return;
          const prospectId = prospectIdByConversationId[m.conversation_id];
          if (prospectId) engaged.add(prospectId);
        });
        activeProspects = engaged.size;
      }
    }

    const { data: appointments } = await selectInChunks(userIds, (part) => supabaseAdmin
      .from('appointments')
      .select('id, status, proposed_at')
      .in('user_id', part)
      .in('status', ['proposé', 'validé'])
      .gte('proposed_at', new Date().toISOString()));
    const upcomingAppointments = ((appointments as any[]) || []).length;

    return {
      activeProspects,
      opportunities,
      upcomingAppointments,
      total: activeProspects + opportunities + upcomingAppointments,
    };
  } catch (err: any) {
    // Jamais bloquant : sans ces chiffres l'email part quand même, sans le
    // paragraphe. Une relance muette vaut mieux qu'une relance jamais partie.
    console.error('Ce qui est en pause — calcul impossible (non bloquant):', err?.message || err);
    return EMPTY;
  }
}

// Phrase française prête à insérer, ou null quand il n'y a rien à dire.
export function stakesSentence(stakes: SubscriptionStakes): string | null {
  const bits: string[] = [];
  if (stakes.activeProspects > 0) {
    bits.push(`${stakes.activeProspects} prospect${stakes.activeProspects > 1 ? 's' : ''} en cours de discussion`);
  }
  if (stakes.opportunities > 0) {
    bits.push(`${stakes.opportunities} opportunité${stakes.opportunities > 1 ? 's' : ''} ouverte${stakes.opportunities > 1 ? 's' : ''}`);
  }
  if (stakes.upcomingAppointments > 0) {
    bits.push(`${stakes.upcomingAppointments} rendez-vous à venir`);
  }
  if (bits.length === 0) return null;
  const last = bits.pop() as string;
  return bits.length === 0 ? last : `${bits.join(', ')} et ${last}`;
}
