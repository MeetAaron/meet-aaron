// app/api/marketing-campaigns/[id]/draft/route.ts
// POST -> Aaron rédige (ou réécrit) le sujet + corps de la campagne à partir
// d'un objectif en langage libre ("annoncer notre nouvelle fonctionnalité X",
// "relancer les clients qui n'ont pas commandé depuis 3 mois", "campagne de
// fidélisation pour nos clients à risque"...).
//
// Bonnes pratiques d'emailing marketing (benchmark HubSpot / ActiveCampaign /
// Klaviyo / Customer.io — voir recherche menée pour ce lot) injectées
// directement dans le prompt plutôt que laissées à l'appréciation du modèle :
// un seul objectif clair par email, un sujet court et concret (pas de
// clickbait), une personnalisation ({{prenom}}), un seul appel à l'action
// net, et un ton qui correspond à une relation déjà établie (client existant,
// pas un prospect froid) — donc jamais l'angle "aversion à la perte" agressif
// utilisé pour la prospection (voir Aaron Prospect), plutôt un ton de
// partenaire qui apporte de la valeur.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';
import { resolveAudience } from '@/lib/marketing-audience';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { data: campaign } = await supabaseAdmin.from('marketing_campaigns').select('*').eq('id', params.id).single();
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== campaign.created_by_user_id) return forbiddenResponse();

  if (!['brouillon', 'prete'].includes(campaign.status)) {
    return NextResponse.json({ error: 'Cette campagne ne peut plus être modifiée (envoi déjà commencé)' }, { status: 400 });
  }

  const { goal } = await request.json();
  if (!goal || !goal.trim()) {
    return NextResponse.json({ error: "Objectif de la campagne manquant (ex: \"annoncer une nouveauté\")" }, { status: 400 });
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('name, business_summary')
    .eq('id', campaign.company_id)
    .single();

  let audienceCount = 0;
  try {
    audienceCount = (await resolveAudience(campaign)).length;
  } catch {
    // Aperçu d'audience non bloquant pour la rédaction — au pire le prompt
    // n'a pas ce chiffre.
  }

  const prompt = `Tu es Aaron, copilote commercial IA. Rédige un email marketing pour ${company?.name || 'cette société'} à destination de CLIENTS DÉJÀ GAGNÉS (pas des prospects froids — ce sont des gens qui ont déjà acheté et ont une relation établie avec l'entreprise).

Contexte sur l'entreprise : ${company?.business_summary || 'non renseigné'}
Objectif de cette campagne, donné par le commercial : ${goal.trim()}
Taille de l'audience visée : ${audienceCount || 'quelques'} client(s).

Règles à respecter absolument (bonnes pratiques emailing constatées chez les meilleurs outils du marché) :
- Un seul objectif par email, pas de mélange de sujets.
- Sujet court (moins de 60 caractères), concret, jamais putaclic.
- Corps en texte brut (pas de HTML), 80 à 150 mots, ton de partenaire qui apporte de la valeur à un client existant — jamais le ton "aversion à la perte" utilisé pour démarcher un prospect froid.
- Utilise la balise {{prenom}} exactement une fois pour personnaliser l'accroche (ex: "Bonjour {{prenom}},").
- Un seul appel à l'action net et clair, formulé en texte (pas de lien fictif à inventer).
- Ne signe pas l'email (la signature du commercial est ajoutée automatiquement après).

Réponds STRICTEMENT en JSON valide, ${localeInstruction(authedUser.locale)}, sur ce format exact, sans texte avant ni après :
{"subject": "...", "body": "..."}`;

  let subject = '';
  let bodyText = '';
  try {
    const data = await callClaude(
      { model: 'claude-sonnet-4-6', max_tokens: 600, messages: [{ role: 'user', content: prompt }] },
      campaign.company_id,
      'ac'
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    const raw = textBlock?.text?.trim() || '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    subject = (parsed.subject || '').trim();
    bodyText = (parsed.body || '').trim();
    if (!subject || !bodyText) throw new Error('Réponse incomplète');
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? 'Plafond de dépense API du jour atteint pour votre société — ça repart automatiquement demain.'
              : err.reason === 'credits_exhausted'
              ? 'Plafond de dépense API atteint et solde de crédits Aaron Clients épuisé — achetez des crédits dans Préférences pour continuer.'
              : 'Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.',
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: "Aaron n'a pas pu générer ce brouillon cette fois — réessaie dans un instant." }, { status: 500 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('marketing_campaigns')
    .update({ subject, body_text: bodyText, ai_generated: true, status: 'brouillon', updated_at: new Date().toISOString() })
    .eq('id', campaign.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: updated });
}
