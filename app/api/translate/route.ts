// app/api/translate/route.ts
// POST { items: [{ id, text }], target: 'fr'|'en'|... }
//   -> { translations: [{ id, source_locale, text|null }] }
//
// Traduction à la demande des textes affichés dans l'interface (avis et
// conseils d'Aaron, messages des prospects, résumés) vers la langue de
// l'interface du commercial — voir lib/translate.ts. Utilisée par
// components/Translated.jsx. Compte dans le plafond de la société.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { readJsonBody } from '@/lib/http';
import { translateBatch, TRANSLATE_LOCALES, MAX_ITEMS_PER_CALL, TranslateLocale } from '@/lib/translate';
import { MonthlyCapExceededError, SubscriptionUnpaidError } from '@/lib/anthropic-client';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const { items, target } = await readJsonBody(request);
  if (!TRANSLATE_LOCALES.includes(target)) {
    return NextResponse.json({ error: 'langue cible inconnue' }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ translations: [] });
  }
  if (items.length > MAX_ITEMS_PER_CALL) {
    return NextResponse.json({ error: `au plus ${MAX_ITEMS_PER_CALL} textes par appel` }, { status: 400 });
  }

  try {
    const translations = await translateBatch(items, target as TranslateLocale, authedUser.company_id || null, authedUser.id);
    return NextResponse.json({ translations });
  } catch (err: any) {
    // Plafond atteint ou abonnement impayé : on ne traduit pas, l'interface
    // affiche l'original — ce n'est pas une erreur à montrer.
    if (err instanceof MonthlyCapExceededError || err instanceof SubscriptionUnpaidError) {
      return NextResponse.json({ translations: [], capped: true });
    }
    console.error('[api/translate]', err?.message || err);
    return NextResponse.json({ translations: [] });
  }
}
