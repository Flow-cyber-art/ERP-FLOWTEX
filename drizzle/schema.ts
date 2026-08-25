import {
  boolean,
  date,
  decimal,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  time,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/* ============================================================
 * Odzwierciedla 1:1 realny schemat bazy w Supabase (zweryfikowany przez
 * introspekcję information_schema — patrz rozmowa / SUPABASE_SETUP.md).
 * Poprzednia wersja tego pliku rozjeżdżała się z realną bazą (inne
 * nazwy kolumn w materials/employees/reports/material_orders), przez co
 * server/data-routers.ts i kod klienta przestały się kompilować — ten
 * plik to teraz jedyne źródło prawdy, trzymane w sync z bazą ręcznie
 * (RLS jest już włączone bezpośrednio w Supabase, więc `drizzle-kit
 * push` z tego pliku NIE jest tu używane do zarządzania schematem).
 * ============================================================ */

export const userRoleEnum = pgEnum("role", ["user", "admin"]);

export const employeeRoleEnum = pgEnum("employee_role", [
  "Brygadzista",
  "Pracownik",
]);

export const buildStatusEnum = pgEnum("build_status", [
  "aktywna",
  "zamknięta",
]);

export const batchSourceEnum = pgEnum("batch_source", [
  "stan początkowy",
  "zamówienie",
  "korekta",
  "zwrot",
]);

export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "wydanie",
  "zuzycie",
  "zwrot",
  "korekta",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "do realizacji",
  "zamówione",
  "dostarczone",
]);

export const materialCategoryEnum = pgEnum("material_category", [
  "technologiczny",
  "pomocniczy",
]);

export const returnDecisionEnum = pgEnum("return_decision", [
  "zwrot",
  "wyrzucenie",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "roboczy",
  "oczekuje_na_synchronizacje",
  "submitted",
  "do_poprawy",
  "approved",
  "konflikt",
]);

