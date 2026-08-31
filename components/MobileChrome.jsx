// components/MobileChrome.jsx
// Habillage "app" sur téléphone/tablette (docx Modifs Aaron 30/08/2026,
// item 8 : "la version app fait peur, ça fait amateur — aussi agréable que
// Things 3, et pour chaque résolution"). Rendu par le Shell de chaque page
// (dupliqué dans les 14 pages, convention du projet) à la place de l'ancien
// bouton hamburger flottant qui se superposait aux titres :
//
//   - une barre du haut fixe (logo + titre de la rubrique + bouton menu),
//   - une barre d'onglets fixe en bas, comme une app native : Tableau de
//     bord / Prospects / Agenda / Chat / Plus — « Plus » ouvre le tiroir
//     latéral existant (toutes les rubriques, langue, déconnexion).
//
// Invisible au-dessus de 900px (voir app/globals.css, section "Couche
// mobile") : la version ordinateur, qu'Alex trouve bien, ne change pas.
// Tous les styles sont dans globals.css (pas de styled-jsx ici) : ils
// s'appliquent tels quels aux 14 pages sans dépendre du hachage de scope
// de chaque page — et <Link> garde la navigation côté client.

'use client';

import Link from 'next/link';
import { NavIcon } from '@/components/NavIcon';
import Stories from '@/components/Stories';

// Les 4 rubriques toujours présentes dans la nav (jamais filtrées par rôle
// ni par compte), dans l'ordre d'usage quotidien sur téléphone.
const TAB_SLUGS = ['dashboard', 'prospects', 'agenda', 'chat'];

export default function MobileChrome({ title, items, userId, onMenu, menuLabel, moreLabel, locale }) {
  const tabs = TAB_SLUGS.map((slug) => items.find((item) => item.slug === slug)).filter(Boolean);
  const q = userId ? `?user_id=${userId}` : '';

  return (
    <>
      <header className="mobile-topbar">
        <img src="/icon.png" alt="" className="mobile-topbar-mark" aria-hidden="true" />
        <span className="mobile-topbar-title">{title}</span>
        {/* Cloche de notifications (stories, docx « mon avis » 31/08/2026). */}
        <span className="mobile-topbar-bell">
          <Stories mode="bell" userId={userId} locale={locale} />
        </span>
        <button type="button" className="mobile-topbar-menu" aria-label={menuLabel} onClick={onMenu}>
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </button>
      </header>

      <nav className="mobile-tabbar" aria-label={moreLabel}>
        {tabs.map((item) => (
          <Link
            key={item.slug}
            href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${q}`}
            className={`mobile-tab${item.label === title ? ' active' : ''}`}
            aria-current={item.label === title ? 'page' : undefined}
          >
            <span className="mobile-tab-icon"><NavIcon slug={item.slug} size={22} /></span>
            <span className="mobile-tab-label">{item.label}</span>
          </Link>
        ))}
        <button type="button" className="mobile-tab" onClick={onMenu}>
          <span className="mobile-tab-icon mobile-tab-more" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="mobile-tab-label">{moreLabel}</span>
        </button>
      </nav>
    </>
  );
}
