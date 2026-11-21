-- ============================================================
-- 111: Podwykonawcy — krok 1 (kartoteka firm, brygady podwykonawców,
-- cennik za etap).
--
-- Model (ustalony z właścicielem):
--   * podwykonawca = FIRMA (subcontractors), nie pracownik — nie trafia
--     do listy płac, urlopów ani godzin,
--   * brygada podwykonawcy = zwykła brygada (teams) z ustawionym
--     teams.subcontractor_id; jej brygadzista to zwykłe konto z rolą
--     Brygadzista (ten sam ekran raportu — tryb podwykonawcy w raporcie
--     to krok 2),
--   * rozliczenie po ETAPACH: cennik = stawka za jednostkę (m²/mb/szt)
--     dla danego etapu technologii (subcontractor_rates). Cennik jest
--     BIEŻĄCY — stawka zostanie zamrożona dopiero w zleceniu na budowie
--     (krok 3), tak jak "hourlyRate" w time_entries (055) i "unitPrice"
--     w build_material_lots. Zmiana cennika nie zmienia więc już
--     zleconych prac.
--
-- Stawka wskazuje technologię po KODZIE (technologies.code), nie po id:
-- edycja technologii przypisanej już do budowy tworzy nową wersję z nowym
-- id (patrz 073), a stawka podwykonawcy ma dotyczyć całej rodziny.
-- Etap po NAZWIE — tak samo jak build_stage_status.stage_name i snapshot
-- receptury budowy (build_technology_snapshot), z którymi krok 3 będzie
-- to dopasowywał. stage_name = NULL oznacza "cała technologia" (dla
-- technologii bez podziału na etapy albo gdy podwykonawca robi całość
-- w jednej stawce).
--
-- Bezpieczeństwo: stawki i dane firmy (NIP, konto) widzi i edytuje TYLKO
-- Admin (D11.1) — brak polityki select dla pozostałych ról.
--
-- Uruchom PO 110_receptury_z_ksiegi_technicznej.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

create table if not exists subcontractors (
  id serial primary key,
  name text not null,
  nip text not null default '',
  contact_person text not null default '',
  phone text not null default '',
  email text not null default '',
  bank_account text not null default '',
  note text not null default '',
  active boolean not null default true,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create index if not exists subcontractors_name_idx on subcontractors (lower(name));

-- Brygada podwykonawcy. NULL = brygada własna (jak dotąd).
alter table teams
  add column if not exists subcontractor_id integer references subcontractors(id) on delete set null;

create index if not exists teams_subcontractor_id_idx on teams (subcontractor_id);

create table if not exists subcontractor_rates (
  id serial primary key,
  subcontractor_id integer not null references subcontractors(id) on delete cascade,
  technology_code text not null,
  stage_name text,
  unit text not null default 'm2' check (unit in ('m2', 'mb', 'szt')),
  rate decimal(12, 2) not null check (rate >= 0),
  note text not null default '',
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

-- Jedna stawka na (podwykonawca, technologia, etap) — NULL etapu
-- traktowany jak osobna wartość "cała technologia".
create unique index if not exists subcontractor_rates_unique_idx
  on subcontractor_rates (subcontractor_id, technology_code, coalesce(stage_name, ''));

/* ---------- RLS: tylko Admin ---------- */

alter table subcontractors enable row level security;
alter table subcontractor_rates enable row level security;

drop policy if exists "subcontractors_admin_all" on subcontractors;
create policy "subcontractors_admin_all" on subcontractors
  for all to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

drop policy if exists "subcontractor_rates_admin_all" on subcontractor_rates;
create policy "subcontractor_rates_admin_all" on subcontractor_rates
  for all to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

grant select, insert, update, delete on subcontractors, subcontractor_rates to authenticated;
grant usage, select on sequence subcontractors_id_seq, subcontractor_rates_id_seq to authenticated;
