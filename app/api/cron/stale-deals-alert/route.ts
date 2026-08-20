// app/api/cron/stale-deals-alert/route.ts
// Exécuté une fois par jour via Vercel Cron. Alerte le commercial (push et/ou
// email selon ses préférences) quand une affaire du pipeline Aaron Opportunité
// n'a pas bougé depuis STALE_DAYS jours (deal_stage_updated_at), pour les
// étapes non terminales (rdv_fait, devis_envoye, en_negociation) — jamais
// pour une affaire déjà signée ou perdue. Dédoublonné via deal_stage_alerts :
// une seule alerte par (prospect, étape) — se réinitialise naturellement
// quand l'affaire avance à l'étape suivante (voir
// migration_aaron_sales_2026-08-13.sql).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmailForUser } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

const STALE_DAYS = 5;
const NON_TERMINAL_STAGES = ['rdv_fait', 'devis_envoye', 'en_negociation'];

const STAGE_LABELS: Record<string, string> = {
  rdv_fait: 'RDV fait',
  devis_envoye: 'Devis envoyé',
  en_negociation: 'En négociation',
};

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

// Suggestion de relance courte générée par Aaron — best-effort : si le
// plafond API est atteint ou l'appel échoue, on retombe sur un message
// générique plutôt que de bloquer l'alerte (l'essentiel est de prévenir le
// commercial que l'affaire stagne, pas d'avoir une suggestion parfaite).
async function suggestRelance(
  prospectName: string,
  stageLabel: string,
  companyId: string | null,
  locale: string
): Promise<string> {
  const fallback = "Une relance courte, avec un angle différent de la dernière fois, peut débloquer la situation.";
  if (!companyId) return fallback;

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, copilote commercial IA. L'affaire avec le prospect "${prospectName}" est bloquée à ` +
              `l'étape "${stageLabel}" depuis plus de ${STALE_DAYS} jours. Suggère en UNE phrase courte et concrète ` +
              `une action de relance au commercial. Réponds uniquement avec cette phrase, ${localeInstruction(locale)}, sans préambule.`,
          },
        ],
      },
      companyId, 'as'
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    return textBlock?.text?.trim() || fallback;
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur génération suggestion de relance (affaire stagnante):', err.message);
    }
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const staleBefore = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleDeals, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, deal_stage, deal_stage_updated_at, assigned_user_id, company_id, users(id, full_name, email, notify_channel, locale), prospect_companies(name)')
    .in('deal_stage', NON_TERMINAL_STAGES)
    .lt('deal_stage_updated_at', staleBefore);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const alerted: string[] = [];

  for (const deal of staleDeals || []) {
    try {
      const { data: alreadySent } = await supabaseAdmin
        .from('deal_stage_alerts')
        .select('id')
        .eq('prospect_id', deal.id)
        .eq('deal_stage', deal.deal_stage);

      if (alreadySent && alreadySent.length > 0) continue;

      const { error: logError } = await supabaseAdmin
        .from('deal_stage_alerts')
        .insert({ prospect_id: deal.id, deal_stage: deal.deal_stage });

      if (logError) {
        // Contrainte unique déjà posée par un passage concurrent du cron : on passe simplement au suivant.
        if (logError.code === '23505') continue;
        console.error(`Erreur log alerte affaire stagnante ${deal.id}:`, logError.message);
        continue;
      }

      const user = (deal as any).users;
      const companyName = (deal as any).prospect_companies?.name;
      const stageLabel = STAGE_LABELS[deal.deal_stage] || deal.deal_stage;
      const daysSince = Math.floor((Date.now() - new Date(deal.deal_stage_updated_at).getTime()) / (24 * 60 * 60 * 1000));

      const suggestion = await suggestRelance(deal.full_name, stageLabel, deal.company_id, user?.locale);

      const title = `Affaire au point mort : ${deal.full_name}`;
      const body =
        `${deal.full_name}${companyName ? ` (${companyName})` : ''} — étape "${stageLabel}" depuis ${daysSince} jours. ${suggestion}`;
      const url = `/app/sales?user_id=${deal.assigned_user_id}`;

      if (!user) continue;
      const channel = user.notify_channel || 'email';

      if (channel === 'email' || channel === 'both') {
        await sendEmailForUser(
          user.id,
          user.email,
          title,
          `${body}\n\nVoir le pipeline Aaron Opportunité : ${process.env.APP_URL || ''}${url}`
        );
      }

      if (channel === 'push' || channel === 'both') {
        await sendPushNotification(user.id, { title, body, url });
      }

      alerted.push(deal.id);
    } catch (err: any) {
      // Un échec sur UNE alerte ne doit pas empêcher les autres.
      console.error(`Erreur envoi alerte affaire stagnante ${deal.id}:`, err.message);
    }
  }

  return NextResponse.json({ alerted: alerted.length });
}
