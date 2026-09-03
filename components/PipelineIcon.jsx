'use client';

// components/PipelineIcon.jsx
//
// Les trois symboles du pipeline, dessinés en SVG (demande Alex validée le
// 04/09/2026, variante B) :
//   🎯 cible          -> prospect     (En cours, En bonne voie)
//   🤝 poignée de main -> opportunité  (RDV obtenu, Proposition demandée, En négociation)
//   ⭐ étoile          -> client
//
// Pourquoi du SVG et pas les emojis, alors que le reste de l'app utilise
// CATEGORY_ICONS (lib/pipeline.ts) : un emoji porte ses propres couleurs et
// ne peut être ni évidé ni recoloré. Or la règle demandée est précisément
// « contour seul quand personne n'est à l'étape, symbole plein dès qu'il y en
// a un » — impossible avec 🎯🤝⭐, qui resteraient identiques dans les deux
// états. Les emojis restent utilisés ailleurs (en-têtes, exports), où il n'y
// a pas de changement d'état à représenter.
//
// Le composant est PUR (aucun import serveur) : utilisable dans n'importe
// quel composant client.

const PATHS = {
  // Cible : trois cercles concentriques — lisible jusqu'à 12 px.
  prospect: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  // Poignée de main (choix d'Alex, 04/09/2026, préférée aux anneaux liés).
  opportunite: (
    <>
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
      <path d="m21 3 1 11h-2" />
      <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
      <path d="M3 4h8" />
    </>
  ),
  client: <path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.66l5.9-.86z" />,
};

// `filled` ne remplit que l'étoile (une cible pleine devient un disque
// illisible, une poignée de main pleine devient une tache) : pour les deux
// autres, l'état « atteint » se lit à la couleur du trait et au fond de la
// pastille qui les entoure.
export default function PipelineIcon({ category, size = 20, filled = false, strokeWidth = 1.9 }) {
  const path = PATHS[category] || PATHS.prospect;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled && category === 'client' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}
