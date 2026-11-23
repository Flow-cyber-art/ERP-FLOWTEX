import { supabase } from "@/lib/supabase";

/**
 * Magazyn v2 (supabase/sql/121–123): operacje, których nie było w starym
 * modelu — niedobory „do wyjaśnienia”, zwrot i strata w trakcie budowy,
 * weryfikacja pobrań brygadzisty, alerty nocnej kontroli spójności.
 * Stan zmieniają wyłącznie funkcje RPC (jedna księga ruchów).
 */

export type ShortageRow = {
  id: number;
  buildId: number;
  materialId: number;
  reportId: number | null;
  stageName: string | null;
  qtyOriginal: number;
  qtyOpen: number;
  provisionalPrice: number;
  status: "do_wyjasnienia" | "wyjasniony";
  resolution: string | null;
  note: string | null;
  createdAt: string;
};

export async function listShortages(): Promise<ShortageRow[]> {
  const { data, error } = await supabase
    .from("shortages")
    .select(
      "id, buildId:build_id, materialId:material_id, reportId:report_id, stageName:stage_name, qtyOriginal:qty_original, qtyOpen:qty_open, provisionalPrice:provisional_price, status, resolution, note, createdAt:created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...r,
    qtyOriginal: Number(r.qtyOriginal),
    qtyOpen: Number(r.qtyOpen),
    provisionalPrice: Number(r.provisionalPrice),
  })) as ShortageRow[];
}

/** Różnica inwentaryzacyjna: zostaje kosztem zużycia albo przechodzi do strat. */
export async function resolveShortage(shortageId: number, asLoss: boolean, note: string): Promise<void> {
  const { error } = await supabase.rpc("resolve_shortage", {
    p_shortage_id: shortageId,
    p_as_loss: asLoss,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}

/** Częściowy zwrot budowa → magazyn w trakcie prac (Admin). */
export async function returnMaterialToWarehouse(
  buildId: number,
  materialId: number,
  quantity: number,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("return_material_to_warehouse", {
    p_build_id: buildId,
    p_material_id: materialId,
    p_quantity: quantity,
    p_note: note?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

/** Admin: strata księgowana od razu. Brygadzista: zgłoszenie do zatwierdzenia. */
export async function reportMaterialLoss(
  buildId: number,
  materialId: number,
  quantity: number,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("report_material_loss", {
    p_build_id: buildId,
    p_material_id: materialId,
    p_quantity: quantity,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export type LossRequestRow = {
  id: number;
  buildId: number;
  materialId: number;
  qty: number;
  reason: string;
  status: "oczekuje" | "zatwierdzona" | "odrzucona";
  createdAt: string;
};

export async function listLossRequests(): Promise<LossRequestRow[]> {
  const { data, error } = await supabase
    .from("material_loss_requests")
    .select("id, buildId:build_id, materialId:material_id, qty, reason, status, createdAt:created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, qty: Number(r.qty) })) as LossRequestRow[];
}

export async function approveMaterialLoss(requestId: number, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc("approve_material_loss", {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
}

export type StockReviewRow = {
  id: string;
  buildId: number | null;
  note: string | null;
  createdAt: string;
  lines: { materialId: number; quantity: number; unitPrice: number }[];
};

/** Pobrania z magazynu wykonane przez brygadzistę, czekające na weryfikację Admina (D3). */
export async function listPendingStockReviews(): Promise<StockReviewRow[]> {
  const { data, error } = await supabase
    .from("stock_operations")
    .select(
      "id, buildId:build_id, note, createdAt:created_at, stock_ledger(material_id, qty_delta, unit_price, location_build_id)",
    )
    .eq("needs_review", true)
    .is("reviewed_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((op) => ({
    id: op.id as string,
    buildId: op.buildId as number | null,
    note: op.note as string | null,
    createdAt: op.createdAt as string,
    lines: ((op.stock_ledger ?? []) as {
      material_id: number;
      qty_delta: number;
      unit_price: number;
      location_build_id: number | null;
    }[])
      .filter((l) => l.location_build_id != null && Number(l.qty_delta) > 0)
      .map((l) => ({
        materialId: l.material_id,
        quantity: Number(l.qty_delta),
        unitPrice: Number(l.unit_price),
      })),
  }));
}

export async function verifyStockOperation(operationId: string): Promise<void> {
  const { error } = await supabase.rpc("verify_stock_operation", { p_operation_id: operationId });
  if (error) throw new Error(error.message);
}

export type IntegrityAlertRow = {
  id: number;
  checkedAt: string;
  issues: { check: string; detail: Record<string, unknown> }[];
};

/** Alerty nocnej kontroli spójności (tylko Admin widzi wiersze). */
export async function listIntegrityAlerts(): Promise<IntegrityAlertRow[]> {
  const { data, error } = await supabase
    .from("stock_integrity_alerts")
    .select("id, checkedAt:checked_at, issues")
    .is("acknowledged_at", null)
    .order("checked_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []) as IntegrityAlertRow[];
}

export const RESOLUTION_LABELS: Record<string, string> = {
  dostawa: "dostawa na budowę",
  transfer: "transfer z innej budowy",
  wydanie: "wydanie z magazynu",
  korekta_raportu: "korekta raportu",
  roznica_inwentaryzacyjna: "różnica inwentaryzacyjna",
};
