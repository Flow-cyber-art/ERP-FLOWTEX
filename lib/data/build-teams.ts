import { supabase } from "@/lib/supabase";

/**
 * Brygady pracujące na budowie (build_teams, patrz
 * supabase/sql/112_podwykonawcy_raport_i_brygady_budowy.sql) — własne i
 * podwykonawców, każda z zakresem etapów. Można je dopinać w dowolnym
 * momencie, także w trakcie budowy. Brygada główna (builds."teamId") jest
 * odzwierciedlana tu automatycznie przez trigger w bazie.
 */

export type BuildTeamRow = {
  buildId: number;
  teamId: number;
  /** null = wszystkie etapy budowy. */
  stageNames: string[] | null;
};

export async function listBuildTeams(): Promise<BuildTeamRow[]> {
  const { data, error } = await supabase
    .from("build_teams")
    .select("buildId:build_id, teamId:team_id, stageNames:stage_names");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BuildTeamRow[];
}

export async function saveBuildTeam(row: BuildTeamRow): Promise<void> {
  const { error } = await supabase.from("build_teams").upsert(
    {
      build_id: row.buildId,
      team_id: row.teamId,
      stage_names: row.stageNames && row.stageNames.length ? row.stageNames : null,
    },
    { onConflict: "build_id,team_id" },
  );
  if (error) throw new Error(error.message);
}

export async function removeBuildTeam(buildId: number, teamId: number): Promise<void> {
  const { error } = await supabase
    .from("build_teams")
    .delete()
    .eq("build_id", buildId)
    .eq("team_id", teamId);
  if (error) throw new Error(error.message);
}

/**
 * Brygada (id), w której zalogowany pracownik jest liderem, a która jest
 * brygadą podwykonawcy — odpowiednik my_subcontractor_team() z bazy, do
 * ustawienia trybu raportu po stronie aplikacji. Baza i tak ustala to
 * sama przy zapisie raportu.
 */
export function subcontractorTeamIdsLedBy(
  employeeId: number | null,
  teams: { id: number; leadEmployeeId: number | null; active: boolean }[],
  teamSubcontractor: Map<number, number | null>,
): number[] {
  if (employeeId == null) return [];
  return teams
    .filter(
      (t) =>
        t.active && t.leadEmployeeId === employeeId && teamSubcontractor.get(t.id) != null,
    )
    .map((t) => t.id);
}
