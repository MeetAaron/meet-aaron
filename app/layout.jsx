import "./globals.css";
import React from "react";
import AuthFetchInterceptor from "@/components/AuthFetchInterceptor";

export const metadata = {
    title: "Meet Aaron — Le copilote de votre commercial",
    description: "Aaron prospecte, relance et remplit votre agenda pendant que vous vendez.",
};

export default function RootLayout({ children }) {
    return React.createElement(
          "html",
      { lang: "fr" },
          React.createElement(
            "body",
            null,
            React.createElement(AuthFetchInterceptor, null),
            children
          )
        );
}
