import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Nasłuchuje zmian (insert/update/delete) na tabelach, które kilku
 * administratorów może edytować równolegle (magazyn, pracownicy, budowy,
 * zamówienia, przypisania materiałów) i po każdej zmianie unieważnia
 * odpowiadające zapytanie React Query — kolejny `useQuery` sam dociągnie
 * świeże dane. Bez tego dwóch adminów pracujących naraz mogłoby się
 * nawzajem po cichu nadpisywać, widząc nieaktualny stan aż do ręcznego
 * odświeżenia strony.
 *
 * Wymaga włączonego Realtime na tych tabelach w Supabase — patrz
 * supabase/sql/002_realtime.sql.
 */
const REALTIME_TABLES: { table: string; queryKey: string }[] = [
  { table: "materials", queryKey: "materials" },
  { table: "employees", queryKey: "employees" },
  { table: "builds", queryKey: "builds" },
  { table: "material_orders", queryKey: "orders" },
  { table: "reports", queryKey: "reports" },
  { table: "report_materials", queryKey: "reports" },
  { table: "report_people", queryKey: "reports" },
  { table: "report_extra_costs", queryKey: "reports" },
  { table: "orders", queryKey: "buildOrders" },
  { table: "order_items", queryKey: "buildOrders" },
  // Magazyn v2 (121/122): partie, stany budów, zwroty i straty to WIDOKI
  // liczone z księgi `stock_ledger` — widoki nie wysyłają zdarzeń
  // Realtime, więc każda zmiana w księdze (i w niedoborach) odświeża
  // wszystkie odczyty magazynowe naraz.
  { table: "stock_ledger", queryKey: "warehouseBatches" },
  { table: "stock_ledger", queryKey: "buildMaterialLots" },
  { table: "stock_ledger", queryKey: "buildMaterials" },
  { table: "stock_ledger", queryKey: "buildMaterialReturns" },
  { table: "shortages", queryKey: "buildMaterialLots" },
  { table: "shortages", queryKey: "buildMaterials" },
  { table: "shortages", queryKey: "shortages" },
  { table: "material_loss_requests", queryKey: "lossRequests" },
  { table: "stock_operations", queryKey: "stockReviews" },
  { table: "build_stage_status", queryKey: "buildStageStatuses" },
  // Brakowało tego wpisu od zawsze (moduł Technologia nie miał osobnej
  // migracji realtime) — technologiesQuery w app-data.tsx ma
  // `staleTime: Infinity` i klucz `["technologies", "active"]`, więc bez
  // tego wpisu nowo dodana technologia nigdy nie pojawiała się w
  // pickerze przypisywania do budowy, dopóki ktoś nie zrobił pełnego
  // przeładowania strony. Wymaga też włączenia Realtime na tabeli
  // `technologies` w Supabase — patrz supabase/sql/030_realtime_technologies.sql.
  { table: "technologies", queryKey: "technologies" },
  // Godziny pracy — patrz timeEntriesQuery w contexts/app-data.tsx.
  // Wstawiane przez submit_daily_report (RPC) przy wysyłce raportu, więc
  // to jedyny sposób, w jaki inne urządzenie/sesja dowie się o nowych
  // godzinach bez pełnego przeładowania strony.
  { table: "time_entries", queryKey: "timeEntries" },
  // Wnioski urlopowe — żeby zatwierdzenie przez Brygadzistę/Admina od
  // razu było widoczne u pracownika (i odwrotnie: nowy wniosek u tych,
  // którzy go zatwierdzają), patrz supabase/sql/049_urlopy.sql.
  { table: "leave_requests", queryKey: "leaveRequests" },
  // Krok 5 (124): koszt budowy liczony w bazie z księgi, godzin i raportów;
  // historia przeglądu raportu zmienia się razem ze statusem raportu.
  { table: "stock_ledger", queryKey: "buildCosts" },
  { table: "time_entries", queryKey: "buildCosts" },
  { table: "reports", queryKey: "buildCosts" },
  { table: "report_extra_costs", queryKey: "buildCosts" },
  { table: "reports", queryKey: "reportReviewLog" },
];

export function useRealtimeSync(queryClient: QueryClient) {
  useEffect(() => {
    const channel = supabase.channel("app-data-sync");

    for (const { table, queryKey } of REALTIME_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          // Prefiksowe dopasowanie React Query (domyślne, bez `exact`)
          // unieważnia każdy klucz zaczynający się od [queryKey, ...] —
          // działa to zarówno dla ["materials", "list"], jak i dla
          // ["technologies", "active"], więc nie trzeba tu zgadywać
          // dokładnego sufiksu klucza per tabela.
          queryClient.invalidateQueries({ queryKey: [queryKey] });
        },
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
