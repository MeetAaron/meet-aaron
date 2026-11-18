// app/api/signature/route.ts
// GET    -> lit la signature email enregistrée pour le commercial
// PATCH  -> enregistre la signature (après relecture/correction manuelle)
// POST   -> tente de détecter automatiquement une signature à partir du
//           dernier email envoyé (Gmail uniquement pour l'instant) — ne
//           l'enregistre PAS, la renvoie juste pour relecture côté UI.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { getLastSentGmailBodyText } from '@/lib/google';
import { guessEmailSignature } from '@/lib/signature';
import {
  normalizeSignatureMap,
  parseSignatureMap,
  buildSignatureMap,
  signatureStateOf,
  refreshSignatureTranslations,
  signatureHash,
  tidySignature,
  SIGNATURE_LOCALES,
  SignatureState,
} from '@/lib/signature-locale';
import { readJsonBody, serverError } from '@/lib/http';


// Vue de la signature pour l'écran Mon entreprise (18/11/2026) : la signature
// écrite, la langue dans laquelle Aaron l'a reconnue, et la version qui
// partira dans chacune des autres langues (traduite automatiquement ou
// corrigée à la main).
function describeSignature(state: SignatureState) {
  const hash = signatureHash(state.signature);
  const fresh = !!state.meta.src && state.meta.src === hash;
  const versions: Record<string, { text: string; manual: boolean; pending: boolean }> = {};
  for (const locale of SIGNATURE_LOCALES) {
    if (locale === state.meta.from) continue;
    const manual = state.meta.manual.includes(locale);
    const text = state.entries[locale] || '';
    const usable = manual || (state.meta.auto && fresh && !!text);
    versions[locale] = { text: usable ? text : '', manual, pending: !usable && state.meta.auto && !!state.signature };
  }
  return {
    signature_auto: state.meta.auto,
    signature_from: state.meta.from,
    signature_versions: versions,
  };
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  // Repli 42703 : tant que migration_signature_multilingue_2026-09-26.sql
  // n'est pas passée, la page Mon entreprise doit continuer à fonctionner
  // avec la seule signature par défaut.
  let userRes: any = await supabaseAdmin
    .from('users')
    .select('email_signature, email_signature_by_locale, email_signature_image_url, email_signature_image_by_locale, email_banner_image_url, email_banner_by_locale')
    .eq('id', userId)
    .maybeSingle();
  if (userRes.error && userRes.error.code === '42703') {
    userRes = await supabaseAdmin
      .from('users')
      .select('email_signature, email_signature_image_url, email_banner_image_url')
      .eq('id', userId)
      .maybeSingle();
  }
  const user: any = userRes.data;

  const state = signatureStateOf(user?.email_signature, user?.email_signature_by_locale, authedUser.locale);
  return NextResponse.json({
    ...describeSignature(state),
    signature: user?.email_signature || null,
    // Signature par langue de destinataire (A_FAIRE.docx, 26/09/2026) — voir
    // lib/signature-locale.ts. Objet { langue: texte }, les langues absentes
    // retombant sur `signature` ci-dessus.
    signature_by_locale: user?.email_signature_by_locale || null,
    signature_image_url: user?.email_signature_image_url || null,
    signature_image_by_locale: user?.email_signature_image_by_locale || null,
    // Bandeau publicitaire affiché sous la signature dans les emails (docx
    // Modifs Aaron, bloc "AJOUT signature", 30/08/2026) — voir
    // migration_email_banner_2026-08-31.sql et lib/messaging.ts.
    banner_image_url: user?.email_banner_image_url || null,
    // Bandeau par langue de destinataire (30/09/2026) — meme mecanique que
    // signature_by_locale : une langue absente retombe sur banner_image_url.
    banner_by_locale: user?.email_banner_by_locale || null,
  });
}

