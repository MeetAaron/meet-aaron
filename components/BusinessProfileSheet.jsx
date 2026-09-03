'use client';

// components/BusinessProfileSheet.jsx
//
// Aperçu du « Profil de l'entreprise » sous forme de PAGE DE DOCUMENT
// (demande Alex, 04/09/2026) :
//
//   « Retravaille "profil entreprise" car c'est moche. L'aperçu du profil doit
//     être plus joli, comme si on regardait par un judas et qu'on voyait le
//     début du doc word/pdf du profil. Pas un texte dans une case bleue. »
//
// Ce qu'il y avait avant : les 280 premiers caractères, titres retirés,
// espaces écrasés, posés dans un simple encadré. Aucun rapport avec le
// document que produisent réellement les exports Word et PDF.
//
// Ce qu'on montre maintenant : le vrai début du document, mis en page comme le
// document — feuille blanche, marges, titre, titres de section, phrases
// marqueurs mises en avant — et coupé net par un dégradé, comme si la page
// continuait derrière. D'où l'effet « judas » : on ne voit pas un résumé, on
// voit le haut d'une vraie page.
//
// La feuille reste BLANCHE même en thème sombre : c'est un document destiné à
// être imprimé ou envoyé en PDF. Une feuille grise ne ressemblerait à rien.
// Le texte y est donc toujours foncé, indépendamment du thème de l'app.

import { splitBusinessProfileParagraphs, classifyBusinessProfileParagraph } from '@/lib/business-profile-format';

// Assez de paragraphes pour remplir la hauteur visible et être coupés par le
// dégradé — au-delà, c'est du DOM rendu pour rien.
const MAX_PARAGRAPHS = 8;

export default function BusinessProfileSheet({ summary, title, onOpen, openLabel }) {
  const paragraphs = splitBusinessProfileParagraphs(summary || '').slice(0, MAX_PARAGRAPHS);

  return (
    <div className="sheet-wrap">
      <div
        className="sheet"
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen}
        onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}
        aria-label={onOpen ? openLabel : undefined}
      >
        <div className="sheet-inner">
          {title && <p className="doc-title">{title}</p>}
          {paragraphs.map((para, i) => {
            const p = classifyBusinessProfileParagraph(para);
            if (p.type === 'heading') {
              return <p className="doc-heading" key={i}>{p.text}</p>;
            }
            if (p.type === 'marker') {
              return (
                <p className="doc-marker" key={i}>
                  <strong>{p.label}</strong> {p.rest}
                </p>
              );
            }
            return <p className="doc-body" key={i}>{p.text}</p>;
          })}
        </div>
        <span className="sheet-fade" aria-hidden="true" />
      </div>

      <style jsx>{`
        .sheet-wrap {
          position: relative;
        }
        .sheet {
          position: relative;
          height: 230px;
          overflow: hidden;
          border-radius: var(--radius-md);
          background: #ffffff;
          border: 1px solid var(--border);
          box-shadow: var(--shadow-md);
          cursor: ${onOpen ? 'pointer' : 'default'};
          transition: transform var(--fast), box-shadow var(--fast);
        }
        .sheet:hover {
          transform: ${onOpen ? 'translateY(-2px)' : 'none'};
          box-shadow: ${onOpen ? 'var(--shadow-lg)' : 'var(--shadow-md)'};
        }
        /* Marges de page — c'est ce qui fait « document » plutôt que « bloc de
           texte » : une colonne étroite, respirée, alignée en haut. */
        .sheet-inner {
          padding: 1.5rem 1.7rem 0;
          max-width: 46em;
        }
        .doc-title {
          margin: 0 0 0.85rem;
          font-family: var(--font-display);
          font-size: 0.95rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: #14151f;
          padding-bottom: 0.6rem;
          border-bottom: 1px solid #e6e2d8;
        }
        .doc-heading {
          margin: 0.9rem 0 0.3rem;
          font-family: var(--font-display);
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #4b39ef;
        }
        .doc-body,
        .doc-marker {
          margin: 0 0 0.55rem;
          font-size: 0.82rem;
          line-height: 1.6;
          color: #2a2c3a;
        }
        .doc-marker strong { color: #14151f; }
        /* Le « judas » : la page ne s'arrête pas, elle s'efface. */
        .sheet-fade {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 96px;
          background: linear-gradient(to bottom, rgba(255, 255, 255, 0), #ffffff 78%);
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
