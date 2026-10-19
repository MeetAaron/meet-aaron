// scripts/casa/next15-codemod.mjs
// Passage Next.js 14 → 15 (CASA 6.1.1, 19/10/2026) : Next 14 n'est plus
// maintenu et porte des vulnérabilités critiques sans correctif (avis
// Vercel des 14/10/2026 : seules les lignes 15.5 et 16.4 sont corrigées).
//
// Ce script applique mécaniquement les deux changements de l'API Next 15 :
//   1. routes API : `params` devient une Promise. On réécrit chaque
//      signature `{ params }: { params: { id: string } }` en
//      `ctx: { params: Promise<{ id: string }> }` et on insère
//      `const params = await ctx.params;` en tête de fonction ;
//   2. package.json : next ^15.5.28, react/react-dom ^19, types React 19.
// Il est lancé par .github/workflows/next15-upgrade.yml sur une machine
// GitHub, qui construit l'application avant de pousser quoi que ce soit.
// Idempotent : relancé sur un dépôt déjà migré, il ne change rien.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

let changedRoutes = 0;
const SIG = /export async function (GET|POST|PUT|PATCH|DELETE)\(([^,]+),\s*\{ params \}: \{ params: (\{[^}]*\}) \}\)\s*\{\n/g;
for (const file of walk('app')) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('{ params }: { params:')) continue;
  const next = src.replace(SIG, (m, method, req, shape) =>
    `export async function ${method}(${req}, ctx: { params: Promise<${shape}> }) {\n  const params = await ctx.params;\n`
  );
  if (next !== src) {
    writeFileSync(file, next);
    changedRoutes += 1;
  }
}
console.log(`routes réécrites : ${changedRoutes}`);

// Page cliente qui lit `params` en prop : React.use() sur la Promise.
const bilan = 'app/app/agenda/rdv/[id]/bilan/page.jsx';
try {
  let s = readFileSync(bilan, 'utf8');
  if (s.includes('export default function BilanRdvPage({ params }) {') && !s.includes('use(params)')) {
    s = s.replace('export default function BilanRdvPage({ params }) {', 'export default function BilanRdvPage(props) {\n  const params = use(props.params);');
    if (!/import \{[^}]*\buse\b[^}]*\} from 'react'/.test(s)) {
      s = s.replace(/import \{([^}]*)\} from 'react';/, (m, names) => `import {${names.trimEnd()}, use } from 'react';`);
    }
    writeFileSync(bilan, s);
    console.log('page bilan : params via use()');
  }
} catch (e) {
  console.log('page bilan : ignorée (' + e.message + ')');
}

// package.json
const pkgPath = 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const want = {
  dependencies: { next: '^15.5.28', react: '^19.2.0', 'react-dom': '^19.2.0', 'lucide-react': '^0.541.0' },
  devDependencies: { '@types/react': '^19.2.0', '@types/react-dom': '^19.2.0' },
};
let pkgChanged = false;
for (const [section, entries] of Object.entries(want)) {
  for (const [name, version] of Object.entries(entries)) {
    if (pkg[section][name] !== version) { pkg[section][name] = version; pkgChanged = true; }
  }
}
if (pkgChanged) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
  console.log('package.json : next 15 / react 19');
}
