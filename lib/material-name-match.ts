/**
 * Dopasowywanie nazw materiałów pod podpowiedzi/duplikaty — używane przy
 * dodawaniu nowego materiału do magazynu (warehouse-screen.tsx) i przy
 * zamawianiu materiału spoza listy (orders-screen.tsx). Cel: złapać nie
 * tylko literalne podciągi ("piasek" w "Piasek płukany"), ale i literówki
 * ("Piasek pukany" vs "Piasek płukany"), żeby nie powstawały ciche
 * duplikaty tego samego materiału pod nieco inną nazwą.
 */

// Normalizacja: małe litery, bez polskich znaków diakrytycznych, jedna
// spacja między słowami, przycięte na końcach — "Piasek  Płukany " i
// "piasek plukany" mają dawać identyczny wynik.
export function normalizeMaterialName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Odległość Levenshteina — liczba pojedynczych edycji (wstaw/usuń/zamień
// znak), żeby przejść z a do b. Prosta implementacja DP, wystarczająca
// dla krótkich nazw materiałów (nie ma sensu tu nic bardziej wyrafinowanego).
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow.push(
        Math.min(
          currRow[j - 1] + 1, // wstawienie
          prevRow[j] + 1, // usunięcie
          prevRow[j - 1] + cost, // zamiana
        ),
      );
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

// Próg literówki: dopuszczalna odległość rośnie z długością nazwy (jedna
// literówka w krótkim słowie znaczy więcej niż w długim), ale nigdy więcej
// niż 3 — dłuższe nazwy i tak zwykle różnią się bardziej niż literówką.
function typoThreshold(length: number): number {
  if (length <= 4) return 1;
  if (length <= 10) return 2;
  return 3;
}

export type MaterialNameCandidate = { id: string; name: string };

export type MaterialNameMatch = {
  candidate: MaterialNameCandidate;
  kind: "exact" | "contains" | "typo";
};

// Zwraca dopasowania posortowane: dokładne (po normalizacji) -> zawiera
// podciąg -> prawdopodobna literówka. `query` krótsze niż 2 znaki nie ma
// sensu dopasowywać (zbyt duża szansa fałszywych trafień).
export function matchMaterialNames(
  query: string,
  candidates: MaterialNameCandidate[],
  limit = 6,
): MaterialNameMatch[] {
  const q = normalizeMaterialName(query);
  if (q.length < 2) return [];

  const results: MaterialNameMatch[] = [];
  for (const candidate of candidates) {
    const n = normalizeMaterialName(candidate.name);
    if (n === q) {
      results.push({ candidate, kind: "exact" });
      continue;
    }
    if (n.includes(q) || q.includes(n)) {
      results.push({ candidate, kind: "contains" });
      continue;
    }
    // Literówka na całej nazwie ("Cemant" vs "Cement") ORAZ literówka na
    // samym początku dłuższej nazwy ("piasek pukany" wpisane, kandydat
    // "Piasek płukany 0-2mm") — bez tego drugiego wariantu opis/wymiar
    // doklejony na końcu nazwy magazynowej psuje odległość edycyjną do
    // całego stringa i literówka nigdy by nie złapała podpowiedzi.
    const prefix = n.slice(0, q.length);
    const distance = Math.min(levenshteinDistance(q, n), levenshteinDistance(q, prefix));
    if (distance <= typoThreshold(q.length)) {
      results.push({ candidate, kind: "typo" });
    }
  }

  const order = { exact: 0, contains: 1, typo: 2 };
  return results.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, limit);
}
