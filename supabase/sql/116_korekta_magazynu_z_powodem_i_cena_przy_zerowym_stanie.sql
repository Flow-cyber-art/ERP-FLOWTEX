-- ============================================================
-- 116. Korekta stanu/ceny magazynu z powodem + wpis do księgi ruchów,
--      cena materiału nie zeruje się przy stanie 0.
--
-- Z testów:
--  (a) "Zapisz zmiany" w Magazynie nadpisywało stan (adjust_material_stock)
--      i cenę (zapis wprost do materials) bez powodu i bez śladu w
--      stock_movements. Nowe RPC correct_material robi obie rzeczy w jednej
--      transakcji, wymaga powodu i zapisuje ruch "korekta" (kto, kiedy,
--      było → jest). Stare adjust_material_stock odmawia, żeby nieodświeżona
--      apka nie mogła dalej korygować bez śladu.
--  (b) fn_recalc_material ustawiała cenę na 0, gdy w magazynie głównym nie
--      zostało nic (np. cały towar wydany na budowy) — i przepisywała to 0
--      na build_materials aktywnych budów, zaniżając plan/rozliczenie
--      (przypadek "Deckshield Finish 0,00 zł/kg"). Teraz przy stanie 0
--      zostaje ostatnia znana cena.
--
-- Supabase -> SQL Editor -> wklej całość -> Run. Idempotentne.
-- ============================================================

-- ------------------------------------------------------------
-- (b) Przeliczenie stanu i średniej ceny — przy zerowym stanie zostaje
-- ostatnia cena zamiast 0.
-- ------------------------------------------------------------
create or replace function fn_recalc_material(p_material_id integer)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_stock decimal(12, 3);
  v_value decimal(14, 2);
  v_price decimal(12, 2);
begin
  select coalesce(sum(quantity), 0), coalesce(sum(quantity * "unitPrice"), 0)
    into v_stock, v_value
    from material_batches
    where "materialId" = p_material_id;

  if v_stock > 0 then
    v_price := v_value / v_stock;
  else
    select "unitPrice" into v_price from materials where id = p_material_id;
    v_price := coalesce(v_price, 0);
  end if;

  update materials
    set stock = v_stock, "unitPrice" = v_price, "updatedAt" = now()
    where id = p_material_id;

  -- Odśwież planowaną cenę na budowach jeszcze aktywnych (zamknięte mają
  -- już zamrożone rozliczenie w build_settlement_materials — nie ruszamy).
  -- Przy stanie 0 nic się nie zmieniło w cenie, więc nie ruszamy też budów.
  if v_stock > 0 then
    update build_materials bm
      set "unitPrice" = v_price
      from builds b
      where bm."materialId" = p_material_id
        and bm."buildId" = b.id
        and b.status = 'aktywna';
  end if;
end;
$$;

grant execute on function fn_recalc_material(integer) to authenticated;

