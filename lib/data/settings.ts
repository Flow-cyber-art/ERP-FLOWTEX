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
  closeBuildPin: string | null;
  /** Ile dni wstecz Brygadzista może raportować prace (124). */
  reportBackdateDays: number;
  updatedAt: string;
};

const SETTINGS_SELECT = "id, kmRate:km_rate, closeBuildPin:close_build_pin, reportBackdateDays:report_backdate_days, updatedAt";

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

// Pusty string = wyłączenie zabezpieczenia (zapisywane jako null, patrz
// close_build_pin w 019_pin_zamkniecia_budowy.sql).
export async function updateCloseBuildPin(pin: string): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .update({ close_build_pin: pin.trim() || null, updatedAt: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

export async function updateReportBackdateDays(days: number): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .update({ report_backdate_days: days, updatedAt: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

/** Zamknięte okresy (miesiące) — raportów z nich nie da się wysłać ani zmienić (124). */
export type PeriodLockRow = { month: string; lockedAt: string; note: string | null };

export async function listPeriodLocks(): Promise<PeriodLockRow[]> {
  const { data, error } = await supabase
    .from("period_locks")
    .select("month, lockedAt:locked_at, note")
    .order("month", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PeriodLockRow[];
}

/** `month` — dowolny dzień miesiąca (YYYY-MM-DD). */
export async function setPeriodLock(month: string, locked: boolean, note?: string): Promise<void> {
  const { error } = await supabase.rpc("set_period_lock", {
    p_month: month,
    p_locked: locked,
    p_note: note?.trim() || null,
  });
  if (error) throw new Error(error.message);
}
