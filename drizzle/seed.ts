/**
 * Wgrywa dane startowe (te same, co dziś w components/report-ui.tsx
 * initialMaterials / initialBuilds / initialAssignments / initialEmployees)
 * do świeżo utworzonych tabel w Supabase.
 *
 * Uruchomienie (po `npx drizzle-kit push`):
 *   npx tsx drizzle/seed.ts
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { builds, buildMaterials, employees, materialBatches, materials } from "./schema";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed the database");
  }
  const client = postgres(process.env.DATABASE_URL, { prepare: false });
  const db = drizzle(client);

  const todayISO = new Date().toISOString().slice(0, 10);

  console.log("Seeding materials...");
  const insertedMaterials = await db
    .insert(materials)
    .values([
      {
        name: "Klej do płytek elastyczny",
        index: "KLEJ-EL-25",
        unit: "worek",
        stock: "84",
        min: "20",
        unitPrice: "58",
      },
      {
        name: "Płyta GK impregnowana",
        index: "GKBI-12-5",
        unit: "szt.",
        stock: "42",
        min: "30",
        unitPrice: "34",
      },
      {
        name: "Profil CD 60",
        index: "PRO-CD60",
        unit: "mb",
        stock: "118",
        min: "50",
        unitPrice: "6.5",
      },
      {
        name: "Wkręty TN 25",
        index: "WKR-TN25",
        unit: "opak.",
        stock: "8",
        min: "15",
        unitPrice: "12",
      },
    ])
    .returning();

  const byIndex = Object.fromEntries(
    insertedMaterials.map((m) => [m.index, m]),
  );

  console.log("Seeding opening material batches...");
  await db.insert(materialBatches).values(
    insertedMaterials
      .filter((m) => Number(m.stock) > 0)
      .map((m) => ({
        materialId: m.id,
        quantity: m.stock,
        unitPrice: m.unitPrice,
        receivedAt: todayISO,
        source: "stan początkowy" as const,
      })),
  );

  console.log("Seeding builds...");
  const insertedBuilds = await db
    .insert(builds)
    .values([
      {
        number: "BUD-024",
        name: "Osiedle Brzozowa — etap II",
        manager: "Marek Kowalski",
        startDate: "2026-08-04",
        durationDays: 20,
        status: "aktywna",
      },
      {
        number: "BUD-019",
        name: "Dom jednorodzinny Zielona",
        manager: "Anna Nowak",
        startDate: "2026-08-11",
        durationDays: 8,
        status: "aktywna",
      },
    ])
    .returning();

  const byNumber = Object.fromEntries(insertedBuilds.map((b) => [b.number, b]));

  console.log("Seeding build <-> material assignments...");
  await db.insert(buildMaterials).values([
    {
      buildId: byNumber["BUD-024"].id,
      materialId: byIndex["KLEJ-EL-25"].id,
      planned: "18",
      used: "0",
      unitPrice: "58",
    },
    {
      buildId: byNumber["BUD-024"].id,
      materialId: byIndex["GKBI-12-5"].id,
      planned: "24",
      used: "0",
      unitPrice: "34",
    },
    {
      buildId: byNumber["BUD-024"].id,
      materialId: byIndex["WKR-TN25"].id,
      planned: "4",
      used: "0",
      unitPrice: "12",
    },
    {
      buildId: byNumber["BUD-019"].id,
      materialId: byIndex["PRO-CD60"].id,
      planned: "36",
      used: "0",
      unitPrice: "6.5",
    },
  ]);

  console.log("Seeding employees...");
  await db.insert(employees).values([
    { name: "Piotr Zieliński", role: "Brygadzista", hourlyRate: "45" },
    { name: "Tomasz Wójcik", role: "Pracownik", hourlyRate: "35" },
    { name: "Kamil Mazur", role: "Pracownik", hourlyRate: "35" },
  ]);

  console.log("Done.");
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
