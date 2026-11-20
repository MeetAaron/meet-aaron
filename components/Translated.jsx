// components/Translated.jsx
// Affiche un texte écrit par Aaron ou par un prospect DANS LA LANGUE DE
// L'INTERFACE, avec un lien « Afficher l'original » (demande Alex,
// 07/11/2026). Le texte stocké n'est jamais modifié : la traduction est
// demandée à /api/translate (lib/translate.ts) et mémorisée ici pour la
// session, puis côté serveur pour la société.
//
// Usage :
//   <Translated text={prospect.aaron_advice} locale={locale} />
//   <Translated as="p" className="msg-body" text={m.body} locale={locale} format={frenchTypography} />
//
// Tant que la traduction n'est pas arrivée, ou si elle échoue (plafond
// atteint, réseau), on affiche l'original — exactement le comportement
// d'avant ce composant. Un texte déjà dans la bonne langue ne montre aucun
// lien.
//
// Les demandes d'une même page sont regroupées (50 ms) en un seul appel de
// 40 textes au plus : une fiche avec un avis, un conseil et douze messages ne
// coûte qu'une requête.

'use client';

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';

const PREF_KEY = 'meetaaron_auto_translate';
const MAX_PER_CALL = 40;

// Préférence locale (défaut : activé). Désactivable depuis Mon compte.
export function autoTranslateEnabled() {
  try {
    return window.localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setAutoTranslateEnabled(on) {
  try {
    window.localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* sans stockage : la préférence vaut pour la page courante */
  }
  window.dispatchEvent(new CustomEvent('aaron-auto-translate-change', { detail: !!on }));
}

// ---- File d'attente partagée -------------------------------------------
const cache = new Map(); // `${target}|${text}` -> { source_locale, text|null }
const waiters = new Map(); // key -> [resolve]
let queue = []; // { key, text, target }
let timer = null;

function flush() {
  timer = null;
  const batch = queue;
  queue = [];
  const byTarget = new Map();
  for (const q of batch) {
    if (!byTarget.has(q.target)) byTarget.set(q.target, []);
    byTarget.get(q.target).push(q);
  }
  for (const [target, list] of byTarget) {
    for (let i = 0; i < list.length; i += MAX_PER_CALL) {
      const chunk = list.slice(i, i + MAX_PER_CALL);
      sendChunk(target, chunk);
    }
  }
}

async function sendChunk(target, chunk) {
  const settle = (key, value) => {
    cache.set(key, value);
    const ws = waiters.get(key) || [];
    waiters.delete(key);
    ws.forEach((r) => r(value));
  };
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, items: chunk.map((c, i) => ({ id: String(i), text: c.text })) }),
    });
    const body = res.ok ? await res.json() : { translations: [] };
    const byId = new Map((body.translations || []).map((tr) => [tr.id, tr]));
    chunk.forEach((c, i) => {
      const tr = byId.get(String(i));
      settle(c.key, tr ? { source_locale: tr.source_locale, text: tr.text } : null);
    });
  } catch {
    chunk.forEach((c) => settle(c.key, null));
  }
}

export function requestTranslation(text, target) {
  const key = `${target}|${text}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return new Promise((resolve) => {
    if (!waiters.has(key)) {
      waiters.set(key, []);
      queue.push({ key, text, target });
    }
    waiters.get(key).push(resolve);
    if (!timer) timer = setTimeout(flush, 50);
  });
}

// Hook : traduction d'un texte (null si rien à traduire ou pas encore reçue).
export function useTranslation(text, locale) {
  const [tr, setTr] = useState(null);
  useEffect(() => {
    let alive = true;
    const run = () => {
      if (!text || typeof text !== 'string' || !locale || !autoTranslateEnabled() || text.trim().length < 2) {
        setTr(null);
        return;
      }
      requestTranslation(text, locale).then((r) => {
        if (alive) setTr(r && r.text ? r : null);
      });
    };
    run();
    const onPref = () => run();
    window.addEventListener('aaron-auto-translate-change', onPref);
    return () => {
      alive = false;
      window.removeEventListener('aaron-auto-translate-change', onPref);
    };
  }, [text, locale]);
  return tr;
}

// ---- Texte long (fiche entreprise) --------------------------------------
//
// 20/11/2026 (retour d'Alex, compte James en anglais : la fiche entreprise
// s'affichait en français). La fiche est écrite une fois, dans la langue de
// celui qui l'a rédigée, et partagée par toute la société : un commercial
// dont l'interface est dans une autre langue doit pouvoir la LIRE dans la
// sienne. Le texte dépasse le plafond d'un seul envoi (lib/translate.ts,
// 6 000 caractères) : on le découpe par rubrique (« ## … »), puis par
// paragraphes si une rubrique est trop longue. Chaque morceau est mis en
// mémoire séparément, donc corriger une rubrique ne retraduit qu'elle.
export function splitLongText(text, max = 5000) {
  const out = [];
  for (const section of String(text || '').split(/\n(?=## )/)) {
    const clean = section.trim();
    if (!clean) continue;
    if (clean.length <= max) {
      out.push(clean);
      continue;
    }
    let current = '';
    for (const paragraph of clean.split(/\n{2,}/)) {
      const piece = paragraph.trim();
      if (!piece) continue;
      if (current && current.length + piece.length + 2 > max) {
        out.push(current);
        current = '';
      }
      current = current ? `${current}\n\n${piece}` : piece.slice(0, max);
    }
    if (current) out.push(current);
  }
  return out;
}

// Renvoie le texte traduit en entier, ou null : rien à traduire, traduction
// pas encore arrivée, ou texte déjà dans la bonne langue. Jamais un mélange à
// moitié traduit pendant le chargement.
export function useLongTranslation(text, locale) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let alive = true;
    const run = () => {
      setResult(null);
      if (!text || typeof text !== 'string' || !locale || !autoTranslateEnabled()) return;
      const parts = splitLongText(text);
      if (parts.length === 0) return;
      Promise.all(parts.map((part) => requestTranslation(part, locale))).then((answers) => {
        if (!alive) return;
        if (!answers.some((a) => a && a.text)) return;
        setResult(parts.map((part, i) => (answers[i] && answers[i].text ? answers[i].text.trim() : part)).join('\n\n'));
      });
    };
    run();
    const onPref = () => run();
    window.addEventListener('aaron-auto-translate-change', onPref);
    return () => {
      alive = false;
      window.removeEventListener('aaron-auto-translate-change', onPref);
    };
  }, [text, locale]);
  return result;
}

export default function Translated({ text, locale, as: Tag = 'span', className, style, format, children, toggleClassName }) {
  const tr = useTranslation(text, locale);
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => {
    setShowOriginal(false);
  }, [text, locale]);

  if (!text) return null;
  const fmt = typeof format === 'function' ? format : (x) => x;
  const shown = tr && !showOriginal ? tr.text : text;
  return (
    <>
      <Tag className={className} style={style}>
        {children}
        {fmt(shown)}
      </Tag>
      {tr && (
        <button
          type="button"
          className={`tr-toggle${toggleClassName ? ` ${toggleClassName}` : ''}`}
          onClick={() => setShowOriginal((v) => !v)}
        >
          {showOriginal ? t('translate.showTranslation', locale) : t('translate.showOriginal', locale)}
        </button>
      )}
    </>
  );
}
