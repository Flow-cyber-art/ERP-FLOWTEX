-- ============================================================
-- Transfer materiału między podmagazynami budów.
--
-- Jedno wywołanie RPC wykonuje całą operację w transakcji Postgresa:
-- blokuje obie budowy i partie źródłowe, pobiera materiał FIFO, pokrywa
-- ewentualny ujemny stan budowy docelowej, a pozostałość tworzy jako
-- partie na budowie docelowej z niezmienioną ceną źródłową.
--
-- Transfer może wykonać wyłącznie Admin. Super administrator ma profil
-- Admin i przechodzi tę samą kontrolę, a tabela superadmins nadal służy
-- do ochrony jego konta (105_superadmin.sql).
-- ============================================================

alter table stock_movements
  add column if not exists "transferId" uuid;

alter table stock_movements
  add column if not exists "relatedBuildId" integer;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
      where conname = 'stock_movements_relatedBuildId_fkey'
        and conrelid = 'public.stock_movements'::regclass
  ) then
    alter table stock_movements
      add constraint "stock_movements_relatedBuildId_fkey"
      foreign key ("relatedBuildId") references builds(id) on delete restrict;
  end if;
end $$;

create index if not exists stock_movements_transfer_id_idx
  on stock_movements ("transferId")
  where "transferId" is not null;

