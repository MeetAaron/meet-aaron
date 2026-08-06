import "./globals.css";

export const metadata = {
  title: "Meet Aaron — Le copilote de votre commercial",
  description: "Aaron prospecte, relance et remplit votre agenda pendant que vous vendez.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
