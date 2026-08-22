import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla raportów dziennych — bezpośrednio z Supabase (anon
 * key + RLS). Odpowiednik `reportsRouter` z dawnego
 * `server/data-routers.ts`. `submitDailyReport` idzie przez RPC: FIFO
 * (zdjęcie partii, przeliczenie kosztu) i upsert po (buildId, date) muszą
 * wykonać się atomowo w jednej transakcji — bez tego dwa równoległe/
 * ponawiane zapisy tego samego raportu (kolejka offline) mogłyby
 * podwójnie zdjąć towar z magazynu.
 */

export type ReportStatus =
  | "roboczy"
  | "oczekuje_na_synchronizacje"
  | "submitted"
  | "do_poprawy"
  | "approved"
  | "konflikt";

export type SubmitReportPerson = { employeeId: number; start: string; end: string };
export type SubmitReportMaterial = { materialId: number; usedQuantity: number; reason?: string };
export type SubmitReportExtraCost = { label: string; amount: number; note?: string };

export type SubmitDailyReportInput = {
  buildId: number;
  date: string; // "YYYY-MM-DD"
  people: SubmitReportPerson[];
  materials: SubmitReportMaterial[];
  extraCosts: SubmitReportExtraCost[];
};

export type SubmitDailyReportResult = {
  reportId: number;
  /**
   * Rzeczywisty koszt FIFO doliczony PRZEZ BAZĘ dla każdego materiału w
   * tym wywołaniu — autorytatywny, nie do pomylenia z kosztem policzonym
   * lokalnie (na ewentualnie nieaktualnych partiach, np. gdy raport szedł
   * przez kolejkę offline i w międzyczasie ktoś inny zdjął towar z tej
   * samej partii). `saveDailyReport` w contexts/app-data.tsx NADPISUJE
   * tym swój lokalny szacunek zamiast mu ufać.
   */
  materials: { materialId: number; usedQuantity: number; cost: number }[];
};

export async function submitDailyReport(
  input: SubmitDailyReportInput,
): Promise<SubmitDailyReportResult> {
  const { data, error } = await supabase.rpc("submit_daily_report", {
    p_build_id: input.buildId,
    p_date: input.date,
    p_people: input.people,
    p_materials: input.materials,
    p_extra_costs: input.extraCosts,
  });
  if (error) throw new Error(error.message);
  const result = data as { reportId: number; materials: SubmitDailyReportResult["materials"] };
  return { reportId: result.reportId, materials: result.materials ?? [] };
}

/** Zatwierdzenie / odesłanie do poprawy raportu po (buildId, date). */
export async function updateReportStatus(
  buildId: number,
  date: string,
  status: "approved" | "do_poprawy",
  adminComment?: string,
): Promise<void> {
  const { error } = await supabase
    .from("reports")
    .update({ status, adminComment: adminComment ?? null, updatedAt: new Date().toISOString() })
    .eq("buildId", buildId)
    .eq("date", date);
  if (error) throw new Error(error.message);
}

export type ReportRow = {
  id: number;
  buildId: number;
  date: string;
  status: ReportStatus;
  adminComment: string | null;
  updatedAt: string;
  builds: { number: string; name: string } | null;
  report_materials: { materialId: number; usedQuantity: string; cost: string; reason: string | null }[];
  report_people: { employeeId: number; start: string; end: string }[];
  report_extra_costs: { id: number; label: string; amount: string; note: string | null }[];
};

const REPORT_SELECT = `
  id, buildId, date, status, adminComment, updatedAt,
  builds ( number, name ),
  report_materials ( materialId, usedQuantity, cost, reason ),
  report_people ( employeeId, start, end ),
  report_extra_costs ( id, label, amount, note )
`;

/**
 * Wszystkie raporty (dowolnej budowy, dowolnego dnia) — dla ekranu
 * "Raporty" (admin) i "Moje raporty" (brygadzista). Bez tego admin
 * logujący się z innego urządzenia niż to, z którego wysłano raport, nie
 * widział go WCALE — `savedReports` w kontekście było czysto lokalnym
 * stanem, nigdy nie odpytywanym z bazy.
 */
export async function listReports(): Promise<ReportRow[]> {
  const { data, error } = await supabase
    .from("reports")
    .select(REPORT_SELECT)
    .order("updatedAt", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReportRow[];
}
