import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla podwykonawców (firm) i ich stawki za m² — patrz
 * supabase/sql/111_podwykonawcy.sql i 114. Wszystko tylko dla Admina (RLS).
 *
 * Stawka podwykonawcy to JEDNA kwota netto zł/m², niezależna od
 * technologii (114). Jest bieżąca — zamraża ją dopiero zlecenie na budowie
 * (build_subcontracts), więc jej zmiana nie rusza już zleconych prac.
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
  /** Stawka netto zł/m² — jedna, niezależna od technologii (114). */
  rate: number;
};

const SUBCONTRACTOR_COLUMNS =
  "id, name, nip, contactPerson:contact_person, phone, email, bankAccount:bank_account, note, active, rate";

/** Dane z formularza — stawka jako tekst z pola (przecinek dziesiętny). */
export type SubcontractorInput = Omit<SubcontractorRow, "id" | "active" | "rate"> & { rate: string };

export const EMPTY_SUBCONTRACTOR: SubcontractorInput = {
  name: "",
  nip: "",
  contactPerson: "",
  phone: "",
  email: "",
  bankAccount: "",
  note: "",
  rate: "",
};

/** Stawka z pola formularza; null = niepoprawna liczba. Puste pole = 0. */
export const parseRateInput = (value: string): number | null => {
  const trimmed = value.trim().replace(/\s/g, "").replace(",", ".");
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const subcontractorToInput = (row: SubcontractorRow): SubcontractorInput => ({
  name: row.name,
  nip: row.nip,
  contactPerson: row.contactPerson,
  phone: row.phone,
  email: row.email,
  bankAccount: row.bankAccount,
  note: row.note,
  rate: row.rate ? String(row.rate).replace(".", ",") : "",
});

const toDb = (input: SubcontractorInput) => ({
  rate: parseRateInput(input.rate) ?? 0,
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
  return ((data ?? []) as any[]).map((r) => ({ ...r, rate: Number(r.rate ?? 0) })) as SubcontractorRow[];
}

/** Zwraca id nowej firmy — potrzebne, żeby od razu zapisać jej stawki. */
export async function createSubcontractor(input: SubcontractorInput): Promise<number> {
  const { data, error } = await supabase
    .from("subcontractors")
    .insert(toDb(input))
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: number }).id;
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
