-- ============================================================
-- Fundament schematu (Faza 0-2) — brakujący punkt startowy repo.
--
-- Kontekst: `supabase/sql/001_rpc_functions.sql` był pierwszym SQL-em
-- kiedykolwiek zacommitowanym do repo — zakłada, że tabele bazowe
-- (builds, materials, employees, profiles, materiał_batches, reports,
-- technologie itd.) już istnieją. One rzeczywiście istnieją na żywym
-- Supabase (utworzone ręcznie/przez wcześniejszy etap projektu przed
-- wprowadzeniem kontroli wersji SQL), ale nigdy nie trafiły do repo —
-- odtworzenie bazy od zera z samego `supabase/sql/*` kończyło się
-- błędem "relation does not exist" już na 001.
--
-- Ten plik to pełny dump bieżącego stanu produkcyjnej bazy
-- (ERP-Flowtex, projekt gfgdadcsmbtwppbflmbb): wszystkie enumy, tabele
-- z ich finalnymi kolumnami, klucze/ograniczenia, indeksy, RLS
-- (enable + polityki) i wszystkie funkcje RPC — wygenerowany
-- bezpośrednio z pg_catalog/information_schema (pg_get_constraintdef,
-- pg_get_functiondef, pg_policies), nie przepisany ręcznie.
--
-- Celowo NIE ma tu podziału na "Faza 0" / "Faza 1" / "Faza 2" — to jest
-- migawka stanu KOŃCOWEGO (po wszystkich 093 migracjach), nie próba
-- odtworzenia chronologii. Dzięki temu jest bezpieczna do uruchomienia
-- jako PIERWSZY plik w świeżym projekcie Supabase, przed 001-093:
-- każda z kolejnych migracji używa `create or replace
-- function`/`if not exists`/`add column if not exists`, więc ponowne
-- odtworzenie tego samego stanu przez 001-093 po tym pliku jest
-- neutralne (idempotentne), nie błędem.
--
-- Usunięte świadomie z tego dumpu (patrz audyt bezpieczeństwa z
-- 05.09.2026): tabela `users` (pozostałość szablonu OAuth "Manus",
-- 0 wierszy, RLS otwarte na rolę `public`/anon z `qual: true` — czyli
-- każdy z kluczem anon mógł czytać/pisać/kasować dowolne wiersze) oraz
-- `build_stage_completions` (porzucony prototyp sprzed `build_stage_status`
-- z Fazy 6, ta sama otwarta polityka RLS, zero odwołań w kodzie).
-- Obie skasowane na żywej bazie tą samą sesją (0 wierszy, brak ryzyka
-- utraty danych). Kolumny `employees."userId"` i
-- `stock_movements."createdByUserId"` zostają (nieużywane przez appkę,
-- ale nieszkodliwe) — tylko klucz obcy do skasowanej tabeli `users`
-- został pominięty.
--
-- Dodatkowo (ta sama sesja): 8 funkcji SECURITY DEFINER, które nie miały
-- ustawionego `search_path` (ostrzeżenie Supabase Security Advisor
-- "function_search_path_mutable" — teoretyczna podatność na przechwycenie
-- przez obiekt o tej samej nazwie utworzony wcześniej na search_path
-- wywołującego), dostały `SET search_path TO 'public'`:
-- count_business_days, fn_add_material_batch, fn_add_material_batch_ext,
-- fn_build_plan_remaining, fn_consume_build_lot_fifo, fn_consume_fifo,
-- fn_recalc_material, normalize_material_name. Na żywej bazie zastosowane
-- przez lekkie `ALTER FUNCTION ... SET search_path` (bez podmiany ciała
-- funkcji); w tym pliku odzwierciedlone wprost w definicjach poniżej.
--
-- Jak uruchomić NA NOWYM/PUSTYM projekcie Supabase: SQL Editor -> wklej
-- całość -> Run -> potem po kolei 001_rpc_functions.sql .. 093_*.sql.
-- Na projekcie, który już ma ten schemat (czyli obecny produkcyjny),
-- uruchomienie tego pliku jest neutralne — same `if not exists`/
-- `or replace`/`drop policy if exists` + `create policy`.
-- ============================================================

-- Enums

do $$ begin
  create type app_role as enum ('Admin', 'Brygadzista', 'Pracownik');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type batch_source as enum ('stan początkowy', 'zamówienie', 'korekta', 'zwrot');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type build_status as enum ('aktywna', 'zamknięta');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type employee_role as enum ('Brygadzista', 'Pracownik');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type leave_status as enum ('oczekujący', 'zatwierdzony', 'odrzucony', 'anulowany');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type leave_type as enum ('wypoczynkowy', 'na_zadanie', 'L4', 'okolicznościowy', 'bezpłatny');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type material_category as enum ('technologiczny', 'pomocniczy');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type order_header_status as enum ('robocze', 'zamówione', 'przyjęte', 'anulowane');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type order_status as enum ('do realizacji', 'zamówione', 'dostarczone');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type report_status as enum ('roboczy', 'oczekuje_na_synchronizacje', 'submitted', 'do_poprawy', 'approved', 'konflikt');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type return_decision as enum ('zwrot', 'wyrzucenie');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type stock_movement_type as enum ('wydanie', 'zuzycie', 'zwrot', 'korekta');
exception when duplicate_object then null;
end $$;


-- Sequences (referenced by column defaults below)

create sequence if not exists "build_material_lots_id_seq";

create sequence if not exists "build_material_plan_id_seq";

create sequence if not exists "build_material_returns_id_seq";

create sequence if not exists "build_photos_id_seq";

create sequence if not exists "builds_id_seq";

create sequence if not exists "employees_id_seq";

create sequence if not exists "leave_requests_id_seq";

create sequence if not exists "material_batches_id_seq";

create sequence if not exists "material_orders_id_seq";

create sequence if not exists "materials_id_seq";

create sequence if not exists "order_items_id_seq";

create sequence if not exists "orders_id_seq";

create sequence if not exists "push_tokens_id_seq";

create sequence if not exists "report_extra_costs_id_seq";

create sequence if not exists "report_material_lots_id_seq";

create sequence if not exists "report_materials_id_seq";

create sequence if not exists "reports_id_seq";

create sequence if not exists "stock_movements_id_seq";

create sequence if not exists "teams_id_seq";

create sequence if not exists "technologies_id_seq";

create sequence if not exists "technology_materials_id_seq";

create sequence if not exists "technology_stages_id_seq";

create sequence if not exists "time_entries_id_seq";

create sequence if not exists "web_push_subscriptions_id_seq";


-- Tables

create table if not exists "build_material_lots" (
  "id" integer default nextval('build_material_lots_id_seq'::regclass) not null,
  "buildId" integer not null,
  "materialId" integer not null,
  "sourceBatchId" integer,
  "quantity" numeric not null,
  "unitPrice" numeric not null,
  "issuedAt" timestamp without time zone default now() not null
);

create table if not exists "build_material_plan" (
  "id" integer default nextval('build_material_plan_id_seq'::regclass) not null,
  "build_id" integer not null,
  "stage_name" text not null,
  "material_name" text not null,
  "unit" text not null,
  "consumption_per_m2" numeric not null,
  "planned_quantity" numeric not null,
  "linked_material_id" integer
);

create table if not exists "build_material_returns" (
  "id" integer default nextval('build_material_returns_id_seq'::regclass) not null,
  "buildId" integer not null,
  "materialId" integer not null,
  "batchId" integer,
  "quantity" numeric not null,
  "decision" return_decision not null,
  "reason" text,
  "createdAt" timestamp without time zone default now() not null,
  "unitPrice" numeric default 0 not null
);

create table if not exists "build_materials" (
  "buildId" integer not null,
  "materialId" integer not null,
  "planned" numeric default 0 not null,
  "used" numeric default 0 not null,
  "unitPrice" numeric default 0 not null,
  "issued" numeric default 0 not null,
  "actualCost" numeric default 0 not null
);

create table if not exists "build_photos" (
  "id" integer default nextval('build_photos_id_seq'::regclass) not null,
  "buildId" integer not null,
  "uploadedByName" text not null,
  "driveFileId" text not null,
  "driveFileUrl" text not null,
  "driveFolderName" text not null,
  "createdAt" timestamp without time zone default now() not null
);

create table if not exists "build_settlement_materials" (
  "buildId" integer not null,
  "materialId" integer not null,
  "planned" numeric not null,
  "used" numeric not null,
  "unitPrice" numeric not null,
  "actualCost" numeric not null,
  "issuedUnaccounted" numeric default 0 not null
);

create table if not exists "build_settlements" (
  "buildId" integer not null,
  "closedAt" timestamp without time zone default now() not null,
  "totalHours" numeric default 0 not null,
  "totalExtraCosts" numeric default 0 not null,
  "materialsCost" numeric default 0 not null,
  "laborCost" numeric default 0 not null,
  "totalCost" numeric default 0 not null,
  "wasteCost" numeric default 0 not null
);

create table if not exists "build_stage_status" (
  "build_id" integer not null,
  "stage_name" text not null,
  "completedAt" timestamp without time zone default now() not null,
  "completedBy" uuid
);

create table if not exists "build_technology_snapshot" (
  "build_id" integer not null,
  "source_technology_id" integer,
  "technology_code" text not null,
  "technology_name" text not null,
  "technology_version" integer not null,
  "snapshot_json" jsonb not null,
  "createdAt" timestamp without time zone default now() not null
);

create table if not exists "builds" (
  "id" integer default nextval('builds_id_seq'::regclass) not null,
  "number" character varying not null,
  "name" text not null,
  "manager" text,
  "startDate" date not null,
  "durationDays" integer not null,
  "status" build_status default 'aktywna'::build_status not null,
  "createdAt" timestamp without time zone default now() not null,
  "updatedAt" timestamp without time zone default now() not null,
  "photosUrl" text,
  "teamId" integer,
  "clientName" text,
  "address" text,
  "areaM2" numeric,
  "contractValue" numeric,
  "drive_folder_id" text,
  "plannedHoursPerDay" numeric default 8 not null,
  "public_token" uuid default gen_random_uuid(),
  "public_access_enabled" boolean default false not null,
  "public_pin_hash" text,
  "show_contract_value_to_client" boolean default false not null,
  "show_photos_to_client" boolean default false not null,
  "show_notes_to_client" boolean default false not null,
  "ai_client_summary" text,
  "ai_client_summary_generated_at" timestamp with time zone,
  "allow_client_ai_summary" boolean default false not null
);

create table if not exists "employees" (
  "id" integer default nextval('employees_id_seq'::regclass) not null,
  "name" text not null,
  "role" employee_role default 'Pracownik'::employee_role not null,
  "hourlyRate" numeric default 0 not null,
  "userId" integer,
  "active" boolean default true not null,
  "createdAt" timestamp without time zone default now() not null,
  "updatedAt" timestamp without time zone default now() not null,
  "costRate" numeric,
  "leaveDaysPerYear" integer default 26 not null
);

create table if not exists "leave_requests" (
  "id" integer default nextval('leave_requests_id_seq'::regclass) not null,
  "employeeId" integer not null,
  "type" leave_type not null,
  "dateFrom" date not null,
  "dateTo" date not null,
  "businessDays" integer not null,
  "status" leave_status default 'oczekujący'::leave_status not null,
  "note" text,
  "decidedBy" integer,
  "decidedAt" timestamp without time zone,
  "createdAt" timestamp without time zone default now() not null,
  "updatedAt" timestamp without time zone default now() not null
);

create table if not exists "material_batches" (
  "id" integer default nextval('material_batches_id_seq'::regclass) not null,
  "materialId" integer not null,
  "quantity" numeric not null,
  "unitPrice" numeric not null,
  "receivedAt" date not null,
  "source" batch_source default 'zamówienie'::batch_source not null,
  "createdAt" timestamp without time zone default now() not null,
  "documentNumber" text,
  "supplier" text
);

create table if not exists "material_orders" (
  "id" integer default nextval('material_orders_id_seq'::regclass) not null,
  "materialId" integer,
  "materialName" text not null,
  "quantity" numeric not null,
  "unit" character varying default 'szt.'::character varying not null,
  "status" order_status default 'do realizacji'::order_status not null,
  "createdAt" timestamp without time zone default now() not null,
  "orderedAt" timestamp without time zone,
  "receivedQuantity" numeric,
  "receivedAt" timestamp without time zone,
  "receivedUnitPrice" numeric,
  "batchId" character varying,
  "new_material_min" numeric,
  "new_material_index" text
);

