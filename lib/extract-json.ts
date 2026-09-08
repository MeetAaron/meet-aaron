// lib/extract-json.ts
//
// Extraction tolérante d'un objet JSON dans la réponse texte d'un modèle.
//
// Bug remonté par Alex (08/09/2026, compte TeamSystem) : « Aaron n'a pas pu
// envoyer le premier email », avec en base l'erreur « Réponse Aaron mal formée
// (JSON invalide) ». Le parseur d'origine ne tolérait que des balises ```json
// autour de l'objet. Or un modèle, même bien instruit, glisse parfois une
// phrase avant (« Voici la réponse : »), un commentaire après, ou est coupé
// par max_tokens. Un email non envoyé pour une virgule, alors que l'objet
// JSON est là, lisible, au milieu du texte — c'est le parseur qui était
// fragile, pas la réponse.
//
// Stratégie, du plus strict au plus tolérant :
//   1. le texte entier, balises retirées ;
//   2. la plus grande tranche { … } équilibrée (accolades comptées hors
//      chaînes) — couvre le texte avant/après ;
//   3. si la réponse a été coupée : on referme les chaînes/objets/tableaux
//      ouverts et on retente — récupère un JSON tronqué juste après le
//      dernier champ complet (les champs manquants valent undefined, les
//      appelants savent déjà gérer un champ absent).
// Si rien ne marche, on lève — l'appelant garde son message d'erreur.

export function extractJsonObject<T = any>(text: string): T {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // on continue
  }

  const slice = balancedObjectSlice(cleaned);
  if (slice) {
    try {
      return JSON.parse(slice) as T;
    } catch {
      // on continue
    }
    const repaired = closeTruncatedJson(slice);
    if (repaired) {
      try {
        return JSON.parse(repaired) as T;
      } catch {
        // on continue
      }
    }
  }
  throw new Error('JSON introuvable dans la réponse');
}

// Plus grande tranche commençant au premier '{' — jusqu'à l'accolade qui le
// ferme si elle existe, sinon jusqu'à la fin (réponse coupée).
function balancedObjectSlice(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

// Referme ce qui est resté ouvert dans un JSON coupé net : on ferme une
// chaîne ouverte, on retire ce qui pend en fin de texte (virgule, clé sans
// valeur, deux-points), puis on ferme les conteneurs dans l'ordre inverse.
// Une VALEUR coupée (« "body": "Bonjour, voici un te ») est gardée telle
// quelle : mieux vaut un email tronqué relu par le commercial qu'aucun objet.
function closeTruncatedJson(text: string): string | null {
  let s = text;
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) s += '"';

  const STRING_AT_END = /"(?:[^"\\]|\\.)*"\s*$/;
  // Boucle de nettoyage de la fin : chaque tour retire un élément pendant.
  for (let guard = 0; guard < 10; guard++) {
    s = s.replace(/\s+$/, '');
    if (s.endsWith(',')) {
      s = s.slice(0, -1);
      continue;
    }
    if (s.endsWith(':')) {
      // Clé sans valeur : on retire les deux-points ET la clé.
      s = s.slice(0, -1).replace(/\s+$/, '').replace(STRING_AT_END, '');
      continue;
    }
    const m = s.match(STRING_AT_END);
    if (m) {
      const before = s.slice(0, s.length - m[0].length).replace(/\s+$/, '');
      // Chaîne précédée de « { » ou « , » = une clé sans valeur → on la retire.
      // Précédée de « : » ou « [ » = une valeur, on la garde.
      if (before.endsWith('{') || before.endsWith(',')) {
        s = before;
        continue;
      }
    }
    break;
  }
  while (stack.length) s += stack.pop();
  return s;
}
