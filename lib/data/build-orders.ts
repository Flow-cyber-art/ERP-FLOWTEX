import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla zamówień materiałów jako nagłówek + pozycje — Faza 3
 * modułu Technologia. Generowanie i przyjęcie idą przez RPC (patrz
 * supabase/sql/007_faza3_zamowienia.sql): agregacja planu materiałowego
 * budowy i wieloetapowe przyjęcie dostawy (partia per pozycja) muszą
 * wykonać się atomowo. Zmiana statusu nagłówka i edycja ilości
 * zamawianej (przed wysyłką do dostawcy) idą wprost przez update —
 * ten sam wzorzec co `lib/data/orders.ts` dla starego `material_orders`.
 *
 * Nie zastępuje `lib/data/orders.ts` — oba flow działają równolegle
 * (patrz komentarz w 007_faza3_zamowienia.sql).
 */

export type BuildOrderStatus = "robocze" | "zamówione" | "przyjęte" | "anulowane";

export type BuildOrderItemRow = {
  id: number;
  orderId: number;
  materialName: string;
  linkedMaterialId: number | null;
  plannedQuantity: string;
  orderedQuantity: string;
  unit: string;
  receivedQuantity: string | null;
  receivedUnitPrice: string | null;
};

export type BuildOrderRow = {
  id: number;
  buildId: number;
  orderNumber: string;
  status: BuildOrderStatus;
  notes: string | null;
  createdAt: string;
  order_items: BuildOrderItemRow[];
};

const ORDER_SELECT =
  "id, buildId:build_id, orderNumber:order_number, status, notes, createdAt, " +
  "order_items(id, orderId:order_id, materialName:material_name, linkedMaterialId:linked_material_id, " +
  "plannedQuantity:planned_quantity, orderedQuantity:ordered_quantity, unit, " +
  "receivedQuantity:received_quantity, receivedUnitPrice:received_unit_price)";

/** Wszystkie zamówienia naraz (jak assignments/savedReports), filtrowane po buildId w UI. */
export async function listBuildOrders(): Promise<BuildOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .order("createdAt", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BuildOrderRow[];
}

/** Agreguje `build_material_plan` budowy w jedno nowe zamówienie (status "robocze"). */
export async function generateOrderFromPlan(buildId: number): Promise<number> {
  const { data, error } = await supabase.rpc("generate_order_from_plan", {
    p_build_id: buildId,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

/** Ilość zamawiana różna od planowanej (zaokrąglenia do opakowań) — edytowalna, dopóki "robocze". */
export async function updateOrderItemQuantity(
  itemId: number,
  orderedQuantity: number,
): Promise<void> {
  const { error } = await supabase
    .from("order_items")
    .update({ ordered_quantity: orderedQuantity })
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function markBuildOrderOrdered(orderId: number): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .update({ status: "zamówione" satisfies BuildOrderStatus })
    .eq("id", orderId);
  if (error) throw new Error(error.message);
}

export async function cancelBuildOrder(orderId: number): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .update({ status: "anulowane" satisfies BuildOrderStatus })
    .eq("id", orderId);
  if (error) throw new Error(error.message);
}

export type ReceiveBuildOrderItemInput = {
  itemId: number;
  receivedQuantity: number;
  receivedUnitPrice?: number;
};

export async function receiveBuildOrder(
  orderId: number,
  items: ReceiveBuildOrderItemInput[],
): Promise<void> {
  const { error } = await supabase.rpc("receive_order", {
    p_order_id: orderId,
    p_items: items.map((i) => ({
      itemId: i.itemId,
      receivedQuantity: i.receivedQuantity,
      receivedUnitPrice: i.receivedUnitPrice ?? null,
    })),
  });
  if (error) throw new Error(error.message);
}
