// lib/text-typography.js
// Demande Alex (29/08/2026, capture à l'appui) : dans les textes générés par
// Aaron (chat, avis, résumés, briefs...), le ":" (ou ";"/"!"/"?") se
// retrouvait parfois seul en début de ligne quand le navigateur coupait la
// ligne juste avant lui — "veuve" disgracieuse, pas pro. Cause : Aaron écrit
// naturellement un espace normal avant ces doubles ponctuations (convention
// typographique française), et un espace normal est un point de coupure de
// ligne valide pour le navigateur comme n'importe quel autre.
//
// Correctif : remplacer cet espace par une espace insécable (U+00A0) juste
// avant : ; ! ? — le navigateur ne coupera plus jamais la ligne à cet
// endroit précis. Ne touche QUE les espaces déjà présents avant la
// ponctuation (jamais inséré s'il n'y en avait pas), donc sans effet sur les
// URLs ("https://...") ou les heures ("14:30"), qui n'ont pas d'espace avant
// le ":" pour commencer. Écrit en échappement unicode ( ) plutôt qu'en
// caractère brut dans le code source, pour rester visible/lisible dans un
// diff GitHub (un caractère insécable brut est invisible à l'œil).
export function frenchTypography(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/ +([:;!?])/g, ' $1');
}
