// app/login/layout.jsx
// Fond de la page de connexion (15/11/2026). app/globals.css donne à
// html/body le fond crème du site public ; la page de connexion est sombre.
// Tant que sa propre mise en forme n'était pas arrivée, on voyait ce fond
// clair — la « page blanche » signalée par Alex à l'ouverture de l'app. Posé
// ici, dans le HTML envoyé par le serveur, le fond est sombre dès le premier
// affichage, y compris derrière les zones de sécurité de l'iPhone.
export default function LoginSegmentLayout({ children }) {
  return (
    <>
      <style>{`html, body { background: #0b0e1a; }`}</style>
      {children}
    </>
  );
}
