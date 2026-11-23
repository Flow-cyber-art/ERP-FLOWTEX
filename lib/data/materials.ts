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

export async function updateMaterialIndex(materialId: number, index: string): Promise<void> {
  const { error } = await supabase
    .from("materials")
    .update({ index, updatedAt: new Date().toISOString() })
    .eq("id", materialId);
  if (error) throw new Error(error.message);
}

// Korekta stanu i/lub ceny z wymaganym powodem — jedna transakcja w bazie,
// każda zmiana zostawia wpis "korekta" w stock_movements (kto, kiedy,
// było → jest). Patrz supabase/sql/116_korekta_magazynu_z_powodem_i_cena_przy_zerowym_stanie.sql.
// null = bez zmian w danym polu.
export async function correctMaterial(input: {
  materialId: number;
  newStock: number | null;
  newPrice: number | null;
  reason: string;
}): Promise<void> {
  const { error } = await supabase.rpc("correct_material", {
    p_material_id: input.materialId,
    p_new_stock: input.newStock,
    p_new_price: input.newPrice,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
}

export type MaterialCorrection = {
  id: number;
  createdAt: string;
  quantity: string;
  unitPrice: string;
  note: string | null;
  createdByName: string;
};

export async function listMaterialCorrections(materialId: number, limit = 10): Promise<MaterialCorrection[]> {
  const { data, error } = await supabase.rpc("list_material_corrections", {
    p_material_id: materialId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as MaterialCorrection[];
}

// Archiwizacja zamiast usuwania — patrz supabase/sql/038_archiwizacja_materialow.sql
// i 039_archiwizacja_tylko_zero_stanu.sql. RPC (nie zapis bezpośredni jak
// correctMaterial), bo archiwizacja waliduje stan magazynowy (tylko
// zero) po stronie bazy — nie coś, co dałoby się bezpiecznie sprawdzić
// samą polityką RLS.
export async function setMaterialActive(materialId: number, active: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_material_active", {
    p_material_id: materialId,
    p_active: active,
  });
  if (error) throw new Error(error.message);
}
