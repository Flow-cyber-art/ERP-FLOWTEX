import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { submitDailyReport, SupabaseRpcError } from "@/lib/data/reports";
import { notifyNewReport } from "@/lib/data/push-tokens";

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
 *    zostaje w kolejce niezależnie od przyczyny (retry i tak jest
 *    identyczny). Rozróżniamy jednak przyczynę PRZY KOMUNIKACIE dla
 *    użytkownika (patrz `isNetworkError` niżej): serwer, który aktywnie
 *    ODRZUCIŁ zapis (np. `RAISE EXCEPTION` w `submit_daily_report` —
 *    zawsze niesie `code` z Postgresa, patrz `SupabaseRpcError` w
 *    `lib/data/reports.ts`) nie naprawi się samym czekaniem na internet,
 *    który już jest — pokazywanie wtedy "brak połączenia" wprowadzało
 *    brygadzistę w błąd (raport i tak nigdy się nie wyśle, dopóki
 *    przyczyna nie zostanie poprawiona). Prawdziwy błąd sieci (fetch nie
 *    dotarł do serwera w ogóle) nie ma skąd wziąć `code`, więc jego brak
 *    jest tu heurystyką "to jednak faktycznie sieć" — bez dokładania
 *    zależności typu NetInfo tylko po to, żeby to rozróżnić.
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
    stageName?: string;
  }[];
  extraCosts: { label: string; amount: number; note?: string; category?: string }[];
  // Kilometrówka (Faza 7) — patrz submitDailyReport w lib/data/reports.ts.
  km?: number;
  // Notatka do raportu (Decyzja B) — patrz submitDailyReport w lib/data/reports.ts.
  note?: string;
  /** Kiedy dodane do kolejki lokalnie — do sortowania i debugowania. */
  queuedAt: string;
  /** Liczba nieudanych prób — do prostego backoffu / ostrzeżenia w UI. */
  attempts: number;
  /** Treść ostatniego błędu przy próbie wysyłki (do pokazania w UI). */
  lastError?: string;
  /**
   * `true` gdy ostatni błąd wygląda na brak połączenia (serwer nie
   * odpowiedział w ogóle, nie ma kodu Postgresa) — `false`/`undefined`
   * gdy to serwer aktywnie odrzucił zapis (patrz komentarz na górze
   * pliku); w tym drugim przypadku UI powinien pokazać `lastError`
   * zamiast generycznego "brak internetu".
   */
  isNetworkError?: boolean;
};

function describeError(error: unknown): { message: string; isNetworkError: boolean } {
  if (error instanceof SupabaseRpcError) {
    // `code` obecny = Postgres/RPC faktycznie odpowiedział i odrzucił
    // zapis — to NIE jest brak sieci, retry bez poprawy przyczyny nigdy
    // się nie powiedzie.
    return { message: error.message, isNetworkError: error.code === undefined };
  }
  if (error instanceof Error) {
    return { message: error.message, isNetworkError: true };
  }
  return { message: String(error), isNetworkError: true };
}

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
 * Zwraca `{ sent: true }` jeśli poszło od razu, albo `{ sent: false,
 * errorMessage, isNetworkError }` jeśli został w kolejce — UI powinien
 * wtedy pokazać "zapisano, wyśle się automatycznie" TYLKO gdy
 * `isNetworkError` jest `true`; w przeciwnym razie serwer aktywnie
 * odrzucił zapis i trzeba pokazać `errorMessage` (czekanie na internet
 * nic tu nie da, bo internet już jest).
 */
export async function enqueueReport(
  submission: Omit<PendingReportSubmission, "queuedAt" | "attempts">,
): Promise<{ sent: boolean; errorMessage?: string; isNetworkError?: boolean }> {
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
  const key = reportKey(submission);
  const failed = result.failed.find((item) => reportKey(item) === key);
  return failed
    ? { sent: false, errorMessage: failed.lastError, isNetworkError: failed.isNetworkError }
    : { sent: true };
}

let flushInFlight: Promise<{
  succeededKeys: string[];
  remainingKeys: string[];
  failed: PendingReportSubmission[];
}> | null = null;

/**
 * Próbuje wysłać wszystkie oczekujące raporty, w kolejności dodania.
 * Bezpieczne wywołać wiele razy naraz (np. start apki + event "online"
 * w tym samym momencie) — równoległe wywołania czekają na jeden przelot.
 */
export async function flushOutbox(): Promise<{
  succeededKeys: string[];
  remainingKeys: string[];
  failed: PendingReportSubmission[];
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
          km: item.km,
          note: item.note,
        });
        succeededKeys.push(reportKey(item));
        // Push do Adminów "na bieżąco" — best-effort, patrz komentarz na
        // notifyNewReport. Nigdy nie może zablokować ani cofnąć wysyłki
        // raportu powyżej, która już się udała.
        notifyNewReport(item.buildId, item.date).catch(() => undefined);
      } catch (error) {
        // Zostaje w kolejce do kolejnej próby niezależnie od przyczyny —
        // ale zapisujemy przyczynę (patrz describeError), żeby UI mógł
        // pokazać brygadziście prawdziwy powód zamiast zawsze zgadywać
        // "brak internetu". Nie logujemy tu do usera, bo flush może się
        // dziać po cichu w tle wielokrotnie.
        const { message, isNetworkError } = describeError(error);
        stillPending.push({
          ...item,
          attempts: item.attempts + 1,
          lastError: message,
          isNetworkError,
        });
      }
    }

    await writeQueue(stillPending);
    return {
      succeededKeys,
      remainingKeys: stillPending.map(reportKey),
      failed: stillPending,
    };
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
