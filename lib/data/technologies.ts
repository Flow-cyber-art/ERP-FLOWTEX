import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla technologii (receptur posadzek) — Faza 1 modułu
 * Technologia. Zapis idzie zawsze przez RPC `save_technology` (patrz
 * supabase/sql/005_faza1_technologie.sql): "edycja" nigdy nie nadpisuje
 * istniejącej technologii, zawsze tworzy nową wersję tej samej rodziny
 * (`code`) i dezaktywuje poprzednią — dzięki temu budowa, która już ma
 * przypisaną technologię, nigdy nie widzi późniejszej zmiany receptury.
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
  technology_stages: TechnologyStageRow[];
};

const TECHNOLOGY_SELECT =
  "id, code, name, version, isActive, createdAt, technology_stages(id, name, orderIndex, technology_materials(id, materialName, unit, consumptionPerM2, linkedMaterialId))";

/** Tylko aktywne (najnowsza wersja każdej rodziny) — to, co widać przy zakładaniu budowy. */
export async function listActiveTechnologies(): Promise<TechnologyRow[]> {
  const { data, error } = await supabase
    .from("technologies")
    .select(TECHNOLOGY_SELECT)
    .eq("isActive", true)
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
