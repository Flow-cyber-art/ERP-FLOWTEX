import { supabase } from "@/lib/supabase";

/**
 * Portal Klienta — publiczny, read-only podgląd postępu budowy (QR /
 * link publiczny), bez logowania. Patrz supabase/sql/052_portal_klienta.sql.
 *
 * Dwie części:
 *  - ustawienia w panelu wewnętrznym (poniżej) — Admin, wymaga sesji;
 *  - `fetchPublicBuild` — wywoływane z app/portal/[token].tsx, bez sesji,
 *    kluczem anon. Whitelistę pól narzuca RPC po stronie bazy, nie front.
 */

export type PublicPortalSettings = {
  publicToken: string;
  publicAccessEnabled: boolean;
  hasPin: boolean;
  showContractValueToClient: boolean;
  showPhotosToClient: boolean;
  showNotesToClient: boolean;
  // Zbiorcze podsumowanie AI całej budowy (Gemini) — patrz
  // supabase/functions/generate-client-summary i
  // 063_portal_klienta_podsumowanie_ai.sql. null = jeszcze niewygenerowane.
  aiClientSummary: string | null;
  aiClientSummaryGeneratedAt: string | null;
  // Czy klient może sam wygenerować raport AI z przycisku w publicznym
  // portalu — patrz 064_portal_klienta_klient_generuje_raport_ai.sql.
  allowClientAiSummary: boolean;
};

const SETTINGS_SELECT =
  "publicToken:public_token, publicAccessEnabled:public_access_enabled, publicPinHash:public_pin_hash, showContractValueToClient:show_contract_value_to_client, showPhotosToClient:show_photos_to_client, showNotesToClient:show_notes_to_client, aiClientSummary:ai_client_summary, aiClientSummaryGeneratedAt:ai_client_summary_generated_at, allowClientAiSummary:allow_client_ai_summary";

export async function getPublicPortalSettings(buildId: number): Promise<PublicPortalSettings> {
  const { data, error } = await supabase
    .from("builds")
    .select(SETTINGS_SELECT)
    .eq("id", buildId)
    .single();
  if (error) throw new Error(error.message);
  const row = data as unknown as {
    publicToken: string;
    publicAccessEnabled: boolean;
    publicPinHash: string | null;
    showContractValueToClient: boolean;
    showPhotosToClient: boolean;
    showNotesToClient: boolean;
    aiClientSummary: string | null;
    aiClientSummaryGeneratedAt: string | null;
    allowClientAiSummary: boolean;
  };
  return {
    publicToken: row.publicToken,
    publicAccessEnabled: row.publicAccessEnabled,
    hasPin: !!row.publicPinHash,
    showContractValueToClient: row.showContractValueToClient,
    showPhotosToClient: row.showPhotosToClient,
    showNotesToClient: row.showNotesToClient,
    aiClientSummary: row.aiClientSummary,
    aiClientSummaryGeneratedAt: row.aiClientSummaryGeneratedAt,
    allowClientAiSummary: row.allowClientAiSummary,
  };
}

export async function setAllowClientAiSummary(buildId: number, allow: boolean): Promise<void> {
  const { error } = await supabase
    .from("builds")
    .update({ allow_client_ai_summary: allow })
    .eq("id", buildId);
  if (error) throw new Error(error.message);
}

export async function setPublicAccessEnabled(buildId: number, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from("builds")
    .update({ public_access_enabled: enabled })
    .eq("id", buildId);
  if (error) throw new Error(error.message);
}

export async function setShowContractValueToClient(
  buildId: number,
  show: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("builds")
    .update({ show_contract_value_to_client: show })
    .eq("id", buildId);
  if (error) throw new Error(error.message);
}

export async function setShowPhotosToClient(buildId: number, show: boolean): Promise<void> {
  const { error } = await supabase
    .from("builds")
    .update({ show_photos_to_client: show })
    .eq("id", buildId);
  if (error) throw new Error(error.message);
}

export async function setShowNotesToClient(buildId: number, show: boolean): Promise<void> {
  const { error } = await supabase
    .from("builds")
    .update({ show_notes_to_client: show })
    .eq("id", buildId);
  if (error) throw new Error(error.message);
}

/** `pin` puste/null wyłącza zabezpieczenie PIN-em. */
export async function setPublicPortalPin(buildId: number, pin: string | null): Promise<void> {
  const { error } = await supabase.rpc("set_public_portal_pin", {
    p_build_id: buildId,
    p_pin: pin,
  });
  if (error) throw new Error(error.message);
}

export async function regeneratePublicToken(buildId: number): Promise<string> {
  const { data, error } = await supabase.rpc("regenerate_public_token", {
    p_build_id: buildId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// Procent KAŻDEGO etapu liczony z realnego zużycia materiału tego etapu
// (koszt zużyty / zaplanowany), nie z ręcznego odznaczania — patrz
// supabase/sql/057_portal_klienta_etapy_z_materialow.sql.
export type PublicBuildStage = { name: string; percent: number };

// Miniaturka budowana z `id` (driveFileId) — foldery zdjęć budowy mają
// "anyone with the link: reader" ustawione już przy tworzeniu (patrz
// supabase/functions/drive-photos/index.ts findOrCreateFolder), więc
// bezpośredni link do miniaturki Google Drive działa bez logowania.
export type PublicBuildPhoto = { id: string; createdAt: string };
export type PublicBuildNote = { date: string; note: string };

export type PublicBuildView = {
  requiresPin?: boolean;
  name: string;
  number: string;
  address: string | null;
  areaM2: string | null;
  startDate: string;
  plannedEndDate: string;
  status: "aktywna" | "zamknięta";
  displayStatus: "nierozpoczeta" | "aktywna" | "zamknieta";
  // Postęp CAŁEJ budowy, też liczony z realnego zużycia materiałów
  // (wartość zużyta / zaplanowana).
  progressPercent: number;
  statusColor: "green" | "yellow" | "red" | null;
  stages: PublicBuildStage[];
  materials: string[];
  technologyName: string | null;
  // Zdjęcia/notatki: puste tablice, gdy Admin nie włączył udostępniania
  // dla tej budowy (show_photos_to_client / show_notes_to_client) — front
  // nie musi osobno sprawdzać flag, tylko renderować to, co przyszło.
  photos: PublicBuildPhoto[];
  notes: PublicBuildNote[];
  // Zbiorcze podsumowanie AI całej budowy — pokazywane nad listą notatek
  // dziennych, null gdy jeszcze niewygenerowane lub notatki wyłączone.
  aiSummary: string | null;
  // Pokazuje przycisk "Wygeneruj raport z budowy AI" klientowi w portalu
  // — patrz 064_portal_klienta_klient_generuje_raport_ai.sql.
  allowClientAiSummary: boolean;
  lastUpdateDate: string | null;
  photosUrl: string | null;
  contractValue: string | null;
};

/**
 * `null` = token nie istnieje albo portal wyłączony dla tej budowy —
 * front pokazuje ten sam ekran "nie znaleziono" w obu przypadkach,
 * żeby nie zdradzać, że token w ogóle istnieje.
 */
export async function fetchPublicBuild(
  token: string,
  pin?: string,
): Promise<PublicBuildView | null> {
  const { data, error } = await supabase.rpc("get_public_build", {
    p_token: token,
    p_pin: pin ?? null,
  });
  if (error) throw new Error(error.message);
  return (data as PublicBuildView | null) ?? null;
}
