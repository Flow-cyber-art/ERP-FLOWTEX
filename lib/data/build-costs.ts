import { supabase } from "@/lib/supabase";

/**
 * Koszt budowy z JEDNEJ kalkulacji w bazie (124: fn_build_cost) — ta sama
 * liczba na karcie budowy, w ekranie Rozliczenie i w rozliczeniu końcowym
 * (close_build → build_settlements). Materiał = wycenione ruchy zużycia z
 * księgi magazynowej, robocizna = godziny × stawka kosztowa zamrożona na
 * wpisie, plus kilometrówka, koszty dodatkowe, straty i protokoły
 * podwykonawców. Tylko Admin (zawiera stawki).
 */
export type BuildCost = {
  buildId: number;
  materials: number;
  losses: number;
  hours: number;
  labor: number;
  /** Godziny, dla których brak stawki kosztowej (liczone stawką godzinową). */
  hoursWithoutCostRate: number;
  km: number;
  extra: number;
  subcontract: number;
  total: number;
};

export async function getBuildCosts(buildIds?: number[]): Promise<BuildCost[]> {
  const { data, error } = await supabase.rpc("get_build_costs", {
    p_build_ids: buildIds?.length ? buildIds : null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    buildId: Number(r.buildId),
    materials: Number(r.materials),
    losses: Number(r.losses),
    hours: Number(r.hours),
    labor: Number(r.labor),
    hoursWithoutCostRate: Number(r.hoursWithoutCostRate),
    km: Number(r.km),
    extra: Number(r.extra),
    subcontract: Number(r.subcontract),
    total: Number(r.total),
  }));
}
