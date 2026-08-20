// components/charts/MiniBarChart.jsx
// Petits graphiques en barres, sans dépendance externe (tâche #129 piste 3 :
// vraie dataviz sur Dashboard/Résultats). Aucune librairie de charting
// (recharts, chart.js, d3...) n'est installée dans ce projet et l'accès au
// registre npm n'est pas disponible dans cet environnement pour en tester
// l'installation avant de pousser sur `main` — ces deux composants sont donc
// de simples div/CSS (pas de SVG), sur le même principe que le reste de
// l'app (aucune page n'utilise déjà de SVG pour ses graphiques).
//
// MiniBarChart : barres verticales pour une série chronologique courte
// (ex. bilan jour/semaine/mois). HorizontalBarChart : barres horizontales
// pour une répartition catégorielle (ex. statuts prospects, santé client).

'use client';

// data: [{ key, label, value }]. La dernière barre (la plus récente) est
// mise en avant (couleur pleine), les précédentes en plus clair — cohérent
// avec la lecture "de gauche à droite dans le temps" déjà utilisée par
// BilanRow juste à côté de ce graphique.
export function MiniBarChart({ data, height = 56, color = 'var(--accent)' }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="mini-bar-chart" style={{ height: `${height}px` }}>
      {data.map((d, i) => (
        <div
          key={d.key ?? i}
          className="mini-bar-wrap"
          title={`${d.label} : ${d.value}`}
        >
          <div
            className="mini-bar"
            style={{
              height: `${Math.max((d.value / max) * 100, d.value > 0 ? 6 : 2)}%`,
              background: color,
              opacity: i === data.length - 1 ? 1 : 0.45,
            }}
          />
        </div>
      ))}
      <style jsx>{`
        .mini-bar-chart {
          display: flex;
          align-items: flex-end;
          gap: 3px;
        }
        .mini-bar-wrap {
          flex: 1 1 0;
          height: 100%;
          display: flex;
          align-items: flex-end;
          min-width: 3px;
        }
        .mini-bar {
          width: 100%;
          border-radius: 2px 2px 0 0;
          transition: height 0.3s ease;
        }
      `}</style>
    </div>
  );
}

// data: [{ key, label, value, color? }]
export function HorizontalBarChart({ data, barColor = 'var(--accent)' }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="hbar-chart">
      {data.map((d, i) => (
        <div className="hbar-row" key={d.key ?? i}>
          <span className="hbar-label">{d.label}</span>
          <div className="hbar-track">
            <div
              className="hbar-fill"
              style={{
                width: `${Math.max((d.value / max) * 100, d.value > 0 ? 4 : 0)}%`,
                background: d.color || barColor,
              }}
            />
          </div>
          <span className="hbar-value">{d.value}</span>
        </div>
      ))}
      <style jsx>{`
        .hbar-chart {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .hbar-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .hbar-label {
          flex: 0 0 auto;
          min-width: 88px;
          font-size: 0.72rem;
          color: var(--muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .hbar-track {
          flex: 1 1 auto;
          height: 8px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 999px;
          overflow: hidden;
        }
        .hbar-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 0.3s ease;
        }
        .hbar-value {
          flex: 0 0 auto;
          font-family: var(--font-mono);
          font-size: 0.78rem;
          font-weight: 600;
          min-width: 20px;
          text-align: right;
        }
      `}</style>
    </div>
  );
}
