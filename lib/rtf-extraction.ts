// lib/rtf-extraction.ts
// Extrait le texte brut d'un fichier .rtf — utilisé quand l'utilisateur
// renvoie une version modifiée de son "Profil de l'entreprise" après l'avoir
// édité dans Word/LibreOffice/Google Docs (le fichier exporté par
// lib/rtf-document.ts est un .rtf ; voir ce fichier pour le pourquoi de ce
// choix plutôt qu'un vrai .docx). Implémentation pure JS, sans dépendance —
// le RTF est un format texte structuré par groupes {...} et mots de
// contrôle \xxx, largement plus simple à parser correctement qu'un .docx.
//
// Testé manuellement en aller-retour complet : génération -> ouverture et
// réenregistrement via LibreOffice (simulateur d'édition utilisateur) ->
// relecture ici, avec accents français, guillemets « », tirets cadratins —
// et contre les métadonnées bruyantes que LibreOffice ajoute à la
// réexportation (\*\generator, \*\userprops, etc., correctement ignorées).

// Table cp1252 pour les octets 0x80-0x9F (Windows-1252 ne diffère de Latin-1
// que sur cette plage — guillemets courbes, tiret cadratin, etc., que Word
// insère couramment via la correction automatique et encode en \'XX).
const CP1252_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ',
};
function decodeAnsiByte(code: number): string {
  if (code >= 0x80 && code <= 0x9f) return CP1252_HIGH[code] || '?';
  return Buffer.from([code]).toString('latin1');
}

// Destinations à ignorer entièrement (métadonnées, mise en forme) — en plus
// de la règle générale \* (voir plus bas), qui couvre déjà la plupart des
// destinations "ignorables" au sens strict de la spec RTF.
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'generator', 'pict', 'object',
  'header', 'footer', 'headerf', 'footerf', 'headerl', 'headerr', 'footerl', 'footerr',
  'xe', 'tc', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl',
]);

interface GroupState {
  skip: boolean;
  ucSkip: number;
}

export function extractTextFromRtf(rtfText: string): string {
  let i = 0;
  const n = rtfText.length;
  let out = '';
  const stack: GroupState[] = [{ skip: false, ucSkip: 1 }];
  const top = () => stack[stack.length - 1];

  while (i < n) {
    const ch = rtfText[i];

    if (ch === '{') {
      stack.push({ skip: top().skip, ucSkip: top().ucSkip });
      i++;
      continue;
    }
    if (ch === '}') {
      if (stack.length > 1) stack.pop();
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = rtfText[i + 1];

      // \* : symbole de contrôle marquant TOUJOURS une destination
      // ignorable au sens de la spec RTF (métadonnées diverses) — le mot de
      // contrôle réel (ex: \generator, \userprops) suit juste après.
      if (next === '*') {
        top().skip = true;
        i += 2;
        continue;
      }
      if (next === '\\' || next === '{' || next === '}') {
        if (!top().skip) out += next;
        i += 2;
        continue;
      }
      // \'XX : octet ansi hexadécimal (codepage 1252)
      if (next === "'") {
        const hex = rtfText.slice(i + 2, i + 4);
        i += 4;
        if (!top().skip) {
          const code = parseInt(hex, 16);
          if (!Number.isNaN(code)) out += decodeAnsiByte(code);
        }
        continue;
      }

      const m = /^\\([a-zA-Z]+)(-?\d+)?( )?/.exec(rtfText.slice(i));
      if (m) {
        const word = m[1];
        const param = m[2] !== undefined ? parseInt(m[2], 10) : null;
        i += m[0].length;

        if (SKIP_DESTINATIONS.has(word)) {
          top().skip = true;
          continue;
        }
        if (word === 'par' || word === 'line') {
          if (!top().skip) out += '\n';
          continue;
        }
        if (word === 'tab') {
          if (!top().skip) out += '\t';
          continue;
        }
        if (word === 'page' || word === 'sect') {
          if (!top().skip) out += '\n\n';
          continue;
        }
        if (word === 'uc') {
          top().ucSkip = param !== null ? param : 1;
          continue;
        }
        if (word === 'u') {
          if (param !== null) {
            const codepoint = param < 0 ? param + 65536 : param;
            if (!top().skip) out += String.fromCodePoint(codepoint);
            // Saute les caractères de repli qui suivent un \uNNNN (ex: le
            // "?" que notre propre générateur émet, ou un \'XX ansi de repli
            // comme LibreOffice en produit à la réexportation) — chacun
            // compte comme UNE unité de repli, qu'il s'agisse d'un caractère
            // brut ou d'un mot de contrôle complet (sinon ce repli est
            // ensuite réinterprété comme du texte normal et le caractère se
            // retrouve dupliqué dans la sortie).
            let toSkip = top().ucSkip;
            while (toSkip > 0 && i < n) {
              if (rtfText[i] === '{' || rtfText[i] === '}') break;
              if (rtfText[i] === '\\') {
                const fallbackHex = /^\\'[0-9a-fA-F]{2}/.exec(rtfText.slice(i));
                if (fallbackHex) {
                  i += fallbackHex[0].length;
                  toSkip--;
                  continue;
                }
                const fallbackWord = /^\\([a-zA-Z]+)(-?\d+)?( )?/.exec(rtfText.slice(i));
                if (fallbackWord) {
                  i += fallbackWord[0].length;
                  toSkip--;
                  continue;
                }
                if (rtfText[i + 1] === '\\' || rtfText[i + 1] === '{' || rtfText[i + 1] === '}') {
                  i += 2;
                  toSkip--;
                  continue;
                }
                break;
              }
              i++;
              toSkip--;
            }
          }
          continue;
        }
        // Tout autre mot de contrôle de mise en forme (\fs24, \cf1, \qc,
        // \margl1440, \b, \b0, \pard, ...) est ignoré sans produire de texte.
        continue;
      }
      i++;
      continue;
    }

    if (!top().skip) out += ch;
    i++;
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
