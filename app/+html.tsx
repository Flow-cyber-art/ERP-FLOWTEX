import { ScrollViewStyleReset } from "expo-router/html";

/**
 * Ten plik podmienia domyslny root HTML generowany przez Expo Router
 * przy statycznym eksporcie webowym (`expo export -p web`).
 *
 * Rozni sie od domyslnego szablonu dwoma rzeczami:
 *  1) viewport: dopisane `maximum-scale=1, user-scalable=no` (blokada
 *     pinch-zoom i double-tap zoom) oraz `viewport-fit=cover`, bez
 *     ktorego przegladarka nie zwraca prawdziwych env(safe-area-inset-*),
 *  2) inline <style> z tlem — zeby nie bylo bialego mignięcia przed
 *     wykonaniem JS-a i zeby pod aplikacja nie przeswitywala biel.
 *
 * <ScrollViewStyleReset /> ZOSTAJE. Probowalismy go usunac przy debugu
 * gapu — nie pomoglo, a bez niego <body> zaczyna scrollowac globalnie.
 *
 * Uwaga: ten komponent renderuje sie tylko raz, przy buildzie.
 */
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* Bez tego przeglądarka pokazuje na karcie sam adres (np.
            "erp.flowtex.pl") zamiast nazwy aplikacji — ten szablon
            całkowicie podmienia domyślny <head> Expo Routera, który
            normalnie wstawiłby <title> sam, więc trzeba go dopisać
            ręcznie. */}
        <title>FLOWTEX ERP</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, shrink-to-fit=no, viewport-fit=cover"
        />
        {/* PWA: pozwala zapisac aplikacje na pulpicie/ekranie glownym
            i uruchamiac ja jako samodzielne okno bez paska adresu.
            Ikony w public/icons/. */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1B1B1D" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Budowy" />
        <ScrollViewStyleReset />

        {/* Tlo dokumentu wymuszone INLINE: global.css uzywa
            var(--color-background), ktora ustawia dopiero ThemeProvider
            w runtime — a ten <style> dziala juz przy pierwszym paint. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              "html,body,#root{background-color:#1B1B1D;}" +
              "body{overscroll-behavior:none;}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
