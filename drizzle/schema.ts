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
