// app/api/campaigns/advice-global/route.ts
// POST -> avis global d'Aaron sur l'ensemble des campagnes EN COURS d'un
// commercial (scope: "ongoing"), ou bilan + conseils pour les prochaines
// campagnes à partir des campagnes PASSÉES (scope: "past") — CHANGEMENTS A
// FAIRE #14. Généré à la demande (bouton dédié dans app/app/campaigns/page.jsx),
// pas mis en cache (contrairement à l'avis par campagne) puisqu'il dépend de
// l'ensemble des campagnes à l'instant du clic.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { getPastCampaignStats } from '@/lib/campaign-insights';
import { localeInstruction } from '@/lib/locale-instruction';

export async function POST(request: NextRequest) {
  const { user_id, scope } = await request.json();

  if (!user_id || (scope !== 'ongoing' && scope !== 'past')) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  let prompt: string;

  if (scope === 'ongoing') {
    const { data: ongoing } = await supabaseAdmin
      .from('prospecting_campaigns')
      .select('zone_label, sector_keywords, company_sizes, target_role, status, target_count, contacts_found, companies_found')
      .eq('assigned_user_id', user_id)
      .in('status', ['en_attente', 'en_cours', 'en_pause']);

    if (!ongoing || ongoing.length === 0) {
      return NextResponse.json({ advice: null, empty: true });
    }

    const lines = ongoing.map(
      (c) =>
        `- "${c.zone_label}" (${(c.sector_keywords || []).join(', ') || 'secteur non précisé'}, statut ${c.status}) : ${c.contacts_found}/${c.target_count} contacts trouvés, ${c.companies_found} entreprises analysées.`
    );

    prompt = `Tu es Aaron, copilote commercial IA. Voici les campagnes de prospection actuellement EN COURS (ou en pause/en attente) de ce commercial :\n${lines.join('\n')}\n\nDonne un avis global en 3-5 phrases maximum : quelles campagnes semblent bien parties, lesquelles méritent d'être resserrées ou mises en pause, et un conseil global pour la suite. Sois concret et direct. Réponds uniquement avec ce texte, ${localeInstruction(authedUser.locale)}, sans préambule ni titre.`;
  } else {
    const stats = await getPastCampaignStats(user.company_id);
    const ownStats = await supabaseAdmin
      .from('prospecting_campaigns')
      .select('id')
      .eq('assigned_user_id', user_id)
      .eq('status', 'terminee');

    if (!ownStats.data || ownStats.data.length === 0) {
      return NextResponse.json({ advice: null, empty: true });
    }

    const sorted = [...stats].sort((a, b) => b.conversionRate - a.conversionRate);
    const lines = sorted.map(
      (s) =>
        `- "${s.zone_label}" (${s.sector_keywords.join(', ') || 'secteur non précisé'}) : ${s.contacts_found} contacts, ${s.won} gagnés, ${s.lost} perdus, ${s.active} encore actifs — conversion ${(s.conversionRate * 100).toFixed(0)}%.`
    );

    prompt = `Tu es Aaron, copilote commercial IA. Voici le bilan de toutes les campagnes de prospection TERMINÉES de cette société, de la mieux à la moins bien convertie :\n${lines.join('\n')}\n\nFais un bilan en 4-6 phrases maximum : quels secteurs/zones ont le mieux marché et pourquoi selon toi, et 2-3 conseils concrets pour les prochaines campagnes à lancer. Sois direct et actionnable. Réponds uniquement avec ce texte, ${localeInstruction(authedUser.locale)}, sans préambule ni titre.`;
  }

  try {
    const data = await callClaude(
      { model: 'claude-haiku-4-5', max_tokens: 350, messages: [{ role: 'user', content: prompt }] },
      user.company_id, 'ap'
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    const advice = textBlock?.text?.trim() || "Aaron n'a pas pu générer d'avis cette fois — réessaie dans un instant.";
    return NextResponse.json({ advice });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? 'Plafond de dépense API du jour atteint pour votre société — ça repart automatiquement demain.'
              : 'Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.',
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }
}
