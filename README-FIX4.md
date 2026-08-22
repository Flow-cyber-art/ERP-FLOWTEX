# FIX 4 — "przy starcie gapu nie ma, po ulamku sekundy jest"

## Ten objaw odwraca diagnoze

Layout startuje POPRAWNIE i psuje sie PO mount. Czyli problem nie
polega na zamrozeniu zlej wysokosci (jak sadzilem w FIX 3), ale na
tym, ze cos AKTYWNIE psuje layout ulamek sekundy po starcie.

Podejrzany nr 1: moj wlasny hook z FIX 3.
window.visualViewport.height w standalone PWA na Androidzie potrafi
zwrocic wartosc MNIEJSZA niz ekran (nie liczy obszaru pod paskiem
gestow). Wpisanie jej do --app-height SKRACALO #root -> gap.

## TEST ROZSTRZYGAJACY (zrob przed wdrozeniem)

W app/_layout.tsx zakomentuj:

    // useViewportHeight();

Rebuild. Wynik:
  - gap ZNIKNAL  -> winowajca byl hook (FIX 4 to naprawia)
  - gap ZOSTAL   -> winowajca sa safe-area insets przychodzace
                    z opoznieniem (FIX 4 tez to naprawia)

## Rozwiazanie: position:fixed zamiast liczenia wysokosci

    #root {
      position: fixed;
      inset: 0;
      height: auto !important;
      display: flex;
      flex-direction: column;
    }

Dlaczego to jest odporne:
  - position:fixed pozycjonuje wzgledem VIEWPORTU, nie rodzica
  - nie zalezy od height html/body
  - nie zalezy od dvh (ktore w PWA bywa nieaktualne)
  - nie zalezy od ZADNEGO JS-a — nie ma czego zepsuc po mount

height:auto !important jest konieczne: dla position:fixed jawna
wysokosc (inline height:100% od <ScrollViewStyleReset/>) wygrywa
nad para top/bottom.

## Druga polowa fixu: przekazanie wysokosci w dol

#root zna teraz prawdziwa wysokosc, ale musi ja PRZEKAZAC przez
wszystkie kontenery. Sam flex:1 nie wystarczy, jesli ktorykolwiek
przodek zostanie z height:auto — wtedy dolny pasek przykleja sie do
dolu za krotkiego kontenera.

Dlatego ScreenContainer dostal na webie height:100% + minHeight:0
na wszystkich trzech warstwach (outer View, SafeAreaView, inner View).

## Pliki

| plik                             | akcja   |
|----------------------------------|---------|
| global.css                       | NADPISZ |
| lib/_core/use-viewport-height.ts | NADPISZ |
| components/screen-container.tsx  | NADPISZ |

app/_layout.tsx i app/(tabs)/index.tsx z paczki "flowtex-podmiana"
zostaja BEZ ZMIAN.

Hook zostaje w projekcie, ale robi teraz tylko jedno: puszcza
sztuczny event resize, zeby RNW przeliczylo Dimensions. Nie ustawia
zadnych wymiarow, wiec nie moze nic zepsuc.

## Kolejnosc

1. podmien 3 pliki
2. npx expo export -p web
3. odinstaluj PWA z telefonu i dodaj ponownie

## Weryfikacja

Ubij aplikacje (przesun z listy ostatnich), otworz ponownie
i POCZEKAJ 2 sekundy bez obracania. Gap nie powinien sie pojawic.

## Jesli nadal jest

Zostaje opcja silowa — w app/+html.tsx usun linie:

    <ScrollViewStyleReset />

To on wstrzykuje inline #root,body,html{height:100%}, z ktorym
walczymy przez !important. Przy pelnoekranowej appce z wlasnym
ScrollView jest zbedny.
