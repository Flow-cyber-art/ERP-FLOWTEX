import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla ustawień aplikacji — na razie jedna wartość
 * (stawka za km, Faza 7 modułu Technologia). Tabela jest singletonem
 * (id = true), patrz supabase/sql/012_faza7_km_koszty.sql. Odczyt dla
 * wszystkich zalogowanych (RLS), zapis wyłącznie dla Admina.
 */

export type SettingsRow = {
  id: true;
  kmRate: string;
  updatedAt: string;
};

const SETTINGS_SELECT = "id, kmRate:km_rate, updatedAt";

export async function getSettings(): Promise<SettingsRow> {
  const { data, error } = await supabase
    .from("settings")
    .select(SETTINGS_SELECT)
    .eq("id", true)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as SettingsRow;
}

export async function updateKmRate(kmRate: number): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .update({ km_rate: kmRate, updatedAt: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}
