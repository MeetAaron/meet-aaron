// scripts/casa/deps-fix.mjs
// Correctif de dépendance (CASA 6.1.1, 22/10/2026).
//
// Le scan du 22/10 sur main (Next 15.5.28) : 0 critique, 6 « high ». Cinq
// d'entre eux (braces, chokidar, micromatch, fast-glob, tailwindcss) sont
// marqués "dev": true dans package-lock.json : ils ne servent qu'à la
// construction (Tailwind/PostCSS) et ne partent jamais en production.
//
// Le sixième, postcss, arrive en PRODUCTION par Next.js lui-même, qui
// embarque sa propre copie figée (node_modules/next/node_modules/postcss
// 8.4.31). Avis GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 (high),
// GHSA-qx2v-qp2m-jg93 et GHSA-fxqj-rqcc-2cmp (moderate) : vulnérable
// jusqu'à 8.5.22. npm ne propose que Next 16 (version majeure) comme
// correctif. On force plutôt la copie de Next sur postcss ^8.5.31, même
// version majeure, API identique : c'est le correctif minimal.
//
// Lancé par .github/workflows/deps-fix.yml, qui régénère le lockfile,
// CONSTRUIT l'application (type-check actif) et vérifie qu'il ne reste
// aucune vulnérabilité high/critique en production avant de pousser.
// Idempotent.

import { readFileSync, writeFileSync } from 'node:fs';

// 22/10/2026, run #1 : un override GLOBAL `postcss` est refusé par npm
// (EOVERRIDE : postcss est aussi une devDependency directe, ^8.4.39). On
// cible donc UNIQUEMENT la copie embarquée par Next.js : la devDependency
// directe se résout déjà en 8.5.31 (hors plage vulnérable).
const pkgPath = 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.overrides = pkg.overrides || {};
delete pkg.overrides.postcss;
const current = pkg.overrides.next;
if (!current || typeof current !== 'object' || current.postcss !== '^8.5.31') {
  pkg.overrides.next = { ...(typeof current === 'object' ? current : {}), postcss: '^8.5.31' };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
  console.log('package.json : overrides.next.postcss = ^8.5.31');
} else {
  console.log('package.json : override next > postcss déjà en place');
}
