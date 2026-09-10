/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
