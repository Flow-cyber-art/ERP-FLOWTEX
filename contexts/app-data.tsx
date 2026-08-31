import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueReport } from "@/lib/offline-outbox";
import { normalizeMaterialName } from "@/lib/material-name-match";
import {
  closeBuild as closeBuildRemote,
  createBuild,
  listBuilds,
  reopenBuild as reopenBuildRemote,
  updateBuildBasicInfo as updateBuildBasicInfoRemote,
  updateBuildLaborPlan as updateBuildLaborPlanRemote,
  updateBuildPhotosUrl as updateBuildPhotosUrlRemote,
  type CloseBuildReturnItem,
} from "@/lib/data/builds";
import {
  adjustMaterialStock as adjustMaterialStockRemote,
  createMaterial,
  listMaterials,
  setMaterialActive as setMaterialActiveRemote,
  updateMaterialPrice as updateMaterialPriceRemote,
} from "@/lib/data/materials";
import {
  createEmployee,
  listEmployees,
  setEmployeeActive as setEmployeeActiveRemote,
  updateEmployeeCostRate as updateEmployeeCostRateRemote,
  updateEmployeeName as updateEmployeeNameRemote,
  updateEmployeeRate as updateEmployeeRateRemote,
} from "@/lib/data/employees";
import {
  addTeamMember as addTeamMemberRemote,
  createTeam as createTeamRemote,
  listTeamMembers,
  listTeams,
  removeTeamMember as removeTeamMemberRemote,
  type TeamMemberRow,
  type TeamRow,
} from "@/lib/data/teams";
import {
  createOrder as createOrderRemote,
  deleteOrder as deleteOrderRemote,
  listOrders,
  markOrderOrdered as markOrderOrderedRemote,
  receiveOrder as receiveOrderRemote,
} from "@/lib/data/orders";
import { listTimeEntries } from "@/lib/data/time-entries";
import {
  cancelLeaveRequest as cancelLeaveRequestRemote,
  decideLeaveRequest as decideLeaveRequestRemote,
  listLeaveRequests,
  requestLeave as requestLeaveRemote,
  updateEmployeeLeaveDays as updateEmployeeLeaveDaysRemote,
  updateLeaveRequest as updateLeaveRequestRemote,
  type LeaveRequestRow,
  type LeaveType,
} from "@/lib/data/leave";
import {
  assignMaterialBatchesToBuild,
  unassignMaterialFromBuild,
  listBuildMaterialLots as listBuildMaterialLotsRemote,
  listBuildMaterialReturns as listBuildMaterialReturnsRemote,
  listBuildMaterials,
  type AssignMaterialBatchItem,
  type BuildMaterialLotRow,
  type BuildMaterialReturnRow,
} from "@/lib/data/build-materials";
import { generateReportClientNote } from "@/lib/data/ai-summary";
import { useRegisterPushToken } from "@/lib/notifications/use-register-push-token";
import { useRegisterWebPush } from "@/lib/notifications/use-register-web-push";
import {
  listReports,
  submitDailyReport,
  updateReportStatus,
  type ReportRow,
} from "@/lib/data/reports";
import {
  getSettings,
  updateKmRate as updateKmRateRemote,
  updateCloseBuildPin as updateCloseBuildPinRemote,
} from "@/lib/data/settings";
import { useRealtimeSync } from "@/lib/data/use-realtime-sync";
import { listActiveTechnologies, type TechnologyRow } from "@/lib/data/technologies";
import {
  assignTechnologyToBuild,
  listBuildMaterialPlans,
  listBuildTechnologySnapshots,
  type BuildMaterialPlanRow,
  type BuildTechnologySnapshotRow,
} from "@/lib/data/build-technology";
import {
  listMaterialBatches as listWarehouseBatchesRemote,
  type MaterialBatchRow as WarehouseBatchRow,
} from "@/lib/data/material-batches";
import {
  completeBuildStage as completeBuildStageRemote,
  listBuildStageStatuses,
  reopenBuildStage as reopenBuildStageRemote,
  type BuildStageStatusRow,
} from "@/lib/data/build-stages";
import {
  cancelBuildOrder as cancelBuildOrderRemote,
  deleteBuildOrder as deleteBuildOrderRemote,
  generateOrderFromPlan as generateOrderFromPlanRemote,
  listBuildOrders,
  markBuildOrderOrdered as markBuildOrderOrderedRemote,
  receiveBuildOrder as receiveBuildOrderRemote,
  updateOrderItemQuantity as updateOrderItemQuantityRemote,
  type BuildOrderRow,
  type ReceiveBuildOrderItemInput,
} from "@/lib/data/build-orders";
export type SavedReportStatus = "submitted" | "approved";

export type NewMaterialInput = {
  name: string;
  index: string;
  unit: string;
  stock: string;
  min: string;
  unitPrice: string;
};

export type NewBuildInput = {
  number: string;
  name: string;
  manager: string;
  startDate: string;
  durationDays: string;
  teamId: string;
  plannedHoursPerDay: string;
  clientName: string;
  address: string;
  contractValue: string;
};

export type NewEmployeeInput = {
  name: string;
  role: string;
  hourlyRate: string;
  costRate: string;
};

export type NewTeamInput = {
  name: string;
  leadEmployeeId: string;
};

export type OrderCartItem = {
  id: string;
  materialName: string;
  quantity: number;
  unit: string;
  materialId?: string;
  // Stan minimalny NOWEGO materiału (brak materialId) — patrz
  // CreateOrderInput.newMaterialMin w lib/data/orders.ts.
  newMaterialMin?: number;
  // Indeks materiałowy NOWEGO materiału (brak materialId) — patrz
  // CreateOrderInput.newMaterialIndex w lib/data/orders.ts.
  newMaterialIndex?: string;
};

export type SavedReport = {
  id: string;
  date: string;
  buildId: string;
  buildNumber: string;
  buildName: string;
  materialValues: Record<string, string>;
  // Rzeczywisty koszt FIFO doliczony w TYM raporcie, per materiał —
  // niezależny od skumulowanego buildMaterialActualCost (ten sumuje
  // wszystkie raporty budowy razem). Bez tego ReportCard nie ma jak
  // pokazać kwoty przy pojedynczej pozycji materiałowej raportu.
  // Kumulatywny w obrębie edycji tego samego raportu, tak samo jak
  // buildMaterialActualCost: zmniejszenie zużycia nie odejmuje kosztu.
  materialCosts: Record<string, number>;
  reasons: Record<string, string>;
  people: { employeeId: string; start: string; end: string }[];
  extraCosts: ExtraCost[];
  status: SavedReportStatus;
  updatedAt: string;
  // Kilometrówka (Faza 7) — km wpisane przez brygadzistę i stawka/koszt
  // zamrożone PRZEZ BAZĘ w momencie wysyłki (patrz submit_daily_report).
  km?: number;
  kmRateApplied?: number;
  kmCost?: number;
  // Kto faktycznie wysłał ten raport (profiles.id) — null dla raportów
  // wysłanych zanim ta kolumna zaczęła być wypełniana (025) oraz dla
  // lokalnych, jeszcze niezsynchronizowanych wpisów. Używane wyłącznie do
  // filtrowania "Moje raporty" u Brygadzisty (saved-reports-screen.tsx).
  submittedByProfileId?: string | null;
  // Notatka brygadzisty do tego raportu (Decyzja B) — jedna, dowolna,
  // czysto informacyjna, patrz draftNote niżej.
  note?: string;
  // Oczyszczona wersja notatki dla klienta (Gemini, generowana na żądanie
  // Admina) — to, i tylko to, może trafić do portalu klienta; `note`
  // wyżej zostaje wyłącznie wewnętrzne. Patrz
  // supabase/functions/generate-report-note oraz 063_portal_klienta_
  // podsumowanie_ai.sql.
  clientNote?: string | null;
};

import {
  todayISO,
  initialMaterials,
  initialBuilds,
  initialAssignments,
  initialEmployees,
  initialTimeEntries,
  type MaterialOrder,
  type MaterialBatch,
  type ExtraCost,
  type Build,
  type BuildSettlement,
  type Material,
  type Assignment,
  type Employee,
  confirmAction,
  notify,
} from "@/components/report-ui";

// Mapuje wiersz z bazy (reports + zagnieżdżone report_materials/
// report_people/report_extra_costs/builds, patrz lib/data/reports.ts)
// na kształt SavedReport używany w całej reszcie apki — żeby ekrany
// (ReportCard, "Moje raporty", "Raporty") nie musiały wiedzieć, czy
// dany raport przyszedł z serwera, czy jest jeszcze lokalny/offline.
function mapReportRowToSavedReport(row: ReportRow): SavedReport {
  const materialValues: Record<string, string> = {};
  const materialCosts: Record<string, number> = {};
  const reasons: Record<string, string> = {};
  for (const m of row.report_materials) {
    const key = String(m.materialId);
    materialValues[key] = m.usedQuantity;
    materialCosts[key] = Number(m.cost);
    if (m.reason) reasons[key] = m.reason;
  }
  return {
    id: String(row.id),
    date: row.date,
    buildId: String(row.buildId),
    buildNumber: row.builds?.number ?? "",
    buildName: row.builds?.name ?? "",
    materialValues,
    materialCosts,
    reasons,
    people: row.report_people.map((p) => ({
      employeeId: String(p.employeeId),
      start: p.start.slice(0, 5),
      end: p.end.slice(0, 5),
    })),
    extraCosts: row.report_extra_costs.map((c) => ({
      id: String(c.id),
      label: c.label,
      amount: Number(c.amount),
      note: c.note ?? undefined,
      category: c.category ?? undefined,
    })),
    status: row.status === "approved" ? "approved" : "submitted",
    updatedAt: row.updatedAt,
    km: row.km != null ? Number(row.km) : undefined,
    kmRateApplied: row.kmRateApplied != null ? Number(row.kmRateApplied) : undefined,
    kmCost: row.kmCost != null ? Number(row.kmCost) : undefined,
    submittedByProfileId: row.submittedByProfileId,
    note: row.note ?? undefined,
    clientNote: row.clientNote ?? null,
  };
}

