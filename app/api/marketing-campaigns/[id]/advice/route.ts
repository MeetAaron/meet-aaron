// app/api/marketing-campaigns/[id]/advice/route.ts
// POST -> génère (ou régénère) l'avis d'Aaron sur UNE campagne marketing,
// même principe que app/api/campaigns/[id]/advice/route.ts (prospection),
// adapté aux métriques disponibles ici : taux de clic et de désabonnement.
//
// Pas de taux d'ouverture pour l'instant (voir lib/marketing-tracking.ts —
// nécessite un envoi HTML, pas encore fait) : le prompt le précise
// explicitement pour qu'Aaron ne le mentionne pas comme s'il l'avait.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: campaign } = await supabaseAdmin.from('marketing_campaigns').select('*').eq('id', params.id).single();
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.created_by_user_id) return forbiddenResponse();

  if (!['en_cours', 'terminee', 'en_pause'].includes(campaign.status)) {
    return NextResponse.json({ error: "Cette campagne n'a pas encore été envoyée" }, { status: 400 });
  }

  const { data: recipients } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('status, click_count')
    .eq('campaign_id', campaign.id);

  const total = (recipients || []).length;
  const envoyes = (recipients || []).filter((r) => r.status === 'envoye').length;
  const echecs = (recipients || []).filter((r) => r.status === 'echec').length;
  const desabonnes = (recipients || []).filter((r) => r.status === 'desabonne').length;
  const clics = (recipients || []).filter((r) => r.click_count > 0).length;
  const clickRate = envoyes > 0 ? Math.round((clics / envoyes) * 100) : 0;
  const unsubRate = total > 0 ? Math.round((desabonnes / total) * 100) : 0;

  const prompt = `Tu es Aaron, copilote commercial IA. Voici les résultats d'une campagne email marketing envoyée à des clients déjà gagnés (pas des prospects froids) :
- Nom de la campagne : ${campaign.name}
- Sujet utilisé : ${campaign.subject || 'non renseigné'}
- Destinataires visés : ${total}, emails envoyés avec succès : ${envoyes}, échecs d'envoi : ${echecs}.
- Taux de clic (sur les emails envoyés) : ${clickRate}%.
- Taux de désabonnement (sur les destinataires visés) : ${unsubRate}%.
- Note : le taux d'OUVERTURE n'est pas mesuré pour l'instant (limitation technique connue) — ne le mentionne pas et ne l'invente pas.

Donne un avis concret en 3-4 phrases maximum : la campagne a-t-elle plutôt bien ou mal fonctionné compte tenu du taux de clic et de désabonnement, et un conseil actionnable pour la prochaine campagne (angle du message, segmentation, fréquence d'envoi...). Sois direct, pas générique. Réponds uniquement avec ce texte, ${localeInstruction(authedUser.locale)}, sans préambule ni titre.`;

  let advice: string;
  try {
    const data = await callClaude(
      { model: 'claude-sonnet-4-6', max_tokens: 250, messages: [{ role: 'user', content: prompt }] },
      campaign.company_id,
      'ac'
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    advice = textBlock?.text?.trim() || "Aaron n'a pas pu générer d'avis cette fois — réessaie dans un instant.";
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? 'Plafond de dépense API du jour atteint pour votre société — ça repart automatiquement demain.'
              : err.reason === 'credits_exhausted'
              ? 'Plafond de dépense API atteint et solde de crédits Aaron Clients épuisé.'
              : 'Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.',
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }

  const generatedAt = new Date().toISOString();
  await supabaseAdmin.from('marketing_campaigns').update({ advice, advice_generated_at: generatedAt }).eq('id', campaign.id);

  return NextResponse.json({ advice, advice_generated_at: generatedAt });
}
