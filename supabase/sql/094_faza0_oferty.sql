-- ============================================================
-- Faza 0: Wizard ofert (oferty klienckie) — pilotaż na /oferta.
--
-- Kontekst: chcemy sprawdzić w praktyce, czy ofertę dla klienta da się
-- składać z tych samych "kart standardu wykonawczego" co technologie
-- posadzek (koszt materiału na m²/mb liczony z `technology_materials`),
-- zanim zdecydujemy, czy/jak spiąć to z zakładaniem budowy (`builds`).
--
-- Świadomie NIE dotykamy `technologies` / `technology_stages` /
-- `technology_materials` — te tabele tylko CZYTAMY (SELECT), zero ALTER.
-- Wszystko poniżej jest nowe i w pełni odwracalne: gdyby pilotaż się nie
-- przyjął, wystarczy
--   drop table if exists offer_pilot_technologies;
--   drop table if exists offer_items;
--   drop table if exists offers;
-- żeby wrócić do stanu sprzed tej migracji, bez śladu w resztach schematu.
--
-- offer_pilot_technologies: świadomie OSOBNA, malutka tabela zamiast
-- kolumny na `technologies` (np. `is_offer_enabled`) — właśnie po to, żeby
-- nie ruszać tej tabeli w ogóle. Pilotaż startuje z 3 pozycjami (patrz
-- rozmowa) — dodanie/odjęcie kolejnej to zwykły insert/delete tutaj, nie
-- migracja.
--
-- offer_items.material_costs_json: ZAMROŻONA migawka cen materiału w
-- momencie tworzenia oferty (nazwa etapu/materiału, zużycie/m², jednostka,
-- przyjęta cena) — ten sam powód co build_technology_snapshot dla budów:
-- późniejsza zmiana receptury albo ceny w magazynie nie może po cichu
-- przeliczyć już wysłanej klientowi oferty.
--
-- Zapis PDF / eksport dokumentu celowo POZA zakresem tej migracji i tej
-- fazy — na start liczy się tylko: wybór karty, metraż, koszt materiału,
-- cena sprzedaży, zapis/odzyskanie oferty po numerze lub kliencie.
-- ============================================================

create table if not exists offers (
  id serial primary key,
  ref text not null unique,
  company_name text not null default '',
  contact_person text not null default '',
  address text not null default '',
  investment_address text not null default '',
  nip text not null default '',
  email text not null default '',
  phone text not null default '',
  discount_percent decimal(5,2) not null default 0,
  status text not null default 'szkic', -- 'szkic' | 'wyslana' | 'zaakceptowana' | 'odrzucona'
  createdBy text, -- uuid (auth.users/profiles.id), jak technologies.createdBy
  createdAt timestamp not null default now(),
  updatedAt timestamp not null default now()
);

create index if not exists offers_company_name_idx on offers (lower(company_name));

create table if not exists offer_items (
  id serial primary key,
  offer_id integer not null references offers(id) on delete cascade,
  -- Nullable: NULL = pozycja własna (spoza katalogu), bez opisu technologii.
  technology_id integer references technologies(id) on delete set null,
  -- Zamrożone na wypadek, gdyby technology_id kiedyś zniknął (usunięta
  -- technologia) albo pozycja była własna — oferta ma wciąż czytelną
  -- nazwę/kod bez potrzeby joina.
  code text not null default '',
  name text not null default '',
  unit text not null default 'szt',
  qty decimal(12,3) not null default 0,
  unit_price decimal(12,2) not null default 0,
  is_custom boolean not null default false,
  sort_order integer not null default 0,
  -- jsonb: [{stage, materialName, unit, consumptionPerM2, cost}] — patrz
  -- komentarz u góry pliku. text() w drizzle/schema.ts (brak natywnego
  -- typu jsonb w tamtym pliku, jak snapshotJson w build_technology_snapshot).
  material_costs_json jsonb not null default '[]'::jsonb
);

create index if not exists offer_items_offer_id_idx on offer_items (offer_id);

create table if not exists offer_pilot_technologies (
  technology_id integer primary key references technologies(id) on delete cascade,
  addedAt timestamp not null default now()
);

alter table offers enable row level security;
alter table offer_items enable row level security;
alter table offer_pilot_technologies enable row level security;

-- Każdy zalogowany widzi/składa oferty (biuro/admin) — bez podziału na
-- właściciela oferty na razie, jak przy technologies. Edycja/kasowanie
-- zarezerwowane dla Admina, tak samo jak przy technologies/technology_stages.
drop policy if exists "select_authenticated" on offers;
create policy "select_authenticated" on offers for select to authenticated using (true);
drop policy if exists "insert_authenticated" on offers;
create policy "insert_authenticated" on offers for insert to authenticated with check (true);
drop policy if exists "write_admin" on offers;
create policy "write_admin" on offers for update to authenticated using (app_role() = 'Admin'::app_role) with check (app_role() = 'Admin'::app_role);
drop policy if exists "delete_admin" on offers;
create policy "delete_admin" on offers for delete to authenticated using (app_role() = 'Admin'::app_role);

drop policy if exists "select_authenticated" on offer_items;
create policy "select_authenticated" on offer_items for select to authenticated using (true);
drop policy if exists "write_authenticated" on offer_items;
create policy "write_authenticated" on offer_items for all to authenticated using (true) with check (true);

drop policy if exists "select_authenticated" on offer_pilot_technologies;
create policy "select_authenticated" on offer_pilot_technologies for select to authenticated using (true);
drop policy if exists "write_admin" on offer_pilot_technologies;
create policy "write_admin" on offer_pilot_technologies for all to authenticated using (app_role() = 'Admin'::app_role) with check (app_role() = 'Admin'::app_role);

-- Pilotaż: 3 pierwsze aktywne technologie, jeśli tabela jest jeszcze
-- pusta (świeże wdrożenie) — Admin dobierze docelowe 3 ręcznie z ekranu,
-- to tylko żeby /oferta nie było puste od razu po migracji.
insert into offer_pilot_technologies (technology_id)
select id from technologies where is_active = true order by id limit 3
on conflict (technology_id) do nothing;
