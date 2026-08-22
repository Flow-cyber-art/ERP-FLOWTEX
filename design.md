# Projekt interfejsu — Budowy

Aplikacja działa w orientacji pionowej i jest projektowana do obsługi jedną ręką przez brygadzistę. Główna nawigacja obejmuje Dashboard, Magazyn, Budowy i Raport. Dashboard pokazuje liczbę materiałów, niskie stany, aktywne budowy i skrót do raportu. Magazyn oferuje wyszukiwanie po nazwie i indeksie oraz dodawanie nowej pozycji. Budowy pokazują numer, nazwę i osobę odpowiedzialną, a szczegóły prezentują przypisane materiały. Raport dzienny pokazuje materiały przypisane do budowy, pozwala wpisać zużycie i wymaga uzasadnienia dla każdej różnicy.

Wizualnie aplikacja korzysta z grafitowego tła `#1B1B1D`, powierzchni `#242427`, jasnego tekstu `#F8F5EE`, bursztynowego akcentu `#E2A73B`, stonowanych opisów `#A8A39A` oraz zielonego statusu `#63C58C`. Ten kierunek jest inspirowany repozytorium `Flow-cyber-art/Flow`; jego kod nie jest modyfikowany ani kopiowany do aplikacji.

Główne przepływy to: wyszukanie lub dodanie materiału, utworzenie budowy, przypisanie materiałów, a następnie wpisanie dziennego zużycia i uzasadnienie różnic. Lokalna warstwa danych ma później zostać zastąpiona adapterem Supabase bez zmiany ekranów.
