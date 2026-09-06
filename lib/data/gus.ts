import { supabase } from "@/lib/supabase";

/**
 * Autouzupełnianie "Nazwa firmy" w kroku 1 Wizardu Ofert — wyszukiwanie
 * przez rejestr GUS REGON (edge function `gus-search-company`, patrz
 * supabase/functions/gus-search-company/index.ts). Zwraca nazwę, NIP i
 * adres siedziby po wpisaniu min. 3 znaków.
 */
export type GusCompanyMatch = {
  name: string;
  nip: string | null;
  address: string | null;
};

export async function searchGusCompanies(query: string): Promise<GusCompanyMatch[]> {
  const { data, error } = await supabase.functions.invoke<{ results: GusCompanyMatch[]; error?: string }>(
    "gus-search-company",
    { body: { query } },
  );
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data?.results ?? [];
}
