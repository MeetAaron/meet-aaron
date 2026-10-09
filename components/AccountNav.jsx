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
  // Vue fondateur (09/10/2026) : marge par client + seuil GST. Visible du
  // seul compte editeur, voir l'item correspondant dans connexions/page.jsx.
  marge: (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="m19 9-5 5-4-4-3 3" />
    </>
  ),
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
        {/* Le statut vit DANS la colonne de texte, pas à côté (01/10/2026).
            Placé en frère de .nav-text, il était « flex-shrink: 0 » et
            participait donc à la largeur minimale de la ligne : sur
            téléphone, il poussait la carte au-delà de l'écran et se
            retrouvait lui-même hors champ. Ici il passe à la ligne quand il
            n'y a plus la place, et ne peut plus rien élargir. */}
        {/* Première ligne : le titre et la pastille se partagent la largeur.
            Deuxième ligne : la description, sur TOUTE la largeur.
            Les deux versions precedentes echouaient autrement — pastille
            seule sur sa ligne, ou pastille qui ecrasait la description a
            trois mots. Ici elles ne se disputent plus la meme place. */}
        <span className="nav-head">
          <span className="nav-title">{item.title}</span>
          {item.status && (
            // title : une pastille tres bavarde se tronque (voir le CSS), le
            // texte complet reste accessible au survol et a l'appui long.
            <span className={`nav-status st-${item.status.tone}`} title={item.status.label}>
              {item.status.label}
            </span>
          )}
        </span>
        {item.description && <span className="nav-desc">{item.description}</span>}
      </span>

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
          position: relative;
          display: grid;
          /* Trois colonnes : icône, contenu, chevron. La colonne du milieu
             est bornée par minmax(0, 1fr) — sans ce 0, une colonne de grille
             ne descend JAMAIS sous la largeur de son contenu, et c'est
             exactement ce qui faisait déborder la ligne hors de l'écran. */
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 0.85rem;
          width: 100%;
          min-width: 0;
          padding: 0.9rem 1rem;
          background: transparent;
          border: 0;
          text-align: left;
          cursor: pointer;
          color: var(--text);
          /* 56 px : une ligne de liste se vise au pouce, en marchant. */
          min-height: 56px;
          transition: background var(--fast);
          -webkit-tap-highlight-color: transparent;
        }
        /* Séparateur en pseudo-élément plutôt qu'en border : il s'arrête
           après l'icône, comme dans les listes iOS et Android, au lieu de
           couper la carte de bord à bord. */
        .nav-row::after {
          content: '';
          position: absolute;
          left: 4rem;
          right: 0;
          bottom: 0;
          height: 1px;
          background: var(--border);
          opacity: 0.7;
        }
        .nav-row:last-child::after {
          display: none;
        }
        .nav-row:hover,
        .nav-row:focus-visible {
          background: var(--tint-4);
        }
        .nav-row:active {
          background: var(--tint-8);
        }
        .nav-row.active {
          background: linear-gradient(90deg, rgba(75, 57, 239, 0.16), rgba(75, 57, 239, 0.04));
        }
        /* Filet d'accent à gauche de la ligne ouverte : on voit où on est
           sans avoir à comparer deux nuances de fond. */
        .nav-row.active::before {
          content: '';
          position: absolute;
          left: 0;
          top: 8px;
          bottom: 8px;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: var(--accent);
        }
        .nav-icon {
          width: 40px;
          height: 40px;
          /* Carré arrondi plutôt que cercle : même langage que les icônes
             d'application et les cartes du reste de l'interface. */
          border-radius: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .nav-row.active .nav-icon {
          transform: scale(1.04);
        }
        .tone-brand {
          background: linear-gradient(145deg, rgba(124, 110, 245, 0.22), rgba(75, 57, 239, 0.12));
          box-shadow: inset 0 0 0 1px rgba(124, 110, 245, 0.22);
          color: var(--accent-light);
        }
        .tone-neutral {
          background: var(--tint-7);
          box-shadow: inset 0 0 0 1px var(--border);
          color: var(--muted);
        }
        .tone-warn {
          background: linear-gradient(145deg, rgba(245, 166, 35, 0.22), rgba(245, 166, 35, 0.1));
          box-shadow: inset 0 0 0 1px rgba(245, 166, 35, 0.24);
          color: var(--accent-amber);
        }
        .tone-danger {
          background: linear-gradient(145deg, rgba(239, 68, 89, 0.2), rgba(239, 68, 89, 0.08));
          box-shadow: inset 0 0 0 1px rgba(239, 68, 89, 0.22);
          color: var(--accent-red);
        }
        .nav-text {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .nav-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.6rem;
          min-width: 0;
        }
        .nav-title {
          flex: 1 1 auto;
          font-size: 0.95rem;
          font-weight: 600;
          letter-spacing: -0.01em;
          line-height: 1.3;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .nav-row.danger .nav-title {
          color: var(--accent-red);
        }
        .nav-desc {
          font-size: 0.78rem;
          line-height: 1.4;
          color: var(--muted);
          min-width: 0;
          overflow-wrap: anywhere;
          /* Deux lignes puis des points de suspension. L'ancienne version
             coupait à UNE ligne sans retour : « Chaque rapport couvre à la
             fois tes prospects et tes c… » n'apprend rien. Deux lignes
             suffisent à lire la phrase entière dans presque tous les cas. */
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .nav-status {
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.01em;
          padding: 3px 9px;
          border-radius: 999px;
          /* Elle vit dans une colonne minmax(0, auto) : elle prend sa place
             naturelle quand il y en a, et se tronque proprement sinon —
             plutôt que de passer seule à la ligne sous le titre, ce qui
             cassait l'alignement de toute la rangée. */
          /* Plafonnee a la moitie de la ligne : une pastille bavarde se
             tronque plutot que d'etrangler le titre. 58 % laisse passer les
             pastilles courantes (« 12 contacts », « +2 clients ») et ne
             coupe que les plus longues. */
          /* 0 0 auto : la pastille garde sa taille naturelle tant qu'elle
             tient sous le plafond, et c'est le TITRE qui passe a la ligne.
             Avec 0 1 auto, c'etait l'inverse — « 12 contacts » se tronquait
             en « 12 cont... » alors que la place existait. */
          flex: 0 0 auto;
          min-width: 0;
          max-width: 58%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-top: 1px;
        }
        .st-ok {
          background: rgba(61, 214, 140, 0.15);
          color: var(--accent-green);
          box-shadow: inset 0 0 0 1px rgba(61, 214, 140, 0.22);
        }
        .st-todo {
          background: rgba(245, 166, 35, 0.15);
          color: var(--accent-amber);
          box-shadow: inset 0 0 0 1px rgba(245, 166, 35, 0.22);
        }
        /* Ce ton manquait purement et simplement (01/10/2026) : la page
           « Mes résultats » l'utilise pour les trois rapports, les pastilles
           s'affichaient donc sans fond ni couleur, comme du texte perdu. */
        .st-brand {
          background: rgba(124, 110, 245, 0.16);
          color: var(--accent-light);
          box-shadow: inset 0 0 0 1px rgba(124, 110, 245, 0.24);
        }
        .st-off {
          background: var(--tint-7);
          color: var(--muted);
          box-shadow: inset 0 0 0 1px var(--border);
        }
        .nav-chevron {
          color: var(--muted);
          opacity: 0.5;
          flex-shrink: 0;
          transition: transform var(--fast), opacity var(--fast);
        }
        .nav-row:hover .nav-chevron {
          opacity: 0.9;
          transform: translateX(2px);
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
            min-height: 48px;
          }
          .nav-icon {
            width: 32px;
            height: 32px;
            border-radius: 10px;
          }
          .nav-row::after {
            left: 3.4rem;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .nav-row,
          .nav-icon,
          .nav-chevron {
            transition: none;
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
          gap: 1.5rem;
          /* INDISPENSABLE (01/10/2026). .account-nav est un element de
             grille, et la largeur minimale d'un element de grille vaut
             auto : il ne descend donc JAMAIS sous la largeur de son
             contenu. Les descriptions etant en nowrap, la colonne s'elargit
             au-dela de l'ecran du telephone, et la carte — qui est en
             overflow:hidden — coupait net le texte, la pastille et le
             chevron. C'est la cause de la capture envoyee par Alex.
             .account-panel avait bien ce min-width, la liste l'avait
             oublie. */
          min-width: 0;
        }
        .nav-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          min-width: 0;
        }
        .nav-group-label {
          margin: 0;
          padding-left: 0.3rem;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-soft);
        }
        .nav-card {
          display: flex;
          flex-direction: column;
          min-width: 0;
          /* Degrade tres leger plutot qu'un aplat : la carte se detache du
             fond sans avoir besoin d'une bordure franche. */
          background: linear-gradient(180deg, var(--surface) 0%, var(--bg-elevated) 100%);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          overflow: hidden;
        }
      `}</style>
    </nav>
  );
}
