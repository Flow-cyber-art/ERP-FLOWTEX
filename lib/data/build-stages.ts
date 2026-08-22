import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla statusu etapów technologii na budowie (Faza 6).
 * Jeden wiersz w `build_stage_status` = jeden ZAKOŃCZONY etap danej
 * budowy; brak wiersza = etap nierozpoczęty/w trakcie (to już rozstrzyga
 * samo UI, na podstawie tego, czy jakiś materiał etapu ma zużycie > 0).
 * Zapis wprost (insert/delete), bez RPC — RLS pozwala na to Adminowi i
 * Brygadziście (ta sama para ról co submit_daily_report).
 */

export type BuildStageStatusRow = {
  buildId: number;
  stageName: string;
  completedAt: string;
};

export async function listBuildStageStatuses(): Promise<BuildStageStatusRow[]> {
  const { data, error } = await supabase
    .from("build_stage_status")
    .select("buildId:build_id, stageName:stage_name, completedAt");
  if (error) throw new Error(error.message);
  return (data ?? []) as BuildStageStatusRow[];
}

export async function completeBuildStage(buildId: number, stageName: string): Promise<void> {
  const { error } = await supabase
    .from("build_stage_status")
    .upsert({ build_id: buildId, stage_name: stageName }, { onConflict: "build_id,stage_name" });
  if (error) throw new Error(error.message);
}

export async function reopenBuildStage(buildId: number, stageName: string): Promise<void> {
  const { error } = await supabase
    .from("build_stage_status")
    .delete()
    .eq("build_id", buildId)
    .eq("stage_name", stageName);
  if (error) throw new Error(error.message);
}
