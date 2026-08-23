-- ============================================================
-- PIN zabezpieczający "Zamknij i rozlicz budowę" / "Zamknij budowę".
--
-- Dokłada jedną kolumnę do istniejącego singletona `settings` (Faza 7,
-- 012) — ten sam wzorzec co km_rate: odczyt dla wszystkich zalogowanych
-- (potrzebne do porównania wpisanego PIN-u), zapis tylko dla Admina.
-- Pusty/NULL PIN = zabezpieczenie wyłączone (nie pytaj o PIN), zgodnie
-- z domyślnym stanem "PIN jeszcze nie ustawiony w Ustawieniach".
-- Uruchom PO 012 (i po 018). Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

alter table settings add column if not exists close_build_pin text;