create table if not exists "materials" (
  "id" integer default nextval('materials_id_seq'::regclass) not null,
  "name" text not null,
  "index" character varying not null,
  "unit" character varying default 'szt.'::character varying not null,
  "stock" numeric default 0 not null,
  "min" numeric default 0 not null,
  "unitPrice" numeric default 0 not null,
  "createdAt" timestamp without time zone default now() not null,
  "updatedAt" timestamp without time zone default now() not null,
  "category" material_category default 'pomocniczy'::material_category not null,
  "active" boolean default true not null
);

create table if not exists "order_items" (
  "id" integer default nextval('order_items_id_seq'::regclass) not null,
  "order_id" integer not null,
  "material_name" text not null,
  "linked_material_id" integer,
  "planned_quantity" numeric default 0 not null,
  "ordered_quantity" numeric default 0 not null,
  "unit" text default 'kg'::text not null,
  "received_quantity" numeric,
  "received_unit_price" numeric,
  "available_free_quantity" numeric default 0 not null
);

create table if not exists "orders" (
  "id" integer default nextval('orders_id_seq'::regclass) not null,
  "build_id" integer not null,
  "order_number" text not null,
  "status" order_header_status default 'robocze'::order_header_status not null,
  "notes" text,
  "createdAt" timestamp without time zone default now() not null,
  "createdBy" uuid
);

create table if not exists "profiles" (
  "id" uuid not null,
  "role" app_role default 'Pracownik'::app_role not null,
  "employeeId" integer,
  "createdAt" timestamp without time zone default now() not null
);

