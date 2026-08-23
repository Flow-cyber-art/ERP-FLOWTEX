import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla modułu budów — bezpośrednie połączenie z Supabase
 * (anon key + RLS), bez pośredniczącego serwera Express/tRPC.
 *
 * Odpowiednik `buildsRouter.list` / `buildsRouter.create` z
 * `server/data-routers.ts`. Kolumny w bazie mają te same (camelCase)
 * nazwy co w `drizzle/schema.ts` — Postgres je cytuje, więc `.select()`
 * może się odwoływać do nich wprost.
 */

export type BuildStatus = "aktywna" | "zamknięta";

export type BuildRow = {
  id: number;
  number: string;
  name: string;
  manager: string | null;
  teamId: number | null;
  startDate: string;
  durationDays: number;
  status: BuildStatus;
  photosUrl: string | null;
  driveFolderId: string | null;
  createdAt: string;
  updatedAt: string;
};

const BUILD_COLUMNS =
  "id, number, name, manager, teamId, startDate, durationDays, status, photosUrl, driveFolderId:drive_folder_id, createdAt, updatedAt";

export async function listBuilds(): Promise<BuildRow[]> {
  const { data, error } = await supabase
    .from("builds")
    .select(BUILD_COLUMNS)
    .order("createdAt", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as BuildRow[];
}

export type CreateBuildInput = {
  number: string;
  name: string;
  manager: string;
  startDate: string;
  durationDays: number;
};

/**
 * Zwraca czytelny błąd, gdy numer budowy już istnieje — RLS/unique
 * constraint w bazie zwróci kod 23505, tłumaczymy go na komunikat
 * analogiczny do dawnego TRPCError({ code: "CONFLICT" }).
 */
export async function createBuild(input: CreateBuildInput): Promise<BuildRow> {
  const { data, error } = await supabase
    .from("builds")
    .insert({
      number: input.number,
      name: input.name,
      manager: input.manager,
      startDate: input.startDate,
      durationDays: input.durationDays,
      status: "aktywna" satisfies BuildStatus,
    })
    .select(BUILD_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`Budowa z numerem "${input.number}" już istnieje.`);
    }
    throw new Error(error.message);
  }
  return data as BuildRow;
}

export type CloseBuildReturnItem = {
  materialId: number;
  batchId: number | null;
  quantity: number;
  decision: "zwrot" | "wyrzucenie";
  reason?: string | null;
};

/**
 * Zamyka budowę i zapisuje snapshot rozliczenia (godziny, materiały,
 * koszty dodatkowe) — patrz `close_build` w `supabase/sql/`. Wymaga, żeby
 * wszystkie raporty tej budowy były już zatwierdzone; w innym wypadku
 * (albo gdy budowa nie istnieje) rzuca czytelny błąd z komunikatem funkcji.
 *
 * `returns` (Faza 9) — decyzja per pozostała partia przypisana do budowy
 * (`build_material_lots`): zwrot na magazyn (ta sama partia, ta sama
 * cena) albo do wyrzucenia (zostaje kosztem budowy). Puste = budowa bez
 * pozostałości materiałowej.
 */
export async function closeBuild(
  buildId: number,
  returns: CloseBuildReturnItem[] = [],
): Promise<void> {
  const { error } = await supabase.rpc("close_build", {
    p_build_id: buildId,
    p_returns: returns,
  });
  if (error) throw new Error(error.message);
}

/**
 * Ponownie otwiera zamkniętą budowę. Zostawia snapshot w
 * build_settlements — przy ponownym zamknięciu `close_build` nadpisze go
 * świeżym przeliczeniem.
 */
export async function reopenBuild(buildId: number): Promise<void> {
  const { error } = await supabase
    .from("builds")
    .update({ status: "aktywna" satisfies BuildStatus, updatedAt: new Date().toISOString() })
    .eq("id", buildId);
  if (error) throw new Error(error.message);
}

export async function updateBuildPhotosUrl(buildId: number, photosUrl: string): Promise<void> {
  const { error } = await supabase
    .from("builds")
    .update({ photosUrl: photosUrl.length ? photosUrl : null, updatedAt: new Date().toISOString() })
    .eq("id", buildId);
  if (error) throw new Error(error.message);
}
