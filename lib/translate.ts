// lib/translate.ts
// Traduction à la demande des TEXTES ÉCRITS PAR AARON ou REÇUS DES PROSPECTS,
// dans la langue de l'interface du commercial (demande Alex, 07/11/2026 :
// « toutes les écritures dans la langue où on utilise le produit, sauf les
// emails envoyés ; l'avis d'Aaron etc., tout doit pouvoir être traduit »).
//
// Principe : on ne retraduit JAMAIS ce qui est stocké. L'avis d'Aaron, le
// conseil, le résumé, le message du prospect restent en base dans la langue
// où ils ont été écrits ; c'est l'AFFICHAGE qui demande une traduction à
// /api/translate, et l'interface propose « Afficher l'original ». Ainsi un
// Italien qui travaille en italien avec des prospects italiens ne paie rien
// (Haiku répond « même langue »), et un Français qui bascule son interface
// en anglais voit tout en anglais sans que rien ne soit réécrit.
//
// Coût : Haiku, ~0,0005 $ pour un avis de 300 caractères, et un cache en base
// (text_translations, clé = empreinte du texte + langue cible) fait qu'un
// même texte n'est traduit qu'une fois pour toute la société. Les appels sont
// comptés dans le plafond de la société comme tout le reste (callClaude).
//
// Si la migration migration_traductions_2026-11-07.sql n'est pas jouée, le
// cache est simplement ignoré (erreur 42P01 tolérée) : ça traduit quand
// même, juste sans mémoire.

import crypto from 'crypto';
import { supabaseAdmin } from './supabase-admin';
import { callClaude } from './anthropic-client';

export const TRANSLATE_LOCALES = ['fr', 'en', 'de', 'it', 'es', 'pt', 'nl'] as const;
export type TranslateLocale = (typeof TRANSLATE_LOCALES)[number];

const LANGUAGE_NAMES: Record<TranslateLocale, string> = {
  fr: 'French',
  en: 'English',
  de: 'German',
  it: 'Italian',
  es: 'Spanish',
  pt: 'Portuguese',
  nl: 'Dutch',
};

export type TranslateItem = { id: string; text: string };
export type TranslatedItem = {
  id: string;
  // Langue détectée du texte source (code à 2 lettres, ou 'xx' si inconnue).
  source_locale: string;
  // Texte traduit — null quand le texte est déjà dans la langue cible.
  text: string | null;
};

export const MAX_ITEMS_PER_CALL = 40;
export const MAX_CHARS_PER_ITEM = 6000;

const UNDEFINED_TABLE = '42P01';

export function textHash(text: string): string {
  return crypto.createHash('sha256').update(text.normalize('NFC')).digest('hex');
}

async function readCache(hashes: string[], target: TranslateLocale): Promise<Map<string, { source_locale: string; translated: string | null }>> {
  const out = new Map<string, { source_locale: string; translated: string | null }>();
  if (!hashes.length) return out;
  const { data, error } = await supabaseAdmin
    .from('text_translations')
    .select('source_hash, source_locale, translated')
    .eq('target_locale', target)
    .in('source_hash', hashes);
  if (error) {
    if (error.code !== UNDEFINED_TABLE) console.error('[translate] lecture cache:', error.message);
    return out;
  }
  for (const row of data || []) out.set(row.source_hash, { source_locale: row.source_locale, translated: row.translated });
  return out;
}

async function writeCache(rows: { source_hash: string; target_locale: string; source_locale: string; translated: string | null; company_id: string | null }[]) {
  if (!rows.length) return;
  const { error } = await supabaseAdmin.from('text_translations').upsert(rows, { onConflict: 'source_hash,target_locale', ignoreDuplicates: true });
  if (error && error.code !== UNDEFINED_TABLE) console.error('[translate] écriture cache:', error.message);
}

function extractJson(raw: string): any {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('réponse non JSON');
  }
}

