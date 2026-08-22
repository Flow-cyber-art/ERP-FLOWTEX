import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla realnych partii magazynowych — Faza 4 modułu
 * Technologia. Czysty odczyt: `material_batches.quantity` to już
 * ilość DOSTĘPNA (FIFO w `fn_consume_fifo`, 001_rpc_functions.sql,
 * zmniejsza ją albo usuwa wiersz przy zejściu do zera — nie ma osobnej
 * kolumny "zużyte"). Wcześniej ekran magazynu w ogóle nie odpytywał tej
 * tabeli — odtwarzał jedną fikcyjną partię z samego `materials.stock`
 * (patrz komentarz przy `materialsQuery` w contexts/app-data.tsx); ten
 * plik i `warehouseBatches` w kontekście to osobny, prawdziwy odczyt,
 * używany tylko do WYŚWIETLENIA partii na ekranie magazynu — celowo NIE
 * zastępuje `materialBatches` (lokalna symulacja FIFO pod offline/
 * optymistyczny raport dzienny), żeby nie ruszać tamtej, przetestowanej
 * ścieżki w tej fazie.
 */

export type MaterialBatchRow = {
  id: number;
  materialId: number;
  quantity: string;
  unitPrice: string;
  receivedAt: string;
  source: string;
  documentNumber: string | null;
  supplier: string | null;
};

const BATCH_COLUMNS =
  "id, materialId, quantity, unitPrice, receivedAt, source, documentNumber, supplier";

export async function listMaterialBatches(): Promise<MaterialBatchRow[]> {
  const { data, error } = await supabase
    .from("material_batches")
    .select(BATCH_COLUMNS)
    .order("receivedAt", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MaterialBatchRow[];
}
