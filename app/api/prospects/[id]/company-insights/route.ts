// app/api/prospects/[id]/company-insights/route.ts
// POST { action: 'opinion' | 'socials', refresh?: boolean }
//
// 22/10/2026 — enrichissement validé par Alex :
//   - 'opinion' : l'avis d'Aaron sur l'entreprise de ce contact (bonne cible ?
//     angle d'approche ? vigilance ?), voir generateCompanyOpinion. Mis en
//     cache sur la fiche société ; renvoyé tel quel s'il existe déjà dans la
//     langue du commercial, sauf refresh=true.
//   - 'socials' : pages LinkedIn / Instagram PUBLIQUES de l'entreprise, pour
//     les fiches recherchées avant l'ajout de cette fonction. Une seule
//     tentative par société (socials_checked_at), lancée par le commercial.
// Aucune connexion à LinkedIn ni à Instagram : ce sont des liens qu'il ouvre
// lui-même.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';
import { findCompanySocials, generateCompanyOpinion } from '@/lib/prospect-research';
import { readJsonBody, serverError } from '@/lib/http';

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { data: prospect } = await supabaseAdmin
    .from('prospects')
    .select('id, company_id, assigned_user_id, prospect_company_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!prospect) return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return forbiddenResponse();
  }
  if (!prospect.prospect_company_id) {
    return NextResponse.json({ error: 'Aucune société associée à cette fiche' }, { status: 400 });
  }

  const body: any = await readJsonBody(request);
  const action = body?.action;

  const { data: pc, error: pcError } = await supabaseAdmin
    .from('prospect_companies')
    .select('*')
    .eq('id', prospect.prospect_company_id)
    .maybeSingle();
  if (pcError) return serverError(pcError, '/api/prospects/[id]/company-insights');
  if (!pc) return NextResponse.json({ error: 'Société introuvable' }, { status: 404 });

  try {
    if (action === 'opinion') {
      // Colonne absente = migration du 22/10 pas encore jouée : on ne génère
      // rien (on ne pourrait pas le garder, donc on le repaierait à chaque
      // ouverture de fiche).
      if (!('aaron_opinion' in pc)) return NextResponse.json({ opinion: null, unavailable: true });
      const sameLocale = (pc.aaron_opinion_locale || 'fr') === (authedUser.locale || 'fr');
      if (pc.aaron_opinion && sameLocale && !body?.refresh) {
        return NextResponse.json({
          opinion: pc.aaron_opinion,
          fit: pc.aaron_opinion_fit || null,
          generated_at: pc.aaron_opinion_generated_at || null,
        });
      }
      const result = await generateCompanyOpinion(prospect.company_id, pc, authedUser.locale, authedUser.id);
      if (!result) return NextResponse.json({ opinion: null });
      const generated_at = new Date().toISOString();
      await supabaseAdmin
        .from('prospect_companies')
        .update({
          aaron_opinion: result.opinion,
          aaron_opinion_fit: result.fit,
          aaron_opinion_locale: authedUser.locale || 'fr',
          aaron_opinion_generated_at: generated_at,
        })
        .eq('id', pc.id);
      return NextResponse.json({ opinion: result.opinion, fit: result.fit, generated_at });
    }

    if (action === 'socials') {
      if (!('socials_checked_at' in pc)) return NextResponse.json({ unavailable: true });
      if (pc.socials_checked_at && !body?.refresh) {
        return NextResponse.json({ linkedin_url: pc.linkedin_url || null, instagram_url: pc.instagram_url || null, checked: true });
      }
      const found = await findCompanySocials(prospect.company_id, { name: pc.name, website: pc.website, domain: pc.domain });
      const update: Record<string, any> = { socials_checked_at: new Date().toISOString() };
      // Jamais écraser un lien saisi par le commercial.
      if (found.linkedin_url && !pc.linkedin_url) update.linkedin_url = found.linkedin_url;
      if (found.instagram_url && !pc.instagram_url) update.instagram_url = found.instagram_url;
      await supabaseAdmin.from('prospect_companies').update(update).eq('id', pc.id);
      return NextResponse.json({
        linkedin_url: update.linkedin_url || pc.linkedin_url || null,
        instagram_url: update.instagram_url || pc.instagram_url || null,
        checked: true,
      });
    }
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json({ error: 'cap', reason: err.reason }, { status: 429 });
    }
    return serverError(err, '/api/prospects/[id]/company-insights');
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
