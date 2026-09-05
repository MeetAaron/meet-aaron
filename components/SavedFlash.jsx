'use client';

// components/SavedFlash.jsx
//
// « Changement enregistré » — le même message vert partout où un réglage
// s'enregistre tout seul au clic (docx « derniers ajouts », 05/09/2026 :
// « quand je clique ou dé-clique sur un bouton, il faut au moins un message
// en vert en dessous qui dit "modifications enregistrées". Il faut que ce
// soit la même chose sur toutes les fonctionnalités et boutons concernés »).
//
// Deux pièces :
//   useSavedFlash() → { savedKey, flash }  : flash('doc-12') affiche le
//     message pour cette clé pendant 2,5 s (une seule clé à la fois, la
//     dernière gagne — c'est ce qu'on attend quand on clique vite).
//   <SavedFlash when={savedKey === 'doc-12'} locale={locale} />
//
// Le style (.saved-flash) est global, dans app/globals.css, pour être
// identique dans les 14 pages et les composants sans dépendre du scope
// styled-jsx de chacun.

import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import Ic from '@/components/UiIcon';

export function useSavedFlash(durationMs = 2500) {
  const [savedKey, setSavedKey] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function flash(key = 'default') {
    setSavedKey(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSavedKey(null), durationMs);
  }

  return { savedKey, flash };
}

export default function SavedFlash({ when, locale, text }) {
  if (!when) return null;
  return (
    <p className="saved-flash" role="status" aria-live="polite">
      <Ic name="check" size={13} strokeWidth={2.8} />
      {text || t('preferences.changeSaved', locale)}
    </p>
  );
}
