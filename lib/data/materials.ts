import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla magazynu — bezpośrednio z Supabase (anon key + RLS),
 * bez pośredniczącego serwera Express/tRPC. Odpowiednik `materialsRouter`
 * z dawnego `server/data-routers.ts`. Operacje wieloetapowe (nowy materiał
 * + partia startowa, korekta stanu FIFO) idą przez RPC (`supabase/sql/`),
 * żeby wykonać się atomowo bez pośredniczącego serwera.
 */

export type MaterialRow = {
  id: number;
  name: string;
  index: string;
  unit: string;
  stock: string;
  min: string;
  unitPrice: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const MATERIAL_COLUMNS =
  "id, name, index, unit, stock, min, unitPrice, active, createdAt, updatedAt";

export async function listMaterials(): Promise<MaterialRow[]> {
  const { data, error } = await supabase
    .from("materials")
    .select(MATERIAL_COLUMNS)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as MaterialRow[];
}

export type CreateMaterialInput = {
  name: string;
  index: string;
  unit: string;
  stock: number;
  min: number;
  unitPrice: number;
};

export async function createMaterial(input: CreateMaterialInput): Promise<void> {
  const { error } = await supabase.rpc("create_material", {
    p_name: input.name,
    p_index: input.index,
    p_unit: input.unit,
    p_initial_stock: input.stock,
    p_min: input.min,
    p_unit_price: input.unitPrice,
  });
  if (error) throw new Error(error.message);
}

export async function updateMaterialPrice(materialId: number, unitPrice: number): Promise<void> {
  const { error } = await supabase
    .from("materials")
    .update({ unitPrice, updatedAt: new Date().toISOString() })
    .eq("id", materialId);
  if (error) throw new Error(error.message);
}

export async function adjustMaterialStock(materialId: number, newStock: number): Promise<void> {
  const { error } = await supabase.rpc("adjust_material_stock", {
    p_material_id: materialId,
    p_new_stock: newStock,
  });
  if (error) throw new Error(error.message);
}

// Archiwizacja zamiast usuwania — patrz supabase/sql/038_archiwizacja_materialow.sql.
// Zapis bezpośredni (RLS "materials_write_admin", ten sam wzorzec co
// updateMaterialPrice), bez RPC — to tylko jedna kolumna, nie operacja
// wieloetapowa.
export async function setMaterialActive(materialId: number, active: boolean): Promise<void> {
  const { error } = await supabase
    .from("materials")
    .update({ active, updatedAt: new Date().toISOString() })
    .eq("id", materialId);
  if (error) throw new Error(error.message);
}
