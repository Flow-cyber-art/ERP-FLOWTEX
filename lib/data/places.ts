import { supabase } from "@/lib/supabase";

/**
 * Autouzupełnianie "Nazwa firmy" w kroku 1 Wizardu Ofert — Google
 * Places API (New), przez edge function `google-places-search` (klucz
 * trzymany po stronie serwera, nigdy w przeglądarce). NIE zwraca NIP-u
 * (Google go nie ma) — tylko nazwę i, po wybraniu podpowiedzi, adres.
 */
export type PlaceSuggestion = {
  placeId: string;
  name: string;
  secondary: string | null;
};

export async function autocompleteCompanies(query: string): Promise<PlaceSuggestion[]> {
  const { data, error } = await supabase.functions.invoke<{ suggestions: PlaceSuggestion[]; error?: string }>(
    "google-places-search",
    { body: { mode: "autocomplete", query } },
  );
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data?.suggestions ?? [];
}

export async function getPlaceCompanyDetails(placeId: string): Promise<{ name: string; address: string | null }> {
  const { data, error } = await supabase.functions.invoke<{ details: { name: string; address: string | null }; error?: string }>(
    "google-places-search",
    { body: { mode: "details", placeId } },
  );
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.details) throw new Error("Brak szczegółów firmy z Google Places.");
  return data.details;
}
