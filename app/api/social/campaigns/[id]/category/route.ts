// app/api/social/campaigns/[id]/category/route.ts
//
// POST { category } -> prépare les 4 posts d'une famille pour cette campagne
// (lib/social-posts.ts) et les range dans les semaines 1 à 4, au créneau de
// la famille. Quand les 4 familles sont là, la campagne passe « prete ».
// Relancer une famille déjà préparée la remplace.
//
// Réservé pour l'instant au compte aaron@meetaaron.app (lib/social-access.js).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { readJsonBody } from '@/lib/http';
import { socialPreviewAllowed } from '@/lib/social-access';
import { generateCategoryPosts, generateOnePost, SOCIAL_CATEGORIES, SocialCategory } from '@/lib/social-posts';
import { MonthlyCapExceededError, SubscriptionUnpaidError } from '@/lib/anthropic-client';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await ctx.params;
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (!socialPreviewAllowed(authedUser.email) || !authedUser.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { category, week } = await readJsonBody(request);
  if (!(SOCIAL_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: 'category_invalide' }, { status: 400 });
  }
  const slot = (SOCIAL_CATEGORIES as readonly string[]).indexOf(category) + 1;

  const { data: campaign } = await supabaseAdmin
    .from('social_campaigns')
    .select('id, company_id, status, locale')
    .eq('id', campaignId)
    .maybeSingle();
  if (!campaign || (campaign as any).company_id !== authedUser.company_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!['preparation', 'prete', 'erreur'].includes((campaign as any).status)) {
    return NextResponse.json({ error: 'campagne_lancee' }, { status: 409 });
  }

  // UN post pour une semaine donnée (21/11/2026) : voir generateOnePost.
  const weekNum = Number(week);
  if (Number.isInteger(weekNum) && weekNum >= 1 && weekNum <= 4) {
    const { data: siblings } = await supabaseAdmin
      .from('social_posts')
      .select('subject, week')
      .eq('campaign_id', campaignId)
      .eq('slot', slot);
    const avoid = ((siblings || []) as any[]).filter((r) => r.week !== weekNum).map((r) => String(r.subject || '')).filter(Boolean);
    let one;
    try {
      one = await generateOnePost(authedUser.company_id, category as SocialCategory, (campaign as any).locale || authedUser.locale, authedUser.id, avoid);
    } catch (err: any) {
      if (err instanceof MonthlyCapExceededError || err instanceof SubscriptionUnpaidError) {
        return NextResponse.json({ error: 'budget' }, { status: 429 });
      }
      console.error(`[social] post « ${category} » semaine ${weekNum} :`, err?.message || err);
      return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
    }
    if (!one) return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
    const nowOne = new Date().toISOString();
    await supabaseAdmin.from('social_posts').delete().eq('campaign_id', campaignId).eq('slot', slot).eq('week', weekNum);
    const { error: oneErr } = await supabaseAdmin.from('social_posts').insert({
      campaign_id: campaignId,
      company_id: authedUser.company_id,
      week: weekNum,
      slot,
      category,
      subject: one.subject,
      material_needed: one.material_needed,
      material_hint: one.material_hint,
      content: one.content,
      status: one.material_needed === 'none' ? 'pret' : 'brouillon',
      updated_at: nowOne,
    });
    if (oneErr) {
      console.error('[social] enregistrement du post :', oneErr.code || '', oneErr.message);
      return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }
    const { count } = await supabaseAdmin.from('social_posts').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
    if ((count || 0) >= 16) {
      await supabaseAdmin.from('social_campaigns').update({ status: 'prete', error: null, updated_at: nowOne }).eq('id', campaignId);
    }
    return NextResponse.json({ success: true, posts_done: count || 0 });
  }

  let posts;
  try {
    posts = await generateCategoryPosts(authedUser.company_id, category as SocialCategory, (campaign as any).locale || authedUser.locale, authedUser.id);
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError || err instanceof SubscriptionUnpaidError) {
      return NextResponse.json({ error: 'budget' }, { status: 429 });
    }
    console.error(`[social] famille « ${category} » :`, err?.message || err);
    return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
  }
  if (posts.length === 0) {
    return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
  }

  const now = new Date().toISOString();
  const rows = posts.map((p, i) => ({
    campaign_id: campaignId,
    company_id: authedUser.company_id,
    week: i + 1,
    slot,
    category,
    subject: p.subject,
    material_needed: p.material_needed,
    material_hint: p.material_hint,
    content: p.content,
    status: p.material_needed === 'none' ? 'pret' : 'brouillon',
    updated_at: now,
  }));
  // Relance d'une famille : on remplace ses posts.
  await supabaseAdmin.from('social_posts').delete().eq('campaign_id', campaignId).eq('slot', slot);
  const { error: insertError } = await supabaseAdmin.from('social_posts').insert(rows);
  if (insertError) {
    console.error('[social] enregistrement des posts :', insertError.code || '', insertError.message);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  const { data: slots } = await supabaseAdmin.from('social_posts').select('slot').eq('campaign_id', campaignId);
  const done = new Set(((slots || []) as any[]).map((r) => r.slot)).size;
  if (done >= SOCIAL_CATEGORIES.length) {
    await supabaseAdmin.from('social_campaigns').update({ status: 'prete', error: null, updated_at: now }).eq('id', campaignId);
  }
  return NextResponse.json({ success: true, count: rows.length, categories_done: done });
}