-- ------------------------------------------------------------
-- (a) Korekta stanu i/lub ceny z powodem.
--   p_new_stock  — docelowy stan w magazynie głównym (null = bez zmian)
--   p_new_price  — docelowa cena jednostkowa (null = bez zmian)
--   p_reason     — wymagany, min. 3 znaki
-- Stan w górę: nowa partia "korekta" po cenie docelowej (albo bieżącej).
-- Stan w dół: zdjęcie FIFO, jak realne zużycie.
-- Cena: korekta pomyłki, więc przestawia cenę wszystkich partii w magazynie
-- głównym (inaczej następne przeliczenie średniej ważonej by ją cofnęło);
-- partie już wydane na budowy zostają ze swoją ceną.
-- Każda zmiana = osobny wpis "korekta" w stock_movements:
--   stan:  quantity = różnica (+/−), note = "Stan: było X → jest Y. Powód: …"
--   cena:  quantity = 0,             note = "Cena: było A → jest B. Powód: …"
-- ------------------------------------------------------------
create or replace function correct_material(
  p_material_id integer,
  p_new_stock decimal,
  p_new_price decimal,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material materials;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor text := auth.uid()::text;
  v_old_stock decimal;
  v_old_price decimal;
  v_delta decimal;
  v_cost decimal;
  v_batch_id integer;
  v_price_changed boolean;
begin
  perform assert_role(array['Admin']::app_role[]);

  if length(v_reason) < 3 then
    raise exception 'Podaj powód korekty (min. 3 znaki).';
  end if;
  if p_new_stock is not null and p_new_stock < 0 then
    raise exception 'Stan magazynowy nie może być ujemny.';
  end if;
  if p_new_price is not null and p_new_price < 0 then
    raise exception 'Cena nie może być ujemna.';
  end if;

  select * into v_material from materials where id = p_material_id for update;
  if not found then
    raise exception 'Nie znaleziono materiału #%.', p_material_id;
  end if;

  v_old_stock := coalesce(v_material.stock, 0);
  v_old_price := coalesce(v_material."unitPrice", 0);
  v_price_changed := p_new_price is not null and abs(p_new_price - v_old_price) >= 0.005;

  -- Cena najpierw: korekta w górę dopisze wtedy partię już po nowej cenie.
  if v_price_changed then
    update material_batches set "unitPrice" = p_new_price
      where "materialId" = p_material_id;
    update materials set "unitPrice" = p_new_price, "updatedAt" = now()
      where id = p_material_id;
    perform fn_recalc_material(p_material_id);
    -- Planowana cena na aktywnych budowach — przy stanie 0 recalc jej nie
    -- rusza, a to właśnie przypadek "materiał bez ceny" do poprawienia.
    update build_materials bm
      set "unitPrice" = p_new_price
      from builds b
      where bm."materialId" = p_material_id
        and bm."buildId" = b.id
        and b.status = 'aktywna';

    insert into stock_movements
        ("type", "materialId", quantity, "unitPrice", note, "createdByProfileId")
      values ('korekta', p_material_id, 0, p_new_price,
              format('Cena: było %s → jest %s. Powód: %s',
                     round(v_old_price, 2), round(p_new_price, 2), v_reason),
              v_actor);
  end if;

  if p_new_stock is not null then
    v_delta := p_new_stock - v_old_stock;
    if abs(v_delta) >= 0.0001 then
      if v_delta > 0 then
        insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
          values (p_material_id, v_delta,
                  coalesce(p_new_price, v_old_price), current_date, 'korekta')
          returning id into v_batch_id;
        perform fn_recalc_material(p_material_id);
        v_cost := v_delta * coalesce(p_new_price, v_old_price);
      else
        v_cost := fn_consume_fifo(p_material_id, -v_delta);
      end if;

      insert into stock_movements
          ("type", "materialId", "batchId", quantity, "unitPrice", note, "createdByProfileId")
        values ('korekta', p_material_id, v_batch_id, v_delta,
                case when v_delta <> 0 then round(abs(v_cost / v_delta), 2) else 0 end,
                format('Stan: było %s → jest %s %s. Powód: %s',
                       trim_scale(v_old_stock), trim_scale(p_new_stock), v_material.unit, v_reason),
                v_actor);
    end if;
  end if;
end;
$$;

grant execute on function correct_material(integer, decimal, decimal, text) to authenticated;

-- Stara ścieżka bez powodu — zablokowana. Nieodświeżona apka dostanie
-- czytelny komunikat zamiast cichej korekty bez śladu.
create or replace function adjust_material_stock(p_material_id integer, p_new_stock decimal)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Korekta stanu wymaga podania powodu — odśwież aplikację.';
end;
$$;

-- Lista korekt materiału do wglądu w Magazynie (kto, kiedy, było → jest).
create or replace function list_material_corrections(p_material_id integer, p_limit integer default 10)
returns table (
  id integer,
  "createdAt" timestamp,
  quantity numeric,
  "unitPrice" numeric,
  note text,
  "createdByName" text
)
language sql
stable
security definer
set search_path = public
as $$
  select sm.id, sm."createdAt", sm.quantity, sm."unitPrice", sm.note,
         coalesce(e.name, u.email, '—')::text
    from stock_movements sm
    left join profiles p on p.id::text = sm."createdByProfileId"
    left join employees e on e.id = p."employeeId"
    left join auth.users u on u.id = p.id
    where sm."materialId" = p_material_id
      and sm."type" = 'korekta'
      and sm."buildId" is null
      and app_role() = 'Admin'
    order by sm."createdAt" desc, sm.id desc
    limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

grant execute on function list_material_corrections(integer, integer) to authenticated;
