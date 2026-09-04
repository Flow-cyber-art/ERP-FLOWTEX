import { supabase } from "@/lib/supabase";

/**
 * Log ruchów magazynowych (przyjęcie/wydanie/zużycie/korekta) —
 * `stock_movements`, zapisywany wyłącznie przez funkcje RPC
 * (supabase/sql/079_ksiega_ruchow_przyjecie_zuzycie.sql i późniejsze),
 * nigdy bezpośrednio z apki. W odróżnieniu od `build_material_lots`
 * (ŻYWY stan partii leżących na budowie — zeruje się w miarę zużycia i
 * znika całkiem po zamknięciu budowy), to jest TRWAŁY log zdarzeń: dobre
 * źródło do pokazania "po jakiej cenie faktycznie trafił na tę budowę
 * każdy kilogram materiału", także dla budów już zamkniętych.
 */
export type StockMovementRow = {
  id: number;
  type: "przyjecie" | "wydanie" | "zuzycie" | "korekta" | string;
  materialId: number;
  buildId: number | null;
  quantity: string;
  unitPrice: string;
  createdAt: string;
};

// Tylko "wydanie" (materiał trafił NA tę budowę, z magazynu albo prosto
// z dostawy) — to jest zdarzenie z ceną, o którą pyta Rozliczenie
// ("skąd wzięła się ta cena"), nie "zużycie" (zejście z podmagazynu
// budowy do raportu, ta sama partia/cena co przy wydaniu, więc
// duplikowałoby te same kwoty) ani "przyjęcie" (dotyczy całego
// magazynu, nie konkretnej budowy).
export async function listMaterialIssuesForBuild(buildId: number): Promise<StockMovementRow[]> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id, type, materialId, buildId, quantity, unitPrice, createdAt")
    .eq("buildId", buildId)
    .eq("type", "wydanie")
    .order("createdAt", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StockMovementRow[];
}
