import "./globals.css";
import React from "react";
import AuthFetchInterceptor from "@/components/AuthFetchInterceptor";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

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
};

export default function RootLayout({ children }) {
    return React.createElement(
          "html",
      { lang: "fr" },
          React.createElement(
            "body",
            null,
            React.createElement("script", { dangerouslySetInnerHTML: { __html: THEME_INIT_SCRIPT } }),
            React.createElement(AuthFetchInterceptor, null),
            children
          )
        );
}