export async function PATCH(request: NextRequest) {
  const { user_id, signature, signature_by_locale, auto_translate, overrides } = await readJsonBody(request);

  if (!user_id || typeof signature !== 'string') {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const cleanSignature = tidySignature(signature).slice(0, 1500);
  const patch: Record<string, any> = { email_signature: cleanSignature || null };

  // Nouvel écran (18/11/2026) : une seule signature, traduite par Aaron.
  // `overrides` = les langues que le commercial corrige lui-même
  // ({ en: '…' } pour fixer une version, { en: null } pour la rendre à la
  // traduction automatique). `auto_translate` coupe ou rallume la traduction.
  const usesNewScreen = auto_translate !== undefined || overrides !== undefined;
  if (usesNewScreen) {
    const { data: current, error: readError } = await supabaseAdmin
      .from('users')
      .select('email_signature_by_locale')
      .eq('id', user_id)
      .maybeSingle();
    if (readError && (readError as any).code !== '42703') return serverError(readError, '/api/signature');
    const { entries, meta } = parseSignatureMap((current as any)?.email_signature_by_locale);
    const nextMeta = { ...meta, manual: [...meta.manual] };
    if (typeof auto_translate === 'boolean') nextMeta.auto = auto_translate;
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      for (const locale of SIGNATURE_LOCALES) {
        if (!(locale in overrides)) continue;
        const raw = (overrides as any)[locale];
        const value = typeof raw === 'string' ? tidySignature(raw).slice(0, 1500) : '';
        if (value) {
          entries[locale] = value;
          if (!nextMeta.manual.includes(locale)) nextMeta.manual.push(locale);
        } else {
          delete entries[locale];
          nextMeta.manual = nextMeta.manual.filter((l) => l !== locale);
        }
      }
    }
    patch.email_signature_by_locale = buildSignatureMap(entries, nextMeta);
  } else if (signature_by_locale !== undefined) {
    // Ancien écran (onglets par langue) : chaque langue saisie est manuelle.
    const map = normalizeSignatureMap(signature_by_locale) || {};
    patch.email_signature_by_locale = buildSignatureMap(map, {
      auto: true,
      src: null,
      from: null,
      manual: Object.keys(map),
    });
  }

  let { error } = await supabaseAdmin.from('users').update(patch).eq('id', user_id);
  // Colonne pas encore créée : on enregistre au moins la signature par défaut
  // plutôt que de renvoyer une erreur au commercial, et on le dit.
  if (error && (error as any).code === '42703') {
    const retry = await supabaseAdmin
      .from('users')
      .update({ email_signature: cleanSignature || null })
      .eq('id', user_id);
    if (retry.error) {
      return serverError(retry.error, '/api/signature');
    }
    return NextResponse.json({ success: true, locale_signatures_saved: false });
  }

  if (error) {
    return serverError(error, '/api/signature');
  }

  // Traduction dans la foulée, pour que l'écran montre tout de suite ce qui
  // partira dans chaque langue. Plafonnée à 15 s : au-delà, la traduction
  // se fera au premier envoi concerné, sans rien bloquer.
  const refreshed = await Promise.race([
    refreshSignatureTranslations(user_id, authedUser.locale),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
  ]);
  const { data: after } = await supabaseAdmin
    .from('users')
    .select('email_signature, email_signature_by_locale')
    .eq('id', user_id)
    .maybeSingle();
  const state = refreshed || signatureStateOf((after as any)?.email_signature, (after as any)?.email_signature_by_locale, authedUser.locale);

  return NextResponse.json({
    success: true,
    locale_signatures_saved: true,
    signature: cleanSignature || null,
    ...describeSignature(state),
  });
}

export async function POST(request: NextRequest) {
  const { user_id } = await readJsonBody(request);

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: connection } = await supabaseAdmin
    .from('oauth_connections')
    .select('provider')
    .eq('user_id', user_id)
    .eq('provider', 'google')
    .maybeSingle();

  if (!connection) {
    return NextResponse.json(
      { error: "Détection automatique disponible uniquement pour Gmail — connectez votre compte Google, ou saisissez votre signature manuellement." },
      { status: 400 }
    );
  }

  try {
    const bodyText = await getLastSentGmailBodyText(user_id);
    const guess = guessEmailSignature(bodyText);

    if (!guess) {
      return NextResponse.json(
        { error: "Aucune signature détectée dans votre dernier email envoyé — saisissez-la manuellement ci-dessous.", signature: null },
        { status: 200 }
      );
    }

    return NextResponse.json({ signature: guess });
  } catch (err: any) {
    return serverError(err, '/api/signature');
  }
}
