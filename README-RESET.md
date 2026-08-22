# RESET + POMIAR

Za duzo warstw fixow naloszylo sie na siebie i zgubilismy punkt
odniesienia. Ta paczka cofa WSZYSTKIE eksperymenty z wysokoscia
i dodaje narzedzie pomiarowe.

==================================================================
CO ROBI TA PACZKA
==================================================================

ZOSTAJE (to jedyna zmiana, ktora na pewno pomogla):
  - tlo dokumentu w global.css + inline w +html.tsx  -> brak bieli

COFNIETE (wszystkie proby naprawy gapu):
  - height / min-height / dvh na html, body, #root
  - position: fixed na #root
  - regula "#root > div { flex:1 }"
  - !important
  - height:100% w screen-container.tsx
  - --app-height z JS-a
  - usuniecie <ScrollViewStyleReset/>  -> PRZYWROCONE
  - nav bez position:absolute          -> PRZYWROCONE do absolute
  - paddingBottom: 24                  -> PRZYWROCONE do 125 + inset

Czyli layout wraca do stanu z Twojego pierwszego screena
(gap byl, ale ZNIKAL po obrocie telefonu — to wazna wlasciwosc,
ktora zgubilismy przy kolejnych fixach).

DODANE: komponent DomProbe w app/(tabs)/index.tsx — zielony overlay
z wysokosciami warstw DOM.

==================================================================
KROK 1 — podmien 5 plikow
==================================================================

| plik w paczce                    | docelowa sciezka                 |
|----------------------------------|----------------------------------|
| global.css                       | global.css                       |
| app/+html.tsx                    | app/+html.tsx                    |
| app/(tabs)/index.tsx             | app/(tabs)/index.tsx             |
| components/screen-container.tsx  | components/screen-container.tsx  |
| lib/_core/use-viewport-height.ts | lib/_core/use-viewport-height.ts |

app/_layout.tsx, app/(tabs)/_layout.tsx, lib/theme-provider.tsx
zostaja bez zmian.

==================================================================
KROK 2 — rebuild
==================================================================

    npx expo export -p web

==================================================================
KROK 3 — uruchom i zrob screenshot
==================================================================

1. ubij aplikacje (przesun z listy ostatnich aplikacji)
2. otworz ponownie
3. poczekaj 2 sekundy, NIE obracaj telefonu
4. zrob screenshot zielonego tekstu w lewym gornym rogu

==================================================================
KROK 4 — obroc telefon i zrob DRUGI screenshot
==================================================================

1. obroc na poziomo, wroc do pionu (gap powinien zniknac)
2. zrob DRUGI screenshot zielonego tekstu

Wrzuc OBA screenshoty. Roznica miedzy nimi pokaze DOKLADNIE
ktora warstwa DOM zmienia wysokosc po obrocie — czyli ktora jest
winowajca. Wtedy fix bedzie jedna linijka, bez kolejnych paczek.

==================================================================
JAK CZYTAC OVERLAY
==================================================================

Pierwszy wiersz:
    WIN 800 / vv 800
      WIN = window.innerHeight
      vv  = window.visualViewport.height
    Jesli vv < WIN, to wlasnie dlatego --app-height z FIX 3 psulo layout.

Kolejne wiersze (jeden na warstwe DOM, od #root w dol):
    0 h800 sb 800px
    1 h634 sb auto      <- PIERWSZA liczba mniejsza od WIN = winowajca
    2 h634 sf 100%
    ...

Format: <poziom> h<realna wysokosc> <position><display> <CSS height>
  position: s=static, f=fixed, a=absolute, r=relative
  display:  b=block, f=flex

==================================================================
PO DIAGNOZIE
==================================================================

Usun z app/(tabs)/index.tsx:
  - caly komponent DomProbe (funkcja na koncu pliku)
  - linie <DomProbe /> obok {nav}
