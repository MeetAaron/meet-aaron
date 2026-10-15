/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // POLICES DE pdfkit DANS LE BUNDLE SERVERLESS (02/10/2026).
  //
  // pdfkit ne dessine pas Helvetica : il lit ses metriques depuis des
  // fichiers .afm presents dans son paquet. Le traceur de Next ne les voit
  // pas (ils ne sont jamais `require`), il ne les embarque donc pas dans la
  // fonction deployee — et l'appel echoue a l'execution avec un ENOENT sur
  // Helvetica.afm, en production uniquement, jamais en local.
  //
  // Ca concerne les quatre PDF de l'application : profil d'entreprise,
  // facture, devis, rapport d'equipe. Symptome cote utilisateur : « Share by
  // email ne fonctionne pas » et un message generique, parce que l'exception
  // part hors du try (voir app/api/business-summary/share/route.ts).
  outputFileTracingIncludes: {
    '/api/**/*': ['./node_modules/pdfkit/js/data/**'],
  },
  // EN-TÊTES DE SÉCURITÉ (15/10/2026).
  //
  // Ajoutés après l'audit CASA, qui a constaté qu'il n'y en avait AUCUN :
  // ni HSTS, ni protection contre l'encadrement, ni verrouillage du type
  // MIME. Vercel sert déjà en HTTPS, mais servir en HTTPS et DEMANDER au
  // navigateur de n'accepter que HTTPS sont deux choses différentes : sans
  // HSTS, la toute première requête d'un utilisateur qui tape
  // « meetaaron.app » dans sa barre d'adresse part en clair.
  //
  // Pas de Content-Security-Policy pour l'instant, et c'est un choix motivé :
  // l'application utilise styled-jsx, qui injecte des styles en ligne, et
  // une CSP posée sans mesurer casserait l'affichage de dix-sept pages en
  // production. Une CSP cassée qu'on désactive en urgence est pire que pas
  // de CSP : elle fait croire à une protection qui n'existe plus. Elle
  // viendra, en mode rapport d'abord.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Deux ans, sous-domaines compris : la valeur attendue par les
          // listes de préchargement des navigateurs.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // Empêche le navigateur de « deviner » qu'un fichier déposé par un
          // utilisateur est du HTML et de l'exécuter comme tel.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // L'application n'a aucune raison d'être affichée dans un cadre.
          // DENY et non SAMEORIGIN : rien chez nous ne s'encadre soi-même.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          // Les URL de l'application portent parfois des identifiants en
          // paramètre ; elles ne doivent pas fuiter vers les sites tiers que
          // le commercial ouvre depuis une fiche prospect.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Aucune de ces fonctions n'est utilisée. Les refuser explicitement
          // évite qu'un script tiers compromis les réclame un jour.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
        ],
      },
      {
        // Le pixel de suivi des devis est appelé depuis les clients mail du
        // monde entier : il lui faut l'inverse, aucune mise en cache.
        source: '/api/t/:token',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private, max-age=0' }],
      },
    ];
  },
  async rewrites() {
    return [
      // Digital Asset Links pour l'application Android (dossier android/).
      // Android et Google lisent /.well-known/assetlinks.json ; la route qui
      // le fabrique vit dans app/api/android/assetlinks (voir son commentaire).
      { source: '/.well-known/assetlinks.json', destination: '/api/android/assetlinks' },
    ];
  },
};

module.exports = nextConfig;