create table if not exists "push_tokens" (
  "id" integer default nextval('push_tokens_id_seq'::regclass) not null,
  "profile_id" uuid not null,
  "token" text not null,
  "platform" text,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "report_extra_costs" (
  "id" integer default nextval('report_extra_costs_id_seq'::regclass) not null,
  "reportId" integer not null,
  "label" text not null,
  "amount" numeric not null,
  "note" text,
  "category" text
);

create table if not exists "report_material_lots" (
  "id" integer default nextval('report_material_lots_id_seq'::regclass) not null,
  "reportId" integer not null,
  "materialId" integer not null,
  "lotId" integer,
  "sourceBatchId" integer,
  "quantity" numeric not null,
  "unitPrice" numeric not null,
  "createdAt" timestamp without time zone default now() not null,
  "reversalOfId" integer,
  "stage_name" text
);

create table if not exists "report_materials" (
  "reportId" integer not null,
  "materialId" integer not null,
  "usedQuantity" numeric default 0 not null,
  "cost" numeric default 0 not null,
  "reason" text,
  "needsReview" boolean default false not null,
  "stage_name" text,
  "id" integer default nextval('report_materials_id_seq'::regclass) not null
);

create table if not exists "report_people" (
  "reportId" integer not null,
  "employeeId" integer not null,
  "start" time without time zone not null,
  "end" time without time zone not null,
  "confirmedByEmployee" boolean default false not null
);

create table if not exists "reports" (
  "id" integer default nextval('reports_id_seq'::regclass) not null,
  "buildId" integer not null,
  "date" date not null,
  "status" report_status default 'submitted'::report_status not null,
  "adminComment" text,
  "createdAt" timestamp without time zone default now() not null,
  "updatedAt" timestamp without time zone default now() not null,
  "km" numeric,
  "kmRateApplied" numeric,
  "kmCost" numeric,
  "submittedByProfileId" uuid,
  "note" text,
  "client_note" text,
  "client_note_generated_at" timestamp with time zone
);

create table if not exists "settings" (
  "id" boolean default true not null,
  "km_rate" numeric default 0 not null,
  "updatedAt" timestamp without time zone default now() not null,
  "close_build_pin" text
);

create table if not exists "stock_movements" (
  "id" integer default nextval('stock_movements_id_seq'::regclass) not null,
  "type" text not null,
  "materialId" integer not null,
  "buildId" integer,
  "batchId" integer,
  "lotId" integer,
  "reportId" integer,
  "quantity" numeric not null,
  "unitPrice" numeric not null,
  "note" text,
  "createdByUserId" integer,
  "createdAt" timestamp without time zone default now() not null,
  "createdByProfileId" text
);

create table if not exists "team_members" (
  "team_id" integer not null,
  "employee_id" integer not null,
  "createdAt" timestamp without time zone default now() not null
);

create table if not exists "teams" (
  "id" integer default nextval('teams_id_seq'::regclass) not null,
  "name" text not null,
  "leadEmployeeId" integer,
  "active" boolean default true not null,
  "createdAt" timestamp without time zone default now() not null,
  "updatedAt" timestamp without time zone default now() not null
);

create table if not exists "technologies" (
  "id" integer default nextval('technologies_id_seq'::regclass) not null,
  "code" text not null,
  "name" text not null,
  "version" integer default 1 not null,
  "is_active" boolean default true not null,
  "createdAt" timestamp without time zone default now() not null,
  "createdBy" uuid,
  "company" text,
  "thickness_min_mm" numeric,
  "thickness_max_mm" numeric
);

create table if not exists "technology_materials" (
  "id" integer default nextval('technology_materials_id_seq'::regclass) not null,
  "stage_id" integer not null,
  "material_name" text not null,
  "unit" text default 'kg'::text not null,
  "consumption_per_m2" numeric not null,
  "linked_material_id" integer
);

create table if not exists "technology_stages" (
  "id" integer default nextval('technology_stages_id_seq'::regclass) not null,
  "technology_id" integer not null,
  "name" text not null,
  "order_index" integer default 0 not null
);

create table if not exists "time_entries" (
  "id" integer default nextval('time_entries_id_seq'::regclass) not null,
  "date" date not null,
  "buildId" integer not null,
  "employeeId" integer not null,
  "hours" numeric not null,
  "start" time without time zone,
  "end" time without time zone,
  "hourlyRate" numeric,
  "costRate" numeric
);

create table if not exists "web_push_subscriptions" (
  "id" integer default nextval('web_push_subscriptions_id_seq'::regclass) not null,
  "profile_id" uuid not null,
  "endpoint" text not null,
  "p256dh" text not null,
  "auth" text not null,
  "created_at" timestamp with time zone default now() not null
);


-- Constraints: PRIMARY KEY / UNIQUE / CHECK first

alter table build_material_lots add constraint "build_material_lots_pkey" PRIMARY KEY (id);

alter table build_material_plan add constraint "build_material_plan_pkey" PRIMARY KEY (id);

alter table build_material_returns add constraint "build_material_returns_pkey" PRIMARY KEY (id);

alter table build_materials add constraint "build_materials_pkey" PRIMARY KEY ("buildId", "materialId");

alter table build_photos add constraint "build_photos_pkey" PRIMARY KEY (id);

alter table build_settlement_materials add constraint "build_settlement_materials_pkey" PRIMARY KEY ("buildId", "materialId");

alter table build_settlements add constraint "build_settlements_pkey" PRIMARY KEY ("buildId");

alter table build_stage_status add constraint "build_stage_status_pkey" PRIMARY KEY (build_id, stage_name);

alter table build_technology_snapshot add constraint "build_technology_snapshot_pkey" PRIMARY KEY (build_id);

alter table builds add constraint "builds_pkey" PRIMARY KEY (id);

alter table builds add constraint "builds_number_key" UNIQUE (number);

alter table builds add constraint "builds_public_token_key" UNIQUE (public_token);

alter table employees add constraint "employees_pkey" PRIMARY KEY (id);

alter table leave_requests add constraint "leave_requests_businessDays_check" CHECK (("businessDays" > 0));

alter table leave_requests add constraint "leave_requests_date_order" CHECK (("dateTo" >= "dateFrom"));

alter table leave_requests add constraint "leave_requests_pkey" PRIMARY KEY (id);

alter table material_batches add constraint "material_batches_pkey" PRIMARY KEY (id);

alter table material_orders add constraint "material_orders_pkey" PRIMARY KEY (id);

alter table materials add constraint "materials_pkey" PRIMARY KEY (id);

alter table materials add constraint "materials_index_key" UNIQUE (index);

alter table order_items add constraint "order_items_pkey" PRIMARY KEY (id);

alter table orders add constraint "orders_pkey" PRIMARY KEY (id);

alter table orders add constraint "orders_order_number_key" UNIQUE (order_number);

alter table profiles add constraint "profiles_pkey" PRIMARY KEY (id);

alter table push_tokens add constraint "push_tokens_pkey" PRIMARY KEY (id);

alter table push_tokens add constraint "push_tokens_token_key" UNIQUE (token);

alter table report_extra_costs add constraint "report_extra_costs_pkey" PRIMARY KEY (id);

alter table report_material_lots add constraint "report_material_lots_pkey" PRIMARY KEY (id);

alter table report_materials add constraint "report_materials_pkey" PRIMARY KEY (id);

alter table report_people add constraint "report_people_pkey" PRIMARY KEY ("reportId", "employeeId");

alter table reports add constraint "reports_pkey" PRIMARY KEY (id);

alter table reports add constraint "reports_build_date_key" UNIQUE ("buildId", date);

alter table settings add constraint "settings_singleton" CHECK (id);

alter table settings add constraint "settings_pkey" PRIMARY KEY (id);

alter table stock_movements add constraint "stock_movements_type_check" CHECK ((type = ANY (ARRAY['przyjecie'::text, 'wydanie'::text, 'zuzycie'::text, 'zwrot'::text, 'korekta'::text])));

alter table stock_movements add constraint "stock_movements_pkey" PRIMARY KEY (id);

alter table team_members add constraint "team_members_pkey" PRIMARY KEY (team_id, employee_id);

alter table teams add constraint "teams_pkey" PRIMARY KEY (id);

alter table technologies add constraint "technologies_pkey" PRIMARY KEY (id);

alter table technologies add constraint "technologies_code_version_key" UNIQUE (code, version);

alter table technology_materials add constraint "technology_materials_pkey" PRIMARY KEY (id);

alter table technology_stages add constraint "technology_stages_pkey" PRIMARY KEY (id);

alter table time_entries add constraint "time_entries_pkey" PRIMARY KEY (id);

alter table time_entries add constraint "time_entries_date_buildId_employeeId_key" UNIQUE (date, "buildId", "employeeId");

alter table web_push_subscriptions add constraint "web_push_subscriptions_pkey" PRIMARY KEY (id);

alter table web_push_subscriptions add constraint "web_push_subscriptions_endpoint_key" UNIQUE (endpoint);


-- Constraints: FOREIGN KEY (after all PK/UNIQUE above exist)

alter table build_material_lots add constraint "build_material_lots_sourceBatchId_fkey" FOREIGN KEY ("sourceBatchId") REFERENCES material_batches(id) ON DELETE SET NULL;

alter table build_material_lots add constraint "build_material_lots_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES materials(id) ON DELETE RESTRICT;

alter table build_material_lots add constraint "build_material_lots_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES builds(id) ON DELETE CASCADE;

alter table build_material_plan add constraint "build_material_plan_linked_material_id_fkey" FOREIGN KEY (linked_material_id) REFERENCES materials(id) ON DELETE SET NULL;

alter table build_material_plan add constraint "build_material_plan_build_id_fkey" FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE;

alter table build_material_returns add constraint "build_material_returns_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES material_batches(id) ON DELETE SET NULL;

alter table build_material_returns add constraint "build_material_returns_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES builds(id) ON DELETE CASCADE;

alter table build_material_returns add constraint "build_material_returns_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES materials(id) ON DELETE RESTRICT;

alter table build_materials add constraint "build_materials_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES builds(id) ON DELETE CASCADE;

alter table build_materials add constraint "build_materials_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES materials(id) ON DELETE RESTRICT;

alter table build_photos add constraint "build_photos_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES builds(id) ON DELETE CASCADE;

alter table build_settlement_materials add constraint "build_settlement_materials_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES build_settlements("buildId") ON DELETE CASCADE;

alter table build_settlement_materials add constraint "build_settlement_materials_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES materials(id) ON DELETE RESTRICT;

alter table build_settlements add constraint "build_settlements_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES builds(id) ON DELETE CASCADE;

alter table build_stage_status add constraint "build_stage_status_completedBy_fkey" FOREIGN KEY ("completedBy") REFERENCES auth.users(id) ON DELETE SET NULL;

alter table build_stage_status add constraint "build_stage_status_build_id_fkey" FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE;

alter table build_technology_snapshot add constraint "build_technology_snapshot_build_id_fkey" FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE;

alter table build_technology_snapshot add constraint "build_technology_snapshot_source_technology_id_fkey" FOREIGN KEY (source_technology_id) REFERENCES technologies(id) ON DELETE SET NULL;

alter table builds add constraint "builds_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES teams(id) ON DELETE SET NULL;

alter table leave_requests add constraint "leave_requests_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES employees(id) ON DELETE SET NULL;

alter table leave_requests add constraint "leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES employees(id) ON DELETE CASCADE;

alter table material_batches add constraint "material_batches_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES materials(id) ON DELETE CASCADE;

alter table material_orders add constraint "material_orders_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES materials(id) ON DELETE SET NULL;

alter table order_items add constraint "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

alter table order_items add constraint "order_items_linked_material_id_fkey" FOREIGN KEY (linked_material_id) REFERENCES materials(id) ON DELETE SET NULL;

alter table orders add constraint "orders_build_id_fkey" FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE;

alter table orders add constraint "orders_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES auth.users(id) ON DELETE SET NULL;

alter table profiles add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table profiles add constraint "profiles_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES employees(id) ON DELETE SET NULL;

alter table push_tokens add constraint "push_tokens_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table report_extra_costs add constraint "report_extra_costs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES reports(id) ON DELETE CASCADE;

alter table report_material_lots add constraint "report_material_lots_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES reports(id) ON DELETE CASCADE;

alter table report_material_lots add constraint "report_material_lots_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES materials(id) ON DELETE RESTRICT;

alter table report_material_lots add constraint "report_material_lots_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES report_material_lots(id) ON DELETE SET NULL;

alter table report_material_lots add constraint "report_material_lots_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES build_material_lots(id) ON DELETE SET NULL;

alter table report_material_lots add constraint "report_material_lots_sourceBatchId_fkey" FOREIGN KEY ("sourceBatchId") REFERENCES material_batches(id) ON DELETE SET NULL;

alter table report_materials add constraint "report_materials_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES materials(id) ON DELETE RESTRICT;

alter table report_materials add constraint "report_materials_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES reports(id) ON DELETE CASCADE;

alter table report_people add constraint "report_people_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES reports(id) ON DELETE CASCADE;

alter table report_people add constraint "report_people_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES employees(id) ON DELETE RESTRICT;

alter table reports add constraint "reports_submittedByProfileId_fkey" FOREIGN KEY ("submittedByProfileId") REFERENCES profiles(id) ON DELETE SET NULL;

alter table reports add constraint "reports_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES builds(id) ON DELETE RESTRICT;

alter table stock_movements add constraint "stock_movements_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES reports(id) ON DELETE SET NULL;

alter table stock_movements add constraint "stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES material_batches(id) ON DELETE SET NULL;

alter table stock_movements add constraint "stock_movements_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES builds(id) ON DELETE RESTRICT;

alter table stock_movements add constraint "stock_movements_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES materials(id) ON DELETE RESTRICT;

alter table stock_movements add constraint "stock_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES build_material_lots(id) ON DELETE SET NULL;

alter table team_members add constraint "team_members_team_id_fkey" FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

alter table team_members add constraint "team_members_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table teams add constraint "teams_leadEmployeeId_fkey" FOREIGN KEY ("leadEmployeeId") REFERENCES employees(id) ON DELETE SET NULL;

alter table technologies add constraint "technologies_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES profiles(id) ON DELETE SET NULL;

alter table technology_materials add constraint "technology_materials_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES technology_stages(id) ON DELETE CASCADE;

alter table technology_materials add constraint "technology_materials_linked_material_id_fkey" FOREIGN KEY (linked_material_id) REFERENCES materials(id) ON DELETE SET NULL;

alter table technology_stages add constraint "technology_stages_technology_id_fkey" FOREIGN KEY (technology_id) REFERENCES technologies(id) ON DELETE CASCADE;

alter table time_entries add constraint "time_entries_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES builds(id) ON DELETE CASCADE;

alter table time_entries add constraint "time_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES employees(id) ON DELETE RESTRICT;

alter table web_push_subscriptions add constraint "web_push_subscriptions_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;


-- Indexes (excluding those Postgres already created for PK/UNIQUE constraints above)

CREATE INDEX build_material_lots_build_material_batch_idx ON public.build_material_lots USING btree ("buildId", "materialId", "sourceBatchId");

CREATE INDEX build_material_plan_build_idx ON public.build_material_plan USING btree (build_id);

CREATE INDEX leave_requests_employee_idx ON public.leave_requests USING btree ("employeeId");

CREATE INDEX "material_batches_materialId_idx" ON public.material_batches USING btree ("materialId");

CREATE INDEX material_batches_material_received_idx ON public.material_batches USING btree ("materialId", "receivedAt");

CREATE INDEX material_orders_batch_id_idx ON public.material_orders USING btree ("batchId");

CREATE INDEX order_items_order_id_idx ON public.order_items USING btree (order_id);

CREATE INDEX orders_build_id_idx ON public.orders USING btree (build_id);

CREATE INDEX push_tokens_profile_id_idx ON public.push_tokens USING btree (profile_id);

CREATE INDEX "report_extra_costs_reportId_idx" ON public.report_extra_costs USING btree ("reportId");

CREATE INDEX report_extra_costs_report_idx ON public.report_extra_costs USING btree ("reportId");

CREATE UNIQUE INDEX report_materials_report_material_stage_uq ON public.report_materials USING btree ("reportId", "materialId", stage_name) NULLS NOT DISTINCT;

CREATE INDEX "reports_buildId_idx" ON public.reports USING btree ("buildId");

CREATE INDEX reports_date_idx ON public.reports USING btree (date);

CREATE INDEX technology_materials_stage_idx ON public.technology_materials USING btree (stage_id);

CREATE INDEX technology_stages_technology_idx ON public.technology_stages USING btree (technology_id);

CREATE INDEX time_entries_build_idx ON public.time_entries USING btree ("buildId");

CREATE INDEX "time_entries_employeeId_idx" ON public.time_entries USING btree ("employeeId");

CREATE INDEX time_entries_employee_idx ON public.time_entries USING btree ("employeeId");

CREATE INDEX web_push_subscriptions_profile_id_idx ON public.web_push_subscriptions USING btree (profile_id);


-- Row Level Security: enable on every table

alter table "build_material_lots" enable row level security;

alter table "build_material_plan" enable row level security;

alter table "build_material_returns" enable row level security;

alter table "build_materials" enable row level security;

alter table "build_photos" enable row level security;

alter table "build_settlement_materials" enable row level security;

alter table "build_settlements" enable row level security;

alter table "build_stage_status" enable row level security;

alter table "build_technology_snapshot" enable row level security;

alter table "builds" enable row level security;

alter table "employees" enable row level security;

alter table "leave_requests" enable row level security;

alter table "material_batches" enable row level security;

alter table "material_orders" enable row level security;

alter table "materials" enable row level security;

alter table "order_items" enable row level security;

alter table "orders" enable row level security;

alter table "profiles" enable row level security;

alter table "push_tokens" enable row level security;

alter table "report_extra_costs" enable row level security;

alter table "report_material_lots" enable row level security;

alter table "report_materials" enable row level security;

alter table "report_people" enable row level security;

alter table "reports" enable row level security;

alter table "settings" enable row level security;

alter table "stock_movements" enable row level security;

alter table "team_members" enable row level security;

alter table "teams" enable row level security;

alter table "technologies" enable row level security;

alter table "technology_materials" enable row level security;

alter table "technology_stages" enable row level security;

alter table "time_entries" enable row level security;

alter table "web_push_subscriptions" enable row level security;


-- Row Level Security: policies

drop policy if exists "select_authenticated" on "build_material_lots";
create policy "select_authenticated" on "build_material_lots" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "build_material_plan";
create policy "select_authenticated" on "build_material_plan" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "build_material_returns";
create policy "select_authenticated" on "build_material_returns" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "build_materials";
create policy "select_authenticated" on "build_materials" for SELECT to authenticated using (true);

drop policy if exists "build_photos_select_authenticated" on "build_photos";
create policy "build_photos_select_authenticated" on "build_photos" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "build_settlement_materials";
create policy "select_authenticated" on "build_settlement_materials" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "build_settlements";
create policy "select_authenticated" on "build_settlements" for SELECT to authenticated using (true);

drop policy if exists "build_stage_status_write" on "build_stage_status";
create policy "build_stage_status_write" on "build_stage_status" for ALL to authenticated using ((app_role() = ANY (ARRAY['Admin'::app_role, 'Brygadzista'::app_role]))) with check ((app_role() = ANY (ARRAY['Admin'::app_role, 'Brygadzista'::app_role])));

drop policy if exists "select_authenticated" on "build_stage_status";
create policy "select_authenticated" on "build_stage_status" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "build_technology_snapshot";
create policy "select_authenticated" on "build_technology_snapshot" for SELECT to authenticated using (true);

drop policy if exists "builds_insert_admin" on "builds";
create policy "builds_insert_admin" on "builds" for INSERT to authenticated with check ((app_role() = 'Admin'::app_role));

drop policy if exists "builds_update_admin_brygadzista" on "builds";
create policy "builds_update_admin_brygadzista" on "builds" for UPDATE to authenticated using ((app_role() = ANY (ARRAY['Admin'::app_role, 'Brygadzista'::app_role]))) with check ((app_role() = ANY (ARRAY['Admin'::app_role, 'Brygadzista'::app_role])));

drop policy if exists "select_authenticated" on "builds";
create policy "select_authenticated" on "builds" for SELECT to authenticated using (true);

drop policy if exists "employees_write_admin" on "employees";
create policy "employees_write_admin" on "employees" for ALL to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "employees";
create policy "select_authenticated" on "employees" for SELECT to authenticated using (true);

drop policy if exists "select_leave_requests" on "leave_requests";
create policy "select_leave_requests" on "leave_requests" for SELECT to authenticated using (((app_role() = ANY (ARRAY['Admin'::app_role, 'Brygadzista'::app_role])) OR ("employeeId" = ( SELECT profiles."employeeId"
   FROM profiles
  WHERE (profiles.id = auth.uid())))));

drop policy if exists "select_authenticated" on "material_batches";
create policy "select_authenticated" on "material_batches" for SELECT to authenticated using (true);

drop policy if exists "orders_update_admin" on "material_orders";
create policy "orders_update_admin" on "material_orders" for UPDATE to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "orders_write_admin" on "material_orders";
create policy "orders_write_admin" on "material_orders" for INSERT to authenticated with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "material_orders";
create policy "select_authenticated" on "material_orders" for SELECT to authenticated using (true);

drop policy if exists "materials_write_admin" on "materials";
create policy "materials_write_admin" on "materials" for UPDATE to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "materials";
create policy "select_authenticated" on "materials" for SELECT to authenticated using (true);

drop policy if exists "order_items_update_admin" on "order_items";
create policy "order_items_update_admin" on "order_items" for UPDATE to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "order_items";
create policy "select_authenticated" on "order_items" for SELECT to authenticated using (true);

drop policy if exists "orders_update_admin" on "orders";
create policy "orders_update_admin" on "orders" for UPDATE to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "orders";
create policy "select_authenticated" on "orders" for SELECT to authenticated using (true);

drop policy if exists "profiles_admin_all" on "profiles";
create policy "profiles_admin_all" on "profiles" for ALL to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "profiles_select_own" on "profiles";
create policy "profiles_select_own" on "profiles" for SELECT to authenticated using ((id = auth.uid()));

drop policy if exists "push_tokens_own_delete" on "push_tokens";
create policy "push_tokens_own_delete" on "push_tokens" for DELETE to authenticated using ((profile_id = auth.uid()));

drop policy if exists "push_tokens_own_select" on "push_tokens";
create policy "push_tokens_own_select" on "push_tokens" for SELECT to authenticated using ((profile_id = auth.uid()));

drop policy if exists "select_authenticated" on "report_extra_costs";
create policy "select_authenticated" on "report_extra_costs" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "report_material_lots";
create policy "select_authenticated" on "report_material_lots" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "report_materials";
create policy "select_authenticated" on "report_materials" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "report_people";
create policy "select_authenticated" on "report_people" for SELECT to authenticated using (true);

drop policy if exists "reports_update_admin" on "reports";
create policy "reports_update_admin" on "reports" for UPDATE to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "reports";
create policy "select_authenticated" on "reports" for SELECT to authenticated using (true);

drop policy if exists "settings_select_authenticated" on "settings";
create policy "settings_select_authenticated" on "settings" for SELECT to authenticated using (true);

drop policy if exists "settings_update_admin" on "settings";
create policy "settings_update_admin" on "settings" for UPDATE to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "stock_movements";
create policy "select_authenticated" on "stock_movements" for SELECT to authenticated using (true);

drop policy if exists "select_authenticated" on "team_members";
create policy "select_authenticated" on "team_members" for SELECT to authenticated using (true);

drop policy if exists "team_members_write_admin" on "team_members";
create policy "team_members_write_admin" on "team_members" for ALL to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "teams";
create policy "select_authenticated" on "teams" for SELECT to authenticated using (true);

drop policy if exists "teams_write_admin" on "teams";
create policy "teams_write_admin" on "teams" for ALL to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "technologies";
create policy "select_authenticated" on "technologies" for SELECT to authenticated using (true);

drop policy if exists "write_admin" on "technologies";
create policy "write_admin" on "technologies" for ALL to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "technology_materials";
create policy "select_authenticated" on "technology_materials" for SELECT to authenticated using (true);

drop policy if exists "write_admin" on "technology_materials";
create policy "write_admin" on "technology_materials" for ALL to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_authenticated" on "technology_stages";
create policy "select_authenticated" on "technology_stages" for SELECT to authenticated using (true);

drop policy if exists "write_admin" on "technology_stages";
create policy "write_admin" on "technology_stages" for ALL to authenticated using ((app_role() = 'Admin'::app_role)) with check ((app_role() = 'Admin'::app_role));

drop policy if exists "select_time_entries" on "time_entries";
create policy "select_time_entries" on "time_entries" for SELECT to authenticated using (((app_role() = ANY (ARRAY['Admin'::app_role, 'Brygadzista'::app_role])) OR ("employeeId" = ( SELECT profiles."employeeId"
   FROM profiles
  WHERE (profiles.id = auth.uid())))));

drop policy if exists "web_push_subscriptions_own_delete" on "web_push_subscriptions";
create policy "web_push_subscriptions_own_delete" on "web_push_subscriptions" for DELETE to authenticated using ((profile_id = auth.uid()));

drop policy if exists "web_push_subscriptions_own_select" on "web_push_subscriptions";
create policy "web_push_subscriptions_own_select" on "web_push_subscriptions" for SELECT to authenticated using ((profile_id = auth.uid()));


-- Functions (current state, in alphabetical order; later files 001-093
-- create-or-replace most of these to their evolved versions again,
-- which is harmless since every migration in this repo is idempotent)

CREATE OR REPLACE FUNCTION public.adjust_material_stock(p_material_id integer, p_new_stock numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_material materials;
  v_delta decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_material from materials where id = p_material_id for update;
  if not found then
    raise exception 'Nie znaleziono materiału #%.', p_material_id;
  end if;

  v_delta := p_new_stock - v_material.stock;
  if abs(v_delta) < 0.0001 then
    return;
  end if;

  if v_delta > 0 then
    perform fn_add_material_batch(p_material_id, v_delta, coalesce(v_material."unitPrice", 0), current_date, 'korekta');
  else
    perform fn_consume_fifo(p_material_id, -v_delta);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_role()
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from profiles where id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.apply_order_item_free_stock(p_order_item_id integer)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item order_items;
  v_order orders;
  v_build_status build_status;
  v_material_id integer;
  v_want decimal;
  v_remaining decimal;
  v_applied decimal := 0;
  v_row record;
  v_take decimal;
  v_avg_qty decimal;
  v_avg_value decimal;
  v_new_price decimal;
  v_fallback_price decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_item from order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'Nie znaleziono pozycji zamówienia #%.', p_order_item_id;
  end if;

  select * into v_order from orders where id = v_item.order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia dla pozycji #%.', p_order_item_id;
  end if;
  if v_order.status <> 'robocze' then
    raise exception 'Można uwzględnić wolny magazyn tylko w zamówieniu roboczym.';
  end if;

  select status into v_build_status from builds where id = v_order.build_id;
  if v_build_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przypisywać materiału.';
  end if;

  v_material_id := v_item.linked_material_id;
  if v_material_id is null then
    raise exception 'Pozycja #% nie jest powiązana z żadnym materiałem magazynowym.', p_order_item_id;
  end if;

  v_want := least(coalesce(v_item.available_free_quantity, 0), coalesce(v_item.ordered_quantity, 0));
  if v_want <= 0.0001 then
    return 0;
  end if;

  v_remaining := v_want;

  for v_row in
    select id, quantity, "unitPrice"
      from material_batches
      where "materialId" = v_material_id
      order by "receivedAt" asc, id asc
      for update
  loop
    exit when v_remaining <= 0.0001;
    v_take := least(v_row.quantity, v_remaining);
    if v_take <= 0.0001 then
      continue;
    end if;

    insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values (v_order.build_id, v_material_id, v_row.id, v_take, v_row."unitPrice", now());

    if v_row.quantity - v_take > 0.0001 then
      update material_batches set quantity = quantity - v_take where id = v_row.id;
    else
      delete from material_batches where id = v_row.id;
    end if;

    v_remaining := v_remaining - v_take;
    v_applied := v_applied + v_take;
  end loop;

  if v_applied <= 0.0001 then
    update order_items set available_free_quantity = 0 where id = p_order_item_id;
    return 0;
  end if;

  perform fn_recalc_material(v_material_id);

  select sum(quantity), sum(quantity * "unitPrice")
    into v_avg_qty, v_avg_value
    from build_material_lots
    where "buildId" = v_order.build_id and "materialId" = v_material_id;

  select "unitPrice" into v_fallback_price from materials where id = v_material_id;
  v_new_price := case when v_avg_qty > 0 then v_avg_value / v_avg_qty else coalesce(v_fallback_price, 0) end;

  insert into build_materials ("buildId", "materialId", planned, used, "unitPrice", issued)
    values (v_order.build_id, v_material_id, v_applied, 0, v_new_price, v_applied)
    on conflict ("buildId", "materialId") do update
      set planned = build_materials.planned + excluded.planned,
          issued = build_materials.issued + excluded.issued,
          "unitPrice" = v_new_price;

  update order_items
    set ordered_quantity = greatest(0, coalesce(ordered_quantity, 0) - v_applied),
        available_free_quantity = greatest(0, coalesce(available_free_quantity, 0) - v_applied)
    where id = p_order_item_id;

  return v_applied;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assert_role(allowed app_role[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role app_role;
begin
  v_role := app_role();
  if v_role is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;
  if not (v_role = any(allowed)) then
    raise exception 'Brak uprawnień (rola: %, wymagane: %).', v_role, allowed
      using errcode = '42501';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assert_role(allowed text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_role(allowed::app_role[]);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_material_batches_to_build(p_build_id integer, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status build_status;
  v_item jsonb;
  v_batch material_batches;
  v_batch_id integer;
  v_quantity decimal;
  v_avg_qty decimal;
  v_avg_value decimal;
  v_lot_id integer;
  v_actor text := auth.uid()::text;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);

  select status into v_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przypisywać materiałów.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_batch_id := (v_item->>'batchId')::integer;
    v_quantity := (v_item->>'quantity')::decimal;
    if v_quantity is null or v_quantity <= 0 then
      continue;
    end if;

    select * into v_batch from material_batches where id = v_batch_id for update;
    if not found then
      raise exception 'Nie znaleziono partii #%.', v_batch_id;
    end if;
    if v_batch.quantity < v_quantity - 0.0001 then
      raise exception 'Za mało towaru w partii #% (dostępne %, żądane %).',
        v_batch_id, v_batch.quantity, v_quantity;
    end if;

    insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values (p_build_id, v_batch."materialId", v_batch_id, v_quantity, v_batch."unitPrice", now())
      returning id into v_lot_id;

    insert into stock_movements
        ("type", "materialId", "buildId", "batchId", "lotId", quantity, "unitPrice", "createdByProfileId")
      values ('wydanie', v_batch."materialId", p_build_id, v_batch_id, v_lot_id, v_quantity, v_batch."unitPrice", v_actor);

    if v_batch.quantity - v_quantity > 0.0001 then
      update material_batches set quantity = quantity - v_quantity where id = v_batch_id;
    else
      delete from material_batches where id = v_batch_id;
    end if;
    perform fn_recalc_material(v_batch."materialId");

    select sum(quantity), sum(quantity * "unitPrice")
      into v_avg_qty, v_avg_value
      from build_material_lots
      where "buildId" = p_build_id and "materialId" = v_batch."materialId";

    insert into build_materials ("buildId", "materialId", planned, used, "unitPrice", issued)
      values (p_build_id, v_batch."materialId", v_quantity, 0, v_batch."unitPrice", v_quantity)
      on conflict ("buildId", "materialId") do update
        set planned = build_materials.planned + excluded.planned,
            issued = build_materials.issued + excluded.issued,
            "unitPrice" = case when v_avg_qty > 0 then v_avg_value / v_avg_qty else build_materials."unitPrice" end;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_technology_to_build(p_build_id integer, p_technology_id integer, p_area_m2 numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tech technologies%rowtype;
  v_snapshot jsonb;
begin
  perform assert_role(array['Admin']::app_role[]);

  if p_area_m2 is null or p_area_m2 <= 0 then
    raise exception 'Powierzchnia (m²) musi być większa od zera.';
  end if;

  select * into v_tech from technologies where id = p_technology_id;
  if v_tech.id is null then
    raise exception 'Technologia o id % nie istnieje.', p_technology_id;
  end if;

  update builds set "areaM2" = p_area_m2 where id = p_build_id;

  select jsonb_agg(
    jsonb_build_object(
      'stageName', s.name,
      'orderIndex', s.order_index,
      'materials', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'materialName', m.material_name,
            'unit', m.unit,
            'consumptionPerM2', m.consumption_per_m2,
            'linkedMaterialId', m.linked_material_id
          ) order by m.id
        ), '[]'::jsonb)
        from technology_materials m
        where m.stage_id = s.id
      )
    ) order by s.order_index
  )
  into v_snapshot
  from technology_stages s
  where s.technology_id = p_technology_id;

  delete from build_technology_snapshot where build_id = p_build_id;
  insert into build_technology_snapshot (
    build_id, source_technology_id, technology_code, technology_name,
    technology_version, snapshot_json
  )
  values (
    p_build_id, v_tech.id, v_tech.code, v_tech.name, v_tech.version,
    coalesce(v_snapshot, '[]'::jsonb)
  );

  delete from build_material_plan where build_id = p_build_id;
  insert into build_material_plan (
    build_id, stage_name, material_name, unit, consumption_per_m2,
    planned_quantity, linked_material_id
  )
  select
    p_build_id,
    s.name,
    m.material_name,
    m.unit,
    m.consumption_per_m2,
    round(m.consumption_per_m2 * p_area_m2, 3),
    m.linked_material_id
  from technology_stages s
  join technology_materials m on m.stage_id = s.id
  where s.technology_id = p_technology_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_request_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee_id integer;
begin
  select "employeeId" into v_employee_id from profiles where id = auth.uid();

  update leave_requests
  set status = 'anulowany', "updatedAt" = now()
  where id = p_request_id
    and status = 'oczekujący'
    and "employeeId" = v_employee_id;

  if not found then
    raise exception 'Wniosek nie istnieje, nie należy do Ciebie lub został już rozpatrzony.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_build(p_build_id integer, p_returns jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_build builds;
  v_pending_count integer;
  v_total_hours decimal;
  v_labor_cost decimal;
  v_materials_cost decimal;
  v_total_extra_costs decimal;
  v_waste_cost decimal := 0;
  v_total_cost decimal;
  v_ret jsonb;
  v_lot_id integer;
  v_material_id integer;
  v_batch_id integer;
  v_qty decimal;
  v_decision text;
  v_reason text;
  v_lot_price decimal;
  v_unresolved_list text;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_build from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build.status = 'zamknięta' then
    return;
  end if;

  select count(*) into v_pending_count from reports
    where "buildId" = p_build_id and status <> 'approved';
  if v_pending_count > 0 then
    raise exception 'Nie wszystkie raporty tej budowy są zatwierdzone — zatwierdź je przed zamknięciem.';
  end if;

  for v_ret in select * from jsonb_array_elements(p_returns)
  loop
    v_lot_id := (v_ret->>'lotId')::integer;
    v_qty := (v_ret->>'quantity')::decimal;
    v_decision := v_ret->>'decision';
    v_reason := v_ret->>'reason';

    if v_qty is null or v_qty <= 0 then
      continue;
    end if;
    if v_decision not in ('zwrot', 'wyrzucenie') then
      raise exception 'Nieprawidłowa decyzja rozliczenia partii #%: %', v_lot_id, v_decision;
    end if;

    select "materialId", "sourceBatchId" into v_material_id, v_batch_id
      from build_material_lots
      where id = v_lot_id and "buildId" = p_build_id and quantity >= v_qty - 0.0001
      for update;
    if not found then
      raise exception 'Partia #% nie istnieje na budowie #% albo ilość do rozliczenia przekracza jej pozostałość.',
        v_lot_id, p_build_id;
    end if;

    update build_material_lots set quantity = quantity - v_qty
      where id = v_lot_id
      returning "unitPrice" into v_lot_price;
    delete from build_material_lots where id = v_lot_id and quantity <= 0.0001;

    if v_decision = 'zwrot' then
      if v_batch_id is not null then
        update material_batches set quantity = quantity + v_qty where id = v_batch_id;
      else
        insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
          values (v_material_id, v_qty, v_lot_price, current_date, 'zwrot z budowy');
      end if;
      perform fn_recalc_material(v_material_id);
    else
      v_waste_cost := v_waste_cost + v_qty * v_lot_price;
    end if;

    insert into build_material_returns ("buildId", "materialId", "batchId", quantity, decision, reason, "unitPrice")
      values (p_build_id, v_material_id, v_batch_id, v_qty, v_decision::return_decision, v_reason, v_lot_price);
  end loop;

  select string_agg(
           coalesce(m.name, 'materiał #' || v_unresolved."materialId") || ': ' || round(v_unresolved.net, 3),
           ', '
         )
    into v_unresolved_list
    from (
      select "materialId", sum(quantity) as net
        from build_material_lots
        where "buildId" = p_build_id
        group by "materialId"
        having abs(sum(quantity)) > 0.0001
    ) v_unresolved
    left join materials m on m.id = v_unresolved."materialId";

  if v_unresolved_list is not null then
    raise exception 'Nie można zamknąć budowy — podmagazyn nie jest wyzerowany: %. Rozlicz zwrot/wyrzucenie (dodatnia pozostałość) albo uzupełnij przypisanie materiału (ujemny niedobór) przed zamknięciem.',
      v_unresolved_list;
  end if;

  select coalesce(sum(t.hours), 0),
         coalesce(sum(t.hours * coalesce(t."hourlyRate", e."hourlyRate", 0)), 0)
    into v_total_hours, v_labor_cost
    from time_entries t
    join employees e on e.id = t."employeeId"
    where t."buildId" = p_build_id;

  select coalesce(sum("actualCost"), 0) into v_materials_cost from build_materials
    where "buildId" = p_build_id;

  select coalesce(sum(rec.amount), 0) into v_total_extra_costs
    from report_extra_costs rec
    join reports r on r.id = rec."reportId"
    where r."buildId" = p_build_id;

  v_total_cost := v_materials_cost + v_labor_cost + v_total_extra_costs + v_waste_cost;

  insert into build_settlements (
    "buildId", "totalHours", "totalExtraCosts", "materialsCost", "laborCost", "wasteCost", "totalCost"
  ) values (
    p_build_id, v_total_hours, v_total_extra_costs, v_materials_cost, v_labor_cost, v_waste_cost, v_total_cost
  )
  on conflict ("buildId") do update set
    "closedAt" = now(),
    "totalHours" = excluded."totalHours",
    "totalExtraCosts" = excluded."totalExtraCosts",
    "materialsCost" = excluded."materialsCost",
    "laborCost" = excluded."laborCost",
    "wasteCost" = excluded."wasteCost",
    "totalCost" = excluded."totalCost";

  delete from build_settlement_materials where "buildId" = p_build_id;
  insert into build_settlement_materials ("buildId", "materialId", planned, used, "unitPrice", "actualCost")
    select "buildId", "materialId", planned, used, "unitPrice", "actualCost"
      from build_materials where "buildId" = p_build_id;

  update builds set status = 'zamknięta', "updatedAt" = now() where id = p_build_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.close_build(p_build_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_build builds;
  v_pending_count integer;
  v_total_hours decimal;
  v_labor_cost decimal;
  v_materials_cost decimal;
  v_total_extra_costs decimal;
  v_total_cost decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_build from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build.status = 'zamknięta' then
    return;
  end if;

  select count(*) into v_pending_count from reports
    where "buildId" = p_build_id and status <> 'approved';
  if v_pending_count > 0 then
    raise exception 'Nie wszystkie raporty tej budowy są zatwierdzone — zatwierdź je przed zamknięciem.';
  end if;

  select coalesce(sum(t.hours), 0), coalesce(sum(t.hours * e."hourlyRate"), 0)
    into v_total_hours, v_labor_cost
    from time_entries t
    join employees e on e.id = t."employeeId"
    where t."buildId" = p_build_id;

  select coalesce(sum("actualCost"), 0) into v_materials_cost from build_materials
    where "buildId" = p_build_id;

  select coalesce(sum(rec.amount), 0) into v_total_extra_costs
    from report_extra_costs rec
    join reports r on r.id = rec."reportId"
    where r."buildId" = p_build_id;

  v_total_cost := v_materials_cost + v_labor_cost + v_total_extra_costs;

  insert into build_settlements (
    "buildId", "totalHours", "totalExtraCosts", "materialsCost", "laborCost", "totalCost"
  ) values (
    p_build_id, v_total_hours, v_total_extra_costs, v_materials_cost, v_labor_cost, v_total_cost
  )
  on conflict ("buildId") do update set
    "closedAt" = now(),
    "totalHours" = excluded."totalHours",
    "totalExtraCosts" = excluded."totalExtraCosts",
    "materialsCost" = excluded."materialsCost",
    "laborCost" = excluded."laborCost",
    "totalCost" = excluded."totalCost";

  delete from build_settlement_materials where "buildId" = p_build_id;
  insert into build_settlement_materials ("buildId", "materialId", planned, used, "unitPrice", "actualCost")
    select "buildId", "materialId", planned, used, "unitPrice", "actualCost"
      from build_materials where "buildId" = p_build_id;

  update builds set status = 'zamknięta', "updatedAt" = now() where id = p_build_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.commit_build_materials(p_build_id integer, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status build_status;
  v_item jsonb;
  v_material_id integer;
  v_planned decimal;
  v_price decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status into v_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przypisywać materiałów.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    v_planned := (v_item->>'planned')::decimal;

    select "unitPrice" into v_price from materials where id = v_material_id;
    if v_price is null then
      continue;
    end if;

    insert into build_materials ("buildId", "materialId", planned, used, "unitPrice")
      values (p_build_id, v_material_id, v_planned, 0, v_price)
      on conflict ("buildId", "materialId")
      do update set planned = build_materials.planned + excluded.planned;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.count_business_days(p_from date, p_to date)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::integer
  from generate_series(p_from, p_to, interval '1 day') as d
  where extract(isodow from d) < 6;
$function$
;

CREATE OR REPLACE FUNCTION public.create_material(p_name text, p_index text, p_unit text, p_initial_stock numeric, p_min numeric, p_unit_price numeric)
 RETURNS materials
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_material materials;
begin
  perform assert_role(array['Admin']::app_role[]);

  if exists (select 1 from materials where index = p_index) then
    raise exception 'Materiał z indeksem "%" już istnieje.', p_index;
  end if;

  insert into materials (name, index, unit, stock, min, "unitPrice")
    values (p_name, p_index, p_unit, 0, p_min, p_unit_price)
    returning * into v_material;

  if p_initial_stock > 0 then
    perform fn_add_material_batch(
      v_material.id, p_initial_stock, p_unit_price, current_date, 'stan początkowy'
    );
  end if;

  select * into v_material from materials where id = v_material.id;
  return v_material;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_leave_request(p_request_id integer, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_decider_id integer;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);

  select "employeeId" into v_decider_id from profiles where id = auth.uid();

  update leave_requests
  set
    status = (case when p_approve then 'zatwierdzony' else 'odrzucony' end)::leave_status,
    "decidedBy" = v_decider_id,
    "decidedAt" = now(),
    "updatedAt" = now()
  where id = p_request_id
    and status = 'oczekujący';

  if not found then
    raise exception 'Wniosek nie istnieje lub został już rozpatrzony.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_build_order(p_order_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status order_header_status;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status into v_status from orders where id = p_order_id for update;
  if not found then
    return;
  end if;
  if v_status <> 'anulowane' then
    raise exception 'Można skasować tylko anulowane zamówienie.';
  end if;

  delete from orders where id = p_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_material_order(p_order_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status::text into v_status from material_orders where id = p_order_id for update;
  if not found then
    return;
  end if;
  if v_status <> 'do realizacji' then
    raise exception 'Można skasować tylko zamówienie jeszcze niezłożone u dostawcy (status "do realizacji").';
  end if;

  delete from material_orders where id = p_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_add_material_batch(p_material_id integer, p_quantity numeric, p_unit_price numeric, p_received_at date, p_source batch_source)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
    values (p_material_id, p_quantity, p_unit_price, p_received_at, p_source);
  perform fn_recalc_material(p_material_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_add_material_batch_ext(p_material_id integer, p_quantity numeric, p_unit_price numeric, p_received_at date, p_source batch_source, p_document_number text DEFAULT NULL::text, p_supplier text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_build_plan_remaining(p_build_id integer)
 RETURNS TABLE(material_name text, linked_material_id integer, unit text, remaining numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.material_name, p.linked_material_id, p.unit,
         p.total_planned - coalesce(a.total_ordered, 0) as remaining
    from (
      select material_name, linked_material_id, unit, sum(planned_quantity) as total_planned
        from build_material_plan
        where build_id = p_build_id
        group by material_name, linked_material_id, unit
    ) p
    left join (
      select oi.material_name, oi.linked_material_id, oi.unit, sum(oi.ordered_quantity) as total_ordered
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.build_id = p_build_id and o.status <> 'anulowane'
        group by oi.material_name, oi.linked_material_id, oi.unit
    ) a
      on a.material_name = p.material_name
      and a.linked_material_id is not distinct from p.linked_material_id
      and a.unit = p.unit
    where p.total_planned - coalesce(a.total_ordered, 0) > 0.0001;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_consume_build_lot_fifo(p_build_id integer, p_material_id integer, p_amount numeric, p_report_id integer DEFAULT NULL::integer, p_stage_name text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_remaining decimal := p_amount;
  v_cost decimal := 0;
  v_row record;
  v_take decimal;
  v_left decimal;
  v_last_price decimal;
  v_deficit_lot_id integer;
  v_actor text := auth.uid()::text;
begin
  if p_amount <= 0 then
    return 0;
  end if;

  for v_row in
    select id, quantity, "unitPrice", "sourceBatchId"
      from build_material_lots
      where "buildId" = p_build_id and "materialId" = p_material_id
      order by "issuedAt" asc, id asc
      for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_row.quantity, v_remaining);
    v_cost := v_cost + v_take * v_row."unitPrice";
    v_last_price := v_row."unitPrice";
    v_remaining := v_remaining - v_take;
    v_left := v_row.quantity - v_take;

    if p_report_id is not null then
      insert into report_material_lots
        ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice", stage_name)
        values (p_report_id, p_material_id, v_row.id, v_row."sourceBatchId", v_take, v_row."unitPrice", p_stage_name);
    end if;

    insert into stock_movements
        ("type", "materialId", "buildId", "batchId", "lotId", "reportId", quantity, "unitPrice", "createdByProfileId")
      values ('zuzycie', p_material_id, p_build_id, v_row."sourceBatchId", v_row.id, p_report_id, v_take, v_row."unitPrice", v_actor);

    if v_left > 0.0001 then
      update build_material_lots set quantity = v_left where id = v_row.id;
    else
      delete from build_material_lots where id = v_row.id;
    end if;
  end loop;

  if v_remaining > 0.0001 then
    if v_last_price is null then
      select "unitPrice" into v_last_price
        from material_batches
        where "materialId" = p_material_id
        order by "receivedAt" desc, id desc
        limit 1;
    end if;
    if v_last_price is null then
      select "unitPrice" into v_last_price from materials where id = p_material_id;
    end if;
    v_last_price := coalesce(v_last_price, 0);

    v_cost := v_cost + v_remaining * v_last_price;

    insert into build_material_lots
      ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice")
      values (p_build_id, p_material_id, null, -v_remaining, v_last_price)
      returning id into v_deficit_lot_id;

    if p_report_id is not null then
      insert into report_material_lots
        ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice", stage_name)
        values (p_report_id, p_material_id, v_deficit_lot_id, null, v_remaining, v_last_price, p_stage_name);
    end if;

    insert into stock_movements
        ("type", "materialId", "buildId", "lotId", "reportId", quantity, "unitPrice", note, "createdByProfileId")
      values ('zuzycie', p_material_id, p_build_id, v_deficit_lot_id, p_report_id, v_remaining, v_last_price,
              'Niedobór — brak pokrycia w przypisanym stanie, wymaga korekty/transferu admina', v_actor);
  end if;

  return v_cost;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_consume_fifo(p_material_id integer, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_remaining decimal := p_amount;
  v_cost decimal := 0;
  v_row record;
  v_take decimal;
  v_left decimal;
begin
  if p_amount <= 0 then
    return 0;
  end if;

  for v_row in
    select id, quantity, "unitPrice"
      from material_batches
      where "materialId" = p_material_id
      order by "receivedAt" asc, id asc
      for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_row.quantity, v_remaining);
    v_cost := v_cost + v_take * v_row."unitPrice";
    v_remaining := v_remaining - v_take;
    v_left := v_row.quantity - v_take;
    if v_left > 0.0001 then
      update material_batches set quantity = v_left where id = v_row.id;
    else
      delete from material_batches where id = v_row.id;
    end if;
  end loop;

  if v_remaining > 0.0001 then
    raise exception 'Za mało towaru na stanie (materiał #%): brakuje %', p_material_id, round(v_remaining, 3);
  end if;

  perform fn_recalc_material(p_material_id);
  return v_cost;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_recalc_material(p_material_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_stock decimal(12, 3);
  v_value decimal(14, 2);
  v_price decimal(12, 2);
begin
  select coalesce(sum(quantity), 0), coalesce(sum(quantity * "unitPrice"), 0)
    into v_stock, v_value
    from material_batches
    where "materialId" = p_material_id;

  v_price := case when v_stock > 0 then v_value / v_stock else 0 end;

  update materials
    set stock = v_stock, "unitPrice" = v_price, "updatedAt" = now()
    where id = p_material_id;

  -- Odśwież planowaną cenę na budowach jeszcze aktywnych (zamknięte mają
  -- już zamrożone rozliczenie w build_settlement_materials — nie ruszamy).
  update build_materials bm
    set "unitPrice" = v_price
    from builds b
    where bm."materialId" = p_material_id
      and bm."buildId" = b.id
      and b.status = 'aktywna';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_order_from_plan(p_build_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_build builds;
  v_order_id integer;
  v_seq integer;
  v_order_number text;
  v_item record;
  v_free_qty decimal;
  v_resolved_material_id integer;
  v_match_count integer;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_build from builds where id = p_build_id;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;

  if not exists (select 1 from build_material_plan where build_id = p_build_id) then
    raise exception 'Budowa nie ma jeszcze planu materiałowego (przypisz technologię).';
  end if;

  if not exists (select 1 from fn_build_plan_remaining(p_build_id)) then
    raise exception 'Cały plan materiałowy tej budowy jest już zamówiony (uwzględniając wcześniejsze, nieanulowane zamówienia) — nie ma nic więcej do zamówienia.';
  end if;

  select count(*) + 1 into v_seq from orders where build_id = p_build_id;
  v_order_number := 'ZAM/' || v_build.number || '/' || v_seq;

  insert into orders (build_id, order_number, status, "createdBy")
    values (p_build_id, v_order_number, 'robocze', auth.uid())
    returning id into v_order_id;

  for v_item in select * from fn_build_plan_remaining(p_build_id)
  loop
    v_resolved_material_id := v_item.linked_material_id;
    if v_resolved_material_id is null then
      select count(*) into v_match_count from materials
        where normalize_material_name(name) = normalize_material_name(v_item.material_name);
      if v_match_count = 1 then
        select id into v_resolved_material_id from materials
          where normalize_material_name(name) = normalize_material_name(v_item.material_name);
      end if;
    end if;

    if v_resolved_material_id is null then
      v_free_qty := 0;
    else
      select coalesce(m.stock, 0) into v_free_qty
        from materials m
        where m.id = v_resolved_material_id;
      v_free_qty := coalesce(v_free_qty, 0);
    end if;

    insert into order_items (
      order_id, material_name, linked_material_id,
      planned_quantity, ordered_quantity, unit, available_free_quantity
    )
      values (
        v_order_id, v_item.material_name, v_resolved_material_id,
        v_item.remaining, v_item.remaining, v_item.unit,
        least(v_free_qty, v_item.remaining)
      );
  end loop;

  return v_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_employees()
 RETURNS TABLE(id integer, name text, role employee_role, "hourlyRate" numeric, "costRate" numeric, "leaveDaysPerYear" integer, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    e.id,
    e.name,
    e.role,
    case when app_role() = 'Admin' then e."hourlyRate" else null end as "hourlyRate",
    case when app_role() = 'Admin' then e."costRate" else null end as "costRate",
    e."leaveDaysPerYear",
    e."active"
  from employees e
  order by e.name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_public_build(p_token uuid, p_pin text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_build record;
  v_pin_ok boolean;
  v_progress numeric;
  v_days_elapsed integer;
  v_expected_progress numeric;
  v_delta numeric;
  v_status_color text;
  v_display_status text;
  v_last_update date;
  v_materials json;
  v_stages json;
  v_technology_name text;
  v_photos json;
  v_notes json;
begin
  select b.* into v_build
  from builds b
  where b.public_token = p_token;

  if not found or v_build.public_access_enabled is not true then
    return null;
  end if;

  v_pin_ok := v_build.public_pin_hash is null
    or (p_pin is not null and crypt(p_pin, v_build.public_pin_hash) = v_build.public_pin_hash);

  if not v_pin_ok then
    return json_build_object(
      'requiresPin', true,
      'name', v_build.name,
      'number', v_build.number
    );
  end if;

  select count(distinct r.date) into v_days_elapsed
  from reports r
  where r."buildId" = v_build.id and r.status = 'approved';

  select
    json_agg(json_build_object('name', s.stage_name, 'percent', round(s.percent)) order by s.min_id),
    avg(s.percent)
  into v_stages, v_progress
  from (
    select
      p.stage_name,
      min(p.id) as min_id,
      case
        when bss.stage_name is not null then 100
        else sum(least(coalesce(u.used_qty, 0), p.planned_quantity)) / sum(p.planned_quantity) * 100
      end as percent
    from build_material_plan p
    left join (
      select rm."materialId", rm.stage_name, sum(rm."usedQuantity") as used_qty
      from report_materials rm
      join reports r on r.id = rm."reportId"
      where r."buildId" = v_build.id and r.status = 'approved' and rm.stage_name is not null
      group by rm."materialId", rm.stage_name
    ) u on u.stage_name = p.stage_name
      and u."materialId" = coalesce(
        p.linked_material_id,
        (select m.id from materials m
          where normalize_material_name(m.name) = normalize_material_name(p.material_name)
          limit 1)
      )
    left join build_stage_status bss
      on bss.build_id = v_build.id and bss.stage_name = p.stage_name
    where p.build_id = v_build.id and p.planned_quantity > 0
    group by p.stage_name, bss.stage_name
  ) s;

  if v_progress is not null then
    v_progress := round(v_progress);
  else
    v_progress := least(round((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100), 100);
  end if;

  v_expected_progress := least((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100, 100);
  v_delta := coalesce(v_progress, 0) - coalesce(v_expected_progress, 0);
  v_status_color := case
    when v_delta >= -5 then 'green'
    when v_delta >= -15 then 'yellow'
    else 'red'
  end;

  if v_build.status = 'zamknięta' then
    v_display_status := 'zamknieta';
  elsif v_build."startDate" > current_date then
    v_display_status := 'nierozpoczeta';
    v_progress := 0;
    v_status_color := null;
  else
    v_display_status := 'aktywna';
  end if;

  select max(r.date) into v_last_update
  from reports r
  where r."buildId" = v_build.id and r.status = 'approved';

  select json_agg(m.name order by m.name)
  into v_materials
  from build_materials bm
  join materials m on m.id = bm."materialId"
  where bm."buildId" = v_build.id;

  select technology_name into v_technology_name
  from build_technology_snapshot
  where build_id = v_build.id;

  if v_build.show_photos_to_client then
    select json_agg(
      json_build_object('id', bp."driveFileId", 'createdAt', bp."createdAt")
      order by bp."createdAt" desc
    )
    into v_photos
    from (
      select * from build_photos where "buildId" = v_build.id
      order by "createdAt" desc
      limit 24
    ) bp;
  else
    v_photos := '[]'::json;
  end if;

  if v_build.show_notes_to_client then
    select json_agg(
      json_build_object('date', n.date, 'note', n.client_note) order by n.date desc
    )
    into v_notes
    from (
      select date, client_note from reports
      where "buildId" = v_build.id and status = 'approved'
        and client_note is not null and length(trim(client_note)) > 0
      order by date desc
      limit 1
    ) n;
  else
    v_notes := '[]'::json;
  end if;

  return json_build_object(
    'name', v_build.name,
    'number', v_build.number,
    'address', v_build.address,
    'areaM2', v_build."areaM2",
    'startDate', v_build."startDate",
    'plannedEndDate', v_build."startDate"::date + (v_build."durationDays" || ' days')::interval,
    'status', v_build.status,
    'displayStatus', v_display_status,
    'progressPercent', coalesce(v_progress, 0),
    'statusColor', v_status_color,
    'stages', coalesce(v_stages, '[]'::json),
    'materials', coalesce(v_materials, '[]'::json),
    'technologyName', v_technology_name,
    'photos', coalesce(v_photos, '[]'::json),
    'notes', coalesce(v_notes, '[]'::json),
    'aiSummary', case
      when v_build.show_notes_to_client and v_build.ai_client_summary is not null
        and length(trim(v_build.ai_client_summary)) > 0
      then v_build.ai_client_summary
      else null
    end,
    'allowClientAiSummary', coalesce(v_build.allow_client_ai_summary, false),
    'lastUpdateDate', v_last_update,
    'photosUrl', v_build."photosUrl",
    'contractValue', case when v_build.show_contract_value_to_client then v_build."contractValue" else null end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_time_entries()
 RETURNS TABLE(id integer, date date, "buildId" integer, "employeeId" integer, hours numeric, start time without time zone, "end" time without time zone, "hourlyRate" numeric, "costRate" numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    t.id, t.date, t."buildId", t."employeeId", t.hours, t.start, t."end",
    case when app_role() = 'Admin' then t."hourlyRate" else null end as "hourlyRate",
    case when app_role() = 'Admin' then t."costRate" else null end as "costRate"
  from time_entries t
  order by t.date desc;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_material_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select trim(
    regexp_replace(
      lower(
        translate(
          coalesce(p_name, ''),
          'ĄąĆćĘęŃńÓóŚśŹźŻż',
          'AaCcEeNnOoSsZzZz'
        )
      ),
      '\s+', ' ', 'g'
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.receive_material_order(p_order_id integer, p_received_quantity numeric, p_received_unit_price numeric DEFAULT NULL::numeric, p_document_number text DEFAULT NULL::text, p_supplier text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order material_orders;
  v_material_id integer;
  v_price numeric;
  v_match_count integer;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_order from material_orders where id = p_order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia #%.', p_order_id;
  end if;

  v_material_id := v_order."materialId";
  if v_material_id is null then
    select count(*) into v_match_count from materials
      where normalize_material_name(name) = normalize_material_name(v_order."materialName");
    if v_match_count > 1 then
      raise exception 'Materiał "%" występuje w magazynie więcej niż raz — połącz tę pozycję zamówienia z konkretnym materiałem ręcznie przed przyjęciem dostawy.', v_order."materialName";
    end if;
    select id into v_material_id from materials
      where normalize_material_name(name) = normalize_material_name(v_order."materialName")
      limit 1;
  end if;

  v_price := p_received_unit_price;
  if v_price is null and v_material_id is not null then
    select "unitPrice" into v_price from materials where id = v_material_id;
  end if;
  v_price := coalesce(v_price, 0);

  if v_material_id is null then
    insert into materials (name, index, unit, stock, min, "unitPrice")
      values (
        v_order."materialName",
        coalesce(nullif(trim(v_order.new_material_index), ''), 'FLOW-' || v_order.id),
        v_order.unit, 0,
        coalesce(v_order.new_material_min, 5), v_price
      )
      returning id into v_material_id;
  else
    update materials set active = true where id = v_material_id and active = false;
  end if;

  perform fn_add_material_batch_ext(
    v_material_id, p_received_quantity, v_price, current_date, 'zamówienie',
    p_document_number, p_supplier
  );

  update material_orders
    set status = 'dostarczone',
        "receivedQuantity" = p_received_quantity,
        "receivedUnitPrice" = v_price,
        "receivedAt" = now(),
        "materialId" = v_material_id
    where id = p_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.receive_material_order(p_order_id integer, p_received_quantity numeric, p_received_unit_price numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order material_orders;
  v_material_id integer;
  v_price decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_order from material_orders where id = p_order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia #%.', p_order_id;
  end if;

  v_material_id := v_order."materialId";
  if v_material_id is null then
    select id into v_material_id from materials where name = v_order."materialName" limit 1;
  end if;

  v_price := p_received_unit_price;
  if v_price is null and v_material_id is not null then
    select "unitPrice" into v_price from materials where id = v_material_id;
  end if;
  v_price := coalesce(v_price, 0);

  if v_material_id is null then
    insert into materials (name, index, unit, stock, min, "unitPrice")
      values (v_order."materialName", 'AUTO-' || v_order.id, v_order.unit, 0, 5, v_price)
      returning id into v_material_id;
  end if;

  perform fn_add_material_batch(v_material_id, p_received_quantity, v_price, current_date, 'zamówienie');

  update material_orders
    set status = 'dostarczone',
        "receivedQuantity" = p_received_quantity,
        "receivedUnitPrice" = v_price,
        "receivedAt" = now(),
        "materialId" = v_material_id
    where id = p_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.receive_order(p_order_id integer, p_items jsonb, p_document_number text DEFAULT NULL::text, p_supplier text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order orders;
  v_build_status build_status;
  v_item jsonb;
  v_row order_items;
  v_material_id integer;
  v_price decimal;
  v_qty decimal;
  v_batch_id integer;
  v_lot_id integer;
  v_avg_qty decimal;
  v_avg_value decimal;
  v_match_count integer;
  v_is_new_material boolean;
  v_actor text;
begin
  perform assert_role(array['Admin']::app_role[]);
  v_actor := auth.uid()::text;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia #%.', p_order_id;
  end if;
  if v_order.status = 'przyjęte' then
    raise exception 'Zamówienie #% jest już przyjęte.', p_order_id;
  end if;
  if v_order.status = 'anulowane' then
    raise exception 'Zamówienie #% jest anulowane.', p_order_id;
  end if;

  select status into v_build_status from builds where id = v_order.build_id;
  if v_build_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przyjmować dla niej dostaw.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_row from order_items
      where id = (v_item->>'itemId')::integer and order_id = p_order_id
      for update;
    if not found then
      raise exception 'Pozycja #% nie należy do zamówienia #%.', v_item->>'itemId', p_order_id;
    end if;

    v_qty := (v_item->>'receivedQuantity')::decimal;
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;

    v_material_id := v_row.linked_material_id;
    v_is_new_material := false;
    if v_material_id is null then
      select count(*) into v_match_count from materials
        where normalize_material_name(name) = normalize_material_name(v_row.material_name);
      if v_match_count > 1 then
        raise exception 'Materiał "%" występuje w magazynie więcej niż raz — połącz tę pozycję zamówienia z konkretnym materiałem ręcznie przed przyjęciem dostawy.', v_row.material_name;
      end if;
      select id into v_material_id from materials
        where normalize_material_name(name) = normalize_material_name(v_row.material_name)
        limit 1;
    end if;

    v_price := nullif(v_item->>'receivedUnitPrice', '')::decimal;
    if v_price is null and v_material_id is not null then
      select "unitPrice" into v_price from materials where id = v_material_id;
    end if;
    v_price := coalesce(v_price, 0);

    if v_material_id is null then
      insert into materials (name, index, unit, stock, min, "unitPrice")
        values (v_row.material_name, 'FLOW-OI-' || v_row.id, v_row.unit, 0, 0, v_price)
        returning id into v_material_id;
      v_is_new_material := true;
    end if;
    if not v_is_new_material then
      update materials set active = true where id = v_material_id and active = false;
    end if;

    insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source, "documentNumber", "supplier")
      values (v_material_id, v_qty, v_price, current_date, 'zamówienie', p_document_number, p_supplier)
      returning id into v_batch_id;

    insert into stock_movements
        ("type", "materialId", "buildId", "batchId", quantity, "unitPrice", note, "createdByProfileId")
      values ('przyjecie', v_material_id, v_order.build_id, v_batch_id, v_qty, v_price,
              case when p_document_number is not null then 'Dok. ' || p_document_number else null end,
              v_actor);

    insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values (v_order.build_id, v_material_id, v_batch_id, v_qty, v_price, now())
      returning id into v_lot_id;

    insert into stock_movements
        ("type", "materialId", "buildId", "batchId", "lotId", quantity, "unitPrice", "createdByProfileId")
      values ('wydanie', v_material_id, v_order.build_id, v_batch_id, v_lot_id, v_qty, v_price, v_actor);

    delete from material_batches where id = v_batch_id;
    perform fn_recalc_material(v_material_id);

    select sum(quantity), sum(quantity * "unitPrice")
      into v_avg_qty, v_avg_value
      from build_material_lots
      where "buildId" = v_order.build_id and "materialId" = v_material_id;

    insert into build_materials ("buildId", "materialId", planned, used, "unitPrice", issued)
      values (v_order.build_id, v_material_id, v_qty, 0, v_price, v_qty)
      on conflict ("buildId", "materialId") do update
        set planned = build_materials.planned + excluded.planned,
            issued = build_materials.issued + excluded.issued,
            "unitPrice" = case when v_avg_qty > 0 then v_avg_value / v_avg_qty else build_materials."unitPrice" end;

    update order_items
      set linked_material_id = v_material_id,
          received_quantity = v_qty,
          received_unit_price = v_price
      where id = v_row.id;
  end loop;

  update orders set status = 'przyjęte' where id = p_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.receive_order(p_order_id integer, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order orders;
  v_item jsonb;
  v_row order_items;
  v_material_id integer;
  v_price decimal;
  v_qty decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia #%.', p_order_id;
  end if;
  if v_order.status = 'przyjęte' then
    raise exception 'Zamówienie #% jest już przyjęte.', p_order_id;
  end if;
  if v_order.status = 'anulowane' then
    raise exception 'Zamówienie #% jest anulowane.', p_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_row from order_items
      where id = (v_item->>'itemId')::integer and order_id = p_order_id
      for update;
    if not found then
      raise exception 'Pozycja #% nie należy do zamówienia #%.', v_item->>'itemId', p_order_id;
    end if;

    v_qty := (v_item->>'receivedQuantity')::decimal;
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;

    v_material_id := v_row.linked_material_id;
    if v_material_id is null then
      select id into v_material_id from materials where name = v_row.material_name limit 1;
    end if;

    v_price := nullif(v_item->>'receivedUnitPrice', '')::decimal;
    if v_price is null and v_material_id is not null then
      select "unitPrice" into v_price from materials where id = v_material_id;
    end if;
    v_price := coalesce(v_price, 0);

    if v_material_id is null then
      insert into materials (name, index, unit, stock, min, "unitPrice")
        values (v_row.material_name, 'AUTO-OI-' || v_row.id, v_row.unit, 0, 0, v_price)
        returning id into v_material_id;
    end if;

    perform fn_add_material_batch(v_material_id, v_qty, v_price, current_date, 'zamówienie');

    update order_items
      set linked_material_id = v_material_id,
          received_quantity = v_qty,
          received_unit_price = v_price
      where id = v_row.id;
  end loop;

  update orders set status = 'przyjęte' where id = p_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.regenerate_public_token(p_build_id integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_new_token uuid := gen_random_uuid();
begin
  if app_role() <> 'Admin' then
    raise exception 'Brak uprawnień.';
  end if;

  update builds set public_token = v_new_token where id = p_build_id;
  if not found then
    raise exception 'Budowa nie istnieje.';
  end if;

  return v_new_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Wymagana sesja.';
  end if;
  insert into push_tokens (profile_id, token, platform)
    values (auth.uid(), p_token, p_platform)
    on conflict (token) do update
      set profile_id = excluded.profile_id, platform = excluded.platform;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.register_web_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Wymagana sesja.';
  end if;
  insert into web_push_subscriptions (profile_id, endpoint, p256dh, auth)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update
      set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.request_leave(p_type leave_type, p_date_from date, p_date_to date, p_note text DEFAULT NULL::text)
 RETURNS leave_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee_id integer;
  v_business_days integer;
  v_row leave_requests;
begin
  if app_role() is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

  select "employeeId" into v_employee_id from profiles where id = auth.uid();
  if v_employee_id is null then
    raise exception 'Konto nie jest powiązane z pracownikiem — skontaktuj się z Adminem.';
  end if;

  if p_date_to < p_date_from then
    raise exception 'Data końcowa nie może być wcześniejsza niż początkowa.';
  end if;

  v_business_days := count_business_days(p_date_from, p_date_to);
  if v_business_days = 0 then
    raise exception 'Wybrany zakres nie zawiera dni roboczych.';
  end if;

  if exists (
    select 1 from leave_requests
    where "employeeId" = v_employee_id
      and status in ('oczekujący', 'zatwierdzony')
      and "dateFrom" <= p_date_to
      and "dateTo" >= p_date_from
  ) then
    raise exception 'W tym terminie masz już zgłoszony wniosek urlopowy.';
  end if;

  insert into leave_requests ("employeeId", type, "dateFrom", "dateTo", "businessDays", note)
  values (v_employee_id, p_type, p_date_from, p_date_to, v_business_days, nullif(trim(p_note), ''))
  returning * into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_technology(p_source_id integer, p_code text, p_name text, p_stages jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_id integer;
  v_version integer;
  v_stage jsonb;
  v_stage_id integer;
  v_material jsonb;
  v_used boolean;
begin
  perform assert_role(array['Admin']::app_role[]);

  if p_code is null or trim(p_code) = '' or p_name is null or trim(p_name) = '' then
    raise exception 'Kod i nazwa technologii są wymagane.';
  end if;

  if p_source_id is not null then
    select exists(
      select 1 from build_technology_snapshot where source_technology_id = p_source_id
    ) into v_used;

    if not v_used then
      -- Technologia nigdy nie była użyta na żadnej budowie — edycja W
      -- MIEJSCU, bez nowej wersji.
      update technologies set code = p_code, name = p_name where id = p_source_id;
      -- Kasuje też technology_materials przez ON DELETE CASCADE.
      delete from technology_stages where technology_id = p_source_id;
      v_new_id := p_source_id;
    else
      select version + 1 into v_version from technologies where id = p_source_id;
      if v_version is null then
        raise exception 'Technologia o id % nie istnieje.', p_source_id;
      end if;
      update technologies set is_active = false where id = p_source_id;

      insert into technologies (code, name, version, is_active, "createdBy")
      values (p_code, p_name, v_version, true, auth.uid())
      returning id into v_new_id;
    end if;
  else
    insert into technologies (code, name, version, is_active, "createdBy")
    values (p_code, p_name, 1, true, auth.uid())
    returning id into v_new_id;
  end if;

  for v_stage in select * from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb))
  loop
    insert into technology_stages (technology_id, name, order_index)
    values (
      v_new_id,
      v_stage->>'name',
      coalesce((v_stage->>'orderIndex')::integer, 0)
    )
    returning id into v_stage_id;

    for v_material in select * from jsonb_array_elements(coalesce(v_stage->'materials', '[]'::jsonb))
    loop
      insert into technology_materials (stage_id, material_name, unit, consumption_per_m2, linked_material_id)
      values (
        v_stage_id,
        v_material->>'name',
        coalesce(nullif(v_material->>'unit', ''), 'kg'),
        (v_material->>'consumptionPerM2')::decimal,
        nullif(v_material->>'linkedMaterialId', '')::integer
      );
    end loop;
  end loop;

  return v_new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_material_active(p_material_id integer, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_stock decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select stock into v_stock from materials where id = p_material_id;
  if not found then
    raise exception 'Nie znaleziono materiału #%.', p_material_id;
  end if;

  if p_active = false and coalesce(v_stock, 0) <> 0 then
    raise exception 'Nie można zarchiwizować materiału ze stanem magazynowym różnym od zera (aktualnie: %).', v_stock;
  end if;

  update materials set active = p_active, "updatedAt" = now() where id = p_material_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_public_portal_pin(p_build_id integer, p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if app_role() <> 'Admin' then
    raise exception 'Brak uprawnień.';
  end if;

  update builds
  set public_pin_hash = case when p_pin is null or p_pin = '' then null else crypt(p_pin, gen_salt('bf')) end
  where id = p_build_id;

  if not found then
    raise exception 'Budowa nie istnieje.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_daily_report(p_build_id integer, p_date date, p_people jsonb, p_materials jsonb, p_extra_costs jsonb, p_km numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_build_status build_status;
  v_report_id integer;
  v_existing_status report_status;
  v_item jsonb;
  v_material_id integer;
  v_daily_quantity decimal;
  v_prev_daily decimal;
  v_prev_materials jsonb;
  v_reason text;
  v_stage_name text;
  v_key text;
  v_assignment build_materials;
  v_delta decimal;
  v_cost decimal;
  v_employee_id integer;
  v_start text;
  v_end text;
  v_km_rate decimal;
  v_km_rate_applied decimal;
  v_km_cost decimal;
  v_result_materials jsonb := '[]'::jsonb;
  v_qty_to_return decimal;
  v_returned_cost decimal;
  v_lot_row record;
  v_take decimal;
  v_updated integer;
  v_hourly_rate decimal;
  v_cost_rate decimal;
  v_actor text;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);
  v_actor := auth.uid()::text;

  select status into v_build_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build_status = 'zamknięta' then
    raise exception 'Ta budowa jest zamknięta — nie można już dodawać raportów.';
  end if;

  select id, status into v_report_id, v_existing_status
    from reports where "buildId" = p_build_id and date = p_date;
  if v_report_id is not null and v_existing_status = 'approved' then
    raise exception 'Zatwierdzonego raportu nie można już edytować.';
  end if;

  if v_report_id is not null then
    select coalesce(
             jsonb_object_agg("materialId"::text || ':' || coalesce(stage_name, ''), "usedQuantity"),
             '{}'::jsonb
           )
      into v_prev_materials
      from report_materials where "reportId" = v_report_id;
  else
    v_prev_materials := '{}'::jsonb;
  end if;

  if p_km is not null then
    select km_rate into v_km_rate from settings where id = true;
    v_km_rate_applied := coalesce(v_km_rate, 0);
    v_km_cost := p_km * v_km_rate_applied;
  else
    v_km_rate_applied := null;
    v_km_cost := null;
  end if;

  if v_report_id is null then
    insert into reports ("buildId", date, status, km, "kmRateApplied", "kmCost", note, "submittedByProfileId")
      values (p_build_id, p_date, 'submitted', p_km, v_km_rate_applied, v_km_cost, p_note, auth.uid())
      returning id into v_report_id;
  else
    update reports set
      status = 'submitted',
      "updatedAt" = now(),
      km = p_km,
      "kmRateApplied" = v_km_rate_applied,
      "kmCost" = v_km_cost,
      note = p_note
      where id = v_report_id;
    delete from report_people where "reportId" = v_report_id;
    delete from report_materials where "reportId" = v_report_id;
    delete from report_extra_costs where "reportId" = v_report_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_materials)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    v_daily_quantity := (v_item->>'usedQuantity')::decimal;
    v_reason := v_item->>'reason';
    v_stage_name := v_item->>'stageName';
    v_key := v_material_id::text || ':' || coalesce(v_stage_name, '');

    select * into v_assignment from build_materials
      where "buildId" = p_build_id and "materialId" = v_material_id
      for update;
    if not found then
      continue;
    end if;

    v_prev_daily := coalesce((v_prev_materials ->> v_key)::decimal, 0);
    v_delta := v_daily_quantity - v_prev_daily;
    v_cost := 0;

    if v_delta > 0.0001 then
      v_cost := fn_consume_build_lot_fifo(p_build_id, v_material_id, v_delta, v_report_id, v_stage_name);
      update build_materials
        set used = v_assignment.used + v_delta, "actualCost" = "actualCost" + v_cost
        where "buildId" = p_build_id and "materialId" = v_material_id;

    elsif v_delta < -0.0001 then
      v_qty_to_return := -v_delta;
      v_returned_cost := 0;

      for v_lot_row in
        select
          rml.id, rml."lotId", rml."sourceBatchId", rml."unitPrice",
          rml.quantity + coalesce(rev.reversed, 0) as outstanding
        from report_material_lots rml
        left join (
          select "reversalOfId", sum(quantity) as reversed
            from report_material_lots
            where "reversalOfId" is not null
            group by "reversalOfId"
        ) rev on rev."reversalOfId" = rml.id
        where rml."reportId" = v_report_id and rml."materialId" = v_material_id
          and rml.stage_name is not distinct from v_stage_name
          and rml."reversalOfId" is null
        order by rml.id desc
        for update of rml
      loop
        exit when v_qty_to_return <= 0.0001;
        if v_lot_row.outstanding <= 0.0001 then
          continue;
        end if;
        v_take := least(v_lot_row.outstanding, v_qty_to_return);

        if v_lot_row."lotId" is not null then
          update build_material_lots set quantity = quantity + v_take
            where id = v_lot_row."lotId";
          get diagnostics v_updated = row_count;
        else
          v_updated := 0;
        end if;
        if v_updated = 0 then
          insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
            values (p_build_id, v_material_id, v_lot_row."sourceBatchId", v_take, v_lot_row."unitPrice", now());
        end if;

        v_returned_cost := v_returned_cost + v_take * v_lot_row."unitPrice";

        insert into report_material_lots
            ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice", "reversalOfId", stage_name)
          values (v_report_id, v_material_id, v_lot_row."lotId", v_lot_row."sourceBatchId", -v_take, v_lot_row."unitPrice", v_lot_row.id, v_stage_name);

        insert into stock_movements
            ("type", "materialId", "buildId", "batchId", "lotId", "reportId", quantity, "unitPrice", note, "createdByProfileId")
          values ('korekta', v_material_id, p_build_id, v_lot_row."sourceBatchId", v_lot_row."lotId", v_report_id, v_take, v_lot_row."unitPrice",
                  'Korekta w dół — storno zużycia z raportu', v_actor);

        v_qty_to_return := v_qty_to_return - v_take;
      end loop;

      v_cost := -v_returned_cost;
      update build_materials
        set used = greatest(v_assignment.used + v_delta, 0), "actualCost" = greatest("actualCost" - v_returned_cost, 0)
        where "buildId" = p_build_id and "materialId" = v_material_id;
    end if;

    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason, stage_name)
      values (v_report_id, v_material_id, v_daily_quantity, v_cost, v_reason, v_stage_name);

    v_result_materials := v_result_materials || jsonb_build_object(
      'materialId', v_material_id,
      'stageName', v_stage_name,
      'usedQuantity', v_daily_quantity,
      'cost', v_cost
    );
  end loop;

  if jsonb_array_length(p_people) > 0 then
    delete from time_entries where date = p_date and "buildId" = p_build_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_people)
  loop
    v_employee_id := (v_item->>'employeeId')::integer;
    v_start := v_item->>'start';
    v_end := v_item->>'end';

    select "hourlyRate", "costRate" into v_hourly_rate, v_cost_rate
      from employees where id = v_employee_id;

    insert into report_people ("reportId", "employeeId", start, "end")
      values (v_report_id, v_employee_id, v_start::time, v_end::time);
    insert into time_entries ("employeeId", "buildId", date, hours, start, "end", "hourlyRate", "costRate")
      values (
        v_employee_id, p_build_id, p_date,
        greatest(0, extract(epoch from (v_end::time - v_start::time)) / 3600.0),
        v_start::time, v_end::time,
        v_hourly_rate, v_cost_rate
      );
  end loop;

  for v_item in select * from jsonb_array_elements(p_extra_costs)
  loop
    insert into report_extra_costs ("reportId", label, amount, note, category)
      values (v_report_id, v_item->>'label', (v_item->>'amount')::decimal, v_item->>'note', v_item->>'category');
  end loop;

  return jsonb_build_object(
    'reportId', v_report_id,
    'materials', v_result_materials,
    'km', p_km,
    'kmRateApplied', v_km_rate_applied,
    'kmCost', v_km_cost
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unassign_material_from_build(p_build_id integer, p_material_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status build_status;
  v_assignment build_materials;
  v_lot record;
  v_restocked decimal := 0;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);

  select status into v_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już zmieniać przypisań materiałów.';
  end if;

  select * into v_assignment from build_materials
    where "buildId" = p_build_id and "materialId" = p_material_id
    for update;
  if not found then
    raise exception 'Ten materiał nie jest przypisany do budowy #%.', p_build_id;
  end if;

  if not exists (
    select 1 from build_material_lots
      where "buildId" = p_build_id and "materialId" = p_material_id
  ) then
    raise exception 'Cały przydzielony materiał został już zużyty w raportach — nie ma nic do zwrócenia na magazyn.';
  end if;

  for v_lot in
    select * from build_material_lots
      where "buildId" = p_build_id and "materialId" = p_material_id
      for update
  loop
    if v_lot."sourceBatchId" is not null then
      update material_batches set quantity = quantity + v_lot.quantity where id = v_lot."sourceBatchId";
    else
      -- Oryginalna partia już nie istnieje (skasowana, bo przypisanie
      -- wyczerpało ją do zera) — zwrot trafia do nowej partii zamiast do
      -- nieistniejącego wiersza.
      insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
        values (p_material_id, v_lot.quantity, v_lot."unitPrice", current_date, 'korekta');
    end if;
    v_restocked := v_restocked + v_lot.quantity;
  end loop;

  perform fn_recalc_material(p_material_id);

  delete from build_material_lots where "buildId" = p_build_id and "materialId" = p_material_id;

  if v_assignment.used > 0.0001 then
    update build_materials
      set planned = greatest(planned - v_restocked, used),
          issued = greatest(issued - v_restocked, 0)
      where "buildId" = p_build_id and "materialId" = p_material_id;
  else
    delete from build_materials where "buildId" = p_build_id and "materialId" = p_material_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_leave_request(p_request_id integer, p_type leave_type, p_date_from date, p_date_to date, p_note text DEFAULT NULL::text)
 RETURNS leave_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee_id integer;
  v_business_days integer;
  v_row leave_requests;
begin
  select "employeeId" into v_employee_id from profiles where id = auth.uid();
  if v_employee_id is null then
    raise exception 'Konto nie jest powiązane z pracownikiem — skontaktuj się z Adminem.';
  end if;

  if p_date_to < p_date_from then
    raise exception 'Data końcowa nie może być wcześniejsza niż początkowa.';
  end if;

  v_business_days := count_business_days(p_date_from, p_date_to);
  if v_business_days = 0 then
    raise exception 'Wybrany zakres nie zawiera dni roboczych.';
  end if;

  if exists (
    select 1 from leave_requests
    where "employeeId" = v_employee_id
      and id <> p_request_id
      and status in ('oczekujący', 'zatwierdzony')
      and "dateFrom" <= p_date_to
      and "dateTo" >= p_date_from
  ) then
    raise exception 'W tym terminie masz już zgłoszony wniosek urlopowy.';
  end if;

  update leave_requests
  set
    type = p_type,
    "dateFrom" = p_date_from,
    "dateTo" = p_date_to,
    "businessDays" = v_business_days,
    note = nullif(trim(p_note), ''),
    "updatedAt" = now()
  where id = p_request_id
    and "employeeId" = v_employee_id
    and status = 'oczekujący'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Wniosek nie istnieje, nie należy do Ciebie lub został już rozpatrzony.';
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_technology_meta(p_technology_id integer, p_company text, p_thickness_min_mm numeric, p_thickness_max_mm numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_role(array['Admin']::app_role[]);

  if p_thickness_min_mm is not null and p_thickness_max_mm is not null
     and p_thickness_min_mm > p_thickness_max_mm then
    raise exception 'Grubość "od" nie może być większa niż "do".';
  end if;

  update technologies
    set company = nullif(trim(p_company), ''),
        "thickness_min_mm" = p_thickness_min_mm,
        "thickness_max_mm" = p_thickness_max_mm
    where id = p_technology_id;

  if not found then
    raise exception 'Nie znaleziono technologii #%.', p_technology_id;
  end if;
end;
$function$
;
