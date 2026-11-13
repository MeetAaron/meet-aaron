// lib/confirm-dialog.js
//
// Fenêtre de confirmation « Es-tu sûr ? » (13/11/2026, demande d'Alex :
// « Êtes-vous sûr de vouloir vous déconnecter ? Oui »).
//
// Construite en DOM, sans React, pour pouvoir être appelée telle quelle
// depuis n'importe quel gestionnaire (les 12 pages de l'app ont chacune leur
// propre bouton « Se déconnecter », voir handleLogout dans app/app/*). Pas de
// window.confirm : sa boîte grise système détonne dans l'app et affiche
// « meetaaron.app dit… » dans les applis iPhone / Android.
//
// Renvoie une promesse : true si l'utilisateur confirme, false sinon (bouton
// Annuler, clic à côté, touche Échap).

import { t } from '@/lib/i18n';

export function confirmDialog({ message, confirmLabel, cancelLabel, danger = false }) {
  if (typeof document === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'presentation');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2000;background:rgba(5,7,16,0.6);display:flex;align-items:center;justify-content:center;padding:1.25rem;';

    const box = document.createElement('div');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.style.cssText =
      'width:100%;max-width:340px;background:var(--surface,#141a2e);color:var(--text,#f3f4f8);border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:16px;padding:1.2rem 1.1rem 1rem;box-shadow:0 18px 48px rgba(0,0,0,0.45);font-family:inherit;';

    const p = document.createElement('p');
    p.textContent = message;
    p.style.cssText = 'margin:0 0 1.1rem;font-size:0.98rem;line-height:1.45;font-weight:600;';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:0.6rem;justify-content:flex-end;';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = cancelLabel;
    cancel.style.cssText =
      'flex:1;background:transparent;border:1px solid var(--border,rgba(255,255,255,0.14));color:var(--text,#f3f4f8);border-radius:10px;padding:0.7rem 0.8rem;font-size:0.9rem;font-weight:500;cursor:pointer;font-family:inherit;';

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = confirmLabel;
    ok.style.cssText =
      `flex:1;background:${danger ? 'var(--accent-red,#ef4459)' : 'var(--accent,#4b39ef)'};border:none;color:#fff;border-radius:10px;padding:0.7rem 0.8rem;font-size:0.9rem;font-weight:600;cursor:pointer;font-family:inherit;`;

    function close(result) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey);

    row.append(cancel, ok);
    box.append(p, row);
    overlay.append(box);
    document.body.append(overlay);
    ok.focus();
  });
}

// « Es-tu sûr de vouloir te déconnecter ? » — partagé par la pastille
// « Connecté » (components/ConnectionBadge.jsx) et les boutons
// « Se déconnecter » du menu de chaque page.
export function confirmLogout(locale) {
  return confirmDialog({
    message: t('connectionBadge.confirmLogout', locale),
    confirmLabel: t('connectionBadge.logoutYes', locale),
    cancelLabel: t('common.cancel', locale),
    danger: true,
  });
}
