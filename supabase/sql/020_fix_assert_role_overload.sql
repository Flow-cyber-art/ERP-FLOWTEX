-- ============================================================
-- Fix: "function assert_role(text[]) does not exist" przy Zamknij
-- budowę (i potencjalnie przy innych akcjach Admina).
--
-- Wszystkie wywołania assert_role() w tym repo rzutują jawnie na
-- app_role[] (np. `assert_role(array['Admin']::app_role[])`), więc
-- literalny kod źródłowy jest poprawny. Błąd oznacza, że w żywej bazie
-- Postgres/PostgREST z jakiegoś powodu resolve'uje wywołanie do
-- text[] (stary/uszkodzony cache schematu, ręcznie wklejona wcześniejsza
-- wersja bez castu, albo inny nietypowy stan) i nie znajduje pasującej
-- funkcji.
--
-- Zamiast zgadywać dokładną przyczynę stanu tej konkretnej instancji,
-- dokładamy DRUGI, addytywny overload przyjmujący wprost text[] i
-- przekazujący dalej do już istniejącej wersji app_role[] — dzięki
-- temu wywołanie działa niezależnie od tego, jaki typ argumentu
-- Postgres akurat rozpozna. Nie zastępuje istniejącej funkcji, tylko
-- dokłada bezpieczny wariant. Uruchom w dowolnym momencie po
-- 003_auth_rls.sql. Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

create or replace function assert_role(allowed text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_role(allowed::app_role[]);
end;
$$;

grant execute on function assert_role(text[]) to authenticated;
