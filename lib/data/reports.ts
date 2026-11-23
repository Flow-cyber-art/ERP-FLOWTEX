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
export type SubmitReportMaterial = {
  materialId: number;
  usedQuantity: number;
  reason?: string;
  // Faza 6 — nazwa etapu technologii (z build_material_plan), do którego
  // ten materiał należy; puste dla materiałów pomocniczych spoza planu.
  // Wyłącznie informacyjne (report_materials.stage_name) — nie wpływa na
  // FIFO/koszt, patrz submit_daily_report w supabase/sql.
  stageName?: string;
};
// Kategoria kosztu dodatkowego (Faza 7) — pole opisowe, bez walidacji po
// stronie bazy; cztery podpowiedzi w UI (patrz components/report-ui.tsx),
// plus dowolna własna wartość.
export type SubmitReportExtraCost = {
  label: string;
  amount: number;
  note?: string;
  category?: string;
};

export type SubmitDailyReportInput = {
  buildId: number;
  date: string; // "YYYY-MM-DD"
  people: SubmitReportPerson[];
  materials: SubmitReportMaterial[];
  extraCosts: SubmitReportExtraCost[];
  // Kilometrówka (Faza 7) — liczba km na ten raport. `undefined`/0 nie
  // zapisuje żadnego kosztu (baza zamraża kmCost tylko gdy km nie jest
  // null, patrz submit_daily_report w supabase/sql/012_faza7_km_koszty.sql).
  km?: number;
  // Notatka do raportu (Decyzja B) — jedna, dowolna, czysto informacyjna.
  note?: string;
  // Wykonana ilość per etap — raport brygadzisty podwykonawcy (patrz
  // supabase/sql/112_podwykonawcy_raport_i_brygady_budowy.sql). Baza
  // przyjmuje tylko etapy z zakresu jego brygady na tej budowie.
  stageProgress?: SubmitReportStageProgress[];
  // Admin raportuje W IMIENIU podwykonawcy bez konta (115) — id jego
  // brygady. Dla innych ról baza ten parametr ignoruje.
  teamId?: number | null;
};

export type SubmitReportStageProgress = {
  stageName: string;
  quantity: number;
  unit: string;
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
  /** Stawka za km zamrożona PRZEZ BAZĘ w momencie tego zapisu (Faza 7). */
  kmRateApplied: number | null;
  kmCost: number | null;
};

/**
 * Błąd z odpowiedzi Supabase (RPC/Postgres) — w odróżnieniu od zwykłego
 * `Error` niesie `code` z bazy (np. kod wyjątku Postgresa przy
 * `RAISE EXCEPTION` w `submit_daily_report`). Kolejka offline
 * (`lib/offline-outbox.ts`) używa obecności `code`, żeby odróżnić
 * "serwer aktywnie odrzucił zapis" (nie pomoże czekać na internet, bo
 * internet już jest) od prawdziwego braku połączenia (fetch w ogóle nie
 * doszedł do serwera, więc `code` nie ma skąd wziąć).
 */
export class SupabaseRpcError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "SupabaseRpcError";
    this.code = code;
  }
}

export async function submitDailyReport(
  input: SubmitDailyReportInput,
): Promise<SubmitDailyReportResult> {
  const { data, error } = await supabase.rpc("submit_daily_report", {
    // p_team_id tylko gdy Admin raportuje za podwykonawcę (115) — bez tego
    // klucza wywołanie pasuje też do wersji funkcji sprzed 115.
    ...(input.teamId != null ? { p_team_id: input.teamId } : {}),
    p_build_id: input.buildId,
    p_date: input.date,
    p_people: input.people,
    p_materials: input.materials,
    p_extra_costs: input.extraCosts,
    p_km: input.km || null,
    p_note: input.note?.trim() || null,
    p_stage_progress: input.stageProgress?.length ? input.stageProgress : null,
  });
  if (error) throw new SupabaseRpcError(error.message, error.code);
  const result = data as {
    reportId: number;
    materials: SubmitDailyReportResult["materials"];
    kmRateApplied: number | string | null;
    kmCost: number | string | null;
  };
  return {
    reportId: result.reportId,
    materials: result.materials ?? [],
    kmRateApplied: result.kmRateApplied != null ? Number(result.kmRateApplied) : null,
    kmCost: result.kmCost != null ? Number(result.kmCost) : null,
  };
}

