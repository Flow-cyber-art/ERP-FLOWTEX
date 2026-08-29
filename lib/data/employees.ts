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
  // `null` dla każdego, kto nie jest Adminem — patrz
  // supabase/sql/044_ukryj_stawki_pracownikow.sql. Kolumna nie jest już
  // czytelna wprost z tabeli (REVOKE), więc idzie przez RPC, która sama
  // decyduje, czy wywołujący ma prawo zobaczyć realną wartość.
  hourlyRate: string | null;
  // Stawka kosztowa (koszt budowy) — ta sama ochrona co hourlyRate,
  // patrz supabase/sql/048_stawka_kosztowa_pracownika.sql.
  costRate: string | null;
  // Pula dni urlopowych na rok — NIE ukryta jak stawki, widoczna dla
  // każdego (pracownik musi widzieć swoją). Patrz 049_urlopy.sql.
  leaveDaysPerYear: number;
  // Archiwizacja (jak materiały) — ten sam pracownik, nie usunięty, tylko
  // ukryty z domyślnych list. Patrz 051_archiwizacja_pracownikow.sql.
  active: boolean;
};

export async function listEmployees(): Promise<EmployeeRow[]> {
  const { data, error } = await supabase.rpc("get_employees");
  if (error) throw new Error(error.message);
  return (data ?? []) as EmployeeRow[];
}

export type CreateEmployeeInput = {
  name: string;
  role: EmployeeRole;
  hourlyRate: number;
  costRate: number;
};

export async function createEmployee(input: CreateEmployeeInput): Promise<void> {
  const { error } = await supabase.from("employees").insert({
    name: input.name,
    role: input.role,
    hourlyRate: input.hourlyRate,
    costRate: input.costRate,
  });
  if (error) throw new Error(error.message);
}

export async function updateEmployeeName(employeeId: number, name: string): Promise<void> {
  const { error } = await supabase
    .from("employees")
    .update({ name, updatedAt: new Date().toISOString() })
    .eq("id", employeeId);
  if (error) throw new Error(error.message);
}

export async function updateEmployeeRate(employeeId: number, hourlyRate: number): Promise<void> {
  const { error } = await supabase
    .from("employees")
    .update({ hourlyRate, updatedAt: new Date().toISOString() })
    .eq("id", employeeId);
  if (error) throw new Error(error.message);
}

export async function updateEmployeeCostRate(employeeId: number, costRate: number): Promise<void> {
  const { error } = await supabase
    .from("employees")
    .update({ costRate, updatedAt: new Date().toISOString() })
    .eq("id", employeeId);
  if (error) throw new Error(error.message);
}

export async function setEmployeeActive(employeeId: number, active: boolean): Promise<void> {
  const { error } = await supabase
    .from("employees")
    .update({ active, updatedAt: new Date().toISOString() })
    .eq("id", employeeId);
  if (error) throw new Error(error.message);
}
