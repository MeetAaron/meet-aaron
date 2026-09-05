'use client';

// components/ConfidenceRing.jsx
//
// Le score de confiance d'Aaron (Alex, 04/09/2026 : « dans l'aperçu du
// contact ainsi que la fiche contact, il manque le score de confiance — le
// % où Aaron pense que ça va passer à la prochaine étape »).
//
// Un anneau et un pourcentage, dans la couleur de la conviction : rouge
// sous 40, ambre jusqu'à 69, vert au-delà. Même dessin dans la liste (petit)
// et sur la fiche (grand), pour qu'on le reconnaisse d'un écran à l'autre.
// Composant PUR.

export default function ConfidenceRing({ score, size = 34, label, title }) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return null;
  const v = Math.max(0, Math.min(100, Math.round(Number(score))));
  const color = v >= 70 ? '#1fae70' : v >= 40 ? '#f5a623' : '#ef4459';
  const stroke = Math.max(3, Math.round(size / 9));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="conf" title={title} aria-label={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={Math.round(size * 0.3)} fill="var(--text)">
          {v}
        </text>
      </svg>
      {label && <span className="conf-lbl">{label}</span>}
      <style jsx>{`
        .conf {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          flex-shrink: 0;
        }
        .conf-lbl {
          font-size: 0.72rem;
          color: var(--muted);
          line-height: 1.2;
          max-width: 9em;
        }
      `}</style>
    </span>
  );
}
