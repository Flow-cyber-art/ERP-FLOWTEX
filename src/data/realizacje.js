/*
  Każdy wpis = jedna zrealizowana inwestycja pokazywana w zakładce
  "Realizacje" (/realizacje). Najnowsze wpisy dopisuj na GÓRZE tablicy —
  strona wyświetla je w kolejności, w jakiej występują tutaj.

  Pola:
  - slug: unikalny identyfikator wpisu (używany jako #kotwica i do
    dopasowania zdjęcia w src/assets/case-studies/{slug}.webp)
  - title: tytuł realizacji
  - category: krótka etykieta branży/typu posadzki (wyświetlana jako tag)
  - date: miesiąc i rok (do sortowania/wyświetlenia, format "Miesiąc RRRR")
  - paragraphs: wstęp wpisu (BEZ nagłówka), każdy element tablicy = jeden akapit
  - sections: (opcjonalnie) rozbudowana treść z śródtytułami — każda sekcja to
    { heading, blocks }, gdzie blocks to lista bloków w kolejności wyświetlania:
      { type: "paragraph", text }
      { type: "list", items: [{ label, text }] }  — label pogrubiony, potem text
    Użyj tego pola, gdy wpis ma więcej niż jeden temat/śródtytuł (jak poniższy
    wpis o szpitalu). Dla prostych wpisów (jak ENGEL) wystarczy `paragraphs`
    + `closing`, bez `sections`.
  - closing: (opcjonalnie) krótkie podsumowujące zdanie wyświetlane kursywą
    na końcu wpisu — używaj GDY NIE MA `sections` (patrz wpis ENGEL). Przy
    wpisach z `sections` podsumowanie umieszczaj jako ostatnią sekcję.
  - relatedServiceSlug: (opcjonalnie) slug usługi z services.js, do której
    najbardziej pasuje ta realizacja — doda link "Zobacz usługę" pod wpisem
*/
export const REALIZACJE = [
  {
    slug: "posadzka-zywiczna-clean-room-farmacja-mazowieckie",
    title: "Posadzka żywiczna do clean roomu dla przemysłu farmaceutycznego",
    category: "Przemysł farmaceutyczny",
    date: "Wrzesień 2026",
    paragraphs: [
      "Wykonaliśmy posadzkę żywiczną w clean roomie zakładu farmaceutycznego na Mazowszu, w okolicach Warszawy, na powierzchni 340 m².",
      "W pomieszczeniach czystych dla przemysłu farmaceutycznego posadzka nie jest jedynie elementem wykończenia hali — jest częścią środowiska produkcyjnego, w którym liczy się ograniczenie możliwości powstawania i gromadzenia zanieczyszczeń oraz zapewnienie powierzchni łatwej do utrzymania w odpowiednim stanie higienicznym.",
    ],
    sections: [
      {
        heading: "Posadzka do pomieszczeń czystych w przemyśle farmaceutycznym",
        blocks: [
          {
            type: "paragraph",
            text: "W zależności od przeznaczenia pomieszczenia i prowadzonego w nim procesu, znaczenie mają wymagania dotyczące kontroli czystości środowiska określone m.in. w normach serii ISO 14644, a w przypadku procesów wymagających warunków aseptycznych — w wytycznych EU GMP Aneks 1. Dlatego dobór systemu posadzkowego wynikał nie tylko z jego wyglądu czy deklarowanej odporności mechanicznej, ale przede wszystkim z analizy warunków pracy konkretnego pomieszczenia.",
          },
          {
            type: "paragraph",
            text: "Wykonany system jest całkowicie bezspoinowy, z wywinięciem na ściany (fasetą), co eliminuje ostre kąty i połączenia ściana-podłoga — miejsca, w których najłatwiej o zaleganie zanieczyszczeń trudnych do usunięcia podczas czyszczenia i dezynfekcji.",
          },
        ],
      },
      {
        heading: "Od zniszczonego podłoża do gładkiej, higienicznej powierzchni",
        blocks: [
          {
            type: "paragraph",
            text: "Przed rozpoczęciem prac podłoże było mocno zdegradowaną, porowatą wylewką betonową — niespełniającą wymagań higienicznych stawianych pomieszczeniom czystym. Po przygotowaniu podłoża wykonaliśmy system żywiczny z dekoracyjnymi płatkami kwarcowymi, dający jednolitą, bezpyłową i wysoko połyskliwą powierzchnię, odporną na częstą, intensywną dezynfekcję środkami chemicznymi stosowanymi w zakładach farmaceutycznych.",
          },
          {
            type: "list",
            items: [
              { label: "Powierzchnia", text: "340 m²." },
              { label: "Branża", text: "przemysł farmaceutyczny." },
              { label: "Obiekt", text: "clean room." },
              { label: "Lokalizacja", text: "Mazowieckie, okolice Warszawy." },
              { label: "Rodzaj posadzki", text: "posadzka żywiczna bezspoinowa z fasetą." },
              { label: "Zakres prac", text: "przygotowanie podłoża i wykonanie systemu posadzkowego." },
            ],
          },
        ],
      },
    ],
    relatedServiceSlug: "posadzki-zywiczne",
  },
  {
    slug: "posadzka-zywiczna-przemysl-spozywczy-840-m2-hiszpania",
    title: "Posadzka żywiczna 840 m² dla przemysłu spożywczego",
    category: "Przemysł spożywczy",
    date: "Wrzesień 2026",
    paragraphs: [
      "W ramach realizacji wykonaliśmy 840 m² posadzki przemysłowej w zakładzie przetwórstwa rybnego na północy Hiszpanii.",
      "Realizacja wymagała uwzględnienia specyfiki produkcji spożywczej, w tym intensywnego kontaktu z wodą, regularnego mycia powierzchni oraz wymagań związanych z utrzymaniem higieny zakładu.",
    ],
    sections: [
      {
        heading: "Spadki posadzki i odprowadzanie wody",
        blocks: [
          {
            type: "paragraph",
            text: "Jednym z istotnych wyzwań było rozwiązanie kwestii spadków posadzki i odprowadzania wody. W zakładach przemysłu spożywczego prawidłowa geometria posadzki i skuteczne odwodnienie mają kluczowe znaczenie dla efektywnego mycia oraz utrzymania powierzchni w odpowiednim stanie higienicznym.",
          },
        ],
      },
      {
        heading: "Dobór technologii do warunków eksploatacji",
        blocks: [
          {
            type: "paragraph",
            text: "Technologię posadzki dobrano z uwzględnieniem warunków eksploatacji obiektu, obciążeń mechanicznych, kontaktu z wodą oraz wymaganej odporności chemicznej.",
          },
          {
            type: "list",
            items: [
              { label: "Powierzchnia", text: "840 m²." },
              { label: "Branża", text: "przemysł spożywczy." },
              { label: "Specjalizacja", text: "przetwórstwo rybne." },
              { label: "Lokalizacja", text: "północ Hiszpanii." },
              { label: "Rodzaj", text: "posadzka przemysłowa / żywiczna." },
              { label: "Główne wymagania", text: "woda, mycie, higiena, obciążenia mechaniczne, odporność chemiczna." },
            ],
          },
        ],
      },
    ],
    relatedServiceSlug: "posadzki-zywiczne",
  },
  {
    slug: "zywica-schody-prefabrykowane-deckshield",
    title: "Żywica antypoślizgowa na schodach prefabrykowanych — system Deckshield",
    category: "Schody przemysłowe",
    date: "Sierpień 2026",
    paragraphs: [
      "Klient zgłosił się do nas z zapytaniem o wykonanie żywicznej nawierzchni schodów prefabrykowanych — elementu, którego podjęcia odmówiło kilku wcześniejszych oferentów. Powód jest prosty: w przeciwieństwie do posadzek halowych, prace na schodach odbywają się niemal wyłącznie ręcznie, stopień po stopniu, co przy relatywnie niewielkim metrażu generuje znacznie wyższy nakład pracy niż na dużych powierzchniach płaskich.",
      "Zastosowaliśmy system poliuretanowy Deckshield (Tremco CPG) w połączeniu z zaprawą wyrównującą Sikaemaco N 5100 FC oraz żywicą cokołową Flowshield EPW i masą uszczelniającą Sikaflex 415 — rozwiązanie zapewniające certyfikowaną antypoślizgowość i pełną szczelność strefy o intensywnym ruchu pieszym.",
    ],
    sections: [
      {
        heading: "Jak wygląda proces wykonania żywicy na schodach — krok po kroku",
        blocks: [
          {
            type: "list",
            items: [
              { label: "Szlifowanie diamentowe", text: "mechaniczne otwarcie porów betonu na stopnicach, podstopnicach i spocznikach oraz usunięcie mleczka cementowego." },
              { label: "Szpachlowanie", text: "wyrównanie całej powierzchni zaprawą cementową Sikaemaco N 5100 FC." },
              { label: "Warstwa gruntująca", text: "aplikacja Deckshield SF z jednoczesnym zasypem piaskiem kwarcowym frakcji 0,4–0,8 mm." },
              { label: "Warstwa główna", text: "pełny zasyp piaskiem kwarcowym tworzący strukturę antypoślizgową." },
              { label: "Zamknięcie struktury", text: "barwny lakier Deckshield Finish na stopniach i spocznikach." },
              { label: "Cokolik przyścienny", text: "żywica Flowshield EPW wykonana do wysokości 15 cm." },
              { label: "Uszczelnienie dylatacji", text: "masa elastyczna Sikaflex 415 na styku schodów ze ścianą." },
            ],
          },
          {
            type: "paragraph",
            text: "Efektem jest certyfikowana klasa antypoślizgowości, pełne odcięcie wilgoci od konstrukcji betonowej oraz wysoka odporność na ścieranie i uderzenia mechaniczne. Realizacja schodów poprzedziła i otworzyła drogę do wykonania posadzki żywicznej na całej hali produkcyjnej tego samego klienta.",
          },
        ],
      },
      {
        heading: "Dlaczego żywica na schodach jest droższa za m² niż na hali",
        blocks: [
          {
            type: "paragraph",
            text: "Bo prawie cały proces wykonuje się ręcznie — szlifowanie, szpachlowanie i wyrównywanie każdego stopnia osobno, bez możliwości mechanizacji dostępnej przy dużych powierzchniach płaskich. To właśnie ten nakład pracy przy niewielkim metrażu skłonił kilku wcześniejszych oferentów do rezygnacji z tego zlecenia.",
          },
        ],
      },
      {
        heading: "Jaki system żywicy sprawdza się na schodach o dużym natężeniu ruchu",
        blocks: [
          {
            type: "paragraph",
            text: "System poliuretanowy z zasypem kwarcowym, taki jak Deckshield SF/Finish, zapewnia certyfikowaną antypoślizgowość i odporność na ścieranie przy intensywnym ruchu pieszym — co czyni go dobrym wyborem dla schodów prefabrykowanych w obiektach przemysłowych.",
          },
        ],
      },
      {
        heading: "Czy żywica na schodach chroni przed wilgocią",
        blocks: [
          {
            type: "paragraph",
            text: "Tak — przy prawidłowym wykonaniu, łącznie z uszczelnieniem dylatacji przyściennej, system tworzy pełną barierę odcinającą konstrukcję betonową od wilgoci.",
          },
          {
            type: "paragraph",
            text: "Realizację nadzorował osobiście Paweł Najduk, właściciel i dyrektor techniczny FLOWTEX Polska, autoryzowanego wykonawcy systemów Flowcrete, Sika, Sto, Aco i Polysto.",
          },
        ],
      },
    ],
    relatedServiceSlug: "posadzki-zywiczne",
  },
  {
    slug: "posadzka-esd-przemysl-elektroniczny-700-m2",
    title: "700 m² posadzki ESD dla przemysłu elektronicznego",
    category: "Posadzki ESD",
    date: "Sierpień 2026",
    paragraphs: [
      "Zrealizowaliśmy 700 m² posadzki ESD dla strefy przeznaczonej do produkcji elektroniki. To jeden z tych projektów, w których posadzka przemysłowa nie jest tylko elementem wykończenia hali — jest częścią środowiska produkcyjnego, w którym konieczna jest kontrola elektryczności statycznej i ograniczenie ryzyka wyładowań mogących wpływać na wrażliwe komponenty elektroniczne.",
    ],
    sections: [
      {
        heading: "Posadzka ESD to więcej niż żywica",
        blocks: [
          {
            type: "paragraph",
            text: "W przypadku przemysłu elektronicznego wymagania dotyczące posadzki są znacznie bardziej złożone niż wybór odpowiedniej żywicy. System ESD powinien tworzyć kontrolowaną drogę odprowadzania ładunków elektrostatycznych — w praktyce oznacza to konieczność uwzględnienia całej konstrukcji posadzki, przygotowania podłoża, warstw przewodzących lub rozpraszających, uziemienia oraz sposobu użytkowania powierzchni.",
          },
          {
            type: "paragraph",
            text: "Istotne jest również to, jak posadzka współpracuje z obuwiem ESD — sama zgodność podłogi i obuwia ocenianych osobno nie gwarantuje prawidłowego działania całego układu osoba–obuwie–podłoga. Dlatego przy realizacjach ESD nie patrzymy wyłącznie na sam materiał posadzkowy.",
          },
        ],
      },
      {
        heading: "700 m² w wymagającym środowisku produkcyjnym",
        blocks: [
          {
            type: "paragraph",
            text: "Tego typu powierzchnia musi być przygotowana z uwzględnieniem zarówno wymagań elektrycznych, jak i mechanicznych oraz eksploatacyjnych. Znaczenie mają między innymi:",
          },
          {
            type: "list",
            items: [
              { label: "Podłoże", text: "właściwe przygotowanie podłoża betonowego." },
              { label: "System posadzkowy", text: "odpowiedni dobór systemu do wymagań strefy produkcyjnej." },
              { label: "Warstwy ESD", text: "prawidłowe wykonanie warstw przewodzących lub rozpraszających." },
              { label: "Uziemienie", text: "zaplanowanie i wykonanie drogi odprowadzania ładunków." },
              { label: "Kontrola parametrów", text: "pomiar i weryfikacja parametrów elektrycznych posadzki." },
              { label: "Eksploatacja", text: "sposób użytkowania i czyszczenia powierzchni oraz kontrola parametrów w trakcie eksploatacji." },
            ],
          },
          {
            type: "paragraph",
            text: "Przy systemach ESD szczególnie istotne jest prawidłowe wykonanie warstwy przewodzącej i jej połączenie z uziemieniem — nieprawidłowo wykonany detal może wpłynąć na działanie całego systemu, nawet jeśli sama powierzchnia wygląda poprawnie.",
          },
        ],
      },
      {
        heading: "Doświadczenie ma znaczenie",
        blocks: [
          {
            type: "paragraph",
            text: "FLOWTEX Polska ma ponad 20 lat doświadczenia w realizacji posadzek przemysłowych. Przez lata nauczyliśmy się, że najbardziej wymagające projekty nie zaczynają się od pytania „jaki produkt położyć?”, tylko od zrozumienia, jak będzie pracować dana powierzchnia, jakie wymagania ma proces produkcyjny i jakie warunki musi spełnić gotowa posadzka. Dlatego szczególnie interesują nas realizacje, w których technologia, doświadczenie i jakość wykonania mają realne znaczenie.",
          },
        ],
      },
      {
        heading: "Lubimy trudne realizacje",
        blocks: [
          {
            type: "paragraph",
            text: "Ta inwestycja o powierzchni 700 m² dla przemysłu elektronicznego jest kolejnym przykładem projektu, w którym posadzka została potraktowana jako element całego środowiska produkcyjnego, a nie tylko jako wykończenie podłogi.",
          },
        ],
      },
    ],
    relatedServiceSlug: "posadzki-zywiczne",
  },
  {
    slug: "posadzka-clean-room-szpital-warszawa",
    title: "Posadzka żywiczna dla warszawskiego szpitala",
    category: "Sektor medyczny",
    date: "Sierpień 2026",
    paragraphs: [
      "Zrealizowaliśmy posadzkę żywiczną dla jednego z warszawskich szpitali. To inna branża niż nasze wcześniejsze realizacje hal produkcyjnych typu clean room, jednak wymagania okazały się bardzo zbliżone — pomieszczenia szpitalne o podwyższonym reżimie czystości (bloki operacyjne, sale zabiegowe, sterylizatornie, strefy przygotowania leków) muszą spełniać normy porównywalne do tych obowiązujących w przemysłowych clean roomach.",
      "To doświadczenie z realizacji hal clean room dla zakładów produkcyjnych pozwoliło nam sprawnie przełożyć te same standardy techniczne na warunki placówki medycznej — mimo że inwestor, przepisy i procedury odbioru są w obu przypadkach zupełnie inne.",
    ],
    sections: [
      {
        heading: "Jakie normy obowiązują w pomieszczeniach szpitalnych o podwyższonym reżimie czystości",
        blocks: [
          {
            type: "paragraph",
            text: "Pomieszczenia tego typu muszą spełniać rygorystyczne normy czystości powietrza i powierzchni określone w normie ISO 14644-1 oraz — w zakresie procesów wymagających warunków aseptycznych — w wytycznych EU GMP Aneks 1. Klasy czystości ISO 5–8 określają dopuszczalną liczbę cząstek w powietrzu, a to bezpośrednio przekłada się na wymagania wobec posadzki: musi być bezpyłowa, nie może generować ani zatrzymywać cząstek.",
          },
          {
            type: "paragraph",
            text: "Dlatego posadzka w takim pomieszczeniu musi być całkowicie bezspoinowa — każda szczelina czy fuga to potencjalne miejsce gromadzenia się zanieczyszczeń i drobnoustrojów, trudne do skutecznej dezynfekcji. Dla warszawskiego szpitala wykonaliśmy system żywiczny z wywinięciem na ściany (fasetą), eliminując ostre kąty i połączenia ściana-podłoga, w których najłatwiej o zaleganie brudu.",
          },
          {
            type: "paragraph",
            text: "Powierzchnia musiała być również odporna na częstą, intensywną dezynfekcję środkami chemicznymi stosowanymi w placówkach medycznych, a przy tym łatwa w codziennym utrzymaniu czystości — bez porów, w których mogłyby namnażać się bakterie czy grzyby.",
          },
        ],
      },
      {
        heading: "Czym różni się posadzka szpitalna od przemysłowej posadzki clean room",
        blocks: [
          {
            type: "paragraph",
            text: "Choć technicznie oba rozwiązania opierają się na tych samych zasadach — bezspoinowości, faset, odporności chemicznej i braku porowatości — różnią się kontekstem realizacji:",
          },
          {
            type: "list",
            items: [
              {
                label: "Inwestor i regulacje",
                text: "Placówka medyczna podlega przepisom sanitarnym i wymaganiom odbiorowym właściwym dla ochrony zdrowia, natomiast hala produkcyjna — normom branżowym danego sektora (np. farmaceutycznego, elektronicznego czy spożywczego).",
              },
              {
                label: "Harmonogram prac",
                text: "Realizacje w czynnych obiektach szpitalnych często wymagają większej elastyczności w organizacji prac (praca etapowa, ograniczenia czasowe, sąsiedztwo stref sterylnych), podczas gdy hale produkcyjne zwykle pozwalają na bardziej ciągły tok robót.",
              },
              {
                label: "Zakres wykończenia",
                text: "W szpitalach częściej występują dodatkowe wymagania wynikające z sąsiedztwa instalacji medycznych i sprzętu diagnostycznego.",
              },
            ],
          },
          {
            type: "paragraph",
            text: "Mimo tych różnic efekt końcowy — powierzchnia bezpyłowa, bezspoinowa i łatwa do dezynfekcji — pozostaje wspólnym mianownikiem obu typów realizacji.",
          },
        ],
      },
      {
        heading: "Posadzka jako część systemu kontroli czystości",
        blocks: [
          {
            type: "paragraph",
            text: "W obiektach medycznych posadzka nie jest tylko elementem wykończenia — to część systemu kontroli czystości pomieszczenia, dlatego jej wykonanie wymaga tej samej precyzji, co reszta instalacji. Nasze doświadczenie z realizacji posadzek dla hal clean room okazało się tu solidnym fundamentem, pozwalającym z pełną świadomością techniczną podejść do wymagań stawianych przez placówkę medyczną.",
          },
        ],
      },
    ],
    relatedServiceSlug: "posadzki-zywiczne",
  },
  {
    slug: "wtryskarki-engel",
    title: "Posadzka przemysłowa pod wtryskarki ENGEL",
    category: "Posadzki przemysłowe",
    date: "Sierpień 2026",
    paragraphs: [
      "Jedną z realizacji, które szczególnie dobrze pokazują nasze podejście do posadzek przemysłowych, było przygotowanie powierzchni pod wtryskarki ENGEL pracujące w hali produkcyjnej.",
      "W przypadku takiej inwestycji nie wystarczy spojrzeć wyłącznie na ciężar maszyn. Posadzka musi być przygotowana z uwzględnieniem całego środowiska pracy, w którym będzie funkcjonować przez kolejne lata.",
    ],
    sections: [
      {
        heading: "Warunki, które trzeba było uwzględnić",
        blocks: [
          {
            type: "paragraph",
            text: "Przy tej realizacji analizowaliśmy między innymi obciążenia związane z ustawieniem wtryskarek, sposób poruszania się po hali oraz transport form i materiałów. Znaczenie miały także czynniki, które na co dzień obciążają powierzchnię w zakładzie produkcyjnym:",
          },
          {
            type: "list",
            items: [
              { label: "Obciążenia i ustawienie maszyn", text: "nośność posadzki dobrana pod konkretne rozstawienie wtryskarek." },
              { label: "Ruch wewnętrzny", text: "transport form i materiałów oraz codzienny ruch wózków widłowych." },
              { label: "Odporność powierzchni", text: "ścieranie, zarysowania i przypadkowe uderzenia typowe dla pracy hali produkcyjnej." },
              { label: "Elastyczność na przyszłość", text: "możliwość zmiany ustawienia maszyn, stref roboczych i ciągów komunikacyjnych wraz z rozwojem produkcji." },
            ],
          },
        ],
      },
      {
        heading: "Posadzka gotowa na zmiany w organizacji produkcji",
        blocks: [
          {
            type: "paragraph",
            text: "Współczesna hala produkcyjna nie jest przestrzenią statyczną. Ustawienie maszyn, stref roboczych i ciągów komunikacyjnych może zmieniać się wraz z rozwojem zakładu, dlatego posadzka przemysłowa powinna być rozwiązaniem przygotowanym nie tylko na dzień odbioru inwestycji, ale również na późniejsze użytkowanie obiektu.",
          },
        ],
      },
      {
        heading: "Rozwiązanie dopasowane do specyfiki hali",
        blocks: [
          {
            type: "paragraph",
            text: "W tej realizacji zastosowaliśmy system dopasowany do specyfiki hali i warunków, w jakich pracują wtryskarki ENGEL. Szczególną uwagę zwróciliśmy na odpowiednie przygotowanie podłoża oraz wykonanie kolejnych warstw systemu w sposób zapewniający trwałość i odporność powierzchni.",
          },
          {
            type: "paragraph",
            text: "Dzisiaj na wykonanej przez FLOWTEX posadzce pracują wtryskarki ENGEL, a powierzchnia jest częścią codziennego środowiska produkcyjnego zakładu.",
          },
        ],
      },
      {
        heading: "Więcej niż wykończenie hali",
        blocks: [
          {
            type: "paragraph",
            text: "Takie realizacje najlepiej pokazują, że posadzka przemysłowa nie jest jedynie wykończeniem hali — jest elementem infrastruktury produkcyjnej, który musi współpracować z maszynami, transportem wewnętrznym i sposobem organizacji pracy. Po ponad 20 latach doświadczenia w realizacji posadzek przemysłowych wiemy, że dobór technologii powinien zawsze zaczynać się od poznania warunków, w jakich dana powierzchnia będzie użytkowana — a przy produkcji tworzyw sztucznych i wtryskarkach pracujących w ciągłym ruchu posadzka musi po prostu wytrzymać codzienną pracę zakładu.",
          },
        ],
      },
    ],
    relatedServiceSlug: "posadzki-zywiczne",
  },
];

export function getRealizacjaBySlug(slug) {
  return REALIZACJE.find((r) => r.slug === slug);
}
