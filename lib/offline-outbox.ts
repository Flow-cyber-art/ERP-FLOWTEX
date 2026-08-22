import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { submitDailyReport } from "@/lib/data/reports";

/**
 * Kolejka "wyślij, gdy się da" dla raportów dziennych. Nie jest to
 * ogólny sync-engine dla całej aplikacji (magazyn/HR/budowy zostają na
 * razie lokalne) — celowo wąski zakres, patrz uzasadnienie w rozmowie:
 * offline dotyczy tylko brygadzisty wypełniającego raport bez zasięgu.
 *
 * Mechanizm:
 * 1. `enqueueReport` od razu zapisuje raport do AsyncStorage (status
 *    "pending") i próbuje go wysłać.
 * 2. Jeśli wysyłka się nie uda (brak sieci, RPC padnie, timeout) —
 *    zostaje w kolejce. Nie rozróżniamy "offline" od "serwer padł na
 *    chwilę": w obu przypadkach poprawna reakcja jest identyczna (spróbuj
 *    ponownie później), więc nie ma sensu dokładać zależności typu
 *    NetInfo tylko po to, żeby to rozróżnić.
 * 3. `flushOutbox()` przechodzi kolejkę po kolei (ważna kolejność:
 *    jeśli brygadzista poprawiał ten sam raport offline kilka razy,
 *    ostatnia wersja ma wygrać) i wywołuje `submitDailyReport`, który
 *    jest idempotentny po (buildId, date) — bezpiecznie wywołać go
 *    wielokrotnie (upsert w bazie, patrz supabase/sql/001_rpc_functions.sql).
 * 4. Wołaj `flushOutbox()`: przy starcie apki, po evencie `online`
 *    (web) i po każdym udanym wysłaniu raportu online (patrz
 *    `enqueueReport`) — to pokrywa >95% przypadków bez dodatkowych
 *    zależności. Jeśli chcecie też odpalać flush na powrót z tła na
 *    natywnym iOS/Android, dodajcie `@react-native-community/netinfo`
 *    i wywołajcie stąd `flushOutbox()` w jego listenerze.
 */

const STORAGE_KEY = "offline-outbox:reports";

export type PendingReportSubmission = {
  buildId: number;
  date: string;
  people: { employeeId: number; start: string; end: string }[];
  materials: {
    materialId: number;
    usedQuantity: number;
    reason?: string;
  }[];
  extraCosts: { label: string; amount: number; note?: string }[];
  /** Kiedy dodane do kolejki lokalnie — do sortowania i debugowania. */
  queuedAt: string;
  /** Liczba nieudanych prób — do prostego backoffu / ostrzeżenia w UI. */
  attempts: number;
};

/** Klucz identyfikujący raport w kolejce lokalnej — jeden raport na budowę+dzień. */
function reportKey(item: Pick<PendingReportSubmission, "buildId" | "date">) {
  return `${item.buildId}:${item.date}`;
}

async function readQueue(): Promise<PendingReportSubmission[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingReportSubmission[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingReportSubmission[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

/** Ile raportów czeka na wysyłkę — do np. badge'a w UI ("2 do wysłania"). */
export async function getPendingCount(): Promise<number> {
  return (await readQueue()).length;
}

export async function getPendingReports(): Promise<PendingReportSubmission[]> {
  return readQueue();
}

/**
 * Dodaje raport do kolejki lokalnej i od razu próbuje go wysłać.
 * Zwraca `{ sent: true }` jeśli poszło od razu, albo `{ sent: false }`
 * jeśli został w kolejce (UI powinien wtedy pokazać "zapisano, wyśle
 * się automatycznie" zamiast błędu).
 */
export async function enqueueReport(
  submission: Omit<PendingReportSubmission, "queuedAt" | "attempts">,
): Promise<{ sent: boolean }> {
  const queue = await readQueue();
  const withoutDuplicate = queue.filter(
    (item) => reportKey(item) !== reportKey(submission),
  );
  const entry: PendingReportSubmission = {
    ...submission,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  await writeQueue([...withoutDuplicate, entry]);

  const result = await flushOutbox();
  return { sent: !result.remainingKeys.includes(reportKey(submission)) };
}

let flushInFlight: Promise<{
  succeededKeys: string[];
  remainingKeys: string[];
}> | null = null;

/**
 * Próbuje wysłać wszystkie oczekujące raporty, w kolejności dodania.
 * Bezpieczne wywołać wiele razy naraz (np. start apki + event "online"
 * w tym samym momencie) — równoległe wywołania czekają na jeden przelot.
 */
export async function flushOutbox(): Promise<{
  succeededKeys: string[];
  remainingKeys: string[];
}> {
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async () => {
    const queue = await readQueue();
    const succeededKeys: string[] = [];
    const stillPending: PendingReportSubmission[] = [];

    for (const item of queue) {
      try {
        await submitDailyReport({
          buildId: item.buildId,
          date: item.date,
          people: item.people,
          materials: item.materials,
          extraCosts: item.extraCosts,
        });
        succeededKeys.push(reportKey(item));
      } catch (error) {
        // Brak sieci / serwer niedostępny / walidacja nieudana — zostaje
        // w kolejce do kolejnej próby. Nie logujemy tu do usera, bo flush
        // może się dziać po cichu w tle wielokrotnie.
        stillPending.push({ ...item, attempts: item.attempts + 1 });
      }
    }

    await writeQueue(stillPending);
    return { succeededKeys, remainingKeys: stillPending.map(reportKey) };
  })();

  try {
    return await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

/**
 * Podpina automatyczny flush przy starcie i (na webie) po evencie
 * `online`. Wołaj raz, np. w `app/_layout.tsx`.
 */
export function initOfflineOutbox(): () => void {
  flushOutbox();

  if (Platform.OS === "web" && typeof window !== "undefined") {
    const handler = () => flushOutbox();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }

  return () => {};
}
