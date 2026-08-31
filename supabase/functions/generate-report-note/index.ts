// Oczyszczona wersja notatki brygadzisty z JEDNEGO raportu dziennego —
// wywoływane AUTOMATYCZNIE przy zatwierdzeniu raportu przez Admina
// (patrz approveReport w contexts/app-data.tsx), nie ręcznym przyciskiem.
// Surowa `reports.note` bywa skrótowa, napisana pod presją czasu, czasem
// emocjonalna albo wspomina rzeczy, których zleceniodawca nie powinien
// czytać wprost (spięcia w ekipie, problemy personalne). Admin nadal
// widzi surowy tekst w ReportCard — ta funkcja generuje DRUGĄ wersję
// (reports.client_note), przeznaczoną wyłącznie do portalu klienta
// (patrz 063_portal_klienta_podsumowanie_ai.sql).
//
// Generowanie jest bramkowane przez builds.show_notes_to_client: ten sam
// przełącznik "Udostępnij notatki klientowi" w panelu budowy decyduje
// zarówno o WIDOCZNOŚCI notatek w portalu, jak i o tym, czy AI w ogóle
// ma je tworzyć — gdy wyłączony, ta funkcja nic nie robi (zwraca
// `skipped: true`), żeby nie zużywać wywołań Gemini na budowy, których
// klient i tak nie zobaczy.
//
// Dla zbiorczego podsumowania całej budowy (wszystkie dni naraz) patrz
// supabase/functions/generate-client-summary — osobna funkcja, osobny
// przycisk w sekcji Portalu Klienta.
//
// Wymaga (Supabase Dashboard -> Edge Functions -> Secrets):
//   GEMINI_API_KEY — klucz z Google AI Studio (https://aistudio.google.com/apikey).
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy new function ->
// nazwa "generate-report-note" -> wklej ten plik -> Deploy.

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

// "gemini-3.6-flash" (poprzednia wartość) nie jest realną nazwą modelu w
// katalogu Google — każde wywołanie kończyło się błędem 404 z Gemini API.
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = `Jesteś kierownikiem budowy piszącym krótką, rzeczową notatkę dzienną dla zleceniodawcy (klienta), na podstawie wewnętrznej notatki brygadzisty z tego samego dnia.

Zasady:
- Pisz po polsku, w tonie profesjonalnym i neutralnym — jak oficjalna aktualizacja dla klienta, nie jak wewnętrzna notatka robocza.
- Zachowaj wyłącznie informacje o realnie wykonanych pracach/postępie tego dnia.
- NIGDY nie wspominaj: kwot, cen, kosztów, stawek, wynagrodzeń, imion i nazwisk konkretnych pracowników, liczby przepracowanych godzin przez osoby, wewnętrznych konfliktów, skarg na konkretne osoby ani żadnych innych danych, które nie powinny trafić do klienta.
- Jeśli notatka źródłowa zawiera emocje, narzekania, spięcia w ekipie lub drobne problemy organizacyjne — NIE cytuj ich i nie wspominaj wprost; jeśli miały realny wpływ na harmonogram, opisz to jednym neutralnym zdaniem (np. "wystąpiło krótkie opóźnienie związane z dostawą materiału"), bez szczegółów i bez obwiniania kogokolwiek.
- Jeśli notatka źródłowa nie zawiera nic, co nadaje się do pokazania klientowi (np. same skargi, brak informacji o postępie), odpowiedz dokładnie: "BRAK" (same te litery, nic więcej).
- Nie zmyślaj informacji, których nie ma w notatce źródłowej.
- Format: 1-3 zdania zwykłego tekstu, bez nagłówków, bez list, bez emoji.`;

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
  const reportId = Number(body.reportId);
  if (!reportId) return json({ error: "Brak reportId." }, 400);

  const { data: report, error: reportError } = await admin
    .from("reports")
    .select("id, date, note, buildId, builds(show_notes_to_client)")
    .eq("id", reportId)
    .maybeSingle();
  if (reportError || !report) return json({ error: "Nie znaleziono raportu." }, 404);

  const showNotesToClient = (report as any).builds?.show_notes_to_client === true;
  if (!showNotesToClient) {
    return json({ skipped: true, reason: "Udostępnianie notatek klientowi jest wyłączone dla tej budowy." });
  }
  if (!report.note || !report.note.trim()) {
    return json({ skipped: true, reason: "Ten raport nie ma notatki brygadzisty do przetworzenia." });
  }

  const userPrompt = `Data raportu: ${report.date}.

Notatka brygadzisty (materiał źródłowy):
${report.note.trim()}

Napisz notatkę dzienną dla klienta.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message ?? `Gemini API: ${res.status}`);
    }
    const rawNote: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawNote || !rawNote.trim()) {
      throw new Error("Gemini nie zwróciło treści notatki.");
    }
    const cleaned = rawNote.trim();
    const clientNote = cleaned === "BRAK" ? null : cleaned;

    const generatedAt = new Date().toISOString();
    await admin
      .from("reports")
      .update({ client_note: clientNote, client_note_generated_at: generatedAt })
      .eq("id", reportId);

    return json({ clientNote, generatedAt });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