create or replace function transfer_material_between_builds(
  p_source_build_id integer,
  p_target_build_id integer,
  p_material_id integer,
  p_quantity decimal,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build record;
  v_source_status build_status;
  v_target_status build_status;
  v_available decimal;
  v_transfer_id uuid := gen_random_uuid();
  v_actor text := auth.uid()::text;
  v_source_lot record;
  v_deficit_lot record;
  v_source_take decimal;
  v_chunk_left decimal;
  v_cover decimal;
  v_new_lot_id integer;
  v_transferred decimal := 0;
  v_transfer_value decimal := 0;
  v_cost_adjustment decimal := 0;
  v_avg_qty decimal;
  v_avg_value decimal;
  v_clean_note text := nullif(trim(p_note), '');
begin
  perform assert_role(array['Admin']::app_role[]);

  if p_source_build_id = p_target_build_id then
    raise exception 'Budowa źródłowa i docelowa muszą być różne.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Ilość do przeniesienia musi być większa od zera.';
  end if;
  if p_material_id is null then
    raise exception 'Nie wskazano materiału.';
  end if;
  if length(coalesce(v_clean_note, '')) > 500 then
    raise exception 'Uwaga do transferu może mieć maksymalnie 500 znaków.';
  end if;

  -- Stała kolejność blokad chroni przed zakleszczeniem dwóch transferów
  -- wykonywanych równocześnie w przeciwnych kierunkach.
  for v_build in
    select id, status
      from builds
      where id in (p_source_build_id, p_target_build_id)
      order by id
      for update
  loop
    if v_build.id = p_source_build_id then
      v_source_status := v_build.status;
    else
      v_target_status := v_build.status;
    end if;
  end loop;

  if v_source_status is null then
    raise exception 'Nie znaleziono budowy źródłowej #%.' , p_source_build_id;
  end if;
  if v_target_status is null then
    raise exception 'Nie znaleziono budowy docelowej #%.' , p_target_build_id;
  end if;
  if v_source_status = 'zamknięta' then
    raise exception 'Budowa źródłowa jest zamknięta — nie można z niej przenosić materiału.';
  end if;
  if v_target_status = 'zamknięta' then
    raise exception 'Budowa docelowa jest zamknięta — nie można na nią przenosić materiału.';
  end if;

  perform 1
    from materials
    where id = p_material_id and active = true;
  if not found then
    raise exception 'Materiał #% nie istnieje albo jest zarchiwizowany.', p_material_id;
  end if;

  -- Zablokuj wszystkie dodatnie partie źródłowe przed sprawdzeniem
  -- dostępności. Dzięki temu dwa równoległe transfery nie wydadzą tej
  -- samej ilości.
  perform id
    from build_material_lots
    where "buildId" = p_source_build_id
      and "materialId" = p_material_id
      and quantity > 0.0001
    order by "issuedAt" asc, id asc
    for update;

  select coalesce(sum(quantity), 0)
    into v_available
    from build_material_lots
    where "buildId" = p_source_build_id
      and "materialId" = p_material_id
      and quantity > 0.0001;

  if v_available < p_quantity - 0.0001 then
    raise exception 'Za mało materiału na budowie źródłowej (dostępne %, żądane %).',
      round(v_available, 3), round(p_quantity, 3);
  end if;

  -- Niedobory docelowe również blokujemy przed ich wyrównywaniem.
  perform id
    from build_material_lots
    where "buildId" = p_target_build_id
      and "materialId" = p_material_id
      and quantity < -0.0001
    order by "issuedAt" asc, id asc
    for update;

  for v_source_lot in
    select id, "sourceBatchId", quantity, "unitPrice", "issuedAt"
      from build_material_lots
      where "buildId" = p_source_build_id
        and "materialId" = p_material_id
        and quantity > 0.0001
      order by "issuedAt" asc, id asc
      for update
  loop
    exit when v_transferred >= p_quantity - 0.0001;

    v_source_take := least(v_source_lot.quantity, p_quantity - v_transferred);
    v_chunk_left := v_source_take;
    v_transfer_value := v_transfer_value + v_source_take * v_source_lot."unitPrice";

    -- Log powstaje przed ewentualnym usunięciem wyczerpanej partii.
    -- FK stock_movements.lotId ma ON DELETE SET NULL, więc historia
    -- pozostanie, a zapis nie wskaże nieistniejącego już wiersza.
    insert into stock_movements
      ("type", "materialId", "buildId", "relatedBuildId", "batchId", "lotId",
       quantity, "unitPrice", note, "createdByProfileId", "transferId")
    values
      ('zwrot', p_material_id, p_source_build_id, p_target_build_id,
       v_source_lot."sourceBatchId", v_source_lot.id, v_source_take,
       v_source_lot."unitPrice", coalesce(v_clean_note, 'Transfer między budowami'),
       v_actor, v_transfer_id);

    update build_material_lots
      set quantity = quantity - v_source_take
      where id = v_source_lot.id;
    delete from build_material_lots
      where id = v_source_lot.id and quantity <= 0.0001;

    -- Najpierw wyrównaj zarejestrowane zużycie bez pokrycia. Taka część
    -- transferu nie tworzy dodatniego stanu, tylko zeruje niedobór.
    for v_deficit_lot in
      select id, quantity, "unitPrice"
        from build_material_lots
        where "buildId" = p_target_build_id
          and "materialId" = p_material_id
          and quantity < -0.0001
        order by "issuedAt" asc, id asc
        for update
    loop
      exit when v_chunk_left <= 0.0001;
      v_cover := least(v_chunk_left, abs(v_deficit_lot.quantity));
      -- Niedobór został wcześniej wyceniony ceną zastępczą dostępną w
      -- chwili raportowania. Gdy pojawia się prawdziwa partia, korygujemy
      -- koszt budowy do ceny faktycznie przeniesionego materiału.
      v_cost_adjustment := v_cost_adjustment
        + v_cover * (v_source_lot."unitPrice" - v_deficit_lot."unitPrice");

      update build_material_lots
        set quantity = quantity + v_cover
        where id = v_deficit_lot.id;

      insert into stock_movements
        ("type", "materialId", "buildId", "relatedBuildId", "batchId", "lotId",
         quantity, "unitPrice", note, "createdByProfileId", "transferId")
      values
        ('wydanie', p_material_id, p_target_build_id, p_source_build_id,
         v_source_lot."sourceBatchId", v_deficit_lot.id, v_cover,
         v_source_lot."unitPrice", 'Transfer między budowami — pokrycie niedoboru',
         v_actor, v_transfer_id);

      delete from build_material_lots
        where id = v_deficit_lot.id and abs(quantity) <= 0.0001;

      v_chunk_left := v_chunk_left - v_cover;
    end loop;

    if v_chunk_left > 0.0001 then
      insert into build_material_lots
        ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values
        (p_target_build_id, p_material_id, v_source_lot."sourceBatchId",
         v_chunk_left, v_source_lot."unitPrice", now())
      returning id into v_new_lot_id;

      insert into stock_movements
        ("type", "materialId", "buildId", "relatedBuildId", "batchId", "lotId",
         quantity, "unitPrice", note, "createdByProfileId", "transferId")
      values
        ('wydanie', p_material_id, p_target_build_id, p_source_build_id,
         v_source_lot."sourceBatchId", v_new_lot_id, v_chunk_left,
         v_source_lot."unitPrice", coalesce(v_clean_note, 'Transfer między budowami'),
         v_actor, v_transfer_id);
    end if;

    v_transferred := v_transferred + v_source_take;
  end loop;

  update build_materials
    set planned = greatest(used, planned - p_quantity),
        issued = greatest(used, issued - p_quantity)
    where "buildId" = p_source_build_id and "materialId" = p_material_id;

  select coalesce(sum(quantity), 0), coalesce(sum(quantity * "unitPrice"), 0)
    into v_avg_qty, v_avg_value
    from build_material_lots
    where "buildId" = p_target_build_id
      and "materialId" = p_material_id
      and quantity > 0.0001;

  insert into build_materials
    ("buildId", "materialId", planned, used, "unitPrice", issued)
  values
    (p_target_build_id, p_material_id, p_quantity, 0,
     v_transfer_value / p_quantity, p_quantity)
  on conflict ("buildId", "materialId") do update
    set planned = greatest(build_materials.used, build_materials.planned + excluded.planned),
        issued = build_materials.issued + excluded.issued,
        "unitPrice" = case
          when v_avg_qty > 0.0001 then v_avg_value / v_avg_qty
          else excluded."unitPrice"
        end,
        "actualCost" = build_materials."actualCost" + v_cost_adjustment;

  return v_transfer_id;
end;
$$;

grant execute on function transfer_material_between_builds(integer, integer, integer, decimal, text)
  to authenticated;
