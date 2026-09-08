'use client';
// components/LegalPage.jsx
//
// Rendu commun aux deux pages légales publiques : /privacy et /terms.
//
// Pourquoi un composant partagé (08/09/2026) : les deux pages doivent exister
// en sept langues, et elles partagent exactement la même mise en forme. Écrire
// deux fois le parseur, la feuille de style et la logique de repli de langue,
// c'était garantir qu'une correction de style n'atterrisse que sur une des
// deux — et que les deux pages finissent par ne plus se ressembler, alors que
// les relecteurs Google et Apple les ouvrent l'une après l'autre.
//
// Chaque page ne fournit donc plus que ses DONNÉES : un objet par langue, de
// forme {title, updated, intro, sections, footer}. Une section manquante dans
// une langue se voit immédiatement.
//
// Balisage minimal accepté dans les textes : **gras** et [libellé](url).
// Volontairement pauvre — un texte juridique n'a pas besoin de plus, et un
// parseur riche serait une surface de bug pour zéro gain.
import { Fragment } from 'react';

const INLINE = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;

export function inline(text, key) {
  const out = [];
  let last = 0;
  let match;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1]) {
      out.push(<strong key={`${key}-${i}`}>{match[1]}</strong>);
    } else {
      const href = match[3];
      const external = href.indexOf('http') === 0;
      out.push(
        <a
          key={`${key}-${i}`}
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
        >
          {match[2]}
        </a>
      );
    }
    last = match.index + match[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Un bloc est soit une chaîne (paragraphe), soit ['ul', [items]] (liste).
function Block({ block, k }) {
  if (Array.isArray(block)) {
    return (
      <ul>
        {block[1].map((item, i) => (
          <li key={i}>{inline(item, `${k}-${i}`)}</li>
        ))}
      </ul>
    );
  }
  return <p>{inline(block, k)}</p>;
}

// Clause Limited Use de Google : reproduite EN ANGLAIS dans toutes les
// versions, mot pour mot. C'est une exigence de la vérification OAuth — la
// traduire, même fidèlement, fait échouer le contrôle du relecteur.
export const GOOGLE_LIMITED_USE =
  "Meet Aaron's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. The use of information received from Google Workspace scopes will adhere to the Google User Data Policy, including the Limited Use requirements.";

export const MAIL = '[aaron@meetaaron.app](mailto:aaron@meetaaron.app)';

export default function LegalPage({ documents, backLabel, locale }) {
  // Repli sur l'ANGLAIS et non le français : c'est la langue que lisent les
  // relecteurs Google et Apple, et celle qui fait foi pour les traductions.
  const lang = documents[locale] ? locale : 'en';
  const doc = documents[lang];
  return (
    <div className="wrap">
      <div className="content" lang={lang}>
        <a href="/app/preferences" className="back-link">{backLabel[lang] || backLabel.en}</a>
        <img src="/icon.png" alt="Meet Aaron" className="logo" />

        <h1>{doc.title}</h1>
        <p className="updated">{doc.updated}</p>
        {doc.intro.map((block, i) => (
          <Block key={`intro-${i}`} block={block} k={`intro-${i}`} />
        ))}
        {doc.sections.map((section, si) => (
          <Fragment key={si}>
            <h2 id={section.id}>{section.h}</h2>
            {section.b.map((block, bi) => (
              <Block key={bi} block={block} k={`${si}-${bi}`} />
            ))}
          </Fragment>
        ))}
        <p className="footer-note">{inline(doc.footer, 'footer')}</p>
      </div>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500&display=swap');
        .wrap {
          min-height: 100vh;
          background: #0b0e1a;
          color: #f4f1ea;
          font-family: 'Inter', sans-serif;
          padding: 3rem 1.5rem;
          display: flex;
          justify-content: center;
        }
        .content {
          max-width: 680px;
          width: 100%;
        }
        /* a.back-link : le sélecteur .content :global(a) plus bas vaut 0,1,1 et
           l'emporterait sinon sur .back-link (0,1,0) — le lien de retour
           passerait en bleu comme les liens du texte. */
        a.back-link {
          display: inline-block;
          color: #8b90a8;
          font-size: 0.82rem;
          text-decoration: none;
          margin-bottom: 1.5rem;
        }
        a.back-link:hover {
          color: #f4f1ea;
        }
        .logo {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          margin-bottom: 1.5rem;
        }
        h1 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.8rem;
          margin: 0 0 0.4rem;
        }
        .updated {
          color: #8b90a8;
          font-size: 0.82rem;
          margin: 0 0 2rem;
        }
        .content :global(h2) {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.1rem;
          margin: 2rem 0 0.8rem;
        }
        .content :global(p),
        .content :global(li) {
          color: #c7cadb;
          font-size: 0.92rem;
          line-height: 1.6;
        }
        .content :global(ul) {
          padding-left: 1.2rem;
        }
        .content :global(li) {
          margin-bottom: 0.4rem;
        }
        .content :global(a) {
          color: #4b39ef;
        }
        .footer-note {
          margin-top: 2.5rem;
          color: #8b90a8;
          font-size: 0.82rem;
        }
      `}</style>
    </div>
  );
}
