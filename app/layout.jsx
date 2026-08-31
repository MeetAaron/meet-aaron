import "./globals.css";
import React from "react";
import AuthFetchInterceptor from "@/components/AuthFetchInterceptor";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { CHUNK_ERROR_RECOVERY_SCRIPT } from "@/lib/chunk-error-recovery";

export const metadata = {
    title: "Meet Aaron — Le copilote de votre commercial",
    description: "Aaron prospecte, relance et remplit votre agenda pendant que vous vendez.",
    // Voir app/globals.css (règle color-scheme) : indique explicitement aux
    // navigateurs que l'app gère elle-même son thème (sombre par défaut,
    // clair en option depuis Mon compte -> Mon profil, tâche #129 piste 2),
    // pour éviter les recolorations automatiques incohérentes de certains
    // navigateurs. La valeur réelle (sombre/clair) est appliquée côté client
    // par le script ci-dessous, avant l'hydratation React, pour éviter un
    // flash chez un utilisateur ayant déjà choisi le mode clair.
    colorScheme: "dark",
    // public/manifest.json existait déjà mais n'était référencé nulle part
    // dans le <head> -> aucun navigateur ne considérait le site comme une PWA
    // installable. C'est ce lien qui déclenche "Ajouter à l'écran d'accueil"
    // en mode standalone (et non un simple raccourci Safari), condition
    // nécessaire pour que l'API Push fonctionne sur iOS/Safari (16.4+) — voir
    // lib/push.ts et components/PushNotificationManager.jsx.
    manifest: "/manifest.json",
    // Icônes : favicon + icône "ajouter à l'écran d'accueil" sur iOS, qu'Apple
    // lit depuis <link rel="apple-touch-icon"> et non depuis manifest.json.
    // favicon.ico ajouté en complément de icon.png (tâche Alex 2026-08-22,
    // favicon absent de Google Search) : certains robots/anciens navigateurs
    // ne lisent que ce format par défaut, généré depuis public/icon.png.
    icons: {
        icon: [
            { url: "/favicon.ico", sizes: "any" },
            { url: "/icon.png", type: "image/png", sizes: "192x192" },
        ],
        apple: "/icon.png",
    },
    // Balises spécifiques iOS : sans apple-mobile-web-app-capable, Safari
    // ouvre la web-app ajoutée à l'écran d'accueil dans une fenêtre Safari
    // classique (barre d'adresse visible) au lieu du mode standalone attendu
    // pour une PWA, et l'API Push reste indisponible dans ce cas.
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "Meet Aaron",
    },
};

// Couleur de la barre de statut/navigateur quand l'app est installée
// (Android "Ajouter à l'écran d'accueil" + PWA desktop) — alignée sur
// theme_color dans public/manifest.json. Next.js 13+ exige cet export
// séparé de `metadata` pour themeColor (avertissement de build sinon).
export const viewport = {
    themeColor: "#0b0e1a",
    // Couche mobile (app/globals.css, components/MobileChrome.jsx) :
    // viewport-fit=cover permet aux barres fixes du haut/du bas d'utiliser
    // env(safe-area-inset-*) sur iPhone (encoche, barre d'accueil) au lieu
    // de laisser une bande vide ou de passer dessous.
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
};

export default function RootLayout({ children }) {
    return React.createElement(
          "html",
      { lang: "fr" },
          React.createElement(
            "body",
            null,
            React.createElement("script", { dangerouslySetInnerHTML: { __html: THEME_INIT_SCRIPT } }),
            React.createElement("script", { dangerouslySetInnerHTML: { __html: CHUNK_ERROR_RECOVERY_SCRIPT } }),
            React.createElement(AuthFetchInterceptor, null),
            children
          )
        );
}
