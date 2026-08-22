import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla pracowników — bezpośrednio z Supabase (anon key +
 * RLS). Odpowiednik `employeesRouter` z dawnego `server/data-routers.ts`.
 */

export type EmployeeRole = "Brygadzista" | "Pracownik";

export type EmployeeRow = {
  id: number;
  name: string;
  role: EmployeeRole;
  hourlyRate: string;
};

const EMPLOYEE_COLUMNS = "id, name, role, hourlyRate";

export async function listEmployees(): Promise<EmployeeRow[]> {
  const { data, error } = await supabase
    .from("employees")
    .select(EMPLOYEE_COLUMNS)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as EmployeeRow[];
}

export type CreateEmployeeInput = {
  name: string;
  role: EmployeeRole;
  hourlyRate: number;
};

export async function createEmployee(input: CreateEmployeeInput): Promise<void> {
  const { error } = await supabase.from("employees").insert({
    name: input.name,
    role: input.role,
    hourlyRate: input.hourlyRate,
  });
  if (error) throw new Error(error.message);
}

export async function updateEmployeeRate(employeeId: number, hourlyRate: number): Promise<void> {
  const { error } = await supabase
    .from("employees")
    .update({ hourlyRate, updatedAt: new Date().toISOString() })
    .eq("id", employeeId);
  if (error) throw new Error(error.message);
}
