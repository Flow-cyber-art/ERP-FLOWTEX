import { supabase } from "@/lib/supabase";
import type { TechnologyUnit } from "@/lib/data/technologies";

/**
 * Zlecenia podwykonawców na budowie i protokoły odbioru — patrz
 * supabase/sql/113_podwykonawcy_zlecenia_i_odbiory.sql. Tylko Admin (RLS).
 *
 * Zlecenie = pozycja per etap z ilością i stawką ZAMROŻONĄ w chwili
 * zlecenia (kopiowaną z cennika). Protokół odbioru = faktycznie odebrana
 * ilość × ta stawka (liczone w bazie) + prace dodatkowe − potrącenia.
 */

export type MaterialBy = "flowtex" | "podwykonawca";

export type BuildSubcontractRow = {
  id: number;
  buildId: number;
  subcontractorId: number;
  teamId: number | null;
  technologyCode: string;
  /** null = cała technologia. */
  stageName: string | null;
  unit: TechnologyUnit;
  quantity: number;
  rate: number;
  materialBy: MaterialBy;
  note: string;
};

const SUBCONTRACT_COLUMNS =
  "id, buildId:build_id, subcontractorId:subcontractor_id, teamId:team_id, technologyCode:technology_code, " +
  "stageName:stage_name, unit, quantity, rate, materialBy:material_by, note";

export async function listBuildSubcontracts(): Promise<BuildSubcontractRow[]> {
  const { data, error } = await supabase
    .from("build_subcontracts")
    .select(SUBCONTRACT_COLUMNS)
    .order("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    rate: Number(r.rate),
  })) as BuildSubcontractRow[];
}

export type SaveSubcontractInput = Omit<BuildSubcontractRow, "id"> & { id?: number };

export async function saveBuildSubcontract(input: SaveSubcontractInput): Promise<void> {
  const row = {
    build_id: input.buildId,
    subcontractor_id: input.subcontractorId,
    team_id: input.teamId,
    technology_code: input.technologyCode,
    stage_name: input.stageName,
    unit: input.unit,
    quantity: input.quantity,
    rate: input.rate,
    material_by: input.materialBy,
    note: input.note.trim(),
    updatedAt: new Date().toISOString(),
  };
  const { error } = input.id
    ? await supabase.from("build_subcontracts").update(row).eq("id", input.id)
    : await supabase.from("build_subcontracts").insert(row);
  if (error) {
    if (error.code === "23505") {
      throw new Error("Ten podwykonawca ma już pozycję zlecenia dla tego etapu — edytuj istniejącą.");
    }
    throw new Error(error.message);
  }
}

export async function deleteBuildSubcontract(id: number): Promise<void> {
  const { error } = await supabase.from("build_subcontracts").delete().eq("id", id);
  if (error) {
    // 23503 = pozycja ma już odebrane ilości w protokole (FK RESTRICT).
    if (error.code === "23503") {
      throw new Error("Tej pozycji nie można usunąć — ma już odebrane ilości w protokole.");
    }
    throw new Error(error.message);
  }
}

/* ---------- Protokoły odbioru ---------- */

export type AcceptanceItemKind = "etap" | "dodatkowe" | "potracenie";

export type AcceptanceItemRow = {
  id: number;
  subcontractId: number | null;
  kind: AcceptanceItemKind;
  description: string;
  quantity: number | null;
  rate: number | null;
  /** Kwota ze znakiem (potrącenie ujemne). */
  amount: number;
};

export type AcceptanceRow = {
  id: number;
  buildId: number;
  subcontractorId: number;
  acceptedOn: string;
  note: string;
  paidOn: string | null;
  items: AcceptanceItemRow[];
  total: number;
};

export async function listSubcontractAcceptances(): Promise<AcceptanceRow[]> {
  const { data, error } = await supabase
    .from("subcontract_acceptances")
    .select(
      "id, buildId:build_id, subcontractorId:subcontractor_id, acceptedOn:accepted_on, note, paidOn:paid_on, " +
        "subcontract_acceptance_items ( id, subcontractId:subcontract_id, kind, description, quantity, rate, amount )",
    )
    .order("accepted_on", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((a) => {
    const items: AcceptanceItemRow[] = (a.subcontract_acceptance_items ?? []).map((i: any) => ({
      ...i,
      quantity: i.quantity != null ? Number(i.quantity) : null,
      rate: i.rate != null ? Number(i.rate) : null,
      amount: Number(i.amount),
    }));
    return {
      id: a.id,
      buildId: a.buildId,
      subcontractorId: a.subcontractorId,
      acceptedOn: a.acceptedOn,
      note: a.note,
      paidOn: a.paidOn,
      items,
      total: items.reduce((sum, i) => sum + i.amount, 0),
    };
  });
}

export type SaveAcceptanceItem =
  | { kind: "etap"; subcontractId: number; quantity: number }
  | { kind: "dodatkowe" | "potracenie"; description: string; amount: number };

export async function saveSubcontractAcceptance(input: {
  buildId: number;
  subcontractorId: number;
  acceptedOn: string;
  note: string;
  items: SaveAcceptanceItem[];
}): Promise<number> {
  const { data, error } = await supabase.rpc("save_subcontract_acceptance", {
    p_build_id: input.buildId,
    p_subcontractor_id: input.subcontractorId,
    p_accepted_on: input.acceptedOn,
    p_note: input.note,
    p_items: input.items,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function setAcceptancePaid(id: number, paidOn: string | null): Promise<void> {
  const { error } = await supabase
    .from("subcontract_acceptances")
    .update({ paid_on: paidOn })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSubcontractAcceptance(id: number): Promise<void> {
  const { data, error } = await supabase
    .from("subcontract_acceptances")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  // RLS po cichu nie usuwa protokołu zamkniętej budowy — mówimy to wprost.
  if (!data || data.length === 0) {
    throw new Error("Nie można usunąć protokołu — budowa jest już zamknięta.");
  }
}
