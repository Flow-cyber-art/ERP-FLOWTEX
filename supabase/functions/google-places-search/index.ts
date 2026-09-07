// Wyszukiwarka firm dla autouzupełniania "Nazwa firmy" w kroku 1
// Wizardu Ofert — Google Places API (New). Zastępuje GUS REGON
// (gus-search-company): użytkownik nie spełnia wymogów rejestracyjnych
// GUS dla klucza produkcyjnego (podmiot komercyjny musi mailowo podać
// REGON/kontakt/IP do regon_bir@stat.gov.pl), więc wracamy do Google.
// W zamian NIE dostajemy tu NIP-u (Google nie ma takich danych) — pole
// NIP w formularzu zostaje zwykłym polem tekstowym, wypełnianym ręcznie.
//
// Dwa tryby w jednym body (mniej sekretów/deployów niż dwie funkcje):
//   { mode: "autocomplete", query }         -> lekka lista podpowiedzi
//   { mode: "details", placeId }            -> pełna nazwa + adres,
//                                              dociągane DOPIERO po
//                                              wybraniu podpowiedzi
//                                              (nie dla każdej litery).
//
// Wymaga (Supabase Dashboard -> Edge Functions -> Secrets):
//   GOOGLE_PLACES_API_KEY — klucz z Google Cloud Console, z włączonym
//                           "Places API (New)" i aktywnym rozliczeniem.
//   Trzymany wyłącznie po stronie serwera (ta funkcja) — nigdy nie
//   trafia do przeglądarki, w przeciwieństwie do klucza wpiętego
//   bezpośrednio w kod klienta.
//
// Cofnięcie: usuń funkcję w Supabase Dashboard -> Edge Functions.

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

type AutocompleteSuggestion = { placeId: string; name: string; secondary: string | null };

async function autocomplete(apiKey: string, query: string): Promise<AutocompleteSuggestion[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
    body: JSON.stringify({ input: query, languageCode: "pl", regionCode: "PL" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Google Places HTTP ${res.status}`);
  const suggestions = (data.suggestions ?? []) as any[];
  return suggestions
    .filter((s) => s.placePrediction)
    .map((s) => {
      const p = s.placePrediction;
      return {
        placeId: p.placeId,
        name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? null,
      };
    })
    .slice(0, 20);
}

async function placeDetails(apiKey: string, placeId: string): Promise<{ name: string; address: string | null }> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "displayName,formattedAddress" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Google Places HTTP ${res.status}`);
  return { name: data.displayName?.text ?? "", address: data.formattedAddress ?? null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) return json({ error: "Brak GOOGLE_PLACES_API_KEY w sekretach Edge Function." }, 200);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Nieprawidłowe body żądania" }, 400);
  }

  try {
    if (body?.mode === "details") {
      const placeId = String(body.placeId ?? "").trim();
      if (!placeId) return json({ error: "Brak placeId" }, 400);
      const details = await placeDetails(apiKey, placeId);
      return json({ details });
    }
    const query = String(body?.query ?? "").trim();
    if (query.length < 3) return json({ suggestions: [] });
    const suggestions = await autocomplete(apiKey, query);
    return json({ suggestions });
  } catch (e) {
    return json({ suggestions: [], error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
