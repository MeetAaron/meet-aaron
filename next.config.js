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
