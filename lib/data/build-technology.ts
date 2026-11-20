import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla przypisania technologii do budowy — Faza 2 modułu
 * Technologia. Zapis zawsze przez RPC `assign_technology_to_build`
 * (patrz supabase/sql/006_faza2_plan_budowy.sql): atomowo zapisuje m²,
 * zamraża snapshot technologii i przelicza plan materiałowy.
 */

export type BuildTechnologySnapshotRow = {
  buildId: number;
  technologyCode: string;
  technologyName: string;
  technologyVersion: number;
  // Jednostka ilości budowy (m2/mb/szt) zamrożona w chwili przypisania.
  unit: "m2" | "mb" | "szt";
  // Druga miara zamrożona w chwili przypisania (null = brak).
  unit2: "m2" | "mb" | "szt" | null;
  label2: string | null;
};

export type BuildMaterialPlanRow = {
  id: number;
  buildId: number;
  stageName: string;
  materialName: string;
  unit: string;
  consumptionPerM2: string;
  plannedQuantity: string;
  linkedMaterialId: number | null;
  // Czy zużycie liczone na jednostkę podstawową, czy na drugą miarę.
  basis: "primary" | "secondary";
};

// Obie tabele są nowe (Faza 2) = snake_case w bazie (patrz
// 006_faza2_plan_budowy.sql); aliasy "camelCase:snake_case" tłumaczą to
// na JS/TS bez zmuszania reszty kodu do znajomości realnych nazw kolumn.

/** Wszystkie budowy naraz (jak assignments/savedReports) — filtrowane po buildId w UI. */
export async function listBuildTechnologySnapshots(): Promise<BuildTechnologySnapshotRow[]> {
  const { data, error } = await supabase
    .from("build_technology_snapshot")
    .select(
      "buildId:build_id, technologyCode:technology_code, technologyName:technology_name, technologyVersion:technology_version, unit, unit2, label2",
    );
  if (error) throw new Error(error.message);
  return (data ?? []) as BuildTechnologySnapshotRow[];
}

export async function listBuildMaterialPlans(): Promise<BuildMaterialPlanRow[]> {
  const { data, error } = await supabase
    .from("build_material_plan")
    .select(
      "id, buildId:build_id, stageName:stage_name, materialName:material_name, unit, consumptionPerM2:consumption_per_m2, plannedQuantity:planned_quantity, linkedMaterialId:linked_material_id, basis",
    );
  if (error) throw new Error(error.message);
  return (data ?? []) as BuildMaterialPlanRow[];
}

export async function assignTechnologyToBuild(
  buildId: number,
  technologyId: number,
  areaM2: number,
  quantity2: number | null = null,
): Promise<void> {
  const { error } = await supabase.rpc("assign_technology_to_build", {
    p_build_id: buildId,
    p_technology_id: technologyId,
    p_area_m2: areaM2,
    p_quantity2: quantity2,
  });
  if (error) throw new Error(error.message);
}
