// components/RailMore.jsx
//
// Modernisation 16/10/2026, point 4 (validé par Alex) : le rail d'icônes de
// l'ordinateur ne garde que les rubriques du quotidien. Les rubriques rares
// (documents, compte & connexions, équipe…) passent dans un bouton « Plus »,
// comme la barre d'onglets du téléphone (components/MobileChrome.jsx) — un
// rail de 9 icônes se lit mal, un rail de 6 se lit d'un coup d'œil.
//
// Fonctionnement, sans toucher à la liste existante de chaque page :
//   - chaque page ajoute la classe `nav-rare` aux liens dont le slug est dans
//     RARE_SLUGS (sauf la page en cours, qui reste visible dans le rail) ;
//   - app/globals.css masque `.nav-rare` dans le rail (≥ 901 px) et affiche
//     ce composant ; sur téléphone c'est l'inverse : le tiroir montre toute
//     la liste et ce bouton est masqué.

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NavIcon, LockIcon } from '@/components/NavIcon';

export const RARE_SLUGS = ['documents', 'connexions', 'team', 'suggestions', 'products', 'customer'];

export function railLinkClass(slug, label, active) {
  return RARE_SLUGS.includes(slug) && label !== active ? 'nav-link nav-rare' : 'nav-link';
}

export default function RailMore({ items, active, userId, label, notIncludedLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const rare = (items || []).filter((item) => RARE_SLUGS.includes(item.slug) && item.label !== active);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (rare.length === 0) return null;
  const q = userId ? `?user_id=${userId}` : '';

  return (
    <ul className="nav-list rail-more" ref={ref}>
      <li className={open ? 'rail-more-open' : ''}>
        <button
          type="button"
          className="rail-more-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="nav-icon"><NavIcon slug="more" /></span>
          <span className="nav-label">{label}</span>
        </button>
        {open && (
          <div className="rail-more-pop" role="menu">
            {rare.map((item) => (
              <Link
                key={item.slug}
                role="menuitem"
                className="rail-more-item"
                href={item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${q}`}
                onClick={() => setOpen(false)}
              >
                <span className="rail-more-ic"><NavIcon slug={item.slug} size={17} /></span>
                <span className="rail-more-txt">{item.label}</span>
                {item.locked && <span className="rail-more-lock" title={notIncludedLabel}><LockIcon /></span>}
              </Link>
            ))}
          </div>
        )}
      </li>
    </ul>
  );
}
