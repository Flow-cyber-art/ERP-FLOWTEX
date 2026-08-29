import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla `time_entries` — bezpośrednio z Supabase (anon key +
 * RLS, patrz "select_time_entries" w supabase/sql/003_auth_rls.sql).
 *
 * Wiersze do tej tabeli wstawia serwerowa funkcja `submit_daily_report`
 * (patrz supabase/sql/010_faza6_raport_dzienny.sql) w momencie wysłania
 * raportu dziennego przez brygadzistę — niezależnie od późniejszego
 * zatwierdzenia. Do tej pory appka NIGDY nie odczytywała tej tabeli z
 * powrotem: `timeEntries` w contexts/app-data.tsx żyło wyłącznie lokalnie
 * (AsyncStorage / optymistyczna aktualizacja przy wysyłce), więc koszt
 * robocizny w Rozliczeniu (settlement-screen.tsx) był zawsze pusty na
 * każdym innym urządzeniu/po odświeżeniu — mimo że dane realnie były już
 * w bazie.
 */
export type TimeEntryRow = {
  id: number;
  date: string;
  buildId: number;
  employeeId: number;
  hours: string;
  start: string | null;
  end: string | null;
  // `null` dla każdego, kto nie jest Adminem — ta sama ochrona jak
  // employees.hourlyRate (044_ukryj_stawki_pracownikow.sql), patrz
  // supabase/sql/055_stawka_zamrozona_w_godzinach.sql. Stawka
  // ZAMROŻONA w momencie zapisu godzin, nie aktualna stawka pracownika.
  hourlyRate: string | null;
  costRate: string | null;
};

// RPC (get_time_entries), nie bezpośredni select — kolumny hourlyRate/
// costRate mają REVOKE SELECT dla `authenticated`, więc surowy
// `.from("time_entries").select(...)` z tymi polami zawsze zwróciłby
// błąd "permission denied for column"; funkcja SECURITY DEFINER sama
// decyduje, czy wywołujący (Admin) ma prawo zobaczyć realną wartość.
export async function listTimeEntries(): Promise<TimeEntryRow[]> {
  const { data, error } = await supabase.rpc("get_time_entries");
  if (error) throw new Error(error.message);
  return (data ?? []) as TimeEntryRow[];
}
