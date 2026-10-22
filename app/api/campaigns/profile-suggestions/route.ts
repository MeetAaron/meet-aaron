// app/api/campaigns/profile-suggestions/route.ts
// GET -> { prefill, chips } tirés du profil d'entreprise (22/10/2026, lot 2
// de la refonte de l'onboarding validée par Alex) :
//   - prefill : la PREMIÈRE campagne, sans aucune question nouvelle — zone,
//     secteurs, taille et cible déduits des 12 réponses / du profil ; le
//     commercial confirme ou corrige, et choisit le nombre.
//   - chips : pour les campagnes suivantes, les puces « d'après ta fiche »
//     affichées EN PREMIER (contour bleu + icône fiche) à chaque question.
// Un seul appel Haiku, sans recherche web, gardé sur la société et recalculé
// seulement quand le profil change (empreinte source_key). ?hint=… (« tu
// vends quoi, à qui ? ») sert quand le questionnaire a été sauté : jamais
// mis en cache.

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';
import { serverError } from '@/lib/http';

const SIZE_KEYS = ['artisan_tpe', 'pme', 'eti', 'grand_compte'];
const ROLE_KEYS = ['fondateur_dirigeant', 'responsable_commercial', 'responsable_achats', 'rh'];

function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const s = x.trim().slice(0, 80);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
const keyList = (v: unknown, allowed: string[]) => strList(v, allowed.length).filter((k) => allowed.includes(k));

function sanitize(parsed: any) {
  const p = parsed?.prefill || {};
  const c = parsed?.chips || {};
  return {
    prefill: {
      zone_label: typeof p.zone_label === 'string' && p.zone_label.trim() ? p.zone_label.trim().slice(0, 120) : null,
      sector_keywords: strList(p.sector_keywords, 5),
      company_sizes: keyList(p.company_sizes, SIZE_KEYS),
      target_role: ROLE_KEYS.includes(p.target_role) ? p.target_role : null,
      context_notes: typeof p.context_notes === 'string' && p.context_notes.trim() ? p.context_notes.trim().slice(0, 600) : null,
    },
    chips: {
      secteur: strList(c.secteur, 4),
      zone: strList(c.zone, 3),
      taille: keyList(c.taille, SIZE_KEYS),
      role: keyList(c.role, ROLE_KEYS),
      communication: strList(c.communication, 3),
    },
  };
}

export async function GET(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  const hint = (request.nextUrl.searchParams.get('hint') || '').trim().slice(0, 600);

  const [{ data: company }, { data: user }] = await Promise.all([
    supabaseAdmin.from('companies').select('*').eq('id', authedUser.company_id).maybeSingle(),
    supabaseAdmin.from('users').select('onboarding_answers').eq('id', authedUser.id).maybeSingle(),
  ]);
  if (!company) return NextResponse.json({ error: 'Société introuvable' }, { status: 404 });

  const summary = String(company.business_summary || '').trim();
  const answers = Array.isArray(user?.onboarding_answers) ? user!.onboarding_answers : [];
  const answersText = answers
    .filter((a: any) => a?.answer)
    .map((a: any) => `- ${a.question || a.key}: ${a.answer}`)
    .join('\n');
  if (!summary && !answersText && !hint) return NextResponse.json({ prefill: null, chips: null });

  const sourceKey = createHash('sha256').update(`${authedUser.locale}|${summary}|${answersText}`).digest('hex').slice(0, 32);
  const cacheable = !hint && 'campaign_profile_suggestions' in company;
  if (cacheable && company.campaign_profile_suggestions_key === sourceKey && company.campaign_profile_suggestions) {
    return NextResponse.json(company.campaign_profile_suggestions);
  }

  const prompt =
    `Tu prépares la campagne de prospection B2B d'une entreprise à partir de ce qu'on sait d'elle.\n\n` +
    (summary ? `PROFIL D'ENTREPRISE :\n${summary.slice(0, 8000)}\n\n` : '') +
    (answersText ? `RÉPONSES DU QUESTIONNAIRE :\n${answersText.slice(0, 6000)}\n\n` : '') +
    (hint ? `CE QUE L'UTILISATEUR VEND, ET À QUI (en une phrase) : ${hint}\n\n` : '') +
    `Déduis UNIQUEMENT de ces informations (n'invente pas de faits) :\n` +
    `1) "prefill" : la première campagne la plus évidente pour trouver des CLIENTS de cette entreprise :\n` +
    `   - "zone_label" : zone géographique (ville, région ou pays) où elle travaille, ou null si inconnue ;\n` +
    `   - "sector_keywords" : 1 à 3 secteurs d'activité des entreprises CLIENTES à démarcher (pas son propre secteur) ;\n` +
    `   - "company_sizes" : parmi ${JSON.stringify(SIZE_KEYS)} ;\n` +
    `   - "target_role" : le décideur à contacter parmi ${JSON.stringify(ROLE_KEYS)} ou null ;\n` +
    `   - "context_notes" : une phrase utile pour Aaron (offre, argument principal), ou null.\n` +
    `2) "chips" : des propositions courtes (2 à 4 mots) tirées du profil, pour les campagnes suivantes :\n` +
    `   "secteur" (jusqu'à 4 types de clients), "zone" (jusqu'à 3), "taille" (clés ci-dessus), ` +
    `"role" (clés ci-dessus), "communication" (jusqu'à 3 tons adaptés à ces clients).\n` +
    `Rédige les textes ${localeInstruction(authedUser.locale)}. Laisse une liste vide plutôt que de deviner.\n` +
    `Réponds UNIQUEMENT avec un objet JSON, sans texte autour : {"prefill": {...}, "chips": {...}}`;

  try {
    const data = await callClaude(
      { model: 'claude-haiku-4-5', max_tokens: 900, messages: [{ role: 'user', content: prompt }] },
      authedUser.company_id,
      'ap',
      authedUser.id
    );
    const out = data.content.filter((b: any) => b.type === 'text').pop()?.text || '';
    const match = out.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ prefill: null, chips: null });
    const result = sanitize(JSON.parse(match[0]));
    if (cacheable) {
      await supabaseAdmin
        .from('companies')
        .update({ campaign_profile_suggestions: result, campaign_profile_suggestions_key: sourceKey })
        .eq('id', authedUser.company_id);
    }
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) return NextResponse.json({ prefill: null, chips: null, error: 'cap' }, { status: 429 });
    return serverError(err, '/api/campaigns/profile-suggestions');
  }
}
