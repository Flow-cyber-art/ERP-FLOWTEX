import { supabase } from "@/lib/supabase";

/**
 * Warstwa danych dla przypisań materiałów do budów (build_materials) —
 * bezpośrednio z Supabase (anon key + RLS). Odpowiednik
 * `buildMaterialsRouter` z dawnego `server/data-routers.ts`. `commit`
 * idzie przez RPC — dolicza `planned` per pozycja atomowo (upsert z
 * `planned = planned + X`, którego nie da się bezpiecznie wyrazić jedną
 * operacją REST bez wyścigu przy dwóch równoległych zapisach).
 */

export type BuildMaterialRow = {
  buildId: number;
  materialId: number;
  planned: string;
  used: string;
  unitPrice: string;
};

const BUILD_MATERIAL_COLUMNS = "buildId, materialId, planned, used, unitPrice";

export async function listBuildMaterials(): Promise<BuildMaterialRow[]> {
  const { data, error } = await supabase.from("build_materials").select(BUILD_MATERIAL_COLUMNS);
  if (error) throw new Error(error.message);
  return (data ?? []) as BuildMaterialRow[];
}

export type CommitBuildMaterialsItem = { materialId: number; planned: number };

// Wcześniejszy flow (Admin wpisywał tylko ilość planowaną, bez wyboru
// partii — magazyn rozliczał się sam, automatycznym FIFO, dopiero przy
// raporcie dziennym). Zastąpiony w Fazie 5 przez
// `assignMaterialBatchesToBuild` poniżej; RPC `commit_build_materials`
// zostaje w bazie nieużywana (nikt jej już stąd nie woła), żeby nie
// ryzykować dropowania czegoś, co mogło zostać wywołane gdzie indziej.
export async function commitBuildMaterials(
  buildId: number,
  items: CommitBuildMaterialsItem[],
): Promise<void> {
  const { error } = await supabase.rpc("commit_build_materials", {
    p_build_id: buildId,
    p_items: items,
  });
  if (error) throw new Error(error.message);
}

export type AssignMaterialBatchItem = { batchId: number; quantity: number };

/**
 * Ręczny wybór partii (Faza 5) — dla materiałów SPOZA planu technologii.
 * Admin wskazuje konkretną partię (z jej realną ceną/datą) i ile z niej
 * trafia na budowę; jedno wywołanie może objąć wiele partii/materiałów
 * naraz (odpowiednik dawnego koszyka "+ Dodaj do listy"). Materiały Z
 * planu technologii nie przechodzą przez to — przypisanie następuje
 * automatycznie przy przyjęciu zamówienia (receive_order, Faza 3/4).
 */
export async function assignMaterialBatchesToBuild(
  buildId: number,
  items: AssignMaterialBatchItem[],
): Promise<void> {
  const { error } = await supabase.rpc("assign_material_batches_to_build", {
    p_build_id: buildId,
    p_items: items,
  });
  if (error) throw new Error(error.message);
}

/**
 * Odwrotność assignMaterialBatchesToBuild — cofa pomyłkowo dodane
 * przypisanie materiału pomocniczego (zwraca ilość do partii źródłowej,
 * usuwa lot(y) i wpis w build_materials). Zablokowane po stronie RPC,
 * jeśli materiał został już częściowo zużyty w raporcie.
 */
export async function unassignMaterialFromBuild(
  buildId: number,
  materialId: number,
): Promise<void> {
  const { error } = await supabase.rpc("unassign_material_from_build", {
    p_build_id: buildId,
    p_material_id: materialId,
  });
  if (error) throw new Error(error.message);
}

export type BuildMaterialLotRow = {
  id: number;
  buildId: number;
  materialId: number;
  sourceBatchId: number | null;
  quantity: string;
  unitPrice: string;
  issuedAt: string;
};

/** Partie faktycznie przypisane do budów (Faza 5) — do rozbicia "z jakiej partii" w raporcie/rozliczeniu. */
export async function listBuildMaterialLots(): Promise<BuildMaterialLotRow[]> {
  const { data, error } = await supabase
    .from("build_material_lots")
    .select("id, buildId, materialId, sourceBatchId, quantity, unitPrice, issuedAt");
  if (error) throw new Error(error.message);
  return (data ?? []) as BuildMaterialLotRow[];
}

export type BuildMaterialReturnRow = {
  id: number;
  buildId: number;
  materialId: number;
  batchId: number | null;
  quantity: string;
  decision: "zwrot" | "wyrzucenie";
  reason: string | null;
  unitPrice: string;
  createdAt: string;
};

/**
 * Decyzje o pozostałości materiałowej przy zamknięciu budowy (Faza 9) —
 * trwały log, jeden wiersz na partię rozliczoną przy `close_build`. Do
 * policzenia "Straty materiałowe" w Rozliczeniu (§6,
 * docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md): suma `quantity * unitPrice`
 * wierszy z `decision = 'wyrzucenie'` dla danej budowy — liczone na żywo
 * z tej tabeli (ma Realtime, patrz lib/data/use-realtime-sync.ts), nie z
 * `build_settlements` (ten snapshot dziś nigdzie nie jest odczytywany
 * z powrotem do frontu — osobny, wcześniejszy dług).
 */
export async function listBuildMaterialReturns(): Promise<BuildMaterialReturnRow[]> {
  const { data, error } = await supabase
    .from("build_material_returns")
    .select("id, buildId, materialId, batchId, quantity, decision, reason, unitPrice, createdAt");
  if (error) throw new Error(error.message);
  return (data ?? []) as BuildMaterialReturnRow[];
}