/* ============================================================
 * UŻYTKOWNICY I PRACOWNICY
 * ============================================================ */

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: employeeRoleEnum("role").notNull().default("Pracownik"),
  hourlyRate: decimal("hourlyRate", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  userId: integer("userId").references(() => users.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

/* ============================================================
 * BRYGADY (TEAMS)
 * ============================================================ */

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  leadEmployeeId: integer("leadEmployeeId").references(() => employees.id, {
    onDelete: "set null",
  }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

/* ============================================================
 * MAGAZYN GŁÓWNY I PARTIE
 * ============================================================ */

export const materials = pgTable("materials", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  index: varchar("index", { length: 128 }).notNull().unique(),
  unit: varchar("unit", { length: 32 }).notNull().default("szt."),
  stock: decimal("stock", { precision: 12, scale: 3 }).notNull().default("0"),
  min: decimal("min", { precision: 12, scale: 3 }).notNull().default("0"),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  category: materialCategoryEnum("category").notNull().default("pomocniczy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const materialBatches = pgTable("material_batches", {
  id: serial("id").primaryKey(),
  materialId: integer("materialId")
    .notNull()
    .references(() => materials.id, { onDelete: "cascade" }),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  receivedAt: date("receivedAt").notNull(),
  source: batchSourceEnum("source").notNull().default("zamówienie"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // Faza 4 modułu Technologia (patrz plan wdrożenia) — dokument dostawy
  // i dostawca, opcjonalne (partie "stan początkowy"/"korekta" ich nie
  // mają) — patrz supabase/sql/008_faza4_magazyn_partie.sql.
  documentNumber: text("documentNumber"),
  supplier: text("supplier"),
});

/* ============================================================
 * BUDOWY I MATERIAŁY NA BUDOWIE
 * ============================================================ */

export const builds = pgTable("builds", {
  id: serial("id").primaryKey(),
  number: varchar("number", { length: 32 }).notNull().unique(),
  name: text("name").notNull(),
  manager: text("manager"),
  startDate: date("startDate").notNull(),
  durationDays: integer("durationDays").notNull(),
  status: buildStatusEnum("status").notNull().default("aktywna"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  photosUrl: text("photosUrl"),
  teamId: integer("teamId").references(() => teams.id, { onDelete: "set null" }),
  // Faza 0 modułu Technologia (patrz plan wdrożenia) — dane klienta/
  // kontraktu i metraż, potrzebne do planu materiałowego i marży.
  // "technologyId" dochodzi dopiero w Fazie 1, razem z tabelą technologies.
  clientName: text("clientName"),
  address: text("address"),
  areaM2: decimal("areaM2", { precision: 10, scale: 2 }),
  contractValue: decimal("contractValue", { precision: 12, scale: 2 }),
});

export const buildMaterials = pgTable(
  "build_materials",
  {
    buildId: integer("buildId")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    materialId: integer("materialId")
      .notNull()
      .references(() => materials.id, { onDelete: "restrict" }),
    planned: decimal("planned", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    used: decimal("used", { precision: 12, scale: 3 }).notNull().default("0"),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    issued: decimal("issued", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    actualCost: decimal("actualCost", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
  },
  (table) => [primaryKey({ columns: [table.buildId, table.materialId] })],
);

export const buildMaterialLots = pgTable("build_material_lots", {
  id: serial("id").primaryKey(),
  buildId: integer("buildId")
    .notNull()
    .references(() => builds.id, { onDelete: "cascade" }),
  materialId: integer("materialId")
    .notNull()
    .references(() => materials.id, { onDelete: "restrict" }),
  sourceBatchId: integer("sourceBatchId").references(() => materialBatches.id, {
    onDelete: "set null",
  }),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  issuedAt: timestamp("issuedAt").defaultNow().notNull(),
});

/* ============================================================
 * AUDYT I DZIENNIK RUCHÓW (STOCK MOVEMENTS) — istnieje w bazie, ale
 * nie jest jeszcze używany przez żadną ścieżkę w kodzie klienta/serwera.
 * ============================================================ */

export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  type: stockMovementTypeEnum("type").notNull(),
  materialId: integer("materialId")
    .notNull()
    .references(() => materials.id, { onDelete: "restrict" }),
  buildId: integer("buildId").references(() => builds.id, {
    onDelete: "restrict",
  }),
  batchId: integer("batchId").references(() => materialBatches.id, {
    onDelete: "set null",
  }),
  lotId: integer("lotId").references(() => buildMaterialLots.id, {
    onDelete: "set null",
  }),
  reportId: integer("reportId"),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  note: text("note"),
  createdByUserId: integer("createdByUserId").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* ============================================================
 * RAPORTY DZIENNE — jeden raport = jedna budowa + jeden dzień
 * (egzekwowane przez unique("buildId","date"), patrz supabase/sql).
 * Idempotencja zapisu (offline-outbox) opiera się na tym naturalnym
 * kluczu, nie na osobnym clientId — w bazie go nie ma.
 * ============================================================ */

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  buildId: integer("buildId")
    .notNull()
    .references(() => builds.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: reportStatusEnum("status").notNull().default("submitted"),
  adminComment: text("adminComment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  // Kilometrówka (Faza 0/7 modułu Technologia) — km i stawka zamrożone w
  // momencie wysyłki raportu, żeby późniejsza zmiana stawki w ustawieniach
  // nie ruszała już wysłanych raportów.
  km: decimal("km", { precision: 10, scale: 2 }),
  kmRateApplied: decimal("kmRateApplied", { precision: 10, scale: 2 }),
  kmCost: decimal("kmCost", { precision: 12, scale: 2 }),
});

export const reportMaterials = pgTable(
  "report_materials",
  {
    reportId: integer("reportId")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    materialId: integer("materialId")
      .notNull()
      .references(() => materials.id, { onDelete: "restrict" }),
    usedQuantity: decimal("usedQuantity", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    cost: decimal("cost", { precision: 12, scale: 2 }).notNull().default("0"),
    reason: text("reason"),
    // Zużycie dodane przez brygadzistę bez wcześniejszego przypisania do
    // budowy — do weryfikacji administratora. Kolumna istnieje w bazie
    // pod przyszłą funkcję (patrz todo.md), na razie zawsze `false`.
    needsReview: boolean("needsReview").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.reportId, table.materialId] })],
);

export const reportPeople = pgTable(
  "report_people",
  {
    reportId: integer("reportId")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    employeeId: integer("employeeId")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    start: time("start").notNull(),
    end: time("end").notNull(),
    // Potwierdzenie wpisu czasu przez samego pracownika — kolumna istnieje
    // w bazie pod przyszłą funkcję (patrz todo.md), na razie zawsze `false`.
    confirmedByEmployee: boolean("confirmedByEmployee").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.reportId, table.employeeId] })],
);

export const reportExtraCosts = pgTable("report_extra_costs", {
  id: serial("id").primaryKey(),
  reportId: integer("reportId")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  note: text("note"),
  category: text("category"),
});

export const timeEntries = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  buildId: integer("buildId")
    .notNull()
    .references(() => builds.id, { onDelete: "cascade" }),
  employeeId: integer("employeeId")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  hours: decimal("hours", { precision: 5, scale: 2 }).notNull(),
  start: time("start"),
  end: time("end"),
});

export const materialOrders = pgTable("material_orders", {
  id: serial("id").primaryKey(),
  materialId: integer("materialId").references(() => materials.id, {
    onDelete: "set null",
  }),
  materialName: text("materialName").notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 32 }).notNull().default("szt."),
  status: orderStatusEnum("status").notNull().default("do realizacji"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  orderedAt: timestamp("orderedAt"),
  receivedQuantity: decimal("receivedQuantity", { precision: 12, scale: 3 }),
  receivedAt: timestamp("receivedAt"),
  receivedUnitPrice: decimal("receivedUnitPrice", { precision: 12, scale: 2 }),
  // Wspólny identyfikator dla pozycji zatwierdzonych naraz z koszyka
  // (patrz supabase/sql/031_material_orders_batch.sql) — grupuje kilka
  // materiałów w jedno zamówienie w UI, mimo że tabela zostaje płaska.
  batchId: varchar("batchId", { length: 64 }),
});

