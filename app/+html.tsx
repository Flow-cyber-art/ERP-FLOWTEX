import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * Statyczny shell HTML dla builda webowego (expo web output: "static").
 * Renderowany TYLKO po stronie serwera przy exporcie — nie ma tu dostępu
 * do DOM ani do window.
 *
 * Tu żyją meta-tagi wymagane przez iOS do zainstalowania appki jako PWA
 * (bez nich `window.navigator.standalone` nie zrobi się true, a bez
 * standalone iOS NIE udostępnia PushManagera).
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pl">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
        />

        {/* Bez tego przeglądarka w karcie pokazuje samą domenę (np.
            "erp.flowtex.pl") zamiast nazwy aplikacji. */}
        <title>ERP FLOWTEX</title>

        {/* Manifest — bez niego iOS nie potraktuje strony jako PWA. */}
        <link rel="manifest" href="/manifest.json" />

        {/* iOS nie czyta manifestu tak jak Android — potrzebuje własnych
            meta-tagów, żeby appka odpaliła się w trybie standalone. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ERP FLOWTEX" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icons/icon-512.png" />

        <meta name="theme-color" content="#1B1B1D" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
