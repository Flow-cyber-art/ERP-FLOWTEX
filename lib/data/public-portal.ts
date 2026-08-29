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
};

const SETTINGS_SELECT =
  "publicToken:public_token, publicAccessEnabled:public_access_enabled, publicPinHash:public_pin_hash, showContractValueToClient:show_contract_value_to_client";

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
  };
  return {
    publicToken: row.publicToken,
    publicAccessEnabled: row.publicAccessEnabled,
    hasPin: !!row.publicPinHash,
    showContractValueToClient: row.showContractValueToClient,
  };
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

export type PublicBuildStage = { name: string; completed: boolean };

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
  progressPercent: number;
  statusColor: "green" | "yellow" | "red" | null;
  currentStageName: string | null;
  stages: PublicBuildStage[];
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
