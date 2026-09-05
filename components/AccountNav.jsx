'use client';

// components/AccountNav.jsx
//
// Navigation de « Mon compte » en LISTE VERTICALE (maquette validée par Alex
// le 04/09/2026).
//
// Ce qu'il y avait avant : 7 onglets horizontaux — « Mon profil » à
// « Supprimer mon compte » — qui ne tenaient sur aucune largeur de téléphone.
// On avait mis un défilement horizontal en rustine : les 3 derniers onglets
// étaient invisibles tant qu'on ne devinait pas qu'il fallait faire glisser.
// Sur un réglage qu'on cherche une fois tous les six mois, c'est perdu.
//
// Ce qu'on fait maintenant : la liste que tout le monde connaît (Instagram,
// iOS, Android) — trois groupes, une ligne par rubrique, chaque ligne portant
// déjà son état (« Gmail connecté », « À compléter », « Aucun CRM »). On sait
// où aller sans ouvrir quoi que ce soit.
//
// Sur grand écran, la liste devient la colonne de gauche et le panneau
// s'affiche à droite : c'est la même liste, pas une seconde mise en page à
// maintenir.
//
// Composant PUR (aucun import serveur) : utilisable dans un composant client.

import { t } from '@/lib/i18n';

// Icônes dessinées ici plutôt qu'importées : elles ne servent qu'à cette
// liste, et un fichier d'icônes de plus pour 7 tracés ne se justifie pas.
const ICONS = {
  profile: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  company: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />
    </>
  ),
  connection: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  crm: (
    <>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <path d="m16 8-4 4-2-2" />
    </>
  ),
  preferences: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  subscription: <path d="M13 2 3 14h9l-1 8 10-12h-9z" />,
  delete: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  // Mes résultats v2 (05/09/2026) — même liste, autres rubriques.
  overview: (
    <>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </>
  ),
  progress: (
    <>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="M7 12h3M14 12h3" />
    </>
  ),
  'report-day': (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  'report-week': (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M17 14h-6M13 18H7" />
    </>
  ),
  'report-month': (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
    </>
  ),
  steps: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />,
  clients: <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
  compare: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" />
      <path d="M8 12h8" />
    </>
  ),
};

function Row({ item, active, onSelect, locale }) {
  return (
    <button
      type="button"
      className={`nav-row${active ? ' active' : ''}${item.tone === 'danger' ? ' danger' : ''}`}
      onClick={() => onSelect(item.key)}
      aria-current={active ? 'true' : undefined}
    >
      <span className={`nav-icon tone-${item.tone || 'brand'}`}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {ICONS[item.key]}
        </svg>
      </span>

      <span className="nav-text">
        <span className="nav-title">{item.title}</span>
        {item.description && <span className="nav-desc">{item.description}</span>}
      </span>

      {item.status && <span className={`nav-status st-${item.status.tone}`}>{item.status.label}</span>}

      <svg
        className="nav-chevron"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>

      <style jsx>{`
        .nav-row {
          display: flex;
          align-items: center;
          gap: 0.9rem;
          width: 100%;
          padding: 0.85rem 1rem;
          background: transparent;
          border: 0;
          border-bottom: 1px solid var(--border);
          text-align: left;
          cursor: pointer;
          color: var(--text);
          /* 44 px : la hauteur minimale d'une cible tactile confortable. */
          min-height: 44px;
          transition: background var(--fast);
        }
        .nav-row:last-child {
          border-bottom: 0;
        }
        .nav-row:hover,
        .nav-row:focus-visible {
          background: var(--tint-4);
        }
        .nav-row.active {
          background: var(--tint-8);
        }
        .nav-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .tone-brand {
          background: rgba(75, 57, 239, 0.14);
          color: var(--accent);
        }
        .tone-neutral {
          background: var(--tint-7);
          color: var(--muted);
        }
        .tone-warn {
          background: rgba(245, 166, 35, 0.14);
          color: var(--accent-amber);
        }
        .tone-danger {
          background: rgba(239, 68, 89, 0.12);
          color: var(--accent-red);
        }
        .nav-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex-grow: 1;
          min-width: 0;
        }
        .nav-title {
          font-size: 0.95rem;
          font-weight: 600;
        }
        .nav-row.danger .nav-title {
          color: var(--accent-red);
        }
        .nav-desc {
          font-size: 0.76rem;
          color: var(--muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .nav-status {
          font-size: 0.7rem;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 999px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .st-ok {
          background: rgba(61, 214, 140, 0.14);
          color: var(--accent-green);
        }
        .st-todo {
          background: rgba(245, 166, 35, 0.14);
          color: var(--accent-amber);
        }
        .st-off {
          background: var(--tint-7);
          color: var(--muted);
        }
        .nav-chevron {
          color: var(--muted);
          opacity: 0.65;
          flex-shrink: 0;
        }
        /* Sur grand écran la liste est la colonne de gauche : le chevron y
           promet un écran suivant qui n'existe pas — le panneau est déjà à
           droite. On le retire plutôt que de mentir sur la navigation. */
        @media (min-width: 960px) {
          .nav-chevron {
            display: none;
          }
          .nav-desc {
            display: none;
          }
          .nav-row {
            padding: 0.7rem 0.85rem;
            gap: 0.7rem;
          }
          .nav-icon {
            width: 32px;
            height: 32px;
          }
        }
      `}</style>
    </button>
  );
}

export default function AccountNav({ groups, activeTab, onSelect, locale }) {
  return (
    <nav className="account-nav" aria-label={t('connexions.navBack', locale)}>
      {groups.map((group) => (
        <section className="nav-group" key={group.label}>
          <h2 className="nav-group-label">{group.label}</h2>
          <div className="nav-card">
            {group.items.map((item) => (
              <Row key={item.key} item={item} active={activeTab === item.key} onSelect={onSelect} locale={locale} />
            ))}
          </div>
        </section>
      ))}

      <style jsx>{`
        .account-nav {
          display: flex;
          flex-direction: column;
          gap: 1.3rem;
        }
        .nav-group {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
        }
        .nav-group-label {
          margin: 0;
          padding-left: 2px;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .nav-card {
          display: flex;
          flex-direction: column;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
      `}</style>
    </nav>
  );
}
