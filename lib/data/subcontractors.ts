import { supabase } from "@/lib/supabase";
import type { TechnologyUnit } from "@/lib/data/technologies";

/**
 * Warstwa danych dla podwykonawców (firm) i ich cennika za etap — patrz
 * supabase/sql/111_podwykonawcy.sql. Wszystko tylko dla Admina (RLS).
 *
 * Cennik jest bieżący: stawka zostanie zamrożona dopiero w zleceniu na
 * budowie, więc jej edycja nie zmienia już zleconych prac.
 */

export type SubcontractorRow = {
  id: number;
  name: string;
  nip: string;
  contactPerson: string;
  phone: string;
  email: string;
  bankAccount: string;
  note: string;
  active: boolean;
};

const SUBCONTRACTOR_COLUMNS =
  "id, name, nip, contactPerson:contact_person, phone, email, bankAccount:bank_account, note, active";

export type SubcontractorInput = Omit<SubcontractorRow, "id" | "active">;

export const EMPTY_SUBCONTRACTOR: SubcontractorInput = {
  name: "",
  nip: "",
  contactPerson: "",
  phone: "",
  email: "",
  bankAccount: "",
  note: "",
};

const toDb = (input: SubcontractorInput) => ({
  name: input.name.trim(),
  nip: input.nip.trim(),
  contact_person: input.contactPerson.trim(),
  phone: input.phone.trim(),
  email: input.email.trim(),
  bank_account: input.bankAccount.trim(),
  note: input.note.trim(),
});

export async function listSubcontractors(): Promise<SubcontractorRow[]> {
  const { data, error } = await supabase
    .from("subcontractors")
    .select(SUBCONTRACTOR_COLUMNS)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SubcontractorRow[];
}

export async function createSubcontractor(input: SubcontractorInput): Promise<void> {
  const { error } = await supabase.from("subcontractors").insert(toDb(input));
  if (error) throw new Error(error.message);
}

export async function updateSubcontractor(id: number, input: SubcontractorInput): Promise<void> {
  const { error } = await supabase
    .from("subcontractors")
    .update({ ...toDb(input), updatedAt: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setSubcontractorActive(id: number, active: boolean): Promise<void> {
  const { error } = await supabase
    .from("subcontractors")
    .update({ active, updatedAt: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------- Brygady podwykonawcy ---------- */

export type TeamSubcontractorRow = {
  teamId: number;
  subcontractorId: number | null;
};

/**
 * Osobne zapytanie zamiast dopisania kolumny do listTeams() (teams.ts) —
 * lista brygad działa dalej, nawet jeśli migracja 111 nie jest jeszcze
 * uruchomiona.
 */
export async function listTeamSubcontractors(): Promise<TeamSubcontractorRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("teamId:id, subcontractorId:subcontractor_id");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TeamSubcontractorRow[];
}

export async function setTeamSubcontractor(
  teamId: number,
  subcontractorId: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("teams")
    .update({ subcontractor_id: subcontractorId, updatedAt: new Date().toISOString() })
    .eq("id", teamId);
  if (error) throw new Error(error.message);
}

/* ---------- Cennik za etap ---------- */

export type SubcontractorRateRow = {
  id: number;
  subcontractorId: number;
  technologyCode: string;
  /** null = cała technologia (bez podziału na etapy). */
  stageName: string | null;
  unit: TechnologyUnit;
  rate: number;
  note: string;
};

const RATE_COLUMNS =
  "id, subcontractorId:subcontractor_id, technologyCode:technology_code, stageName:stage_name, unit, rate, note";

export async function listSubcontractorRates(): Promise<SubcontractorRateRow[]> {
  const { data, error } = await supabase
    .from("subcontractor_rates")
    .select(RATE_COLUMNS)
    .order("technology_code");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({ ...r, rate: Number(r.rate) })) as SubcontractorRateRow[];
}

export type SaveRateInput = {
  /** Podane = edycja istniejącej stawki. */
  id?: number;
  subcontractorId: number;
  technologyCode: string;
  stageName: string | null;
  unit: TechnologyUnit;
  rate: number;
  note: string;
};

export async function saveSubcontractorRate(input: SaveRateInput): Promise<void> {
  const row = {
    subcontractor_id: input.subcontractorId,
    technology_code: input.technologyCode,
    stage_name: input.stageName,
    unit: input.unit,
    rate: input.rate,
    note: input.note.trim(),
    updatedAt: new Date().toISOString(),
  };
  const { error } = input.id
    ? await supabase.from("subcontractor_rates").update(row).eq("id", input.id)
    : await supabase.from("subcontractor_rates").insert(row);
  if (error) {
    // 23505 = unikalny indeks (podwykonawca, technologia, etap).
    if (error.code === "23505") {
      throw new Error("Ten podwykonawca ma już stawkę dla tego etapu — edytuj istniejącą.");
    }
    throw new Error(error.message);
  }
}

export async function deleteSubcontractorRate(id: number): Promise<void> {
  const { error } = await supabase.from("subcontractor_rates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
