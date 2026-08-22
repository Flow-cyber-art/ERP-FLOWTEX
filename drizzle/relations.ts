import { relations } from "drizzle-orm";
import {
  buildMaterialLots,
  buildMaterials,
  buildSettlementMaterials,
  buildSettlements,
  builds,
  employees,
  materialBatches,
  materialOrders,
  materials,
  reportExtraCosts,
  reportMaterials,
  reportPeople,
  reports,
  stockMovements,
  teams,
  timeEntries,
  users,
} from "./schema";

export const usersRelations = relations(users, ({ one }) => ({
  employee: one(employees, {
    fields: [users.id],
    references: [employees.userId],
  }),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  user: one(users, {
    fields: [employees.userId],
    references: [users.id],
  }),
  timeEntries: many(timeEntries),
  reportPeople: many(reportPeople),
  ledTeams: many(teams),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  leadEmployee: one(employees, {
    fields: [teams.leadEmployeeId],
    references: [employees.id],
  }),
  builds: many(builds),
}));

export const materialsRelations = relations(materials, ({ many }) => ({
  batches: many(materialBatches),
  buildMaterials: many(buildMaterials),
  lots: many(buildMaterialLots),
  movements: many(stockMovements),
  reportMaterials: many(reportMaterials),
  orders: many(materialOrders),
  settlementMaterials: many(buildSettlementMaterials),
}));

export const materialBatchesRelations = relations(
  materialBatches,
  ({ one, many }) => ({
    material: one(materials, {
      fields: [materialBatches.materialId],
      references: [materials.id],
    }),
    lots: many(buildMaterialLots),
    movements: many(stockMovements),
  }),
);

export const buildsRelations = relations(builds, ({ one, many }) => ({
  team: one(teams, {
    fields: [builds.teamId],
    references: [teams.id],
  }),
  materials: many(buildMaterials),
  lots: many(buildMaterialLots),
  movements: many(stockMovements),
  reports: many(reports),
  timeEntries: many(timeEntries),
  settlement: one(buildSettlements, {
    fields: [builds.id],
    references: [buildSettlements.buildId],
  }),
}));

export const buildMaterialsRelations = relations(
  buildMaterials,
  ({ one }) => ({
    build: one(builds, {
      fields: [buildMaterials.buildId],
      references: [builds.id],
    }),
    material: one(materials, {
      fields: [buildMaterials.materialId],
      references: [materials.id],
    }),
  }),
);

export const buildMaterialLotsRelations = relations(
  buildMaterialLots,
  ({ one, many }) => ({
    build: one(builds, {
      fields: [buildMaterialLots.buildId],
      references: [builds.id],
    }),
    material: one(materials, {
      fields: [buildMaterialLots.materialId],
      references: [materials.id],
    }),
    sourceBatch: one(materialBatches, {
      fields: [buildMaterialLots.sourceBatchId],
      references: [materialBatches.id],
    }),
    movements: many(stockMovements),
  }),
);

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  material: one(materials, {
    fields: [stockMovements.materialId],
    references: [materials.id],
  }),
  build: one(builds, {
    fields: [stockMovements.buildId],
    references: [builds.id],
  }),
  batch: one(materialBatches, {
    fields: [stockMovements.batchId],
    references: [materialBatches.id],
  }),
  lot: one(buildMaterialLots, {
    fields: [stockMovements.lotId],
    references: [buildMaterialLots.id],
  }),
  report: one(reports, {
    fields: [stockMovements.reportId],
    references: [reports.id],
  }),
  createdByUser: one(users, {
    fields: [stockMovements.createdByUserId],
    references: [users.id],
  }),
}));

export const reportsRelations = relations(reports, ({ one, many }) => ({
  build: one(builds, {
    fields: [reports.buildId],
    references: [builds.id],
  }),
  materials: many(reportMaterials),
  people: many(reportPeople),
  extraCosts: many(reportExtraCosts),
  movements: many(stockMovements),
}));

export const reportMaterialsRelations = relations(
  reportMaterials,
  ({ one }) => ({
    report: one(reports, {
      fields: [reportMaterials.reportId],
      references: [reports.id],
    }),
    material: one(materials, {
      fields: [reportMaterials.materialId],
      references: [materials.id],
    }),
  }),
);

export const reportPeopleRelations = relations(reportPeople, ({ one }) => ({
  report: one(reports, {
    fields: [reportPeople.reportId],
    references: [reports.id],
  }),
  employee: one(employees, {
    fields: [reportPeople.employeeId],
    references: [employees.id],
  }),
}));

export const reportExtraCostsRelations = relations(
  reportExtraCosts,
  ({ one }) => ({
    report: one(reports, {
      fields: [reportExtraCosts.reportId],
      references: [reports.id],
    }),
  }),
);

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  build: one(builds, {
    fields: [timeEntries.buildId],
    references: [builds.id],
  }),
  employee: one(employees, {
    fields: [timeEntries.employeeId],
    references: [employees.id],
  }),
}));

export const materialOrdersRelations = relations(
  materialOrders,
  ({ one }) => ({
    material: one(materials, {
      fields: [materialOrders.materialId],
      references: [materials.id],
    }),
  }),
);

export const buildSettlementsRelations = relations(
  buildSettlements,
  ({ one, many }) => ({
    build: one(builds, {
      fields: [buildSettlements.buildId],
      references: [builds.id],
    }),
    materials: many(buildSettlementMaterials),
  }),
);

export const buildSettlementMaterialsRelations = relations(
  buildSettlementMaterials,
  ({ one }) => ({
    settlement: one(buildSettlements, {
      fields: [buildSettlementMaterials.buildId],
      references: [buildSettlements.buildId],
    }),
    material: one(materials, {
      fields: [buildSettlementMaterials.materialId],
      references: [materials.id],
    }),
  }),
);
