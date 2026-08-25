import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla zamówień materiałów — bezpośrednio z Supabase (anon
 * key + RLS). Odpowiednik `ordersRouter` z dawnego `server/data-routers.ts`.
 * `receiveOrder` idzie przez RPC (dopisanie partii + przeliczenie stanu +
 * oznaczenie zamówienia jako dostarczone musi wykonać się atomowo).
 */

export type OrderStatus = "do realizacji" | "zamówione" | "dostarczone";

export type MaterialOrderRow = {
  id: number;
  materialId: number | null;
  materialName: string;
  quantity: string;
  unit: string;
  status: OrderStatus;
  createdAt: string;
  orderedAt: string | null;
  receivedQuantity: string | null;
  receivedUnitPrice: string | null;
  receivedAt: string | null;
  batchId: string | null;
};

const ORDER_COLUMNS =
  "id, materialId, materialName, quantity, unit, status, createdAt, orderedAt, receivedQuantity, receivedUnitPrice, receivedAt, batchId";

export async function listOrders(): Promise<MaterialOrderRow[]> {
  const { data, error } = await supabase
    .from("material_orders")
    .select(ORDER_COLUMNS)
    .order("createdAt", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MaterialOrderRow[];
}

export type CreateOrderInput = {
  materialId?: number;
  materialName: string;
  quantity: number;
  unit: string;
  // Wspólny identyfikator dla pozycji tworzonych naraz z koszyka — patrz
  // submitOrderCart w contexts/app-data.tsx. Pojedyncze zamówienia
  // (createOrderFromShortage) go nie przekazują.
  batchId?: string;
};

export async function createOrder(input: CreateOrderInput): Promise<void> {
  const { error } = await supabase.from("material_orders").insert({
    materialId: input.materialId ?? null,
    materialName: input.materialName,
    quantity: input.quantity,
    unit: input.unit,
    batchId: input.batchId ?? null,
    status: "do realizacji" satisfies OrderStatus,
  });
  if (error) throw new Error(error.message);
}

export async function markOrderOrdered(orderId: number): Promise<void> {
  const { error } = await supabase
    .from("material_orders")
    .update({ status: "zamówione" satisfies OrderStatus, orderedAt: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw new Error(error.message);
}

// Tylko zamówienia jeszcze niezłożone u dostawcy ("do realizacji") — patrz
// delete_material_order w supabase/sql/023_usuwanie_zamowien_material_orders.sql.
export async function deleteOrder(orderId: number): Promise<void> {
  const { error } = await supabase.rpc("delete_material_order", { p_order_id: orderId });
  if (error) throw new Error(error.message);
}

export async function receiveOrder(
  orderId: number,
  receivedQuantity: number,
  receivedUnitPrice?: number,
  documentNumber?: string,
  supplier?: string,
): Promise<void> {
  const { error } = await supabase.rpc("receive_material_order", {
    p_order_id: orderId,
    p_received_quantity: receivedQuantity,
    p_received_unit_price: receivedUnitPrice ?? null,
    p_document_number: documentNumber?.trim() || null,
    p_supplier: supplier?.trim() || null,
  });
  if (error) throw new Error(error.message);
}
