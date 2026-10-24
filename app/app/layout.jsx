// app/app/layout.jsx
// FOND DE PAGE DE L'APPLICATION (24/10/2026, « c'est chiant que ça s'affiche
// en mode clair alors que je veux le mode sombre par défaut »).
//
// app/globals.css donne à html/body un fond crème (#F6F4EF), celui du site
// public. Les pages de l'app qui ont leur propre Shell le recouvrent, mais
// les écrans sans Shell (Marge par client, diagnostic Outlook, bilan de
// RDV…) laissaient voir ce fond clair autour des cartes sombres. Ici, pour
// tout ce qui est sous /app, le fond suit le thème : sombre par défaut
// (--bg), clair seulement si l'utilisateur a choisi le mode clair.
export default function AppSegmentLayout({ children }) {
  return (
    <>
      <style>{`html, body { background: var(--bg, #080a14); }`}</style>
      {children}
    </>
  );
}
