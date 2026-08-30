import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Klienci dla dwóch Edge Functions Gemini — patrz
 * supabase/functions/generate-client-summary/index.ts (podsumowanie
 * CAŁEJ budowy) i supabase/functions/generate-report-note/index.ts
 * (oczyszczona notatka JEDNEGO raportu dziennego). Klucz Gemini żyje
 * wyłącznie w tych funkcjach, nigdy w apce.
 */

// Na non-2xx odpowiedź (400/403/404/500...) supabase-js NIE czyta ciała
// odpowiedzi za nas — `error.message` to zawsze ten sam ogólny tekst
// "Edge Function returned a non-2xx status code", a nasz czytelny komunikat
// (np. "Brak zatwierdzonych raportów dla tej budowy...") leży w
// `error.context` (Response). Bez tego admin/klient widzi tylko generyczny
// czerwony błąd bez żadnej wskazówki co poprawić.
async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return String(body.error);
    } catch {
      // Ciało nie jest JSON-em (np. błąd sieci/proxy) — zostaje fallback.
    }
  }
  return error instanceof Error ? error.message : fallback;
}

export async function generateClientSummary(
  buildId: number,
): Promise<{ summary: string; generatedAt: string }> {
  const { data, error } = await supabase.functions.invoke("generate-client-summary", {
    body: { buildId },
  });
  if (error) throw new Error(await functionErrorMessage(error, "Nie udało się wygenerować raportu."));
  if (data?.error) throw new Error(data.error);
  return data as { summary: string; generatedAt: string };
}

/**
 * Wariant wołany z publicznego portalu klienta (bez sesji) — dozwolony
 * tylko gdy Admin włączył "Klient może wygenerować raport AI" dla danej
 * budowy (builds.allow_client_ai_summary), co Edge Function sama
 * sprawdza po tokenie portalu.
 */
export async function generateClientSummaryPublic(
  publicToken: string,
): Promise<{ summary: string; generatedAt: string }> {
  const { data, error } = await supabase.functions.invoke("generate-client-summary", {
    body: { publicToken },
  });
  if (error) throw new Error(await functionErrorMessage(error, "Nie udało się wygenerować raportu."));
  if (data?.error) throw new Error(data.error);
  return data as { summary: string; generatedAt: string };
}

export async function generateReportClientNote(
  reportId: number,
): Promise<{ clientNote: string | null; generatedAt: string }> {
  const { data, error } = await supabase.functions.invoke("generate-report-note", {
    body: { reportId },
  });
  if (error) throw new Error(await functionErrorMessage(error, "Nie udało się wygenerować notatki."));
  if (data?.error) throw new Error(data.error);
  return data as { clientNote: string | null; generatedAt: string };
}
