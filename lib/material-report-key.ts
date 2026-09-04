/**
 * Klucz pozycji materiałowej raportu dziennego — `materialId` sam w sobie
 * dla materiału pomocniczego (spoza planu technologii, zawsze jeden na
 * budowę) albo `materialId::nazwaEtapu` dla materiału z planu technologii
 * (Faza 6).
 *
 * Dlaczego to w ogóle jest potrzebne: ten sam materiał potrafi wystąpić w
 * DWÓCH różnych etapach technologii (np. piasek jako zasyp po gruntowaniu
 * I pod warstwą zamykającą) — `reportValues`/`reasons` (Record<string,
 * string> w contexts/app-data.tsx) muszą mieć osobne miejsce na osobne
 * zużycie każdego etapu, inaczej dwa pola na ekranie brygadzisty pisały w
 * to samo miejsce (zgłoszony problem — jedna wartość zamiast dwóch).
 * `::` jako separator, bo nazwa etapu to dowolny tekst z myślnikami/
 * spacjami, ale nigdy nie zawiera `::`.
 */
const SEPARATOR = "::";

export function materialReportKey(
  materialId: string,
  stageName?: string | null,
): string {
  return stageName ? `${materialId}${SEPARATOR}${stageName}` : materialId;
}

export function parseMaterialReportKey(key: string): {
  materialId: string;
  stageName: string | null;
} {
  const idx = key.indexOf(SEPARATOR);
  if (idx === -1) return { materialId: key, stageName: null };
  return { materialId: key.slice(0, idx), stageName: key.slice(idx + SEPARATOR.length) };
}