// Central store for every piece of app data (materials, builds,
// assignments, employees, time entries, orders, and all of the draft/
// form state that feeds the report/warehouse/admin screens). Screens
// consume this via useAppData() instead of holding their own local
// state, so each screen can be code-split (and role-gated) without
// losing access to shared data.
function useAppDataState(
  initialRole: "Admin" | "Brygadzista" | "Pracownik" = "Brygadzista",
  myProfileId: string | null = null,
  myEmployeeId: string | null = null,
) {
  useRegisterPushToken(initialRole);
  useRegisterWebPush(initialRole);
  const [tab, setTab] = useState(
    initialRole === "Pracownik"
      ? "worker"
      : initialRole === "Admin"
        ? "builds"
        : "savedReports",
  );
  // Które zakładki zostały już choć raz odwiedzone w tej sesji — steruje
  // `enabled` zapytań, które nie są potrzebne od razu na starcie (patrz
  // "leniwe" useQuery niżej: technologie, plan materiałowy, zamówienia z
  // planu, partie magazynowe, loty partii na budowach, statusy etapów,
  // ustawienia). Rośnie tylko w jedną stronę — raz odblokowana zakładka
  // zostaje odblokowana, żeby powrót do niej czytał z cache'u zamiast
  // odpytywać serwer od nowa. `builds/materials/orders/reports/employees/
  // buildMaterials` NIE są tak bramkowane — są potrzebne od razu (liczniki
  // w pasku nawigacji, ekran startowy, `assignments` używane wszędzie).
  const [unlockedTabs, setUnlockedTabs] = useState<Set<string>>(
    () => new Set([tab]),
  );
  useEffect(() => {
    setUnlockedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);
  const tabDataEnabled = (tabs: string[]) => tabs.some((t) => unlockedTabs.has(t));
  const [devRole, setDevRole] = useState<"Admin" | "Brygadzista" | "Pracownik">(
    initialRole,
  );
  const [materials, setMaterials] = useState(initialMaterials);
  // Partie zakupowe — źródło prawdy dla stanu i ceny. `materials[].stock`
  // i `.unitPrice` zostają jako pola pochodne (suma / średnia ważona
  // partii), przeliczane przy każdej zmianie, żeby reszta aplikacji
  // (braki, koszty budów, listy) mogła dalej z nich korzystać bez zmian.
  const [materialBatches, setMaterialBatches] = useState<MaterialBatch[]>(
    () =>
      initialMaterials
        .filter((m) => m.stock > 0)
        .map((m) => ({
          id: `batch-init-${m.id}`,
          materialId: m.id,
          quantity: m.stock,
          unitPrice: m.unitPrice,
          receivedAt: todayISO(),
          source: "stan początkowy",
        })),
  );
  // --- Poniższe to CZYSTE funkcje (biorą tablicę partii, zwracają nową) ---
  // celowo nie czytają stanu z domknięcia — inaczej kilka wywołań pod rząd
  // w jednym handlerze (np. raport z kilkoma materiałami) nadpisywałoby się
  // nawzajem, bo każde bazowałoby na tym samym, nieodświeżonym stanie.

  // Przelicza stock/unitPrice materiałów na podstawie ich partii (suma
  // ilości, cena = średnia ważona).
  const recalcMaterialsFromBatches = (
    prevMaterials: Material[],
    batches: MaterialBatch[],
    affectedIds: Set<string>,
  ) =>
    prevMaterials.map((m) => {
      if (!affectedIds.has(m.id)) return m;
      const rows = batches.filter((b) => b.materialId === m.id);
      const stock = rows.reduce((sum, b) => sum + b.quantity, 0);
      const value = rows.reduce((sum, b) => sum + b.quantity * b.unitPrice, 0);
      return { ...m, stock, unitPrice: stock > 0 ? value / stock : 0 };
    });
  const addBatchPure = (
    batches: MaterialBatch[],
    batch: Omit<MaterialBatch, "id">,
  ) => [
    ...batches,
    {
      ...batch,
      id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    },
  ];
  // Zdejmuje ilość metodą FIFO — najpierw z najstarszych partii, żeby
  // koszt zużycia odzwierciedlał realną cenę zakupu tego towaru.
  const consumeFIFOPure = (
    batches: MaterialBatch[],
    materialId: string,
    amount: number,
  ) => {
    let remaining = amount;
    const sorted = batches
      .filter((b) => b.materialId === materialId)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
    const consumedIds: Record<string, number> = {};
    for (const b of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity, remaining);
      consumedIds[b.id] = take;
      remaining -= take;
    }
    return batches
      .map((b) =>
        consumedIds[b.id] !== undefined
          ? { ...b, quantity: b.quantity - consumedIds[b.id] }
          : b,
      )
      .filter((b) => b.quantity > 0.0001);
  };
  // Jak consumeFIFOPure, ale dodatkowo zwraca faktyczny koszt (PLN) tego
  // konkretnego zdjęcia — sumę quantity×unitPrice partii, z których
  // realnie zeszła ilość. To jest podstawa realnego kosztu budowy,
  // niezależna od jednej uśrednionej ceny materiału.
  const consumeFIFOWithCostPure = (
    batches: MaterialBatch[],
    materialId: string,
    amount: number,
  ) => {
    let remaining = amount;
    let cost = 0;
    const sorted = batches
      .filter((b) => b.materialId === materialId)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
    const consumedIds: Record<string, number> = {};
    for (const b of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity, remaining);
      consumedIds[b.id] = take;
      cost += take * b.unitPrice;
      remaining -= take;
    }
    const nextBatches = batches
      .map((b) =>
        consumedIds[b.id] !== undefined
          ? { ...b, quantity: b.quantity - consumedIds[b.id] }
          : b,
      )
      .filter((b) => b.quantity > 0.0001);
    return { batches: nextBatches, cost };
  };
  // (przyjęcie zamówienia, ręczna korekta stanu — nie ma ryzyka utraty
  // zmian z kilku wywołań pod rząd).
  const addMaterialBatch = (batch: Omit<MaterialBatch, "id">) => {
    const nextBatches = addBatchPure(materialBatches, batch);
    setMaterialBatches(nextBatches);
    setMaterials((prev) =>
      recalcMaterialsFromBatches(prev, nextBatches, new Set([batch.materialId])),
    );
  };
  const consumeMaterialBatchesFIFO = (materialId: string, amount: number) => {
    const nextBatches = consumeFIFOPure(materialBatches, materialId, amount);
    setMaterialBatches(nextBatches);
    setMaterials((prev) =>
      recalcMaterialsFromBatches(prev, nextBatches, new Set([materialId])),
    );
  };
  const [builds, setBuilds] = useState(initialBuilds);
  // Skumulowany, RZECZYWISTY koszt materiału zużytego na danej budowie —
  // klucz `${buildId}:${materialId}`. Rośnie przy każdym raporcie
  // brygadzisty o realny koszt FIFO tej konkretnej partii, którą zdjął.
  // Niezależny od Assignment.unitPrice (to tylko cena szacunkowa z
  // momentu planowania budowy).
  const [buildMaterialActualCost, setBuildMaterialActualCost] = useState<
    Record<string, number>
  >({});
  const [assignments, setAssignments] = useState(initialAssignments);
  const [showAssignment, setShowAssignment] = useState(false);
  // Aktywne/Archiwum na ekranie Budowy. Trzymane tu (nie lokalnie w
  // BuildsScreen), bo na desktopie steruje tym osobna pozycja menu w
  // sidebarze (app/(tabs)/index.tsx), a na mobile — powtórne wciśnięcie
  // przycisku "Budowy" w dolnym pasku.
  const [buildsView, setBuildsView] = useState<"active" | "archive">(
    "active",
  );
  // Materiały/Technologie na zakładce Magazyn. Na desktopie Technologie
  // mają własną pozycję menu (osobny tab), więc to pole tam się nie
  // liczy; na mobile dzielą jedną pozycję w dolnym pasku — powtórne
  // wciśnięcie "Magazyn" przełącza widok, ten sam wzorzec co buildsView.
  const [warehouseView, setWarehouseView] = useState<"materials" | "technologies">(
    "materials",
  );
  const [selectedBuildId, setSelectedBuildId] = useState(initialBuilds[0].id);
  const [selectedMaterialId, setSelectedMaterialId] = useState(
    initialMaterials[0].id,
  );
  // Ręczny wybór partii (Faza 5) — dla materiałów spoza planu technologii
  // wyszukiwarka pokazuje partie (nie same materiały): różne daty/ceny tej
  // samej pozycji do wyboru. `selectedMaterialId` zostaje (nadal potrzebny
  // np. gdzie indziej), ale koszyk przypisania działa teraz na batchId.
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [plannedAmount, setPlannedAmount] = useState("");
  const [picker, setPicker] = useState<"build" | "material" | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [draftAssignments, setDraftAssignments] = useState<
    { batchId: string; materialId: string; quantity: number }[]
  >([]);
  const [workdayHours, setWorkdayHours] = useState(8);
  const [workdayHoursInput, setWorkdayHoursInput] = useState("8");
  const [reportValues, setReportValues] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [reportSaved, setReportSaved] = useState(false);
  const [reportStep, setReportStep] = useState<1 | 2 | 3>(1);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [employees, setEmployees] = useState(initialEmployees);
  const [timeEntries, setTimeEntries] = useState(initialTimeEntries);

  // --- Supabase jako źródło prawdy dla budów/materiałów/pracowników/
  // zamówień/przypisań/raportów — bezpośrednio, anon key + RLS, bez
  // pośredniczącego serwera Express/tRPC (Railway). Nie zastępuje
  // mechanizmu AsyncStorage poniżej (efekt "budowy-simulator") — ten
  // zostaje jako lokalny cache do odczytu offline (brygadzista bez
  // zasięgu wciąż widzi ostatnio pobrany stan budowy/materiałów, żeby móc
  // wypełnić raport). Gdy jest sieć, świeże dane z bazy nadpisują ten cache.
  const queryClient = useQueryClient();
  useRealtimeSync(queryClient);
  // Eager — potrzebne od razu niezależnie od zakładki: liczniki w pasku
  // nawigacji (belowMinimumMaterials, pendingOrdersCount,
  // reportsPendingApprovalCount/reportsNeedingFixCount), ekran startowy,
  // i `assignments` (buildMaterials → useEffect niżej) używane wszędzie.
  // `staleTime: Infinity` na WSZYSTKICH zapytaniach w tym pliku — realtime
  // (useRealtimeSync wyżej) i tak unieważnia cache dokładnie wtedy, gdy
  // dane się realnie zmienią, więc czasowe wygaszanie tylko dokładałoby
  // zbędne odpytywanie serwera przy każdym powrocie na zakładkę.
  const buildsQuery = useQuery({
    queryKey: ["builds", "list"],
    queryFn: listBuilds,
    retry: 1,
    // Realtime samo w sobie potrafi zgubić zdarzenie (zerwane websocket na
    // telefonie brygadzisty, apka w tle w momencie, gdy Admin tworzy
    // katalog na zdjęcia) — bez siatki bezpieczeństwa `photosUrl` zostawał
    // wtedy na zawsze `null` w tej sesji, dopóki ktoś nie zrestartował
    // apki (zgłoszone: przycisk "Zrób zdjęcie" u brygadzisty nie
    // odblokowywał się po utworzeniu katalogu przez Admina). Ten sam wzorzec
    // co reportsQuery niżej: refetch przy powrocie na kartę/ekran +
    // lekki interval jako fallback.
    refetchOnWindowFocus: true,
    refetchInterval: 60000,
    staleTime: Infinity,
  });
  const materialsQuery = useQuery({
    queryKey: ["materials", "list"],
    queryFn: listMaterials,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const employeesQuery = useQuery({
    queryKey: ["employees", "list"],
    queryFn: listEmployees,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const leaveRequestsQuery = useQuery({
    queryKey: ["leaveRequests", "list"],
    queryFn: listLeaveRequests,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const leaveRequests = useMemo(
    () =>
      (leaveRequestsQuery.data ?? []).map((r) => ({
        ...r,
        employeeId: String(r.employeeId),
        decidedBy: r.decidedBy != null ? String(r.decidedBy) : null,
      })),
    [leaveRequestsQuery.data],
  );
  // Brygady i ich skład — potrzebne od razu, tak jak pracownicy wyżej:
  // wybór brygady w formularzu Nowa budowa i planowany koszt robocizny w
  // karcie budowy (Budowy), oraz zarządzanie składem w Admin (Zespół).
  const teamsQuery = useQuery({
    queryKey: ["teams", "list"],
    queryFn: listTeams,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const teamMembersQuery = useQuery({
    queryKey: ["teamMembers", "list"],
    queryFn: listTeamMembers,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const teams = (teamsQuery.data ?? []) as TeamRow[];
  const teamMembers = (teamMembersQuery.data ?? []) as TeamMemberRow[];
  // Leniwe — reszta poniżej odpala się dopiero przy pierwszym wejściu na
  // zakładkę, która ich faktycznie potrzebuje (tabDataEnabled wyżej),
  // zamiast wszystkie naraz na starcie aplikacji. Każde `enabled` wymienia
  // WSZYSTKIE zakładki faktycznie czytające dany zasób (sprawdzone przez
  // grep w komponentach, nie zgadywane) — pomyłka w drugą stronę
  // (zbędna zakładka na liście) kosztuje tylko jedno zbędne zapytanie,
  // ale brakująca zakładka to realny bug (pusty ekran).
  //
  // Technologie (Faza 1/2) — tylko aktywne (najnowsza wersja każdej
  // rodziny); potrzebne w Technologiach i przy przypisywaniu technologii
  // do budowy w Budowach.
  const technologiesQuery = useQuery({
    queryKey: ["technologies", "active"],
    queryFn: listActiveTechnologies,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    // "warehouse" dopisane celowo: na mobile Technologie renderują się
    // WEWNĄTRZ zakładki "warehouse" (przełącznik warehouseView, patrz
    // index.tsx) — `tab` sam w sobie nigdy nie zmienia się na
    // "technologies" na tym layoucie, więc bez tego to zapytanie nigdy
    // by się nie odblokowało na mobile.
    enabled: tabDataEnabled(["technologies", "builds", "warehouse"]),
  });
  // Snapshot+plan dla WSZYSTKICH budów naraz, filtrowane po buildId w UI —
  // ten sam wzorzec co assignments/savedReports poniżej. Tylko Budowy.
  const buildTechnologySnapshotsQuery = useQuery({
    queryKey: ["buildTechnologySnapshots", "list"],
    queryFn: listBuildTechnologySnapshots,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: tabDataEnabled(["builds"]),
  });
  // Plan materiałowy per etap — Budowy (karta budowy), Raport (grupowanie
  // materiałów po etapie) i Rozliczenie (tabela plan/przypisano/zużyto).
  const buildMaterialPlansQuery = useQuery({
    queryKey: ["buildMaterialPlans", "list"],
    queryFn: listBuildMaterialPlans,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: tabDataEnabled(["builds", "report", "settlement"]),
  });
  const buildMaterialPlans = (buildMaterialPlansQuery.data ?? []) as BuildMaterialPlanRow[];
  // Zamówienia jako nagłówek+pozycje (Faza 3) — dla WSZYSTKICH budów naraz,
  // filtrowane po buildId w UI, ten sam wzorzec co plan materiałowy wyżej.
  // Budowy (generowanie/przyjęcie z planu) i Zamówienia (lista/przyjęcie).
  const buildOrdersQuery = useQuery({
    queryKey: ["buildOrders", "list"],
    queryFn: listBuildOrders,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: tabDataEnabled(["builds", "orders"]),
  });
  // Realne partie magazynowe (Faza 4) — czysty odczyt dla ekranu magazynu
  // (data, ilość dostępna, cena, dokument, dostawca); NIE zastępuje
  // `materialBatches` (lokalna symulacja FIFO pod raport dzienny/offline).
  // Magazyn (lista partii), Budowy (ręczny wybór partii do przypisania) i
  // Raport (brygadzista dodający materiał pomocniczy z magazynu).
  const warehouseBatchesQuery = useQuery({
    queryKey: ["warehouseBatches", "list"],
    queryFn: listWarehouseBatchesRemote,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: tabDataEnabled(["warehouse", "builds", "report"]),
  });
  const warehouseBatches = (warehouseBatchesQuery.data ?? []) as WarehouseBatchRow[];
  // Partie faktycznie przypisane do budów (Faza 5) — czysty odczyt,
  // przydatny do pokazania "z jakiej partii" w raporcie/rozliczeniu.
  // Budowy (panel zamknięcia — decyzja o pozostałości) i Rozliczenie.
  const buildMaterialLotsQuery = useQuery({
    queryKey: ["buildMaterialLots", "list"],
    queryFn: listBuildMaterialLotsRemote,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: tabDataEnabled(["builds", "settlement"]),
  });
  // Decyzje zwrot/wyrzucenie przy zamknięciu budowy (Faza 9) — do
  // wyliczenia "Straty materiałowe" w Rozliczeniu na żywo (§6,
  // docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md), ten sam wzorzec co lots wyżej.
  const buildMaterialReturnsQuery = useQuery({
    queryKey: ["buildMaterialReturns", "list"],
    queryFn: listBuildMaterialReturnsRemote,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: tabDataEnabled(["builds", "settlement"]),
  });
  // Statusy etapów technologii (Faza 6) — wszystkie budowy naraz, ten sam
  // wzorzec co plan materiałowy/zamówienia wyżej. Obecnie nieużywane przez
  // żaden ekran (przygotowane pod przyszłą funkcję) — bramkowane tak samo
  // jak Budowy/Raport, których dotyczyłoby najbardziej, gdyby zaczęło być
  // czytane.
  const buildStageStatusesQuery = useQuery({
    queryKey: ["buildStageStatuses", "list"],
    queryFn: listBuildStageStatuses,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: tabDataEnabled(["builds", "report"]),
  });
  // Ustawienia aplikacji (Faza 7 + PIN zamknięcia budowy) — singleton
  // (patrz lib/data/settings.ts). kmRate używane do podglądu kosztu w
  // formularzu raportu, PRZED wysyłką — autorytatywna wartość i tak jest
  // zamrażana przez bazę w submit_daily_report. closeBuildPin sprawdzany
  // w Budowach przed "Zamknij (i rozlicz) budowę", stąd "builds" też w
  // enabled. Tab "admin" (panel Admina — sekcja "Zespół i dniówka" —
  // oraz "Ustawienia" u pozostałych ról, ta sama zakładka) i Raport
  // (kmRate w formularzu).
  const settingsQuery = useQuery({
    queryKey: ["settings", "get"],
    queryFn: getSettings,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: tabDataEnabled(["admin", "report", "builds"]),
  });
  const kmRate = Number(settingsQuery.data?.kmRate ?? 0);
  const closeBuildPin = settingsQuery.data?.closeBuildPin ?? null;

  useEffect(() => {
    // `.data === undefined` = zapytanie jeszcze się nie wykonało (nie
    // nadpisuj lokalnego stanu/danych demo w trakcie ładowania). Ale gdy
    // Supabase realnie zwróci pustą tablicę (np. po wyczyszczeniu bazy),
    // TO TEŻ jest prawidłowy wynik — trzeba go zsynchronizować, inaczej
    // apka na zawsze zostaje przy poprzednim stanie / danych demo
    // (initialBuilds w report-ui.tsx), mimo że w bazie nic już nie ma.
    if (buildsQuery.data === undefined) return;
    setBuilds((previous) =>
      buildsQuery.data.map((b) => {
        // Zachowaj lokalnie policzony snapshot rozliczenia (settlement),
        // bo dziś żyje tylko w AsyncStorage, nie w Supabase.
        const existing = previous.find((p) => p.id === String(b.id));
        return {
          id: String(b.id),
          number: b.number,
          name: b.name,
          manager: b.manager ?? "",
          startDate: b.startDate,
          durationDays: b.durationDays,
          teamId: b.teamId,
          plannedHoursPerDay: Number(b.plannedHoursPerDay ?? 8),
          status: b.status,
          photosUrl: b.photosUrl,
          driveFolderId: b.driveFolderId,
          settlement: existing?.settlement,
          clientName: b.clientName,
          address: b.address,
          areaM2: b.areaM2,
          contractValue: b.contractValue,
        };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildsQuery.data]);

  useEffect(() => {
    // Patrz komentarz przy buildsQuery wyżej — pusta tablica z Supabase to
    // prawidłowy wynik ("magazyn faktycznie pusty"), nie brak danych.
    if (materialsQuery.data === undefined) return;
    const rows = materialsQuery.data.map((m) => ({
      id: String(m.id),
      name: m.name,
      index: m.index,
      unit: m.unit,
      stock: Number(m.stock),
      min: Number(m.min),
      unitPrice: Number(m.unitPrice),
      active: m.active ?? true,
    })) satisfies Material[];
    setMaterials(rows);
    // Partie nie są jeszcze pobierane z material_batches (osobny krok) —
    // do tego czasu odtwarzamy jedną partię "stan początkowy" per
    // materiał na bazie stock/unitPrice z bazy, tak jak dotychczas dla
    // danych lokalnych, żeby FIFO w raportach miało z czego zdejmować.
    setMaterialBatches(
      rows
        .filter((m) => m.stock > 0)
        .map((m) => ({
          id: `batch-init-${m.id}`,
          materialId: m.id,
          quantity: m.stock,
          unitPrice: m.unitPrice,
          receivedAt: todayISO(),
          source: "stan początkowy",
        })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialsQuery.data]);

  useEffect(() => {
    // Patrz komentarz przy buildsQuery wyżej — pusty zespół z Supabase to
    // prawidłowy wynik, nie brak danych.
    if (employeesQuery.data === undefined) return;
    setEmployees(
      employeesQuery.data.map((e) => ({
        id: String(e.id),
        name: e.name,
        role: e.role,
        hourlyRate: Number(e.hourlyRate),
        costRate: Number(e.costRate) || 0,
        leaveDaysPerYear: Number(e.leaveDaysPerYear) || 26,
        active: e.active ?? true,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeesQuery.data]);

  // `time_entries` — godziny pracy per pracownik/budowa. Wstawiane przez
  // serwerową funkcję `submit_daily_report` w momencie wysłania raportu
  // (niezależnie od zatwierdzenia), ale do tej pory appka nigdy nie
  // odczytywała tej tabeli z powrotem: `timeEntries` żyło wyłącznie
  // lokalnie (AsyncStorage / optymistyczna aktualizacja w
  // saveDailyReportUnsafe niżej) — koszt robocizny w Rozliczeniu
  // (settlement-screen.tsx) był więc zawsze pusty na innym urządzeniu
  // albo po odświeżeniu strony, mimo że dane realnie były w bazie.
  const timeEntriesQuery = useQuery({
    queryKey: ["timeEntries", "list"],
    queryFn: listTimeEntries,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (timeEntriesQuery.data === undefined) return;
    setTimeEntries(
      timeEntriesQuery.data.map((t) => ({
        id: String(t.id),
        date: t.date,
        buildId: String(t.buildId),
        employeeId: String(t.employeeId),
        hours: Number(t.hours),
        start: t.start ?? undefined,
        end: t.end ?? undefined,
        hourlyRate: t.hourlyRate != null ? Number(t.hourlyRate) : null,
        costRate: t.costRate != null ? Number(t.costRate) : null,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeEntriesQuery.data]);

  const ordersQuery = useQuery({
    queryKey: ["orders", "list"],
    queryFn: listOrders,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!ordersQuery.data) return;
    setOrders(
      ordersQuery.data.map((o) => ({
        id: String(o.id),
        materialId: o.materialId ? String(o.materialId) : undefined,
        materialName: o.materialName,
        quantity: Number(o.quantity),
        unit: o.unit,
        status: o.status,
        createdAt: o.createdAt.slice(0, 10),
        orderedAt: o.orderedAt ? o.orderedAt.slice(0, 10) : undefined,
        receivedQuantity: o.receivedQuantity
          ? Number(o.receivedQuantity)
          : undefined,
        receivedUnitPrice: o.receivedUnitPrice
          ? Number(o.receivedUnitPrice)
          : undefined,
        receivedAt: o.receivedAt ? o.receivedAt.slice(0, 10) : undefined,
        batchId: o.batchId ?? undefined,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersQuery.data]);

  const buildMaterialsQuery = useQuery({
    queryKey: ["buildMaterials", "list"],
    queryFn: listBuildMaterials,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!buildMaterialsQuery.data) return;
    setAssignments(
      buildMaterialsQuery.data.map((a) => ({
        buildId: String(a.buildId),
        materialId: String(a.materialId),
        planned: Number(a.planned),
        used: Number(a.used),
        unitPrice: Number(a.unitPrice),
        actualCost: Number(a.actualCost),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildMaterialsQuery.data]);

  // Raporty: dawniej WYŁĄCZNIE lokalny stan (savedReports), nigdy nie
  // odpytywany z bazy — admin logujący się z innego urządzenia niż to,
  // z którego brygadzista wysłał raport, nie widział go w ogóle. Teraz
  // pobierane z Supabase i SCALANE z lokalnym stanem: wersja z serwera
  // (ma autorytatywny koszt FIFO policzony w RPC, patrz
  // lib/data/reports.ts) nadpisuje lokalny wpis o tym samym
  // buildId+date, a wpisy, które jeszcze nie zdążyły się zsynchronizować
  // (kolejka offline) zostają bez zmian, dopóki nie dotrą do bazy.
  const reportsQuery = useQuery({
    queryKey: ["reports", "list"],
    queryFn: listReports,
    retry: 1,
    // Admin (panel raportów) zwykle trzyma ten ekran otwarty na biurku,
    // czekając na raporty wysyłane przez brygadzistów z innych urządzeń.
    // refetchOnWindowFocus pokrywa scenariusz "wróciłem, sprawdzam" —
    // odświeża natychmiast przy powrocie na kartę. Do tego lekki
    // refetchInterval jako siatka bezpieczeństwa dla sytuacji, gdy ktoś
    // zostaje na ekranie bez przełączania karty: 60s to rzadko, więc nie
    // dobija bez potrzeby do bazy, a jednocześnie opóźnienie zostaje
    // rozsądne (nie godziny/ręczne odświeżanie, jak wcześniej). Domyślnie
    // React Query wstrzymuje ten interwał, gdy karta jest w tle
    // (refetchIntervalInBackground: false), więc nie chodzi w kółko, gdy
    // nikt nie patrzy. Sam moment wysyłki (ten sam proces) jest już objęty
    // osobnym invalidate("reports") w saveDailyReportUnsafe, więc na
    // jednym urządzeniu wynik i tak jest natychmiastowy.
    refetchOnWindowFocus: true,
    refetchInterval: 60000,
  });
  useEffect(() => {
    if (!reportsQuery.data) return;
    const serverReports = reportsQuery.data.map(mapReportRowToSavedReport);
    const serverKeys = new Set(
      serverReports.map((r) => `${r.buildId}:${r.date}`),
    );
    setSavedReports((previous) => {
      const localOnly = previous.filter(
        (r) => !serverKeys.has(`${r.buildId}:${r.date}`),
      );
      return [...serverReports, ...localOnly].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsQuery.data]);
  // Do plakietek nawigacji (patrz app/(tabs)/index.tsx): ile raportów
  // czeka na admina, ile wróciło "do poprawy" do brygadzisty. Liczone z
  // SUROWEGO statusu z bazy (nie ze zwężonego SavedReportStatus, który
  // ma tylko submitted/approved), żeby odróżnić te dwa przypadki.
  const reportsPendingApprovalCount = (reportsQuery.data ?? []).filter(
    (r) => r.status !== "approved",
  ).length;
  const reportsNeedingFixCount = (reportsQuery.data ?? []).filter(
    (r) => r.status === "do_poprawy",
  ).length;

  // --- Mutacje online (materiały/budowy/pracownicy/zamówienia/przypisania).
  // W przeciwieństwie do raportu dziennego, te NIE przechodzą przez kolejkę
  // offline — to typowe operacje panelu Admina/Magazynu/HR wykonywane przy
  // biurku, z założeniem że jest sieć. Brak połączenia kończy się czytelnym
  // komunikatem zamiast cichego, potencjalnie niespójnego zapisu lokalnego.
  const invalidate = (key: string) =>
    queryClient.invalidateQueries({ queryKey: [key, "list"] });

  // Zamówienia/Magazyn polegają na Realtime do świeżości danych
  // (staleTime: Infinity na tych zapytaniach) — ale uśpiona karta w
  // przeglądarce / telefon w tle potrafi po cichu zerwać kanał Realtime
  // (patrz lib/data/use-realtime-sync.ts), więc zmiana zrobiona na innym
  // urządzeniu nie zawsze dociera, dopóki ktoś nie zrobi pełnego reloadu.
  // Dodatkowe zabezpieczenie: wymuś odświeżenie za każdym razem, gdy
  // ktoś faktycznie PRZEJDZIE na daną zakładkę, niezależnie od Realtime.
  useEffect(() => {
    if (tab === "orders") {
      invalidate("orders");
      invalidate("buildOrders");
      invalidate("materials");
    } else if (tab === "warehouse") {
      invalidate("materials");
      invalidate("warehouseBatches");
      queryClient.invalidateQueries({ queryKey: ["technologies"] });
    }
    // "reports" zasila plakietkę "ile do sprawdzenia" w PASKU NAWIGACJI —
    // widoczną niezależnie od tego, na jakiej zakładce ktoś akurat jest —
    // więc odświeżamy ją przy KAŻDEJ zmianie zakładki, nie tylko przy
    // wejściu na Raporty. Bez tego Admin mógł nie zobaczyć nowego raportu
    // od brygadzisty od razu: Realtime na tej samej karcie przeglądarki
    // potrafi się po cichu urwać (tak samo jak w Zamówieniach/Magazynie
    // wyżej), a refetchInterval na reportsQuery czeka do 60s.
    invalidate("reports");
    // Godziny pracy zasilają Rozliczenie (koszt robocizny) i ekrany HR
    // ("Rozliczenie godzin", "Mój czas", "Czas zespołu") — ta sama
    // ochrona przed po cichu urwanym Realtime co przy "reports" wyżej.
    invalidate("timeEntries");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const createMaterialMutation = useMutation({ mutationFn: createMaterial });
  const updateMaterialPriceMutation = useMutation({
    mutationFn: (vars: { materialId: number; unitPrice: number }) =>
      updateMaterialPriceRemote(vars.materialId, vars.unitPrice),
  });
  const adjustMaterialStockMutation = useMutation({
    mutationFn: (vars: { materialId: number; newStock: number }) =>
      adjustMaterialStockRemote(vars.materialId, vars.newStock),
  });
  const setMaterialActiveMutation = useMutation({
    mutationFn: (vars: { materialId: number; active: boolean }) =>
      setMaterialActiveRemote(vars.materialId, vars.active),
  });
  const createBuildMutation = useMutation({ mutationFn: createBuild });
  const updateBuildBasicInfoMutation = useMutation({
    mutationFn: (vars: {
      buildId: number;
      number: string;
      name: string;
      manager: string;
      clientName?: string | null;
      address?: string | null;
      contractValue?: number | null;
    }) => updateBuildBasicInfoRemote(vars.buildId, vars),
  });
  const updateBuildLaborPlanMutation = useMutation({
    mutationFn: (vars: {
      buildId: number;
      teamId: number | null;
      durationDays: number;
      plannedHoursPerDay: number;
    }) => updateBuildLaborPlanRemote(vars.buildId, vars),
  });
  const closeBuildMutation = useMutation({
    mutationFn: (vars: { buildId: number; returns: CloseBuildReturnItem[] }) =>
      closeBuildRemote(vars.buildId, vars.returns),
  });
  const reopenBuildMutation = useMutation({
    mutationFn: (vars: { buildId: number }) => reopenBuildRemote(vars.buildId),
  });
  const updateBuildPhotosUrlMutation = useMutation({
    mutationFn: (vars: { buildId: number; photosUrl: string }) =>
      updateBuildPhotosUrlRemote(vars.buildId, vars.photosUrl),
  });
  const assignTechnologyMutation = useMutation({
    mutationFn: (vars: { buildId: number; technologyId: number; areaM2: number }) =>
      assignTechnologyToBuild(vars.buildId, vars.technologyId, vars.areaM2),
  });
  // Ręczny wybór partii (Faza 5) — zastępuje dawny commitBuildMaterials
  // (materiał + ilość planowana, bez partii) dla materiałów spoza planu
  // technologii. commitBuildMaterials/commitBuildMaterialsMutation zostają
  // nieużywane (patrz komentarz w lib/data/build-materials.ts).
  const assignBatchesMutation = useMutation({
    mutationFn: (vars: { buildId: number; items: AssignMaterialBatchItem[] }) =>
      assignMaterialBatchesToBuild(vars.buildId, vars.items),
  });
  const unassignMaterialMutation = useMutation({
    mutationFn: (vars: { buildId: number; materialId: number }) =>
      unassignMaterialFromBuild(vars.buildId, vars.materialId),
  });
  const completeBuildStageMutation = useMutation({
    mutationFn: (vars: { buildId: number; stageName: string }) =>
      completeBuildStageRemote(vars.buildId, vars.stageName),
  });
  const reopenBuildStageMutation = useMutation({
    mutationFn: (vars: { buildId: number; stageName: string }) =>
      reopenBuildStageRemote(vars.buildId, vars.stageName),
  });
  const createEmployeeMutation = useMutation({ mutationFn: createEmployee });
  const updateEmployeeNameMutation = useMutation({
    mutationFn: (vars: { employeeId: number; name: string }) =>
      updateEmployeeNameRemote(vars.employeeId, vars.name),
  });
  const updateEmployeeRateMutation = useMutation({
    mutationFn: (vars: { employeeId: number; hourlyRate: number }) =>
      updateEmployeeRateRemote(vars.employeeId, vars.hourlyRate),
  });
  const updateEmployeeCostRateMutation = useMutation({
    mutationFn: (vars: { employeeId: number; costRate: number }) =>
      updateEmployeeCostRateRemote(vars.employeeId, vars.costRate),
  });
  const setEmployeeActiveMutation = useMutation({
    mutationFn: (vars: { employeeId: number; active: boolean }) =>
      setEmployeeActiveRemote(vars.employeeId, vars.active),
  });
  const updateEmployeeLeaveDaysMutation = useMutation({
    mutationFn: (vars: { employeeId: number; leaveDaysPerYear: number }) =>
      updateEmployeeLeaveDaysRemote(vars.employeeId, vars.leaveDaysPerYear),
  });
  const requestLeaveMutation = useMutation({ mutationFn: requestLeaveRemote });
  const updateLeaveRequestMutation = useMutation({
    mutationFn: (vars: {
      requestId: number;
      input: { type: LeaveType; dateFrom: string; dateTo: string; note?: string };
    }) => updateLeaveRequestRemote(vars.requestId, vars.input),
  });
  const cancelLeaveRequestMutation = useMutation({
    mutationFn: cancelLeaveRequestRemote,
  });
  const decideLeaveRequestMutation = useMutation({
    mutationFn: (vars: { requestId: number; approve: boolean }) =>
      decideLeaveRequestRemote(vars.requestId, vars.approve),
  });
  const createTeamMutation = useMutation({ mutationFn: createTeamRemote });
  const addTeamMemberMutation = useMutation({
    mutationFn: (vars: { teamId: number; employeeId: number }) =>
      addTeamMemberRemote(vars.teamId, vars.employeeId),
  });
  const removeTeamMemberMutation = useMutation({
    mutationFn: (vars: { teamId: number; employeeId: number }) =>
      removeTeamMemberRemote(vars.teamId, vars.employeeId),
  });
  const updateKmRateMutation = useMutation({
    mutationFn: (vars: { kmRate: number }) => updateKmRateRemote(vars.kmRate),
  });
  const updateCloseBuildPinMutation = useMutation({
    mutationFn: (vars: { pin: string }) => updateCloseBuildPinRemote(vars.pin),
  });
  const createOrderMutation = useMutation({ mutationFn: createOrderRemote });
  const markOrderOrderedMutation = useMutation({
    mutationFn: (vars: { orderId: number }) => markOrderOrderedRemote(vars.orderId),
  });
  const deleteOrderMutation = useMutation({
    mutationFn: (vars: { orderId: number }) => deleteOrderRemote(vars.orderId),
  });
  const receiveOrderMutation = useMutation({
    mutationFn: (vars: {
      orderId: number;
      receivedQuantity: number;
      receivedUnitPrice?: number;
      documentNumber?: string;
      supplier?: string;
    }) =>
      receiveOrderRemote(
        vars.orderId,
        vars.receivedQuantity,
        vars.receivedUnitPrice,
        vars.documentNumber,
        vars.supplier,
      ),
  });
  const generateOrderFromPlanMutation = useMutation({
    mutationFn: (vars: { buildId: number }) => generateOrderFromPlanRemote(vars.buildId),
  });
  const updateOrderItemQuantityMutation = useMutation({
    mutationFn: (vars: { itemId: number; orderedQuantity: number }) =>
      updateOrderItemQuantityRemote(vars.itemId, vars.orderedQuantity),
  });
  const markBuildOrderOrderedMutation = useMutation({
    mutationFn: (vars: { orderId: number }) => markBuildOrderOrderedRemote(vars.orderId),
  });
  const cancelBuildOrderMutation = useMutation({
    mutationFn: (vars: { orderId: number }) => cancelBuildOrderRemote(vars.orderId),
  });
  const deleteBuildOrderMutation = useMutation({
    mutationFn: (vars: { orderId: number }) => deleteBuildOrderRemote(vars.orderId),
  });
  const receiveBuildOrderMutation = useMutation({
    mutationFn: (vars: {
      orderId: number;
      items: ReceiveBuildOrderItemInput[];
      documentNumber?: string;
      supplier?: string;
    }) =>
      receiveBuildOrderRemote(vars.orderId, vars.items, vars.documentNumber, vars.supplier),
  });
  const approveReportMutation = useMutation({
    mutationFn: (vars: { buildId: number; date: string; status: "approved" | "do_poprawy" }) =>
      updateReportStatus(vars.buildId, vars.date, vars.status),
  });

  function reportMutationError(error: unknown, fallback: string) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : fallback;
    notify("Nie udało się zapisać", message || fallback);
  }

  const [hrSaved, setHrSaved] = useState(false);
  const [reportStatus, setReportStatus] = useState<
    "roboczy" | "wysłany" | "do poprawy" | "zatwierdzony"
  >("roboczy");
  const [adminComment, setAdminComment] = useState("");
  // Celowo BEZ domyślnej osoby — wcześniej startowało od
  // `initialEmployees[0].id`, więc wciśnięcie "Dodaj" bez otwierania
  // listy pracowników po cichu dodawało pierwszego z listy, jakby ktoś go
  // wybrał (zgłoszone jako "dodanie pustej osoby bez wybierania niczego").
  // Pusty string nie pasuje do żadnego prawdziwego pracownika, więc
  // przycisk pokazuje placeholder "Wybierz pracownika", a addPersonToDraft
  // niżej wymaga jawnego wyboru.
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [personStart, setPersonStart] = useState("07:00");
  const [personEnd, setPersonEnd] = useState("15:00");
  useEffect(() => {
    AsyncStorage.getItem("lastPersonTime").then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (saved.start) setPersonStart(saved.start);
        if (saved.end) setPersonEnd(saved.end);
      } catch {}
    });
  }, []);
  const [timePicker, setTimePicker] = useState<"start" | "end" | null>(null);
  const [draftPeople, setDraftPeople] = useState<
    { employeeId: string; start: string; end: string }[]
  >([]);
  const [draftExtraCosts, setDraftExtraCosts] = useState<ExtraCost[]>([]);
  // Kilometrówka (Faza 7) — string (jak inne pola formularza), żeby
  // pole mogło być puste zamiast "0". Puste/niepoprawne = brak km w
  // raporcie (patrz saveDailyReportUnsafe niżej).
  const [draftKm, setDraftKm] = useState("");
  // Notatka do raportu (Decyzja B, docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md
  // §5) — jedna, dowolna notatka tekstowa na cały raport (nie per
  // materiał — to zostaje osobnym polem "reasons", patrz wyżej), czysto
  // informacyjna, nie wpływa na żadne wyliczenia.
  const [draftNote, setDraftNote] = useState("");
  const [orders, setOrders] = useState<MaterialOrder[]>([]);
  useEffect(() => {
    AsyncStorage.getItem("budowy-simulator").then((raw) => {
      if (raw) {
        const d = JSON.parse(raw);
        setMaterials(
          (d.materials || initialMaterials).map((m: Material) => ({
            ...m,
            unitPrice: m.unitPrice || 0,
            // Stary zapis w AsyncStorage sprzed dodania kolumny `active` —
            // domyślnie widoczny/aktywny, żeby nic nie zniknęło po cichu.
            active: m.active ?? true,
          })),
        );
        setBuilds(
          (d.builds || initialBuilds).map((b: Build) => ({
            ...b,
            status: b.status || "aktywna",
          })),
        );
        setAssignments(
          (d.assignments || initialAssignments).map((a: Assignment) => ({
            ...a,
            unitPrice: a.unitPrice || 0,
            actualCost: a.actualCost || 0,
          })),
        );
        setEmployees(
          (d.employees || initialEmployees).map((e: Employee) => ({
            ...e,
            hourlyRate: e.hourlyRate || 0,
            costRate: e.costRate || 0,
            leaveDaysPerYear: e.leaveDaysPerYear || 26,
            active: e.active ?? true,
          })),
        );
        setTimeEntries(d.timeEntries || initialTimeEntries);
        setOrders(d.orders || []);
        // NIE wczytujemy tu d.savedReports: raporty są dziś autorytatywnie
        // w Supabase (reportsQuery/mergeEffect niżej) — wczytanie starego
        // lokalnego zrzutu z tego klucza potrafiło "wskrzeszać" raporty
        // dawno skasowane z bazy (np. po czyszczeniu bazy), bo scalanie z
        // serwerem usuwa lokalny wpis tylko wtedy, gdy serwer zwróci wpis
        // o tym samym buildId+date — a po czyszczeniu bazy serwer nie
        // zwraca nic, więc taki "duch" zostawał na zawsze.
        if (d.workdayHours) {
          setWorkdayHours(d.workdayHours);
          setWorkdayHoursInput(String(d.workdayHours));
        }
      }
    });
  }, []);
  useEffect(() => {
    // savedReports celowo NIE trafia już do tego zrzutu — patrz komentarz
    // przy jego wczytywaniu wyżej (raporty są dziś autorytatywnie w bazie).
    AsyncStorage.setItem(
      "budowy-simulator",
      JSON.stringify({
        materials,
        builds,
        assignments,
        employees,
        timeEntries,
        orders,
        workdayHours,
      }),
    );
  }, [materials, builds, assignments, employees, timeEntries, orders, workdayHours]);
  const activeBuild = builds.find((b) => b.id === selectedBuildId) || builds[0];
  const buildAssignments = assignments.filter(
    (a) => a.buildId === activeBuild?.id,
  );
  // Krzyżyk na karcie "Brak" w Zamówieniach (patrz orders-screen.tsx) —
  // materiał, który akurat wyzerował magazyn, ale Admin wie, że go NIE
  // zamawia teraz (np. ma go gdzie indziej, po innej cenie, i doda ręcznie
  // później). Zapamiętujemy ILE brakowało w chwili odrzucenia — jeśli
  // brak później URÓŚNIE (kolejne przypisanie zjadło jeszcze więcej), alert
  // wraca, bo to już inny, większy niedobór niż ten odrzucony.
  const [dismissedShortages, setDismissedShortages] = useState<Record<string, number>>({});
  useEffect(() => {
    AsyncStorage.getItem("dismissed-shortages").then((raw) => {
      if (!raw) return;
      try {
        setDismissedShortages(JSON.parse(raw));
      } catch {}
    });
  }, []);
  const dismissShortage = (materialId: string, missing: number) => {
    setDismissedShortages((prev) => {
      const next = { ...prev, [materialId]: missing };
      AsyncStorage.setItem("dismissed-shortages", JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  const shortages = useMemo(() => {
    const needed = new Map<string, number>();
    assignments.forEach((a) =>
      needed.set(a.materialId, (needed.get(a.materialId) || 0) + a.planned),
    );
    return materials
      .map((m) => ({
        material: m,
        needed: needed.get(m.id) || 0,
        missing: Math.max(0, (needed.get(m.id) || 0) - m.stock),
      }))
      .filter(
        (row) =>
          row.missing > 0 &&
          !(
            dismissedShortages[row.material.id] !== undefined &&
            dismissedShortages[row.material.id] >= row.missing
          ),
      );
  }, [materials, assignments, dismissedShortages]);
  // Materiały poniżej własnego stanu minimalnego (m.min, patrz + Dodaj
  // materiał w warehouse-screen.tsx) — inny sygnał niż `shortages`
  // powyżej (tam "brakuje do planu budów", tu "trzeba dokupić, żeby
  // magazyn nie zszedł poniżej ustalonego poziomu"). Ten sam warunek co
  // podświetlenie stanu na czerwono na liście materiałów.
  //
  // Materiał znika z tej listy TYLKO gdy suma ilości z aktywnych
  // (nieprzyjętych/nieanulowanych) zamówień — licząc oba równoległe
  // systemy: stary `material_orders` (`orders` niżej) i nowy `orders`/
  // build-order z wizarda technologii (`buildOrders`) — pokrywa CAŁY
  // brakujący dystans (min - stock). Zamówienie mniejsze niż brak nie
  // gasi alertu (świadomie: admin ma widzieć, że mimo zamówienia i tak
  // czegoś zabraknie), tylko zamówienie z zapasem lub dokładnie
  // pokrywające brak.
  const belowMinimumMaterials = useMemo(() => {
    const pendingByMaterialId = new Map<string, number>();
    for (const o of orders) {
      if (o.status === "dostarczone" || !o.materialId) continue;
      pendingByMaterialId.set(
        o.materialId,
        (pendingByMaterialId.get(o.materialId) ?? 0) + o.quantity,
      );
    }
    for (const bo of (buildOrdersQuery.data ?? []) as BuildOrderRow[]) {
      if (bo.status === "przyjęte" || bo.status === "anulowane") continue;
      for (const item of bo.order_items) {
        if (!item.linkedMaterialId) continue;
        const key = String(item.linkedMaterialId);
        pendingByMaterialId.set(
          key,
          (pendingByMaterialId.get(key) ?? 0) + Number(item.orderedQuantity),
        );
      }
    }
    return materials.filter(
      (m) => m.stock + (pendingByMaterialId.get(m.id) ?? 0) < m.min,
    );
  }, [materials, orders, buildOrdersQuery.data]);
  // Ręczny wybór partii (Faza 5) — admin wybiera KONKRETNĄ partię
  // (wyszukiwarka pokazuje różne daty/ceny tej samej pozycji, patrz
  // warehouseBatches) i ile z niej trafia na budowę, zamiast tylko
  // wpisywać ilość planowaną i zdawać się na automatyczny FIFO.
  const addToDraft = () => {
    const amount = Number(plannedAmount);
    // activeBuild?.id, nie goły selectedBuildId — ten drugi startuje na
    // ID z lokalnego seeda (initialBuilds[0].id, patrz useState wyżej) i
    // zostaje nim, dopóki ktoś ręcznie nie dotknie przełącznika budowy w
    // pickerze — u brygadzisty z jedną budową to się nigdy nie zdarza,
    // więc "Zatwierdź" trafiał w budowę, która nie istnieje w bazie
    // (stąd "budowa się nie zsynchronizowała"). saveDailyReportUnsafe
    // niżej ma dokładnie to samo obejście.
    const effectiveBuildId = activeBuild?.id || selectedBuildId;
    if (!effectiveBuildId || !selectedBatchId || !amount || amount <= 0) return;
    const batch = warehouseBatches.find((b) => String(b.id) === selectedBatchId);
    if (!batch) return;
    const existing = draftAssignments.find((a) => a.batchId === selectedBatchId);
    if (existing)
      setDraftAssignments(
        draftAssignments.map((a) =>
          a.batchId === selectedBatchId
            ? { ...a, quantity: a.quantity + amount }
            : a,
        ),
      );
    else
      setDraftAssignments([
        ...draftAssignments,
        { batchId: selectedBatchId, materialId: String(batch.materialId), quantity: amount },
      ]);
    setPlannedAmount("");
  };
  // Klik na materiał w wyszukiwarce dodaje go od razu do listy oczekującej
  // (z ilością 0, edytowalną w miejscu) zamiast wymuszać osobny krok
  // "wpisz ilość → Dodaj do listy" — przy kolejnym materiale użytkownik
  // po prostu klika następną pozycję, bez cofania się do pustego pola.
  const addMaterialToDraft = (batchId: string) => {
    if (draftAssignments.some((a) => a.batchId === batchId)) return;
    const batch = warehouseBatches.find((b) => String(b.id) === batchId);
    if (!batch) return;
    setDraftAssignments([
      ...draftAssignments,
      { batchId, materialId: String(batch.materialId), quantity: 0 },
    ]);
  };
  const updateDraftQuantity = (batchId: string, value: string) => {
    const quantity = Number(value) || 0;
    setDraftAssignments(
      draftAssignments.map((a) => (a.batchId === batchId ? { ...a, quantity } : a)),
    );
  };
  const removeFromDraft = (batchId: string) => {
    setDraftAssignments(draftAssignments.filter((a) => a.batchId !== batchId));
  };
  const commitAssignments = async () => {
    if (!draftAssignments.length) return;
    // Patrz komentarz w addToDraft — activeBuild?.id jest tym, co
    // faktycznie widać na ekranie, selectedBuildId bywa nieaktualne.
    const effectiveBuildId = activeBuild?.id || selectedBuildId;
    const targetBuild = builds.find((b) => b.id === effectiveBuildId);
    if (targetBuild?.status === "zamknięta") {
      notify(
        "Budowa zamknięta",
        "Ta budowa została zamknięta i rozliczona — nie można już przypisywać do niej materiałów.",
      );
      return;
    }
    const numericBuildId = Number(effectiveBuildId);
    const items = draftAssignments
      .map((d) => ({
        batchId: Number(d.batchId),
        quantity: d.quantity,
      }))
      .filter((i) => !Number.isNaN(i.batchId) && i.quantity > 0);
    if (Number.isNaN(numericBuildId) || !items.length) {
      notify(
        items.length
          ? "Poczekaj na synchronizację"
          : "Podaj ilość",
        items.length
          ? "Budowa lub partia jeszcze się nie zsynchronizowały z serwerem — spróbuj ponownie za chwilę."
          : "Wpisz ilość dla przynajmniej jednego materiału z listy.",
      );
      return;
    }
    try {
      await assignBatchesMutation.mutateAsync({
        buildId: numericBuildId,
        items,
      });
      await Promise.all([
        invalidate("buildMaterials"),
        invalidate("materials"),
        invalidate("warehouseBatches"),
        invalidate("buildMaterialLots"),
      ]);
      // Materiał, który brygadzista dopiero co przypisał do budowy z tego
      // raportu, ma od razu widnieć na liście "Materiały pomocnicze" Z
      // wpisaną dziś zużytą ilością — bez tego pozycja pojawiała się na
      // liście, ale ze steperem wyzerowanym, jakby ilość nigdy nie została
      // podana (a była, tylko w innym polu — ilości przydziału z magazynu,
      // nie dziennego zużycia).
      const committedByMaterial = new Map<string, number>();
      for (const d of draftAssignments) {
        if (d.quantity <= 0) continue;
        committedByMaterial.set(
          d.materialId,
          (committedByMaterial.get(d.materialId) || 0) + d.quantity,
        );
      }
      if (committedByMaterial.size) {
        const nextReportValues = { ...reportValues };
        for (const [materialId, delta] of committedByMaterial) {
          const current = Number(nextReportValues[materialId] || 0);
          nextReportValues[materialId] = String(Math.round((current + delta) * 1000) / 1000);
        }
        setReportValues(nextReportValues);
      }
      setDraftAssignments([]);
      setShowAssignment(false);
    } catch (error) {
      reportMutationError(error, "Nie udało się przypisać materiałów do budowy.");
    }
  };
  // Cofnięcie pomyłkowo dodanego materiału pomocniczego (odwrotność
  // commitAssignments powyżej) — zwraca ilość do partii źródłowej po
  // stronie bazy (unassign_material_from_build, 026), zablokowane tam,
  // jeśli materiał został już częściowo zużyty w raporcie.
  const removeBuildAssignment = async (buildId: string, materialId: string) => {
    const numericBuildId = Number(buildId);
    const numericMaterialId = Number(materialId);
    if (Number.isNaN(numericBuildId) || Number.isNaN(numericMaterialId)) return;
    try {
      await unassignMaterialMutation.mutateAsync({
        buildId: numericBuildId,
        materialId: numericMaterialId,
      });
      await Promise.all([
        invalidate("buildMaterials"),
        invalidate("materials"),
        invalidate("warehouseBatches"),
        invalidate("buildMaterialLots"),
      ]);
    } catch (error) {
      reportMutationError(error, "Nie udało się usunąć przypisania materiału.");
    }
  };
  // Status etapu technologii (Faza 6) — wyłącznie brygadzista/admin, ręcznie.
  const completeBuildStage = async (buildId: string, stageName: string) => {
    const numericBuildId = Number(buildId);
    if (Number.isNaN(numericBuildId)) return;
    try {
      await completeBuildStageMutation.mutateAsync({ buildId: numericBuildId, stageName });
      await invalidate("buildStageStatuses");
    } catch (error) {
      reportMutationError(error, "Nie udało się zakończyć etapu.");
    }
  };
  const reopenBuildStage = async (buildId: string, stageName: string) => {
    const numericBuildId = Number(buildId);
    if (Number.isNaN(numericBuildId)) return;
    try {
      await reopenBuildStageMutation.mutateAsync({ buildId: numericBuildId, stageName });
      await invalidate("buildStageStatuses");
    } catch (error) {
      reportMutationError(error, "Nie udało się wznowić etapu.");
    }
  };
  const saveMaterial = async (newMaterial: NewMaterialInput, onSaved: () => void) => {
    // Był tu cichy `return` bez żadnej informacji dla użytkownika — z
    // zewnątrz wyglądało jak "przycisk nic nie robi" (najczęściej dlatego,
    // że pole "Ilość początkowa" zostaje puste, jeśli nikt go nie dotknie —
    // QuantityStepper startuje bez wartości, nie od "0").
    if (!newMaterial.name || !newMaterial.index || !newMaterial.stock) {
      notify(
        "Brakuje danych",
        "Uzupełnij nazwę, indeks i ilość początkową (może być 0), żeby zapisać materiał.",
      );
      return;
    }
    if (
      materials.some(
        (m) =>
          m.index.trim().toLowerCase() ===
          newMaterial.index.trim().toLowerCase(),
      )
    ) {
      notify(
        "Indeks już istnieje",
        `Materiał z indeksem "${newMaterial.index}" jest już w magazynie.`,
      );
      return;
    }
    const stock = Number(newMaterial.stock);
    const min = Number(newMaterial.min) || 0;
    const unitPrice = Number(newMaterial.unitPrice) || 0;
    const createIt = async () => {
      try {
        await createMaterialMutation.mutateAsync({
          name: newMaterial.name,
          index: newMaterial.index,
          unit: newMaterial.unit || "szt.",
          stock,
          min,
          unitPrice,
        });
        await invalidate("materials");
        onSaved();
      } catch (error) {
        reportMutationError(error, "Nie udało się dodać materiału.");
      }
    };
    // Ten sam materiał (nazwa + cena) dodany dwukrotnie jako osobne
    // pozycje magazynowe rozjeżdża stan na dwa niezależne wiersze zamiast
    // jednego — scalanie już istniejących pozycji jest zbyt ryzykowne
    // (partie/przypisania do budów trzymają się materialId), więc tylko
    // ostrzegamy PRZED utworzeniem kolejnej, zamiast robić to po cichu.
    // Dopisanie stanu do istniejącej pozycji: wyszukiwarka + "+ partia"
    // przy materiale w warehouse-screen.tsx.
    const duplicate = materials.find(
      (m) =>
        m.name.trim().toLowerCase() === newMaterial.name.trim().toLowerCase() &&
        Math.abs((m.unitPrice || 0) - unitPrice) < 0.01,
    );
    if (duplicate) {
      confirmAction(
        "Taki materiał już jest w magazynie",
        `"${duplicate.name}" (${duplicate.index}) w tej samej cenie już istnieje — obecny stan: ${duplicate.stock} ${duplicate.unit}. Żeby dopisać ilość do istniejącej pozycji zamiast tworzyć duplikat, użyj wyszukiwarki i edycji stanu przy tym materiale. Dodać mimo to jako nową, osobną pozycję?`,
        "Dodaj mimo to",
        createIt,
      );
      return;
    }
    await createIt();
  };
  const saveBuild = async (
    newBuild: NewBuildInput,
    onSaved: (buildId: string) => void,
  ) => {
    const duration = Number(newBuild.durationDays);
    const missing: string[] = [];
    if (!newBuild.number) missing.push("Numer budowy");
    if (!newBuild.name) missing.push("Nazwa");
    if (!newBuild.manager) missing.push("Osoba odpowiedzialna");
    if (!newBuild.startDate) missing.push("Data rozpoczęcia");
    if (!duration || duration <= 0) missing.push("Czas trwania (dni)");
    if (missing.length > 0) {
      notify("Uzupełnij wymagane pola", missing.join(", "));
      return;
    }
    try {
      const build = await createBuildMutation.mutateAsync({
        number: newBuild.number,
        name: newBuild.name,
        manager: newBuild.manager,
        startDate: newBuild.startDate,
        durationDays: duration,
        teamId: newBuild.teamId ? Number(newBuild.teamId) : null,
        plannedHoursPerDay: newBuild.plannedHoursPerDay
          ? Number(newBuild.plannedHoursPerDay)
          : 8,
        clientName: newBuild.clientName || undefined,
        address: newBuild.address || undefined,
        contractValue: newBuild.contractValue ? Number(newBuild.contractValue) : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["builds", "list"] });
      onSaved(String(build.id));
      // Katalog na zdjęcia (Google Drive) NIE jest tworzony tu automatycznie
      // — Admin robi to świadomie przyciskiem "Stwórz katalog na zdjęcia"
      // na karcie budowy (builds-screen.tsx), przez Supabase Edge Function
      // drive-photos (patrz lib/data/drive-photos.ts). Budowa jako taka
      // nie zależy w żaden sposób od tego, czy katalog już istnieje.
    } catch (error) {
      reportMutationError(error, "Nie udało się dodać budowy.");
    }
  };
  // Edycja podstawowych danych budowy po jej utworzeniu (numer/nazwa/
  // odpowiedzialny/klient/adres/wartość kontraktu) — te same pola co krok 1
  // kreatora w saveBuild wyżej, tylko jako update zamiast insert.
  const updateBuildBasicInfo = async (
    buildId: string,
    input: {
      number: string;
      name: string;
      manager: string;
      clientName: string;
      address: string;
      contractValue: string;
    },
    onSaved?: () => void,
  ) => {
    const missing: string[] = [];
    if (!input.number) missing.push("Numer budowy");
    if (!input.name) missing.push("Nazwa");
    if (!input.manager) missing.push("Osoba odpowiedzialna");
    if (missing.length > 0) {
      notify("Uzupełnij wymagane pola", missing.join(", "));
      return;
    }
    try {
      await updateBuildBasicInfoMutation.mutateAsync({
        buildId: Number(buildId),
        number: input.number,
        name: input.name,
        manager: input.manager,
        clientName: input.clientName || undefined,
        address: input.address || undefined,
        contractValue: input.contractValue ? Number(input.contractValue) : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["builds", "list"] });
      onSaved?.();
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać danych budowy.");
    }
  };
  // Edycja brygady/dni roboczych/godzin dziennych po utworzeniu budowy —
  // te same pola co krok 1 kreatora (sekcja "Brygada i planowana
  // robocizna"), tylko jako update zamiast insert. Bez tego brygadę dało
  // się przypisać WYŁĄCZNIE w trakcie zakładania budowy — literówka albo
  // zmiana ekipy w trakcie realizacji nie miała jak się poprawić.
  const updateBuildLaborPlan = async (
    buildId: string,
    input: { teamId: string; durationDays: string; plannedHoursPerDay: string },
    onSaved?: () => void,
  ) => {
    const durationDays = Number(input.durationDays);
    const plannedHoursPerDay = Number(input.plannedHoursPerDay) || 8;
    if (!durationDays || durationDays <= 0) {
      notify("Uzupełnij wymagane pola", "Liczba dni roboczych");
      return;
    }
    try {
      await updateBuildLaborPlanMutation.mutateAsync({
        buildId: Number(buildId),
        teamId: input.teamId ? Number(input.teamId) : null,
        durationDays,
        plannedHoursPerDay,
      });
      await queryClient.invalidateQueries({ queryKey: ["builds", "list"] });
      onSaved?.();
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać brygady/planu robocizny.");
    }
  };
  // Przypisanie technologii do budowy (Faza 2) — atomowo w RPC: zapisuje
  // m², zamraża snapshot receptury, przelicza plan materiałowy. Bezpieczne
  // do wywołania wielokrotnie (Admin poprawia metraż / zmienia technologię),
  // dopóki budowa nie weszła w kolejne fazy (raporty/rozliczenie).
  const assignBuildTechnology = async (
    buildId: string,
    technologyId: number,
    areaM2: number,
  ) => {
    try {
      await assignTechnologyMutation.mutateAsync({
        buildId: Number(buildId),
        technologyId,
        areaM2,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["builds", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["buildTechnologySnapshots", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["buildMaterialPlans", "list"] }),
      ]);
    } catch (error) {
      reportMutationError(error, "Nie udało się przypisać technologii.");
    }
  };
  // Zamówienia z planu materiałowego (Faza 3) — agregacja
  // `build_material_plan` w jedno zamówienie ze statusem "robocze".
  const generateOrderFromPlan = async (buildId: string) => {
    try {
      await generateOrderFromPlanMutation.mutateAsync({ buildId: Number(buildId) });
      await invalidate("buildOrders");
    } catch (error) {
      reportMutationError(error, "Nie udało się wygenerować zamówienia z planu.");
    }
  };
  const updateOrderItemQuantity = async (itemId: number, orderedQuantity: number) => {
    if (!orderedQuantity || orderedQuantity <= 0) return;
    try {
      await updateOrderItemQuantityMutation.mutateAsync({ itemId, orderedQuantity });
      await invalidate("buildOrders");
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać ilości zamawianej.");
    }
  };
  const markBuildOrderOrdered = async (orderId: number) => {
    try {
      await markBuildOrderOrderedMutation.mutateAsync({ orderId });
      await invalidate("buildOrders");
    } catch (error) {
      reportMutationError(error, "Nie udało się oznaczyć zamówienia jako złożone.");
    }
  };
  const cancelBuildOrder = async (orderId: number) => {
    try {
      await cancelBuildOrderMutation.mutateAsync({ orderId });
      await invalidate("buildOrders");
    } catch (error) {
      reportMutationError(error, "Nie udało się anulować zamówienia.");
    }
  };
  const deleteBuildOrder = async (orderId: number) => {
    try {
      await deleteBuildOrderMutation.mutateAsync({ orderId });
      await invalidate("buildOrders");
    } catch (error) {
      reportMutationError(error, "Nie udało się skasować zamówienia.");
    }
  };
  // Przyjęcie dostawy: każda pozycja z osobną ilością/ceną dopisuje własną
  // partię (patrz receive_order w 007_faza3_zamowienia.sql) — dlatego po
  // sukcesie odświeżamy też magazyn, nie tylko listę zamówień.
  const receiveBuildOrder = async (
    orderId: number,
    items: ReceiveBuildOrderItemInput[],
    documentNumber?: string,
    supplier?: string,
  ) => {
    const valid = items.filter((i) => i.receivedQuantity > 0);
    if (valid.length === 0) return;
    try {
      await receiveBuildOrderMutation.mutateAsync({
        orderId,
        items: valid,
        documentNumber,
        supplier,
      });
      await Promise.all([
        invalidate("buildOrders"),
        invalidate("materials"),
        invalidate("warehouseBatches"),
        invalidate("buildMaterials"),
        invalidate("buildMaterialLots"),
      ]);
    } catch (error) {
      reportMutationError(error, "Nie udało się przyjąć dostawy.");
    }
  };
  const saveWorkdayHours = () => {
    const hours = Number(workdayHoursInput);
    if (!hours || hours <= 0) return;
    setWorkdayHours(hours);
  };
  const saveDailyReport = () => {
    try {
      saveDailyReportUnsafe();
    } catch (error) {
      // Bez tego wyjątek w tej funkcji (synchronicznej, wołanej wprost z
      // onPress) kończył się CISZĄ — przycisk "wyglądał" jakby nic nie
      // robił: żadnego alertu, żadnego requestu, żadnego błędu w konsoli
      // widocznego dla użytkownika (choć technicznie wyjątek trafiał do
      // konsoli deweloperskiej, brygadzista jej nie widzi). Teraz zawsze
      // widać komunikat, nawet jeśli przyczyna wymaga dalszej diagnozy.
      console.error("[saveDailyReport] wyjątek:", error);
      reportMutationError(error, "Nie udało się zapisać raportu dziennego.");
    }
  };
  const saveDailyReportUnsafe = () => {
    const buildId = activeBuild?.id || selectedBuildId;
    if (activeBuild?.status === "zamknięta") {
      notify(
        "Budowa zamknięta",
        "Ta budowa została zamknięta i rozliczona — nie można już dodawać do niej raportów.",
      );
      return;
    }
    const date = todayISO();
    const existingReport = savedReports.find(
      (report) =>
        report.id === editingReportId ||
        (!editingReportId && report.date === date && report.buildId === buildId),
    );
    if (existingReport?.status === "approved") {
      notify(
        "Raport zatwierdzony",
        "Zatwierdzonego raportu nie można już edytować.",
      );
      return;
    }
    const relevantAssignments = assignments.filter(
      (a) => a.buildId === buildId,
    );
    // Zużycie zdejmowane jest metodą FIFO z partii materiału, więc koszt
    // budowy odzwierciedla realną cenę zakupu zużytego towaru, a nie
    // jedną, uśrednioną cenę magazynową. Liczone kumulatywnie na jednej
    // tablicy partii (nie przez osobne wywołania per materiał), bo raport
    // zwykle dotyczy kilku materiałów naraz. Liczone PRZED złożeniem
    // reportSnapshot, żeby móc dołączyć koszt per materiał do samego
    // raportu (materialCosts), nie tylko do skumulowanego buildMaterialActualCost.
    let nextBatches = materialBatches;
    const affectedMaterialIds = new Set<string>();
    const costDeltas: Record<string, number> = {}; // `${buildId}:${materialId}` -> PLN
    const reportMaterialCosts: Record<string, number> = {
      ...(existingReport?.materialCosts || {}),
    };
    relevantAssignments.forEach((assignment) => {
      if (reportValues[assignment.materialId] === undefined) return;
      // reportValues trzyma DZISIEJSZE zużycie tego raportu (od zera), nie
      // nowy stan całkowity budowy — patrz getReportDefaults i
      // 047_raport_dzienna_ilosc_nie_skumulowana.sql. Delta do zastosowania
      // liczona jest więc względem tego, co TEN SAM raport już wcześniej
      // zapisał (existingReport), nie względem życiowego `assignment.used`.
      const newDaily = Number(reportValues[assignment.materialId] || 0);
      const oldDaily = Number(
        existingReport?.materialValues[assignment.materialId] || 0,
      );
      const delta = newDaily - oldDaily;
      if (delta > 0) {
        const result = consumeFIFOWithCostPure(
          nextBatches,
          assignment.materialId,
          delta,
        );
        nextBatches = result.batches;
        affectedMaterialIds.add(assignment.materialId);
        const key = `${buildId}:${assignment.materialId}`;
        costDeltas[key] = (costDeltas[key] || 0) + result.cost;
        reportMaterialCosts[assignment.materialId] =
          (reportMaterialCosts[assignment.materialId] || 0) + result.cost;
      }
      // Zmniejszenie zużycia (korekta raportu w dół) nie "oddaje" partii ani
      // nie odejmuje wcześniej doliczonego kosztu — nie wiemy z której
      // partii realnie towar wrócił; ewentualny zwrot trafia do magazynu
      // jako zwykła korekta stanu.
    });

    const reportSnapshot: SavedReport = {
      id: existingReport?.id || `report-${Date.now()}`,
      date,
      buildId,
      buildNumber: activeBuild?.number || "",
      buildName: activeBuild?.name || "",
      materialValues: { ...reportValues },
      materialCosts: reportMaterialCosts,
      reasons: { ...reasons },
      people: [...draftPeople],
      extraCosts: [...draftExtraCosts],
      status: existingReport?.status || "submitted",
      updatedAt: new Date().toISOString(),
      // km/kmRateApplied/kmCost lokalnie: km od razu (wpisane przez
      // brygadzistę), stawka/koszt dopiero po odpowiedzi z bazy niżej
      // (submitDailyReport) — baza jest tu autorytatywna, tak samo jak
      // przy FIFO materiałów.
      km: Number(draftKm.replace(",", ".")) || undefined,
      kmRateApplied: existingReport?.kmRateApplied,
      kmCost: existingReport?.kmCost,
      note: draftNote.trim() || undefined,
    };
    setSavedReports((previous) =>
      existingReport
        ? previous.map((report) =>
            report.id === reportSnapshot.id ? reportSnapshot : report,
          )
        : [reportSnapshot, ...previous],
    );
    setEditingReportId(reportSnapshot.id);
    if (Object.keys(costDeltas).length) {
      setBuildMaterialActualCost((prev) => {
        const next = { ...prev };
        for (const key in costDeltas) {
          next[key] = (next[key] || 0) + costDeltas[key];
        }
        return next;
      });
    }
    if (affectedMaterialIds.size) {
      setMaterialBatches(nextBatches);
      const finalBatches = nextBatches;
      setMaterials((prev) =>
        recalcMaterialsFromBatches(prev, finalBatches, affectedMaterialIds),
      );
    }
    setAssignments((prevAssignments) =>
      prevAssignments.map((a) => {
        if (a.buildId !== buildId || reportValues[a.materialId] === undefined)
          return a;
        const newDaily = Number(reportValues[a.materialId] || 0);
        const oldDaily = Number(existingReport?.materialValues[a.materialId] || 0);
        return { ...a, used: Math.max(0, a.used + (newDaily - oldDaily)) };
      }),
    );
    if (draftPeople.length) {
      const entries = draftPeople.map((person) => {
        const [sh, sm] = person.start.split(":").map(Number);
        const [eh, em] = person.end.split(":").map(Number);
        return {
          id: `${date}-${buildId}-${person.employeeId}`,
          date,
          buildId,
          employeeId: person.employeeId,
          hours: (eh * 60 + em - sh * 60 - sm) / 60,
          start: person.start,
          end: person.end,
        };
      });
      setTimeEntries((prev) => [
        ...prev.filter(
          (entry) => !(entry.date === date && entry.buildId === buildId),
        ),
        ...entries,
      ]);
      setDraftPeople([]);
    }
    setDraftExtraCosts([]);
    setDraftKm("");
    setDraftNote("");
    setHrSaved(true);
    setReportSaved(true);
    setReportStatus("wysłany");
    setReportStep(1);

    // Wyślij do Supabase (offline-safe): reportSnapshot.id jest generowane
    // raz i trzymane przez cały cykl edycji (patrz editingReportId) — to
    // ten sam string służy jako `clientId`, więc ponowne wciśnięcie
    // "Wyślij" (poprawka raportu) nadpisuje ten sam wiersz w bazie
    // zamiast tworzyć duplikat. Jeśli buildId/materialId nie są jeszcze
    // prawdziwymi ID z Supabase (np. pierwsze uruchomienie offline, zanim
    // budowy/materiały/pracownicy zdążyli się zsynchronizować) — pomijamy
    // wysyłkę po cichu; raport zostaje bezpiecznie zapisany lokalnie
    // (savedReports powyżej) i brygadzista nic nie traci, tylko wyśle go
    // ponownie, gdy dane referencyjne się zsynchronizują.
    const numericBuildId = Number(buildId);
    // Etap technologii (Faza 6) — wyłącznie informacyjne (report_materials
    // .stage_name), dopasowane po nazwie materiału do build_material_plan
    // tej budowy; materiały pomocnicze (spoza planu) zostają bez etapu.
    const planForBuild = buildMaterialPlans.filter(
      (p) => p.buildId === numericBuildId,
    );
    const stageNameForMaterial = (materialId: string) => {
      const name = materials.find((m) => m.id === materialId)?.name;
      if (!name) return undefined;
      const normalized = normalizeMaterialName(name);
      return planForBuild.find(
        (p) => normalizeMaterialName(p.materialName) === normalized,
      )?.stageName;
    };
    const materialsPayload = Object.entries(reportSnapshot.materialValues)
      .map(([materialId, usedQuantityRaw]) => ({
        materialId: Number(materialId),
        usedQuantity: Number(usedQuantityRaw) || 0,
        reason: reasons[materialId],
        stageName: stageNameForMaterial(materialId),
      }))
      .filter((m) => !Number.isNaN(m.materialId));
    const peoplePayload = draftPeople
      .map((p) => ({
        employeeId: Number(p.employeeId),
        start: p.start,
        end: p.end,
      }))
      .filter((p) => !Number.isNaN(p.employeeId));
    const extraCostsPayload = reportSnapshot.extraCosts.map((c) => ({
      label: c.label,
      amount: c.amount,
      note: c.note,
      category: c.category,
    }));
    if (!Number.isNaN(numericBuildId)) {
      enqueueReport({
        buildId: numericBuildId,
        date,
        people: peoplePayload,
        materials: materialsPayload,
        extraCosts: extraCostsPayload,
        km: reportSnapshot.km,
        note: reportSnapshot.note,
      }).then(({ sent, errorMessage, isNetworkError }) => {
        if (!sent) {
          // isNetworkError === false znaczy, że serwer AKTYWNIE odrzucił
          // zapis (ma kod błędu z Postgresa) — to nie jest brak internetu,
          // więc mówienie brygadziście "wyśle się, gdy pojawi się
          // internet" byłoby mylące: nie wyśle się, dopóki przyczyna nie
          // zostanie poprawiona. Patrz lib/offline-outbox.ts.
          if (isNetworkError === false) {
            notify(
              "Nie udało się wysłać raportu",
              errorMessage
                ? `Raport zapisany lokalnie, ale serwer go odrzucił: ${errorMessage}`
                : "Raport zapisany lokalnie, ale serwer go odrzucił. Spróbuj ponownie lub skontaktuj się z administratorem.",
            );
          } else {
            notify(
              "Raport zapisany lokalnie",
              "Brak połączenia z serwerem — raport wyśle się automatycznie, gdy pojawi się internet.",
            );
          }
        } else {
          // Odśwież listę raportów od razu po realnym wysłaniu do
          // Supabase, zamiast czekać na najbliższy refetchInterval
          // (reportsQuery, patrz wyżej) — na tym samym urządzeniu/roli
          // (np. w podglądzie deweloperskim) wynik jest widoczny
          // natychmiast, bez czekania do 15s. timeEntries tak samo —
          // submit_daily_report wstawia godziny do time_entries przy
          // wysyłce, a to jedyne miejsce, które odczytuje tę tabelę
          // z powrotem (patrz timeEntriesQuery wyżej).
          invalidate("reports");
          invalidate("timeEntries");
          // submit_daily_report zmienia też zużycie/koszt materiału
          // (build_materials.used/actualCost) i pulę partii przypisanych
          // do budowy (build_material_lots) — bez tego Rozliczenie budowy
          // (settlement-screen.tsx, liczone z `assignments`/
          // `buildMaterialLots`) pokazywało nieaktualne "Zużyto" aż do
          // przypadkowego odświeżenia innej zakładki. Realtime (patrz
          // lib/data/use-realtime-sync.ts) powinien to i tak złapać, ale
          // jawne unieważnienie od razu po wysyłce jest pewne niezależnie
          // od Realtime.
          invalidate("buildMaterials");
          invalidate("buildMaterialLots");
        }
      });
    }
  };
  const saveEmployee = async (newEmployee: NewEmployeeInput, onSaved: () => void) => {
    if (!newEmployee.name || !newEmployee.role) return;
    // Kartoteka pracowników zna tylko dwie role (Brygadzista/Pracownik) —
    // "Admin" w wyborze na ekranie Administratora to rola aplikacyjna
    // (devRole), nie rola pracownika w bazie.
    if (newEmployee.role !== "Brygadzista" && newEmployee.role !== "Pracownik") {
      notify("Nieprawidłowa rola", "Wybierz Brygadzista lub Pracownik.");
      return;
    }
    try {
      await createEmployeeMutation.mutateAsync({
        name: newEmployee.name,
        role: newEmployee.role,
        hourlyRate: Number(newEmployee.hourlyRate) || 0,
        costRate: Number(newEmployee.costRate) || 0,
      });
      await invalidate("employees");
      onSaved();
    } catch (error) {
      reportMutationError(error, "Nie udało się dodać pracownika.");
    }
  };
  // Nowa brygada (panel administratora, sekcja Zespół) — lider opcjonalny,
  // skład dopisywany osobno przez addTeamMember (ten sam wzorzec co
  // materiał→partia: nagłówek najpierw, powiązane wiersze potem).
  const saveTeam = async (newTeam: NewTeamInput, onSaved: () => void) => {
    if (!newTeam.name) return;
    try {
      await createTeamMutation.mutateAsync({
        name: newTeam.name,
        leadEmployeeId: newTeam.leadEmployeeId ? Number(newTeam.leadEmployeeId) : null,
      });
      await invalidate("teams");
      onSaved();
    } catch (error) {
      reportMutationError(error, "Nie udało się dodać brygady.");
    }
  };
  const addTeamMember = async (teamId: number, employeeId: number) => {
    try {
      await addTeamMemberMutation.mutateAsync({ teamId, employeeId });
      await invalidate("teamMembers");
    } catch (error) {
      reportMutationError(error, "Nie udało się dodać pracownika do brygady.");
    }
  };
  const removeTeamMember = async (teamId: number, employeeId: number) => {
    try {
      await removeTeamMemberMutation.mutateAsync({ teamId, employeeId });
      await invalidate("teamMembers");
    } catch (error) {
      reportMutationError(error, "Nie udało się usunąć pracownika z brygady.");
    }
  };
  // Edycja imienia i nazwiska pracownika (panel administratora, HR ->
  // Zespół) — to Admin ustala tożsamość pracownika, nie sam pracownik
  // przez samoobsługę (patrz account-settings-section.tsx, gdzie
  // samoobsługowa "Nazwa wyświetlana" została usunięta).
  const updateEmployeeName = async (employeeId: string, name: string) => {
    const numericId = Number(employeeId);
    if (Number.isNaN(numericId) || !name.trim()) return;
    try {
      await updateEmployeeNameMutation.mutateAsync({
        employeeId: numericId,
        name: name.trim(),
      });
      await invalidate("employees");
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać imienia i nazwiska.");
    }
  };
  // Edycja stawki godzinowej istniejącego pracownika (panel administratora).
  const updateEmployeeRate = async (employeeId: string, rate: number) => {
    const numericId = Number(employeeId);
    if (Number.isNaN(numericId)) return;
    try {
      await updateEmployeeRateMutation.mutateAsync({
        employeeId: numericId,
        hourlyRate: rate,
      });
      await invalidate("employees");
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać stawki.");
    }
  };
  // Edycja stawki kosztowej (koszty budowy) istniejącego pracownika —
  // osobna od stawki wypłatowej powyżej (panel administratora).
  const updateEmployeeCostRate = async (employeeId: string, rate: number) => {
    const numericId = Number(employeeId);
    if (Number.isNaN(numericId)) return;
    try {
      await updateEmployeeCostRateMutation.mutateAsync({
        employeeId: numericId,
        costRate: rate,
      });
      await invalidate("employees");
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać stawki kosztowej.");
    }
  };
  // Archiwizacja/przywrócenie pracownika — ten sam mechanizm co
  // setMaterialActive (panel administratora, sekcja Zespół).
  const setEmployeeActive = async (employeeId: string, active: boolean) => {
    const numericId = Number(employeeId);
    if (Number.isNaN(numericId)) return;
    try {
      await setEmployeeActiveMutation.mutateAsync({ employeeId: numericId, active });
      await invalidate("employees");
    } catch (error) {
      reportMutationError(
        error,
        active ? "Nie udało się przywrócić pracownika." : "Nie udało się zarchiwizować pracownika.",
      );
    }
  };
  // Pula dni urlopowych na rok (panel administratora, sekcja HR).
  const updateEmployeeLeaveDays = async (employeeId: string, days: number) => {
    const numericId = Number(employeeId);
    if (Number.isNaN(numericId)) return;
    try {
      await updateEmployeeLeaveDaysMutation.mutateAsync({
        employeeId: numericId,
        leaveDaysPerYear: days,
      });
      await invalidate("employees");
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać puli dni urlopowych.");
    }
  };
  // Nowy wniosek urlopowy (ekran Pracownika/Brygadzisty) — employeeId
  // wnioskującego dociąga serwer sam z profilu (patrz request_leave w
  // supabase/sql/049_urlopy.sql), więc klient go tu nie podaje.
  const submitLeaveRequest = async (input: {
    type: LeaveType;
    dateFrom: string;
    dateTo: string;
    note?: string;
  }): Promise<boolean> => {
    try {
      await requestLeaveMutation.mutateAsync(input);
      await invalidate("leaveRequests");
      return true;
    } catch (error) {
      reportMutationError(error, "Nie udało się złożyć wniosku urlopowego.");
      return false;
    }
  };
  // Edycja własnego, jeszcze nierozpatrzonego wniosku (patrz
  // update_leave_request w supabase/sql/050_edycja_urlopu_i_fix_decyzji.sql)
  // — zamiast zmuszać pracownika do anuluj+złóż nowy przy pomyłce.
  const updateLeaveRequest = async (
    requestId: string,
    input: { type: LeaveType; dateFrom: string; dateTo: string; note?: string },
  ): Promise<boolean> => {
    const numericId = Number(requestId);
    if (Number.isNaN(numericId)) return false;
    try {
      await updateLeaveRequestMutation.mutateAsync({ requestId: numericId, input });
      await invalidate("leaveRequests");
      return true;
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać zmian we wniosku.");
      return false;
    }
  };
  const cancelLeaveRequest = async (requestId: string) => {
    const numericId = Number(requestId);
    if (Number.isNaN(numericId)) return;
    try {
      await cancelLeaveRequestMutation.mutateAsync(numericId);
      await invalidate("leaveRequests");
    } catch (error) {
      reportMutationError(error, "Nie udało się anulować wniosku.");
    }
  };
  // Zatwierdzenie/odrzucenie wniosku (Brygadzista/Admin) — patrz
  // components/screens/team-time-screen.tsx i sekcja HR w admin-screen.tsx.
  const decideLeaveRequest = async (requestId: string, approve: boolean) => {
    const numericId = Number(requestId);
    if (Number.isNaN(numericId)) return;
    try {
      await decideLeaveRequestMutation.mutateAsync({ requestId: numericId, approve });
      await invalidate("leaveRequests");
    } catch (error) {
      reportMutationError(
        error,
        approve ? "Nie udało się zatwierdzić wniosku." : "Nie udało się odrzucić wniosku.",
      );
    }
  };
  // Stawka za km (Faza 7) — edytowana wyłącznie przez Admina (RLS), patrz
  // AdminSettingsSection w components/screens/admin-screen.tsx.
  const updateKmRate = async (rate: number) => {
    try {
      await updateKmRateMutation.mutateAsync({ kmRate: rate });
      await queryClient.invalidateQueries({ queryKey: ["settings", "get"] });
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać stawki za km.");
    }
  };
  // PIN zabezpieczający "Zamknij (i rozlicz) budowę" (patrz builds-screen.tsx)
  // — edytowany wyłącznie przez Admina (RLS), pusty string wyłącza
  // zabezpieczenie (patrz updateCloseBuildPin w lib/data/settings.ts).
  const updateCloseBuildPinValue = async (pin: string) => {
    try {
      await updateCloseBuildPinMutation.mutateAsync({ pin });
      await queryClient.invalidateQueries({ queryKey: ["settings", "get"] });
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać PIN-u.");
    }
  };
  // Edycja ceny jednostkowej materiału w magazynie. Nie wpływa wstecz na
  // już przypisane do budów ilości — te mają cenę zamrożoną na Assignment.
  // Ręczna zmiana ceny to korekta pomyłki (np. źle wpisana cena), nie nowy
  // zakup — nadpisuje średnią ważoną wprost, nie tworzy nowej partii.
  // Historia partii (i ich realne ceny) zostaje nienaruszona.
  const updateMaterialPrice = async (materialId: string, price: number) => {
    const numericId = Number(materialId);
    if (Number.isNaN(numericId)) return;
    try {
      await updateMaterialPriceMutation.mutateAsync({
        materialId: numericId,
        unitPrice: price,
      });
      await invalidate("materials");
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać ceny.");
    }
  };
  // Korekta stanu magazynowego materiału — np. pomyłka przy dodawaniu lub
  // ręczna inwentaryzacja. W górę: dopisuje partię "korekta" po aktualnej
  // średniej cenie. W dół: zdejmuje FIFO tak jak realne zużycie.
  const updateMaterialStock = async (materialId: string, stock: number) => {
    const numericId = Number(materialId);
    if (Number.isNaN(numericId)) return;
    try {
      await adjustMaterialStockMutation.mutateAsync({
        materialId: numericId,
        newStock: stock,
      });
      await invalidate("materials");
    } catch (error) {
      reportMutationError(error, "Nie udało się skorygować stanu magazynowego.");
    }
  };
  // Archiwizacja zamiast usuwania (patrz
  // supabase/sql/038_archiwizacja_materialow.sql) — materiał zostaje w
  // bazie (historia go referencjuje po ID), tylko znika z domyślnej listy
  // Magazynu; dalej podpowiadany przy dopasowaniu nazwy, żeby nie powstał
  // duplikat. Przywrócenie to ta sama funkcja z active=true.
  const setMaterialActive = async (materialId: string, active: boolean) => {
    const numericId = Number(materialId);
    if (Number.isNaN(numericId)) return;
    try {
      await setMaterialActiveMutation.mutateAsync({ materialId: numericId, active });
      await invalidate("materials");
    } catch (error) {
      reportMutationError(
        error,
        active ? "Nie udało się przywrócić materiału." : "Nie udało się zarchiwizować materiału.",
      );
    }
  };
  // Finalne zatwierdzenie koszyka (patrz OrderCartItem/koszyk lokalny w
  // orders-screen.tsx): tworzy jedno zamówienie w Supabase per pozycja
  // koszyka (material_orders nie ma nagłówka+pozycji), dopiero teraz — nie
  // przy każdym dodaniu do koszyka. Wszystkie pozycje dostają ten sam
  // batchId, żeby OrdersScreen mógł je pokazać i obsłużyć (Złożono u
  // dostawcy / Usuń) jako jedno zgrupowane zamówienie, mimo że w bazie to
  // nadal osobne wiersze. Zwraca true przy powodzeniu, żeby ekran mógł
  // wyczyścić swój lokalny koszyk.
  const submitOrderCart = async (orderCart: OrderCartItem[]) => {
    if (orderCart.length === 0) return false;
    const batchId =
      orderCart.length > 1
        ? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        : undefined;
    try {
      for (const item of orderCart) {
        await createOrderMutation.mutateAsync({
          materialId: item.materialId ? Number(item.materialId) : undefined,
          materialName: item.materialName,
          quantity: item.quantity,
          unit: item.unit,
          batchId,
          newMaterialMin: item.newMaterialMin,
          newMaterialIndex: item.newMaterialIndex,
        });
      }
      await invalidate("orders");
      return true;
    } catch (error) {
      reportMutationError(error, "Nie udało się złożyć zamówienia.");
      return false;
    }
  };
  // Jedno tapnięcie z listy braków magazynowych: materiał (i jego jednostka)
  // są już znane, więc od razu tworzymy w pełni powiązane zamówienie —
  // bez przepisywania nazwy/ilości do osobnego formularza.
  const createOrderFromShortage = async (materialId: string, quantity: number) => {
    const material = materials.find((m) => m.id === materialId);
    if (!material || quantity <= 0) return;
    try {
      await createOrderMutation.mutateAsync({
        materialId: Number(material.id),
        materialName: material.name,
        quantity,
        unit: material.unit,
      });
      await invalidate("orders");
    } catch (error) {
      reportMutationError(error, "Nie udało się złożyć zamówienia.");
    }
  };
  // Krok 2: zamówienie zostało faktycznie złożone u dostawcy.
  const markOrderOrdered = async (orderId: string) => {
    const numericId = Number(orderId);
    if (Number.isNaN(numericId)) return;
    try {
      await markOrderOrderedMutation.mutateAsync({ orderId: numericId });
      await invalidate("orders");
    } catch (error) {
      reportMutationError(error, "Nie udało się oznaczyć zamówienia jako złożone.");
    }
  };
  // Kasowanie pomyłkowego/zduplikowanego zamówienia — tylko dopóki jest
  // "do realizacji" (delete_material_order odrzuci inny status, patrz
  // supabase/sql/023_usuwanie_zamowien_material_orders.sql).
  const deleteOrder = async (orderId: string) => {
    const numericId = Number(orderId);
    if (Number.isNaN(numericId)) return;
    try {
      await deleteOrderMutation.mutateAsync({ orderId: numericId });
      await invalidate("orders");
    } catch (error) {
      reportMutationError(error, "Nie udało się usunąć zamówienia.");
    }
  };
  // Krok 3: dostawa dotarła. Ilość jest edytowalna w tym miejscu, bo dostawca
  // może przywieźć inaczej niż zamówiono — to ta wartość trafia na stan
  // magazynowy, nie pierwotnie zamówiona. Jeśli zamówienie nie było powiązane
  // z istniejącym materiałem (dopisane ręcznie), serwer zakłada nową pozycję
  // magazynową zamiast po cichu gubić dostawę.
  const receiveOrder = async (
    orderId: string,
    receivedQuantity: number,
    receivedUnitPrice?: number,
    documentNumber?: string,
    supplier?: string,
  ) => {
    const numericId = Number(orderId);
    if (Number.isNaN(numericId) || receivedQuantity <= 0) return;
    try {
      await receiveOrderMutation.mutateAsync({
        orderId: numericId,
        receivedQuantity,
        receivedUnitPrice,
        documentNumber,
        supplier,
      });
      await Promise.all([
        invalidate("orders"),
        invalidate("materials"),
        invalidate("warehouseBatches"),
      ]);
    } catch (error) {
      reportMutationError(error, "Nie udało się przyjąć dostawy.");
    }
  };
  const addPersonToDraft = () => {
    if (!selectedEmployeeId) {
      notify(
        "Nie wybrano pracownika",
        "Wskaż osobę z listy przed dodaniem godzin pracy.",
      );
      return;
    }
    if (!personStart || !personEnd) return;
    const [sh, sm] = personStart.split(":").map(Number);
    const [eh, em] = personEnd.split(":").map(Number);
    if (
      !Number.isFinite(sh) ||
      !Number.isFinite(sm) ||
      !Number.isFinite(eh) ||
      !Number.isFinite(em) ||
      eh * 60 + em <= sh * 60 + sm
    ) {
      notify(
        "Nieprawidłowy czas",
        "Godzina końca musi być późniejsza niż godzina rozpoczęcia.",
      );
      return;
    }
    if (
      draftPeople.some((person) => person.employeeId === selectedEmployeeId)
    ) {
      notify(
        "Osoba już dodana",
        "Ta osoba znajduje się już w koszyku raportu.",
      );
      return;
    }
    setDraftPeople([
      ...draftPeople,
      { employeeId: selectedEmployeeId, start: personStart, end: personEnd },
    ]);
    AsyncStorage.setItem(
      "lastPersonTime",
      JSON.stringify({ start: personStart, end: personEnd }),
    );
    // Wróć do "nikt nie wybrany" po dodaniu — inaczej selectedEmployeeId
    // zostawałby ustawiony na ostatnio dodaną osobę i drugie "Dodaj" z
    // rzędu (np. przez pomyłkę) po cichu dodałoby ją ponownie zamiast
    // wymagać nowego, świadomego wyboru.
    setSelectedEmployeeId("");
  };
  // Dodaje od razu WSZYSTKICH pracowników (spoza już dodanych) z aktualnie
  // ustawionymi godzinami OD/DO — żeby przy całej brygadzie pracującej te
  // same godziny nie trzeba było dodawać każdej osoby osobno.
  const addAllEmployeesToDraft = () => {
    if (!personStart || !personEnd) return;
    const [sh, sm] = personStart.split(":").map(Number);
    const [eh, em] = personEnd.split(":").map(Number);
    if (
      !Number.isFinite(sh) ||
      !Number.isFinite(sm) ||
      !Number.isFinite(eh) ||
      !Number.isFinite(em) ||
      eh * 60 + em <= sh * 60 + sm
    ) {
      notify(
        "Nieprawidłowy czas",
        "Godzina końca musi być późniejsza niż godzina rozpoczęcia.",
      );
      return;
    }
    const alreadyAdded = new Set(draftPeople.map((person) => person.employeeId));
    const toAdd = employees.filter((employee) => !alreadyAdded.has(employee.id));
    if (toAdd.length === 0) {
      notify(
        "Brak osób do dodania",
        "Wszyscy pracownicy są już w koszyku raportu.",
      );
      return;
    }
    setDraftPeople([
      ...draftPeople,
      ...toAdd.map((employee) => ({
        employeeId: employee.id,
        start: personStart,
        end: personEnd,
      })),
    ]);
    AsyncStorage.setItem(
      "lastPersonTime",
      JSON.stringify({ start: personStart, end: personEnd }),
    );
    setSelectedEmployeeId("");
  };
  // Usunięcie pomyłkowo dodanej osoby z koszyka raportu (np. zły
  // pracownik albo złe godziny) — analogiczne "✕" jak przy materiałach
  // pomocniczych (removeFromDraft).
  const removePersonFromDraft = (employeeId: string) => {
    setDraftPeople(draftPeople.filter((person) => person.employeeId !== employeeId));
  };
  const addExtraCostToDraft = (
    label: string,
    amount: number,
    note?: string,
    category?: string,
  ) => {
    setDraftExtraCosts([
      ...draftExtraCosts,
      { id: `cost-${Date.now()}`, label, amount, note, category },
    ]);
  };
  const removeExtraCostFromDraft = (id: string) => {
    setDraftExtraCosts(draftExtraCosts.filter((c) => c.id !== id));
  };
  const openSavedReport = (reportId: string) => {
    const report = savedReports.find((item) => item.id === reportId);
    if (!report) return;
    setEditingReportId(report.id);
    setSelectedBuildId(report.buildId);
    setReportValues({ ...report.materialValues });
    setReasons({ ...report.reasons });
    setDraftPeople([...report.people]);
    setDraftExtraCosts([...(report.extraCosts || [])]);
    setDraftKm(report.km != null ? String(report.km) : "");
    setDraftNote(report.note ?? "");
    setReportSaved(false);
    setReportStep(1);
    setTab("report");
  };
  // Start "od zera": wcześniej przycisk "+ Nowy raport" (saved-reports-
  // screen.tsx) tylko przełączał zakładkę na "report" bez czyszczenia
  // niczego. Dla PIERWSZEGO raportu w sesji działało to przypadkiem (pola
  // draftowe i tak były jeszcze puste), ale przy DRUGIM raporcie w tej
  // samej sesji zostawało m.in. reportSaved=true po poprzednim zapisie —
  // ReportScreen (patrz jego useEffect na reportSaved) natychmiast
  // odsyłał z powrotem do listy raportów, więc ekran wyglądał, jakby nic
  // się nie działo po wciśnięciu "Zapisz raport dzienny" (bo faktycznie
  // nigdy nie dawało się dotrzeć do formularza). editingReportId też
  // zostawał ustawiony na poprzedni raport, więc "nowy" raport w
  // rzeczywistości nadpisywałby poprzedni zamiast utworzyć kolejny.
  // selectedBuildId celowo NIE jest resetowany — to zwykle ta sama
  // budowa, na której brygadzista właśnie pracuje.
  //
  // Pole "zużyto" per materiał trzyma DZISIEJSZE zużycie tego raportu
  // (od zera), NIE nowy stan całkowity — patrz 047_raport_dzienna_ilosc_
  // nie_skumulowana.sql. Brygadzista wie, ile zużył dziś; nie zna (i nie
  // powinien pamiętać) sumy od początku budowy — bazę dolicza sama RPC
  // (`build_materials.used = used + delta`). Dlatego nowy raport startuje
  // z pustym polem (stepper i tak pokazuje "0" jako fallback), a nie od
  // `a.used`, jak wcześniej.
  const getReportDefaults = (_buildId: string): Record<string, string> => {
    return {};
  };
  const startNewReport = () => {
    setEditingReportId(null);
    setReportValues(selectedBuildId ? getReportDefaults(selectedBuildId) : {});
    setReasons({});
    setDraftPeople([]);
    setDraftExtraCosts([]);
    setDraftKm("");
    setDraftNote("");
    setReportStep(1);
    setReportSaved(false);
    setHrSaved(false);
    setReportStatus("roboczy");
    setTab("report");
  };
  const approveReport = (reportId: string) => {
    const report = savedReports.find((r) => r.id === reportId);
    setSavedReports((previous) =>
      previous.map((report) =>
        report.id === reportId
          ? { ...report, status: "approved", updatedAt: new Date().toISOString() }
          : report,
      ),
    );
    // W Supabase raport jest identyfikowany przez (buildId, date) — nie ma
    // osobnej kolumny clientId (patrz submitDailyReport w lib/data/reports.ts).
    // Best-effort: jeśli offline, lokalny status i tak już jest ustawiony
    // powyżej — admin pracuje zwykle online, więc rzadki brak sieci tutaj
    // nie uzasadnia osobnej kolejki jak przy raportach brygadzisty.
    const numericBuildId = report ? Number(report.buildId) : NaN;
    if (!report || Number.isNaN(numericBuildId)) return;
    approveReportMutation.mutate(
      { buildId: numericBuildId, date: report.date, status: "approved" },
      {
        onError: (error) =>
          reportMutationError(
            error,
            "Zatwierdzenie zapisało się lokalnie, ale nie wysłało do serwera — spróbuj ponownie, gdy będzie sieć.",
          ),
        // Notatka dla klienta (Gemini) jest AUTOMATYCZNA, nie ma osobnego
        // przycisku — generowana od razu po zatwierdzeniu raportu. Edge
        // Function sama sprawdza builds.show_notes_to_client i nic nie
        // robi, gdy przełącznik "Udostępnij notatki klientowi" jest
        // wyłączony dla tej budowy, więc nie trzeba tego warunku
        // powtarzać tutaj. Best-effort: błąd Gemini (limit, przejściowa
        // awaria) nie może zablokować ani cofnąć samego zatwierdzenia
        // raportu, dlatego cichy catch — admin i tak widzi status notatki
        // w ReportCard i może zatwierdzić ponownie po stronie Gemini.
        onSuccess: () => {
          generateReportClientNote(Number(reportId))
            .catch(() => undefined)
            .finally(() => {
              queryClient.invalidateQueries({ queryKey: ["reports", "list"] });
            });
        },
      },
    );
  };
  // Zamyka budowę i zapisuje snapshot finalnego rozliczenia (godziny,
  // materiały plan/zużycie, koszty dodatkowe). Wymaga, żeby wszystkie
  // raporty tej budowy były już zatwierdzone — inaczej rozliczenie
  // opierałoby się na niezweryfikowanych danych.
  const closeBuild = async (buildId: string, returns: CloseBuildReturnItem[] = []) => {
    const build = builds.find((b) => b.id === buildId);
    if (!build || build.status === "zamknięta") return;
    const numericId = Number(buildId);
    if (Number.isNaN(numericId)) return;
    try {
      await closeBuildMutation.mutateAsync({ buildId: numericId, returns });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["builds", "list"] }),
        invalidate("buildMaterialLots"),
        invalidate("warehouseBatches"),
      ]);
    } catch (error) {
      reportMutationError(
        error,
        "Nie udało się zamknąć budowy — sprawdź, czy wszystkie raporty są zatwierdzone.",
      );
    }
  };
  // Wznawia zamkniętą budowę: przywraca status "aktywna". Zapisany
  // snapshot rozliczenia w Supabase zostaje (nadpisze go dopiero kolejne
  // `closeBuild`), więc jeśli budowa zostanie zamknięta ponownie bez
  // zmian, ostatnie rozliczenie wciąż jest dostępne do wglądu.
  const reopenBuild = async (buildId: string) => {
    const numericId = Number(buildId);
    if (Number.isNaN(numericId)) return;
    try {
      await reopenBuildMutation.mutateAsync({ buildId: numericId });
      await queryClient.invalidateQueries({ queryKey: ["builds", "list"] });
    } catch (error) {
      reportMutationError(error, "Nie udało się wznowić budowy.");
    }
  };
  // Zapisuje/zmienia link do folderu ze zdjęciami budowy (np. Google
  // Drive). Dostępne z ekranu Budowy (Admin) i z ekranu Raportu
  // (Brygadzista) — każdy z dostępem do danej budowy.
  const updateBuildPhotosUrl = async (buildId: string, photosUrl: string) => {
    const numericId = Number(buildId);
    if (Number.isNaN(numericId)) return;
    try {
      await updateBuildPhotosUrlMutation.mutateAsync({
        buildId: numericId,
        photosUrl,
      });
      await queryClient.invalidateQueries({ queryKey: ["builds", "list"] });
    } catch (error) {
      reportMutationError(error, "Nie udało się zapisać linku do zdjęć.");
    }
  };
  return {
    tab,
    devRole,
    // Prawdziwa rola z profilu Supabase (profiles.role), niezależna od
    // `devRole` — ta druga zostaje lokalnym, nietrwałym "widokiem"
    // (patrz setDevRole/"Widok" w admin-screen.tsx), więc UI potrzebuje
    // sposobu odróżnienia "kim naprawdę jest ten użytkownik" od "co teraz
    // ogląda", żeby np. Admin podglądający widok Brygadzisty miał gdzie
    // wrócić.
    realRole: initialRole,
    myProfileId,
    materials,
    materialBatches,
    buildMaterialActualCost,
    builds,
    technologies: (technologiesQuery.data ?? []) as TechnologyRow[],
    buildTechnologySnapshots: (buildTechnologySnapshotsQuery.data ??
      []) as BuildTechnologySnapshotRow[],
    buildMaterialPlans,
    assignBuildTechnology,
    buildOrders: (buildOrdersQuery.data ?? []) as BuildOrderRow[],
    generateOrderFromPlan,
    updateOrderItemQuantity,
    markBuildOrderOrdered,
    cancelBuildOrder,
    deleteBuildOrder,
    receiveBuildOrder,
    warehouseBatches,
    buildMaterialLots: (buildMaterialLotsQuery.data ?? []) as BuildMaterialLotRow[],
    buildMaterialReturns: (buildMaterialReturnsQuery.data ?? []) as BuildMaterialReturnRow[],
    buildStageStatuses: (buildStageStatusesQuery.data ?? []) as BuildStageStatusRow[],
    completeBuildStage,
    reopenBuildStage,
    selectedBatchId,
    setSelectedBatchId,
    assignments,
    showAssignment,
    buildsView,
    warehouseView,
    selectedBuildId,
    selectedMaterialId,
    plannedAmount,
    picker,
    pickerQuery,
    draftAssignments,
    workdayHours,
    workdayHoursInput,
    reportValues,
    reasons,
    reportSaved,
    reportStep,
    savedReports,
    editingReportId,
    employees,
    teams,
    teamMembers,
    timeEntries,
    saveTeam,
    addTeamMember,
    removeTeamMember,
    hrSaved,
    reportStatus,
    adminComment,
    selectedEmployeeId,
    employeePickerOpen,
    personStart,
    personEnd,
    timePicker,
    draftPeople,
    addAllEmployeesToDraft,
    draftExtraCosts,
    draftKm,
    draftNote,
    kmRate,
    closeBuildPin,
    orders,
    setTab,
    setDevRole,
    setMaterials,
    setBuilds,
    setAssignments,
    setShowAssignment,
    setBuildsView,
    setWarehouseView,
    setSelectedBuildId,
    setSelectedMaterialId,
    setPlannedAmount,
    setPicker,
    setPickerQuery,
    setDraftAssignments,
    setWorkdayHours,
    setWorkdayHoursInput,
    setReportValues,
    setReasons,
    setReportSaved,
    setReportStep,
    setEditingReportId,
    openSavedReport,
    startNewReport,
    getReportDefaults,
    approveReport,
    closeBuild,
    reopenBuild,
    updateBuildPhotosUrl,
    setEmployees,
    setTimeEntries,
    setHrSaved,
    setReportStatus,
    setAdminComment,
    setSelectedEmployeeId,
    setEmployeePickerOpen,
    setPersonStart,
    setPersonEnd,
    setTimePicker,
    setDraftPeople,
    setDraftExtraCosts,
    setDraftKm,
    setDraftNote,
    setOrders,
    activeBuild,
    buildAssignments,
    shortages,
    dismissShortage,
    belowMinimumMaterials,
    addToDraft,
    addMaterialToDraft,
    updateDraftQuantity,
    removeFromDraft,
    commitAssignments,
    removeBuildAssignment,
    saveMaterial,
    saveBuild,
    updateBuildBasicInfo,
    updateBuildLaborPlan,
    saveWorkdayHours,
    saveDailyReport,
    saveEmployee,
    updateEmployeeName,
    updateEmployeeRate,
    updateEmployeeCostRate,
    setEmployeeActive,
    myEmployeeId,
    leaveRequests,
    updateEmployeeLeaveDays,
    submitLeaveRequest,
    updateLeaveRequest,
    cancelLeaveRequest,
    decideLeaveRequest,
    updateKmRate,
    updateCloseBuildPin: updateCloseBuildPinValue,
    updateMaterialPrice,
    updateMaterialStock,
    setMaterialActive,
    submitOrderCart,
    createOrderFromShortage,
    markOrderOrdered,
    deleteOrder,
    receiveOrder,
    addPersonToDraft,
    removePersonFromDraft,
    addExtraCostToDraft,
    removeExtraCostFromDraft,
    reportsPendingApprovalCount,
    reportsNeedingFixCount,
  };
}

type AppData = ReturnType<typeof useAppDataState>;
const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({
  children,
  initialRole,
  myProfileId,
  myEmployeeId,
}: {
  children: ReactNode;
  initialRole?: "Admin" | "Brygadzista" | "Pracownik";
  myProfileId?: string | null;
  myEmployeeId?: string | null;
}) {
  const value = useAppDataState(initialRole, myProfileId ?? null, myEmployeeId ?? null);
  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error("useAppData must be used within an AppDataProvider");
  }
  return ctx;
}
