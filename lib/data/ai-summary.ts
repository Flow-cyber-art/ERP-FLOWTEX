import { supabase } from "@/lib/supabase";

/**
 * Klienci dla dwóch Edge Functions Gemini — patrz
 * supabase/functions/generate-client-summary/index.ts (podsumowanie
 * CAŁEJ budowy) i supabase/functions/generate-report-note/index.ts
 * (oczyszczona notatka JEDNEGO raportu dziennego). Klucz Gemini żyje
 * wyłącznie w tych funkcjach, nigdy w apce.
 */
export async function generateClientSummary(
  buildId: number,
): Promise<{ summary: string; generatedAt: string }> {
  const { data, error } = await supabase.functions.invoke("generate-client-summary", {
    body: { buildId },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as { summary: string; generatedAt: string };
}

export async function generateReportClientNote(
  reportId: number,
): Promise<{ clientNote: string | null; generatedAt: string }> {
  const { data, error } = await supabase.functions.invoke("generate-report-note", {
    body: { reportId },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as { clientNote: string | null; generatedAt: string };
}