// Traduit un lot de textes vers `target`. Ne lève pas pour un texte isolé :
// un texte non traduit revient avec text null et source_locale 'xx' — le
// client affiche alors l'original, ce qui est le comportement d'avant.
export async function translateBatch(
  items: TranslateItem[],
  target: TranslateLocale,
  companyId: string | null,
  userId: string | null
): Promise<TranslatedItem[]> {
  const results = new Map<string, TranslatedItem>();
  const clean = items
    .filter((it) => it && typeof it.id === 'string' && typeof it.text === 'string' && it.text.trim())
    .slice(0, MAX_ITEMS_PER_CALL)
    .map((it) => ({ id: it.id, text: it.text.slice(0, MAX_CHARS_PER_ITEM) }));

  // 1. Cache.
  const hashes = clean.map((it) => textHash(it.text));
  const cached = await readCache(Array.from(new Set(hashes)), target);
  const pending: { id: string; text: string; hash: string }[] = [];
  clean.forEach((it, i) => {
    const hit = cached.get(hashes[i]);
    if (hit) results.set(it.id, { id: it.id, source_locale: hit.source_locale, text: hit.translated });
    else pending.push({ id: it.id, text: it.text, hash: hashes[i] });
  });

  // 2. Haiku pour le reste, en un seul appel.
  if (pending.length) {
    // Dédoublonne les textes identiques (même conseil sur deux fiches…).
    const byHash = new Map<string, { text: string; ids: string[] }>();
    for (const p of pending) {
      const e = byHash.get(p.hash);
      if (e) e.ids.push(p.id);
      else byHash.set(p.hash, { text: p.text, ids: [p.id] });
    }
    const list = Array.from(byHash.entries()).map(([hash, v], i) => ({ n: i + 1, hash, text: v.text, ids: v.ids }));
    const payload = list.map((l) => ({ n: l.n, text: l.text }));

    const prompt =
      `You are a professional translator for a B2B sales application. Target language: ${LANGUAGE_NAMES[target]} (${target}).\n` +
      `For EACH item below: detect its language (ISO 639-1 code), then translate it into the target language.\n` +
      `Rules:\n` +
      `- If an item is ALREADY in the target language, return "text": null (do not rewrite it).\n` +
      `- Preserve meaning, tone, line breaks, names of people and companies, numbers, dates, URLs and email addresses exactly.\n` +
      `- Keep the same register (informal "tu" in French stays informal; business emails stay formal).\n` +
      `- Do not add, summarize or comment. Translate everything, including greetings and signatures.\n` +
      `- Return ONLY a JSON array, no markdown, of objects: {"n": number, "lang": "xx", "text": "translation or null"}.\n\n` +
      `Items:\n${JSON.stringify(payload)}`;

    try {
      const data = await callClaude(
        {
          model: 'claude-haiku-4-5',
          max_tokens: Math.min(16000, 400 + payload.reduce((s, p) => s + Math.ceil(p.text.length / 2.5), 0)),
          messages: [{ role: 'user', content: prompt }],
        },
        companyId,
        undefined,
        userId,
        'autre'
      );
      const raw = (data?.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('');
      const parsed = extractJson(raw);
      const byN = new Map<number, { lang: string; text: string | null }>();
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (r && typeof r.n === 'number') {
            byN.set(r.n, {
              lang: typeof r.lang === 'string' ? r.lang.slice(0, 2).toLowerCase() : 'xx',
              text: typeof r.text === 'string' && r.text.trim() ? r.text : null,
            });
          }
        }
      }
      const toCache: { source_hash: string; target_locale: string; source_locale: string; translated: string | null; company_id: string | null }[] = [];
      for (const l of list) {
        const r = byN.get(l.n);
        // Un texte renvoyé « identique » à l'original est traité comme déjà
        // dans la langue cible.
        const translated = r && r.text && r.text.trim() !== l.text.trim() ? r.text : null;
        // Un « null » n'est digne de confiance que si Haiku dit AUSSI que le
        // texte est déjà dans la langue cible. S'il détecte du français et
        // ne traduit pas quand même (réponse tronquée, numéro décalé, texte
        // sauté), c'est un raté : on affiche l'original cette fois-ci, sans
        // le graver dans le cache. Avant (10/11/2026), ce raté était mis en
        // cache comme « déjà en italien » et la fiche restait en français
        // pour toujours.
        const consistentNull = !translated && !!r && r.lang === target;
        const lang = translated ? r!.lang : consistentNull ? target : 'xx';
        for (const id of l.ids) results.set(id, { id, source_locale: lang, text: translated });
        if (translated || consistentNull) {
          toCache.push({ source_hash: l.hash, target_locale: target, source_locale: lang, translated, company_id: companyId });
        }
      }
      await writeCache(toCache);
    } catch (err: any) {
      console.error('[translate] échec Haiku:', err?.message || err);
      for (const p of pending) if (!results.has(p.id)) results.set(p.id, { id: p.id, source_locale: 'xx', text: null });
    }
  }

  return clean.map((it) => results.get(it.id) || { id: it.id, source_locale: 'xx', text: null });
}
