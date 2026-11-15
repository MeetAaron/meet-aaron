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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { NavIcon } from '@/components/NavIcon';
import ConnectionBadge from '@/components/ConnectionBadge';
import { warmJson, tabDataUrls } from '@/lib/instant';

// Les 4 rubriques toujours présentes dans la nav (jamais filtrées par rôle
// ni par compte), dans l'ordre d'usage quotidien sur téléphone.
const TAB_SLUGS = ['campaigns', 'prospects', 'agenda', 'chat'];

export default function MobileChrome({ title, items, userId, onMenu, menuLabel, moreLabel, locale }) {
  const tabs = TAB_SLUGS.map((slug) => items.find((item) => item.slug === slug)).filter(Boolean);
  const q = userId ? `?user_id=${userId}` : '';

  // Réactivité des onglets du bas (15/11/2026, Alex : « 3 secondes de délai
  // quand on clique dessus »). Chaque rubrique est une page à part : tant
  // que la suivante n'est pas chargée, Next.js laisse l'ancienne affichée,
  // sans le moindre signe que le toucher a été pris en compte. Deux
  // remèdes : (1) l'onglet touché s'allume tout de suite et une barre de
  // progression apparaît sous la barre du haut ; (2) les 4 rubriques sont
  // préchargées en entier dès l'affichage, pour que le changement soit
  // quasi immédiat ensuite.
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(null);
  useEffect(() => { setPending(null); }, [pathname]);
  const tabHref = (item) => (item.locked ? `/app/preferences${userId ? `?user_id=${userId}&tab=subscription` : '?tab=subscription'}` : `/app/${item.slug}${q}`);
  // Le code des 4 rubriques est préchargé à l'affichage, puis rafraîchi
  // toutes les 4 minutes et à chaque retour au premier plan : Next.js ne
  // garde un préchargement que 5 minutes, au-delà le toucher redevenait lent.
  useEffect(() => {
    const prefetchTabs = () => {
      if (document.visibilityState !== 'visible') return;
      tabs.forEach((item) => {
        try { router.prefetch(tabHref(item)); } catch {}
      });
    };
    prefetchTabs();
    const id = setInterval(prefetchTabs, 4 * 60 * 1000);
    document.addEventListener('visibilitychange', prefetchTabs);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', prefetchTabs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Les DONNÉES des rubriques sont préparées en arrière-plan (lib/instant.js),
  // une seconde après l'affichage pour ne pas ralentir la page en cours :
  // même la première visite d'un onglet s'affiche alors tout de suite. Rien
  // n'est préparé en mode « économie de données ».
  useEffect(() => {
    if (!userId) return undefined;
    const warm = () => {
      if (document.visibilityState !== 'visible') return;
      try { if (navigator.connection && navigator.connection.saveData) return; } catch {}
      warmJson(tabDataUrls(userId), 150 * 1000);
    };
    const first = setTimeout(warm, 1200);
    const id = setInterval(warm, 3 * 60 * 1000);
    document.addEventListener('visibilitychange', warm);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener('visibilitychange', warm);
    };
  }, [userId]);

  return (
    <>
      <header className="mobile-topbar">
        <img src="/icon.png" alt="" className="mobile-topbar-mark" aria-hidden="true" />
        <span className="mobile-topbar-title">{title}</span>
        {/* La cloche a laissé la place à l'état de connexion (demande Alex,
            04/09/2026). Les notifications sont désormais affichées en haut du
            contenu de chaque page (bandeau de bulles rendu par le Shell) —
            la cloche faisait doublon et monopolisait la seule place visible
            de la barre du haut. Voir components/ConnectionBadge.jsx. */}
        <span className="mobile-topbar-conn">
          <ConnectionBadge locale={locale} compact />
        </span>
        <button type="button" className="mobile-topbar-menu" aria-label={menuLabel} onClick={onMenu}>
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </button>
      </header>

      {pending && <div className="mobile-nav-progress" aria-hidden="true" />}
      <nav className="mobile-tabbar" aria-label={moreLabel}>
        {tabs.map((item) => {
          const isActive = pending ? pending === item.slug : item.label === title;
          return (
          <Link
            key={item.slug}
            href={tabHref(item)}
            prefetch
            onClick={(e) => {
              if (item.label === title) return;
              setPending(item.slug);
              // Une nouvelle version du site est en ligne et n'a pas pu être
              // chargée plus tôt (saisie en cours, voir
              // components/VersionWatcher.jsx) : ce changement de rubrique
              // se fait par un chargement complet, qui la récupère.
              if (typeof window !== 'undefined' && window.__aaronNewVersion) {
                e.preventDefault();
                window.location.assign(tabHref(item));
              }
            }}
            className={`mobile-tab${isActive ? ' active' : ''}`}
            aria-current={item.label === title ? 'page' : undefined}
          >
            <span className="mobile-tab-icon"><NavIcon slug={item.slug} size={24} /></span>
            <span className="mobile-tab-label">{item.label}</span>
          </Link>
          );
        })}
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
