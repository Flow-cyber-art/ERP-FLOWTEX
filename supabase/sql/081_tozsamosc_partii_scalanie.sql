-- ============================================================
-- R1 (katalog ruchów magazynowych, reguła tożsamości partii):
--   ∄ p' ∈ P(i) : (lot(p')=lot ∧ c(p')=c_faktura ∧ receipt(p')=receipt)
--   ⟹ tworzymy nową partię
-- czyli: nowa partia powstaje TYLKO gdy żadna istniejąca partia nie ma
-- już tej samej tożsamości (ten sam indeks, cena, zdarzenie przyjęcia).
-- fn_add_material_batch_ext (008_faza4_magazyn_partie.sql) nigdy tego
-- nie sprawdzał — każde wywołanie zawsze wstawiało nowy wiersz, nawet
-- dla dokładnie tej samej partii (ten sam materiał, cena, dokument,
-- data). W praktyce nieszkodliwe (FIFO i tak działa poprawnie na wielu
-- wierszach), ale to inna zasada niż opisana, i tworzy niepotrzebny
-- „śmietnik" niemal-duplikatów w magazynie (np. przy przypadkowym
-- dwukrotnym zapisaniu tego samego przyjęcia).
--
-- Naprawa: skoro w tabeli nie ma osobnego pola "lot" (potwierdzone
-- wcześniej jako świadomie zostawione, D1 "zostaw"), najbliższym
-- odpowiednikiem "tego samego zdarzenia przyjęcia" jest komplet
-- (materiał, cena, numer dokumentu, data przyjęcia) — gdy WSZYSTKIE się
-- zgadzają, to ta sama partia: dokładamy ilość do istniejącego wiersza
-- zamiast tworzyć nowy. Gdy nie ma numeru dokumentu (brak wiarygodnego
-- identyfikatora zdarzenia), zawsze tworzymy nową partię — bez dokumentu
-- nie da się bezpiecznie stwierdzić, że to ta sama dostawa.
--
-- Uruchom po 080_blokada_zamkniecia_niezerowy_podmagazyn.sql. Bezpieczne
-- do wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

create or replace function fn_add_material_batch_ext(
  p_material_id integer,
  p_quantity decimal,
  p_unit_price decimal,
  p_received_at date,
  p_source batch_source,
  p_document_number text default null,
  p_supplier text default null
)
returns void
language plpgsql
as $$
declare
  v_batch_id integer;
begin
  if p_document_number is not null and trim(p_document_number) <> '' then
    select id into v_batch_id
      from material_batches
      where "materialId" = p_material_id
        and "unitPrice" = p_unit_price
        and "documentNumber" = p_document_number
        and "receivedAt" = p_received_at
        and source = p_source
      limit 1
      for update;
  end if;

  if v_batch_id is not null then
    -- Ta sama tożsamość (indeks + cena + dokument + data) — to ta sama
    -- partia (to samo zdarzenie przyjęcia); dokładamy, nie duplikujemy.
    update material_batches set quantity = quantity + p_quantity where id = v_batch_id;
  else
    insert into material_batches
        ("materialId", quantity, "unitPrice", "receivedAt", source, "documentNumber", "supplier")
      values (p_material_id, p_quantity, p_unit_price, p_received_at, p_source, p_document_number, p_supplier)
      returning id into v_batch_id;
  end if;

  insert into stock_movements
      ("type", "materialId", "batchId", quantity, "unitPrice", note, "createdByProfileId")
    values ('przyjecie', p_material_id, v_batch_id, p_quantity, p_unit_price,
            case when p_document_number is not null then 'Dok. ' || p_document_number else null end,
            auth.uid()::text);

  perform fn_recalc_material(p_material_id);
end;
$$;
