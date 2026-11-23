import { describe, it, expect, vi, beforeEach } from "vitest";

// Zależności natywne / sieciowe podmienione — testujemy samą logikę kolejki.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/data/push-tokens", () => ({ notifyNewReport: async () => undefined }));
const submit = vi.fn();
vi.mock("@/lib/data/reports", () => {
  class SupabaseRpcError extends Error {
    code?: string;
    constructor(m: string, c?: string) { super(m); this.code = c; }
  }
  return { SupabaseRpcError, submitDailyReport: (...a: unknown[]) => submit(...a) };
});

import { describeError, enqueueReport, getPendingCount, flushOutbox } from "./offline-outbox";
import { SupabaseRpcError } from "@/lib/data/reports";

const report = { buildId: 1, date: "2026-11-24", people: [], materials: [], extraCosts: [] };

describe("kolejka offline — klasyfikacja błędu (F28)", () => {
  it("brak sieci z supabase-js (code pusty) = błąd sieci", () => {
    expect(describeError(new SupabaseRpcError("TypeError: Failed to fetch", "")).isNetworkError).toBe(true);
  });
  it("Safari „Load failed” = błąd sieci", () => {
    expect(describeError(new SupabaseRpcError("TypeError: Load failed", "")).isNetworkError).toBe(true);
  });
  it("odrzucenie przez serwer (kod Postgresa) ≠ błąd sieci", () => {
    expect(describeError(new SupabaseRpcError("Ta budowa jest zamknięta", "P0001")).isNetworkError).toBe(false);
  });
});

describe("kolejka offline — wysyłka", () => {
  beforeEach(() => { store.clear(); submit.mockReset(); });

  it("raport bez sieci zostaje w kolejce i wysyła się przy następnej próbie, dokładnie raz", async () => {
    submit.mockRejectedValueOnce(new SupabaseRpcError("TypeError: Failed to fetch", ""));
    const r = await enqueueReport(report);
    expect(r).toMatchObject({ sent: false, isNetworkError: true });
    expect(await getPendingCount()).toBe(1);

    submit.mockResolvedValueOnce({ reportId: 1, materials: [], kmRateApplied: null, kmCost: null });
    const res = await flushOutbox();
    expect(res.succeededKeys).toEqual(["1:2026-11-24:"]);
    expect(await getPendingCount()).toBe(0);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("ten sam raport zapisany dwa razy offline = jedna pozycja w kolejce", async () => {
    submit.mockRejectedValue(new SupabaseRpcError("TypeError: Failed to fetch", ""));
    await enqueueReport(report);
    await enqueueReport({ ...report, note: "poprawka" });
    expect(await getPendingCount()).toBe(1);
  });
});
