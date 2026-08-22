import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla przypisań materiałów do budów (build_materials) —
 * bezpośrednio z Supabase (anon key + RLS). Odpowiednik
 * `buildMaterialsRouter` z dawnego `server/data-routers.ts`. `commit`
 * idzie przez RPC — dolicza `planned` per pozycja atomowo (upsert z
 * `planned = planned + X`, którego nie da się bezpiecznie wyrazić jedną
 * operacją REST bez wyścigu przy dwóch równoległych zapisach).
 */

export type BuildMaterialRow = {
  buildId: number;
  materialId: number;
  planned: string;
  used: string;
  unitPrice: string;
};

const BUILD_MATERIAL_COLUMNS = "buildId, materialId, planned, used, unitPrice";

export async function listBuildMaterials(): Promise<BuildMaterialRow[]> {
  const { data, error } = await supabase.from("build_materials").select(BUILD_MATERIAL_COLUMNS);
  if (error) throw new Error(error.message);
  return (data ?? []) as BuildMaterialRow[];
}

export type CommitBuildMaterialsItem = { materialId: number; planned: number };

export async function commitBuildMaterials(
  buildId: number,
  items: CommitBuildMaterialsItem[],
): Promise<void> {
  const { error } = await supabase.rpc("commit_build_materials", {
    p_build_id: buildId,
    p_items: items,
  });
  if (error) throw new Error(error.message);
}