/**
 * Korekta szacunkowych m² per etap w raporcie podwykonawcy przez Admina,
 * przed zatwierdzeniem (115). Zastępuje wszystkie wpisy raportu.
 */
export async function setReportStageProgress(
  reportId: number,
  items: SubmitReportStageProgress[],
): Promise<void> {
  const { error } = await supabase.rpc("set_report_stage_progress", {
    p_report_id: reportId,
    p_items: items,
  });
  if (error) throw new Error(error.message);
}

/**
 * Zatwierdzenie / odesłanie do poprawy raportu po (buildId, date, brygada)
 * — od 112 tego samego dnia na budowie może być raport brygady własnej
 * (teamId = null) i osobny raport każdej brygady podwykonawcy.
 */
export async function updateReportStatus(
  buildId: number,
  date: string,
  status: "approved" | "do_poprawy",
  adminComment?: string,
  teamId: number | null = null,
): Promise<void> {
  let query = supabase
    .from("reports")
    .update({ status, adminComment: adminComment ?? null, updatedAt: new Date().toISOString() })
    .eq("buildId", buildId)
    .eq("date", date);
  query = teamId == null ? query.is("team_id", null) : query.eq("team_id", teamId);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export type ReportRow = {
  id: number;
  buildId: number;
  date: string;
  status: ReportStatus;
  adminComment: string | null;
  updatedAt: string;
  /** Kiedy raport wysłano (ostatnie wysłanie) — `date` to dzień wykonania prac. */
  submittedAt: string | null;
  km: string | null;
  kmRateApplied: string | null;
  kmCost: string | null;
  submittedByProfileId: string | null;
  note: string | null;
  clientNote: string | null;
  /** Brygada podwykonawcy, która wysłała raport (null = brygada własna). */
  teamId: number | null;
  report_stage_progress: { stageName: string; quantity: string; unit: string }[];
  builds: { number: string; name: string } | null;
  report_materials: {
    materialId: number;
    usedQuantity: string;
    cost: string;
    reason: string | null;
    stageName: string | null;
  }[];
  report_people: { employeeId: number; start: string; end: string }[];
  report_extra_costs: {
    id: number;
    label: string;
    amount: string;
    note: string | null;
    category: string | null;
  }[];
};

const REPORT_SELECT = `
  id, buildId, date, status, adminComment, updatedAt, km, kmRateApplied, kmCost,
  submittedByProfileId, note,
  submittedAt:submitted_at,
  clientNote:client_note,
  teamId:team_id,
  report_stage_progress ( stageName:stage_name, quantity, unit ),
  builds ( number, name ),
  report_materials ( materialId, usedQuantity, cost, reason, stageName:stage_name ),
  report_people ( employeeId, start, end ),
  report_extra_costs ( id, label, amount, note, category )
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

/**
 * Zatwierdzenie albo odesłanie do poprawy (124: review_report). Przy
 * odesłaniu komentarz jest wymagany; każde zdarzenie trafia do historii
 * (report_review_log).
 */
export async function reviewReport(reportId: number, approve: boolean, comment?: string): Promise<void> {
  const { error } = await supabase.rpc("review_report", {
    p_report_id: reportId,
    p_approve: approve,
    p_comment: comment?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export type ReportReviewEvent = {
  id: number;
  action: "wyslany" | "poprawiony" | "zatwierdzony" | "do_poprawy";
  comment: string | null;
  createdAt: string;
};

export async function listReportReviewLog(reportId: number): Promise<ReportReviewEvent[]> {
  const { data, error } = await supabase
    .from("report_review_log")
    .select("id, action, comment, createdAt:created_at")
    .eq("report_id", reportId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportReviewEvent[];
}

export const REVIEW_ACTION_LABELS: Record<ReportReviewEvent["action"], string> = {
  wyslany: "Wysłany",
  poprawiony: "Poprawiony i wysłany ponownie",
  zatwierdzony: "Zatwierdzony",
  do_poprawy: "Odesłany do poprawy",
};
