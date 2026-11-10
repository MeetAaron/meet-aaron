// components/AaronText.jsx
// Rendu léger des réponses d'Aaron dans le chat (10/11/2026, capture démo).
//
// Le modèle écrit spontanément un peu de Markdown : **gras**, titres « ### »,
// listes « - » ou « 1. ». La bulle affichait tout en texte brut, donc des
// astérisques partout (« **Profil détecté : Consciencieux** »). Plutôt
// qu'une bibliothèque Markdown complète (tableaux, HTML, liens cliquables
// non maîtrisés), on ne traite que ces trois formes, sans jamais injecter de
// HTML : tout passe par des éléments React.
//
// Le texte garde son white-space: pre-wrap (voir .bubble) : on travaille
// ligne par ligne et on remet les retours à la ligne tels quels.

function inline(text, keyBase) {
  const parts = String(text).split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4
      ? <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>
      : p
  );
}

export default function AaronText({ text }) {
  if (!text || typeof text !== 'string') return text || null;
  const lines = text.split('\n');
  const out = [];
  lines.forEach((raw, i) => {
    let line = raw;
    // Titres Markdown : on retire les dièses et on met en gras.
    const h = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (h) line = `**${h[1].replace(/\*\*/g, '')}**`;
    // Puces « - » / « * » / « • » : un vrai point médian, aligné.
    const li = line.match(/^(\s*)[-*•]\s+(.*)$/);
    if (li) line = `${li[1]}• ${li[2]}`;
    out.push(...inline(line, i));
    if (i < lines.length - 1) out.push('\n');
  });
  return out;
}