export const buildSettlements = pgTable("build_settlements", {
  buildId: integer("buildId")
    .primaryKey()
    .references(() => builds.id, { onDelete: "cascade" }),
  closedAt: timestamp("closedAt").defaultNow().notNull(),
  totalHours: decimal("totalHours", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  totalExtraCosts: decimal("totalExtraCosts", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  materialsCost: decimal("materialsCost", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  laborCost: decimal("laborCost", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  totalCost: decimal("totalCost", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
});

export const buildSettlementMaterials = pgTable(
  "build_settlement_materials",
  {
    buildId: integer("buildId")
      .notNull()
      .references(() => buildSettlements.buildId, { onDelete: "cascade" }),
    materialId: integer("materialId")
      .notNull()
      .references(() => materials.id, { onDelete: "restrict" }),
    planned: decimal("planned", { precision: 12, scale: 3 }).notNull(),
    used: decimal("used", { precision: 12, scale: 3 }).notNull(),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
    actualCost: decimal("actualCost", { precision: 12, scale: 2 }).notNull(),
    issuedUnaccounted: decimal("issuedUnaccounted", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
  },
  (table) => [primaryKey({ columns: [table.buildId, table.materialId] })],
);

// Faza 9 modułu Technologia — decyzja o pozostałości materiałowej przy
// zamknięciu budowy (patrz close_build, supabase/sql/013_faza9_...sql).
// Zwrot zwiększa material_batches.quantity tej samej partii po tej samej
// cenie; wyrzucenie zostaje kosztem budowy, nie wraca na stan.
export const buildMaterialReturns = pgTable("build_material_returns", {
  id: serial("id").primaryKey(),
  buildId: integer("buildId")
    .notNull()
    .references(() => builds.id, { onDelete: "cascade" }),
  materialId: integer("materialId")
    .notNull()
    .references(() => materials.id, { onDelete: "restrict" }),
  batchId: integer("batchId").references(() => materialBatches.id, {
    onDelete: "set null",
  }),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  decision: returnDecisionEnum("decision").notNull(),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* ============================================================
 * USTAWIENIA — Faza 0 modułu Technologia. Jednowierszowa tabela
 * ("singleton table": id typu boolean z check(id), drugi wiersz nie
 * może fizycznie powstać). Nowa tabela, więc snake_case (ustalona
 * decyzja) — w odróżnieniu od reszty schematu powyżej, camelCase.
 * ============================================================ */

export const settings = pgTable("settings", {
  id: boolean("id").primaryKey().default(true),
  kmRate: decimal("km_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

/* ============================================================
 * TECHNOLOGIE (RECEPTURY) — Faza 1 modułu Technologia. Wersjonowane:
 * "edycja" zawsze tworzy nowy wiersz w `technologies` (ten sam `code`,
 * `version`+1), stary dostaje `isActive=false` — patrz funkcja SQL
 * `save_technology()` w supabase/sql/005_faza1_technologie.sql, jedyne
 * miejsce, które powinno tu pisać. Nowe tabele = snake_case (kolumny),
 * poza `createdAt`/`createdBy`, które z premedytacją zostają camelCase,
 * żeby pasować do reszty schematu przy odczycie z klienta.
 * ============================================================ */

export const technologies = pgTable("technologies", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  createdBy: text("createdBy"), // uuid (auth.users/profiles.id) — brak natywnego typu uuid w tym pliku dotąd, patrz SQL
  // Firma (producent receptury) i zakres grubości posadzki w mm, do
  // jakiego dana technologia się stosuje (nie jedna wartość — ta sama
  // receptura zwykle pokrywa przedział grubości) — wyłącznie metadane do
  // filtrowania listy technologii (patrz 017_faza1c_zakres_grubosci.sql),
  // nie część receptury: zmiana nie bumpuje wersji jak stages/materials.
  company: text("company"),
  thicknessMinMm: decimal("thickness_min_mm", { precision: 6, scale: 2 }),
  thicknessMaxMm: decimal("thickness_max_mm", { precision: 6, scale: 2 }),
});

export const technologyStages = pgTable("technology_stages", {
  id: serial("id").primaryKey(),
  technologyId: integer("technology_id")
    .notNull()
    .references(() => technologies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
});

export const technologyMaterials = pgTable("technology_materials", {
  id: serial("id").primaryKey(),
  stageId: integer("stage_id")
    .notNull()
    .references(() => technologyStages.id, { onDelete: "cascade" }),
  materialName: text("material_name").notNull(),
  unit: text("unit").notNull().default("kg"),
  consumptionPerM2: decimal("consumption_per_m2", { precision: 10, scale: 4 }).notNull(),
  linkedMaterialId: integer("linked_material_id").references(() => materials.id, {
    onDelete: "set null",
  }),
});

/* ============================================================
 * PLAN MATERIAŁOWY BUDOWY — Faza 2. Przypisanie technologii do budowy
 * zamraża jej treść tu (snapshot_json) i przelicza plan (m² × zużycie).
 * Zapisywane wyłącznie przez RPC `assign_technology_to_build()` — patrz
 * supabase/sql/006_faza2_plan_budowy.sql.
 * ============================================================ */

export const buildTechnologySnapshot = pgTable("build_technology_snapshot", {
  buildId: integer("build_id")
    .primaryKey()
    .references(() => builds.id, { onDelete: "cascade" }),
  sourceTechnologyId: integer("source_technology_id").references(() => technologies.id, {
    onDelete: "set null",
  }),
  technologyCode: text("technology_code").notNull(),
  technologyName: text("technology_name").notNull(),
  technologyVersion: integer("technology_version").notNull(),
  snapshotJson: text("snapshot_json").notNull(), // jsonb — brak natywnego typu jsonb w tym pliku dotąd, patrz SQL
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const buildMaterialPlan = pgTable("build_material_plan", {
  id: serial("id").primaryKey(),
  buildId: integer("build_id")
    .notNull()
    .references(() => builds.id, { onDelete: "cascade" }),
  stageName: text("stage_name").notNull(),
  materialName: text("material_name").notNull(),
  unit: text("unit").notNull(),
  consumptionPerM2: decimal("consumption_per_m2", { precision: 10, scale: 4 }).notNull(),
  plannedQuantity: decimal("planned_quantity", { precision: 12, scale: 3 }).notNull(),
  linkedMaterialId: integer("linked_material_id").references(() => materials.id, {
    onDelete: "set null",
  }),
});

/* ============================================================
 * ZAMÓWIENIA (NAGŁÓWEK + POZYCJE) — Faza 3. Generowane wprost z
 * `build_material_plan` (Faza 2), RPC `generate_order_from_plan()` /
 * `receive_order()` — patrz supabase/sql/007_faza3_zamowienia.sql.
 * Zastępuje (dla budów z przypisaną technologią) dzisiejsze
 * `material_orders` powyżej — ten flow zostaje bez zmian, dalej działa
 * dla zamówień spoza planu materiałowego.
 * ============================================================ */

export const orderStatusV2Enum = pgEnum("order_header_status", [
  "robocze",
  "zamówione",
  "przyjęte",
  "anulowane",
]);

export const buildOrders = pgTable("orders", {
  id: serial("id").primaryKey(),
  buildId: integer("build_id")
    .notNull()
    .references(() => builds.id, { onDelete: "cascade" }),
  orderNumber: text("order_number").notNull().unique(),
  status: orderStatusV2Enum("status").notNull().default("robocze"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  createdBy: text("createdBy"), // uuid (auth.users.id)
});

export const buildOrderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => buildOrders.id, { onDelete: "cascade" }),
  materialName: text("material_name").notNull(),
  linkedMaterialId: integer("linked_material_id").references(() => materials.id, {
    onDelete: "set null",
  }),
  plannedQuantity: decimal("planned_quantity", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  orderedQuantity: decimal("ordered_quantity", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  unit: text("unit").notNull().default("kg"),
  receivedQuantity: decimal("received_quantity", { precision: 12, scale: 3 }),
  receivedUnitPrice: decimal("received_unit_price", { precision: 12, scale: 2 }),
});

/* ============================================================
 * TYPY INFEROWANE
 * ============================================================ */

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = typeof employees.$inferInsert;

export type Team = typeof teams.$inferSelect;
export type InsertTeam = typeof teams.$inferInsert;

export type Material = typeof materials.$inferSelect;
export type InsertMaterial = typeof materials.$inferInsert;

export type MaterialBatch = typeof materialBatches.$inferSelect;
export type InsertMaterialBatch = typeof materialBatches.$inferInsert;

export type Build = typeof builds.$inferSelect;
export type InsertBuild = typeof builds.$inferInsert;

export type BuildMaterial = typeof buildMaterials.$inferSelect;
export type InsertBuildMaterial = typeof buildMaterials.$inferInsert;

export type BuildMaterialLot = typeof buildMaterialLots.$inferSelect;
export type InsertBuildMaterialLot = typeof buildMaterialLots.$inferInsert;

export type StockMovement = typeof stockMovements.$inferSelect;
export type InsertStockMovement = typeof stockMovements.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type InsertReport = typeof reports.$inferInsert;

export type MaterialOrder = typeof materialOrders.$inferSelect;
export type InsertMaterialOrder = typeof materialOrders.$inferInsert;

export type BuildSettlement = typeof buildSettlements.$inferSelect;
export type InsertBuildSettlement = typeof buildSettlements.$inferInsert;

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = typeof settings.$inferInsert;

export type Technology = typeof technologies.$inferSelect;
export type InsertTechnology = typeof technologies.$inferInsert;

export type TechnologyStage = typeof technologyStages.$inferSelect;
export type InsertTechnologyStage = typeof technologyStages.$inferInsert;

export type TechnologyMaterial = typeof technologyMaterials.$inferSelect;
export type InsertTechnologyMaterial = typeof technologyMaterials.$inferInsert;

export type BuildTechnologySnapshot = typeof buildTechnologySnapshot.$inferSelect;
export type InsertBuildTechnologySnapshot = typeof buildTechnologySnapshot.$inferInsert;

export type BuildMaterialPlan = typeof buildMaterialPlan.$inferSelect;
export type InsertBuildMaterialPlan = typeof buildMaterialPlan.$inferInsert;

export type BuildOrder = typeof buildOrders.$inferSelect;
export type InsertBuildOrder = typeof buildOrders.$inferInsert;

export type BuildOrderItem = typeof buildOrderItems.$inferSelect;
export type InsertBuildOrderItem = typeof buildOrderItems.$inferInsert;
