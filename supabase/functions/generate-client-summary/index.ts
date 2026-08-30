// Skonsolidowane podsumowanie budowy dla klienta, pisane "głosem"
// kierownika budowy, generowane przez Gemini na podstawie WSZYSTKICH
// zatwierdzonych raportów dziennych (nie pojedynczego raportu — patrz
// 063_portal_klienta_podsumowanie_ai.sql). Powód: notatka brygadzisty
// (reports.note) bywa skrótowa, zmęczona albo wspomina rzeczy, których
// zleceniodawca nie powinien czytać wprost. Ta funkcja buduje z surowych
// danych jeden neutralny, rzeczowy tekst — i to jedyne, co może trafić
// do builds.ai_client_summary (jedyne pole czytane przez portal klienta).
//
// Twardo wykluczone z promptu (nigdy nie trafiają do Gemini, więc nie
// mogą "wyciec" do wygenerowanego tekstu): kwoty/koszty (extra_costs,
// wartości materiałów, km), dane osobowe pracowników (imiona, nazwiska,
// godziny pracy). Do modelu idą wyłącznie: daty, nazwy materiałów +
// zużyte ilości + jednostki, nazwy etapów technologii, i sama treść
// notatek brygadzisty (jako materiał źródłowy do przepisania na
// neutralny ton — model ma instrukcję pomijać w opisie skargi/emocje/
// konflikty personalne, jeśli się w notatkach pojawią).
//
// Wymaga (Supabase Dashboard -> Edge Functions -> Secrets):
//   GEMINI_API_KEY — klucz z Google AI Studio (https://aistudio.google.com/apikey).
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy new function ->
// nazwa "generate-client-summary" -> wklej ten plik -> Deploy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const SYSTEM_PROMPT = `Jesteś kierownikiem budowy piszącym krótkie, rzeczowe podsumowanie postępu prac dla zleceniodawcy (klienta), na podstawie wewnętrznych notatek brygadzisty i zestawienia zużytych materiałów/etapów.

Zasady:
- Pisz po polsku, w tonie profesjonalnym i neutralnym — jak oficjalna aktualizacja dla klienta, nie jak wewnętrzna notatka.
- Opisz przekrój wykonanych prac i etapów (warstw) w porządku chronologicznym lub tematycznym — co zostało zrobione, jakie materiały/etapy zostały ukończone lub są w toku.
- NIGDY nie wspominaj: kwot, cen, kosztów, stawek, wynagrodzeń, imion i nazwisk konkretnych pracowników, liczby przepracowanych godzin przez osoby, wewnętrznych konfliktów, skarg na konkretne osoby, ani żadnych danych, które nie powinny trafić do klienta.
- Jeśli w notatkach źródłowych pojawiają się emocje, narzekania, spięcia w ekipie lub drobne problemy organizacyjne — NIE cytuj ich i nie wspominaj wprost; jeśli miały realny wpływ na harmonogram, opisz to jednym neutralnym zdaniem (np. "wystąpiło krótkie opóźnienie związane z dostawą materiału"), bez szczegółów i bez obwiniania kogokolwiek.
- Nie zmyślaj informacji, których nie ma w danych źródłowych.
- Format: 2-5 akapitów zwykłego tekstu, bez nagłówków markdown, bez list punktowanych, bez emoji.`;

type ReportRow = {
  date: string;
  note: string | null;
};

type MaterialUsageRow = {
  date: string;
  materialName: string;
  unit: string | null;
  usedQuantity: string;
  stageName: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Brak nagłówka autoryzacji." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    return json(
      { error: "Integracja z Gemini nie jest skonfigurowana (brak sekretu GEMINI_API_KEY)." },
      500,
    );
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) return json({ error: "Nieprawidłowa sesja." }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!callerProfile || callerProfile.role !== "Admin") {
    return json({ error: "Wymagana rola Admin." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Nieprawidłowe body żądania." }, 400);
  }
  const buildId = Number(body.buildId);
  if (!buildId) return json({ error: "Brak buildId." }, 400);

  const { data: build, error: buildError } = await admin
    .from("builds")
    .select("id, name, number")
    .eq("id", buildId)
    .maybeSingle();
  if (buildError || !build) return json({ error: "Nie znaleziono budowy." }, 404);

  // Tylko raporty zatwierdzone (submitted mogą się jeszcze zmienić lub
  // zostać odrzucone) — ten sam próg co surowa lista notatek w
  // get_public_build sprzed tej zmiany (059).
  const { data: reports } = await admin
    .from("reports")
    .select("id, date, note")
    .eq("buildId", buildId)
    .eq("status", "approved")
    .order("date", { ascending: true });

  const reportRows = (reports ?? []) as { id: number; date: string; note: string | null }[];
  if (reportRows.length === 0) {
    return json({ error: "Brak zatwierdzonych raportów dla tej budowy — nie ma z czego zbudować podsumowania." }, 400);
  }

  const reportIds = reportRows.map((r) => r.id);
  const { data: materialUsage } = await admin
    .from("report_materials")
    .select('reportId, usedQuantity, stageName:stage_name, materials(name, unit)')
    .in("reportId", reportIds);

  const reportDateById = new Map(reportRows.map((r) => [r.id, r.date]));
  const materialLines: MaterialUsageRow[] = (materialUsage ?? []).map((row: any) => ({
    date: reportDateById.get(row.reportId) ?? "",
    materialName: row.materials?.name ?? "materiał",
    unit: row.materials?.unit ?? null,
    usedQuantity: String(row.usedQuantity ?? "0"),
    stageName: row.stageName ?? null,
  }));

  const notesText = reportRows
    .filter((r) => r.note && r.note.trim().length > 0)
    .map((r) => `- ${r.date}: ${r.note!.trim()}`)
    .join("\n");
  const materialsText = materialLines
    .map((m) => `- ${m.date}: ${m.materialName} — ${m.usedQuantity}${m.unit ? ` ${m.unit}` : ""}${m.stageName ? ` (etap: ${m.stageName})` : ""}`)
    .join("\n");

  const userPrompt = `Budowa: ${build.name} (nr ${build.number}).
Zakres raportowanych dni: od ${reportRows[0].date} do ${reportRows[reportRows.length - 1].date}.

Zużyte materiały i etapy (dane techniczne, bez cen):
${materialsText || "(brak zarejestrowanego zużycia materiałów)"}

Notatki brygadzisty z poszczególnych dni (materiał źródłowy — przepisz na neutralny, profesjonalny ton zgodnie z instrukcją systemową, pomijając wszystko, co nie powinno trafić do klienta):
${notesText || "(brak notatek tekstowych)"}

Napisz podsumowanie postępu prac dla klienta.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.4 },
        }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message ?? `Gemini API: ${res.status}`);
    }
    const summary: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!summary || !summary.trim()) {
      throw new Error("Gemini nie zwróciło treści podsumowania.");
    }

    const generatedAt = new Date().toISOString();
    await admin
      .from("builds")
      .update({ ai_client_summary: summary.trim(), ai_client_summary_generated_at: generatedAt })
      .eq("id", buildId);

    return json({ summary: summary.trim(), generatedAt });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
