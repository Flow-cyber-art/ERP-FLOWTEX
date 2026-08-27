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
