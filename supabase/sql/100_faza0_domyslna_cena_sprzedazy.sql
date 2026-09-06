-- ============================================================
-- Domyślna cena sprzedaży (za j.m.) per technologia pilotażu.
--
-- Użytkownik: "tam sa ceny ze metra przy jakiejkolwiek ofercie. jezli
-- raz wpisze chcialbym aby byly zapisane juz w bazie danych i drugi
-- raz moge zmienic ale zaciaga dane z bazy danych" — cena/j.m. wpisana
-- w kroku 4 wizardu ma się zapamiętać per technologia (nie per oferta)
-- i przy kolejnej ofercie podpowiadać się automatycznie, edytowalna.
--
-- Kolumna nullable, addytywna, w pełni odwracalna (drop column, brak
-- ryzyka utraty danych — offer_items i tak trzyma faktyczną cenę użytą
-- w każdej konkretnej ofercie niezależnie od tej podpowiedzi).
-- ============================================================

alter table offer_pilot_technologies add column if not exists default_unit_price numeric;
