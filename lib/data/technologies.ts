import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla technologii (receptur posadzek) — Faza 1 modułu
 * Technologia. Zapis idzie zawsze przez RPC `save_technology` (patrz
 * supabase/sql/005_faza1_technologie.sql, zaktualizowane w
 * 073_edycja_technologii_bez_nowej_wersji.sql): dopóki technologia nie
 * jest jeszcze przypisana do ŻADNEJ budowy, "edycja" nadpisuje ją W
 * MIEJSCU (ten sam id, ta sama wersja) — dopiero od momentu, gdy jakaś
 * budowa ją przejmie (assign_technology_to_build zamraża wtedy snapshot
 * w build_technology_snapshot), kolejna edycja zaczyna tworzyć nową
 * wersję tej samej rodziny (`code`) i dezaktywować poprzednią, żeby
 * budowa z już przypisaną recepturą nigdy nie zobaczyła późniejszej
 * zmiany.
 */

export type TechnologyMaterialRow = {
  id: number;
  materialName: string;
  unit: string;
  consumptionPerM2: string;
  linkedMaterialId: number | null;
};

export type TechnologyStageRow = {
  id: number;
  name: string;
  orderIndex: number;
  technology_materials: TechnologyMaterialRow[];
};

export type TechnologyRow = {
  id: number;
  code: string;
  name: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  // Metadane pod filtrowanie (patrz 017_faza1c_zakres_grubosci.sql) — nie
  // część receptury, więc NIE wersjonowane jak stages/materials poniżej.
  // Grubość to ZAKRES (od-do), nie jedna wartość — ta sama receptura
  // zwykle stosuje się w przedziale grubości, nie tylko dokładnie jednej.
  company: string | null;
  thicknessMinMm: string | null;
  thicknessMaxMm: string | null;
  technology_stages: TechnologyStageRow[];
};

// Tabele nowe (Faza 1) = snake_case w bazie (patrz 005_faza1_technologie.sql),
// ale JS/TS trzyma się camelCase — aliasy "camelCase:snake_case" w select
// tłumaczą jedno na drugie, żeby reszta kodu nie musiała znać realnych nazw kolumn.
const TECHNOLOGY_SELECT =
  "id, code, name, version, isActive:is_active, createdAt, company, " +
  "thicknessMinMm:thickness_min_mm, thicknessMaxMm:thickness_max_mm, " +
  "technology_stages(id, name, orderIndex:order_index, " +
  "technology_materials(id, materialName:material_name, unit, consumptionPerM2:consumption_per_m2, linkedMaterialId:linked_material_id))";

/** Tylko aktywne (najnowsza wersja każdej rodziny) — to, co widać przy zakładaniu budowy. */
export async function listActiveTechnologies(): Promise<TechnologyRow[]> {
  const { data, error } = await supabase
    .from("technologies")
    .select(TECHNOLOGY_SELECT)
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TechnologyRow[];
}

/** Wszystkie wersje, najnowsze pierwsze — widok Admina, do historii/audytu. */
export async function listAllTechnologies(): Promise<TechnologyRow[]> {
  const { data, error } = await supabase
    .from("technologies")
    .select(TECHNOLOGY_SELECT)
    .order("code")
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TechnologyRow[];
}

export type SaveTechnologyMaterialInput = {
  name: string;
  unit: string;
  consumptionPerM2: number;
  linkedMaterialId?: number | null;
};

export type SaveTechnologyStageInput = {
  name: string;
  orderIndex: number;
  materials: SaveTechnologyMaterialInput[];
};

/** sourceId: null = nowa rodzina technologii; podany = nowa wersja (edycja). */
export async function saveTechnology(
  sourceId: number | null,
  code: string,
  name: string,
  stages: SaveTechnologyStageInput[],
): Promise<number> {
  const { data, error } = await supabase.rpc("save_technology", {
    p_source_id: sourceId,
    p_code: code,
    p_name: name,
    p_stages: stages,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

/**
 * Firma i zakres grubości (mm, od-do) — metadane pod filtrowanie (patrz
 * 017_faza1c_zakres_grubosci.sql), osobna funkcja od `saveTechnology` bo
 * nie są częścią receptury: edycja NIE tworzy nowej wersji.
 */
export async function updateTechnologyMeta(
  technologyId: number,
  company: string | null,
  thicknessMinMm: number | null,
  thicknessMaxMm: number | null,
): Promise<void> {
  const { error } = await supabase.rpc("update_technology_meta", {
    p_technology_id: technologyId,
    p_company: company,
    p_thickness_min_mm: thicknessMinMm,
    p_thickness_max_mm: thicknessMaxMm,
  });
  if (error) throw new Error(error.message);
}
