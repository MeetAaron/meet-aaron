// components/TypoFix.jsx
//
// PAS DE SIGNE DE PONCTUATION SEUL EN DÉBUT DE LIGNE (19/11/2026).
//
// Remarque d'Alex, capture de l'écran de bienvenue à l'appui : « évite
// veuves et orphelins. Regarde le ":" » — la carte « Tu valides » finissait
// sa première ligne sur « importante » et commençait la suivante par « : ».
//
// En français, les deux-points, le point-virgule, le point d'interrogation,
// le point d'exclamation et les guillemets sont précédés d'une espace. Si
// c'est une espace ordinaire, le navigateur a le droit de couper la ligne à
// cet endroit. La règle typographique est d'y mettre une espace INSÉCABLE.
//
// Les textes de l'application vivent dans lib/i18n.js et dans une vingtaine
// de dictionnaires locaux, plus tout ce qu'Aaron rédige lui-même (résumés,
// conseils, brouillons). Corriger les sources une à une laisserait passer le
// prochain texte écrit. On corrige donc à l'affichage, une fois pour toutes :
// ce composant remplace l'espace ordinaire par une insécable dans les textes
// affichés, et suit les textes qui arrivent ensuite.
//
// Ce qu'il ne touche jamais : les champs de saisie et les zones éditables
// (on ne modifie pas ce que la personne tape), le code, les scripts.
//
// Les veuves (un mot seul sur la dernière ligne) sont traitées en CSS :
// « text-wrap: pretty » posé sur body dans app/globals.css.

'use client';

import { useEffect } from 'react';

const NBSP = ' ';
const BEFORE = / ([:;?!»])/g;
const AFTER = /« /g;
const NEEDS_FIX = / [:;?!»]|« /;
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'NOSCRIPT']);

function skipped(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName) || el.isContentEditable) return true;
  }
  return false;
}

function fixTextNode(node) {
  const value = node.nodeValue;
  if (!value || !NEEDS_FIX.test(value) || skipped(node)) return;
  const fixed = value.replace(BEFORE, `${NBSP}$1`).replace(AFTER, `«${NBSP}`);
  if (fixed !== value) node.nodeValue = fixed;
}

function fixTree(root) {
  if (!root) return;
  if (root.nodeType === 3) {
    fixTextNode(root);
    return;
  }
  if (root.nodeType !== 1) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    fixTextNode(node);
    node = walker.nextNode();
  }
}

export default function TypoFix() {
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || !document.body) return undefined;
    fixTree(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          fixTextNode(mutation.target);
        } else {
          mutation.addedNodes.forEach(fixTree);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
