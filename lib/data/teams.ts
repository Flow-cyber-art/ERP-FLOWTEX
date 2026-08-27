import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla brygad (teams) i ich składu (team_members) —
 * bezpośrednio z Supabase (anon key + RLS). Tabela `teams` istniała już
 * wcześniej w schemacie (lider, patrz `builds.teamId`), ale bez UI ani
 * polityki zapisu — `team_members` i zapis do obu dochodzą razem, patrz
 * supabase/sql/040_planowany_koszt_robocizny.sql.
 */

export type TeamRow = {
  id: number;
  name: string;
  leadEmployeeId: number | null;
  active: boolean;
};

const TEAM_COLUMNS = "id, name, leadEmployeeId, active";

export async function listTeams(): Promise<TeamRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select(TEAM_COLUMNS)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamRow[];
}

export type CreateTeamInput = {
  name: string;
  leadEmployeeId: number | null;
};

export async function createTeam(input: CreateTeamInput): Promise<void> {
  const { error } = await supabase.from("teams").insert({
    name: input.name,
    leadEmployeeId: input.leadEmployeeId,
  });
  if (error) throw new Error(error.message);
}

export async function updateTeamActive(teamId: number, active: boolean): Promise<void> {
  const { error } = await supabase
    .from("teams")
    .update({ active, updatedAt: new Date().toISOString() })
    .eq("id", teamId);
  if (error) throw new Error(error.message);
}

export type TeamMemberRow = {
  teamId: number;
  employeeId: number;
};

const TEAM_MEMBER_COLUMNS = "teamId:team_id, employeeId:employee_id";

export async function listTeamMembers(): Promise<TeamMemberRow[]> {
  const { data, error } = await supabase.from("team_members").select(TEAM_MEMBER_COLUMNS);
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamMemberRow[];
}

export async function addTeamMember(teamId: number, employeeId: number): Promise<void> {
  const { error } = await supabase
    .from("team_members")
    .insert({ team_id: teamId, employee_id: employeeId });
  if (error) throw new Error(error.message);
}

export async function removeTeamMember(teamId: number, employeeId: number): Promise<void> {
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
}
