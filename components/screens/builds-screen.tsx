import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DateField } from "@/components/date-field";
import {
  COLORS,
  addDaysISO,
  Button,
  confirmAction,
  DetailSection,
  Field,
  formatPLN,
  IconBadge,
  notify,
  pluralPL,
  QuantityStepper,
  ReportCard,
  ScreenHeader,
  SearchablePicker,
  StatusBadge,
  WizardStepper,
} from "@/components/report-ui";
import { useAppData, type NewBuildInput } from "@/contexts/app-data";
import { createBuildDriveFolder } from "@/lib/data/drive-photos";
import { BuildPhotosSection } from "@/components/build-photos-section";
import { BuildPortalSection } from "@/components/build-portal-section";
import { todayISO } from "@/components/report-ui";

// Wartość kontraktu bywa 6-7 cyfrowa (setki tysięcy) — bez separatora
// tysięcznego zera się zlewają w jeden ciąg trudny do odczytania na
// pierwszy rzut oka. `newBuild.contractValue` w stanie zostaje "czystą"
// liczbą (bez spacji) — separator dochodzi wyłącznie przy wyświetlaniu.
const formatThousands = (raw: string): string => {
  if (!raw) return raw;
  const [intPart, decPart] = raw.split(".");
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return decPart !== undefined ? `${withSeparators}.${decPart}` : withSeparators;
};
const parseThousands = (formatted: string): string =>
  formatted.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.]/g, "");

const createEmptyNewBuild = (): NewBuildInput => ({
  number: "",
  name: "",
  manager: "",
  startDate: todayISO(),
  durationDays: "",
  teamId: "",
  plannedHoursPerDay: "8",
  clientName: "",
  address: "",
  contractValue: "",
});

export function BuildsScreen() {
  const {
    materials,
    builds,
    technologies,
    buildTechnologySnapshots,
    buildMaterialPlans,
    buildMaterialLots,
    assignBuildTechnology,
    assignments,
    savedReports,
    employees,
    teams,
    teamMembers,
    timeEntries,
    buildMaterialActualCost,
    buildOrders,
    generateOrderFromPlan,
    updateOrderItemQuantity,
    markBuildOrderOrdered,
    cancelBuildOrder,
    deleteBuildOrder,
    receiveBuildOrder,
    selectedBatchId,
    warehouseBatches,
    plannedAmount,
    picker,
    pickerQuery,
    draftAssignments,
    setDraftAssignments,
    workdayHours,
    setSelectedBuildId,
    setSelectedBatchId,
    setPlannedAmount,
    setPicker,
    setPickerQuery,
    addToDraft,
    commitAssignments,
    saveBuild,
    updateBuildBasicInfo,
    updateBuildLaborPlan,
    approveReport,
    closeBuild,
    reopenBuild,
    updateBuildPhotosUrl,
    buildsView,
    setBuildsView,
    closeBuildPin,
  } = useAppData();

  const [showBuild, setShowBuild] = useState(false);
  const [newBuild, setNewBuild] = useState<NewBuildInput>(createEmptyNewBuild);
  // Wizard zakładania budowy — 6 kroków wzorowanych na raporcie dziennym
  // brygadzisty (WizardStepper, ten sam wygląd co ReportStepper). Kroki
  // 2-6 dotyczą już KONKRETNEJ, utworzonej budowy (wizardBuildId), więc
  // istnieją dopiero po zapisaniu kroku 1. Nawigacja Wstecz/Dalej jak w
  // raporcie — akcje opcjonalne (zamówienie, katalog na zdjęcia) są
  // checkboxem obok "Dalej", nie osobnym przyciskiem "Pomiń", bo to
  // jedno pytanie ("czy chcesz X przy okazji"), nie osobna decyzja o
  // porzuceniu kroku. "Anuluj" zamyka cały wizard w dowolnym momencie —
  // budowa, jeśli już powstała (krok 1 zaliczony), zostaje zapisana,
  // resztę da się dokończyć później ze zwykłej karty budowy.
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [wizardBuildId, setWizardBuildId] = useState<string | null>(null);
  const [wizardTechId, setWizardTechId] = useState<number | null>(null);
  const [wizardAreaInput, setWizardAreaInput] = useState("");
  const [wizardAssigning, setWizardAssigning] = useState(false);
  const [wizardGenerateOrder, setWizardGenerateOrder] = useState(true);
  const [wizardOrderGenerating, setWizardOrderGenerating] = useState(false);
  const [wizardOrderGenerated, setWizardOrderGenerated] = useState(false);
  const [wizardCreateFolder, setWizardCreateFolder] = useState(true);
  const WIZARD_STEPS = [
    { n: 1, label: "Budowa" },
    { n: 2, label: "Technologia" },
    { n: 3, label: "Materiały" },
    { n: 4, label: "Zamówienie" },
    { n: 5, label: "Zdjęcia" },
    { n: 6, label: "Portal" },
  ];
  const closeWizard = () => {
    setShowBuild(false);
    setNewBuild(createEmptyNewBuild());
    setWizardStep(1);
    setWizardBuildId(null);
    setWizardTechId(null);
    setWizardAreaInput("");
    setWizardOrderGenerated(false);
    setAssignBuildId(null);
  };

  const isArchiveView = buildsView === "archive";

  // Które budowy mają rozwiniętą sekcję raportów, i który konkretny raport
  // (w obrębie dowolnej budowy) jest rozwinięty — jeden na raz wystarcza.
  // Szukajka po numerze/nazwie budowy — ten sam mechanizm co w Raportach
  // Admina (manager-screen.tsx). Aktywne/Archiwum: mały przełącznik
  // "Archiwum" obok wyszukiwarki (ten sam standard co w Magazynie/
  // Raportach/Rozliczeniu), nie osobna zakładka nawigacji — patrz
  // buildsView w kontekście i setBuildsView niżej.
  const [buildQuery, setBuildQuery] = useState("");
  // Wybór "Osoby odpowiedzialnej" z listy pracowników/brygadzistów (zamiast
  // dowolnego tekstu) — jeden picker na wizard (krok 1) i osobny na
  // edycję danych podstawowych istniejącej budowy (poniżej, w akordeonie).
  const [wizardManagerPickerOpen, setWizardManagerPickerOpen] = useState(false);
  const [wizardManagerQuery, setWizardManagerQuery] = useState("");
  const [managerPickerBuildId, setManagerPickerBuildId] = useState<string | null>(null);
  const [managerPickerQuery, setManagerPickerQuery] = useState("");
  const [expandedBuildReports, setExpandedBuildReports] = useState<
    Record<string, boolean>
  >({});
  const [expandedReportId, setExpandedReportId] = useState<string | null>(
    null,
  );
  // Lista budów jest akordeonem: domyślnie zwinięta do jednej linii,
  // rozwijana pojedynczo, żeby po rozwinięciu było dużo miejsca na
  // materiały/koszty/raporty zamiast upychania wszystkiego naraz.
  const [expandedBuildId, setExpandedBuildId] = useState<string | null>(null);
  // Edycja linku do zdjęć (Google Drive itp.) — jeden ekran edycji na
  // raz, wg tego samego wzorca co edycja stawki w admin-screen.tsx.
  const [editingPhotosBuildId, setEditingPhotosBuildId] = useState<
    string | null
  >(null);
  const [photosUrlInput, setPhotosUrlInput] = useState("");
  // Tworzenie katalogu na zdjęcia (Google Drive) — jeden na raz w trakcie
  // tworzenia, żeby zablokować podwójne kliknięcie (i przez to podwójny
  // folder) na czas wywołania edge function drive-photos.
  const [creatingDriveFolderId, setCreatingDriveFolderId] = useState<string | null>(null);
  const [driveFolderError, setDriveFolderError] = useState<string | null>(null);
  // Łączna liczba zdjęć w folderze, do nagłówka "ZDJĘCIA (n)" — zgłaszana
  // przez BuildPhotosSection (onCountChange), które i tak już ją pobiera.
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  // Zdjęcia budowy — zwinięte domyślnie, ten sam wzorzec akordeonu co
  // reszta sekcji na karcie budowy (Portal klienta, Materiały dodatkowe).
  const [expandedPhotosBuildId, setExpandedPhotosBuildId] = useState<
    string | null
  >(null);
  // Portal klienta (QR/PIN/link) — konfiguracja ustawiana raz na budowę,
  // domyślnie zwinięta, żeby nie zajmowała miejsca przy każdym wejściu
  // (ten sam wzorzec zwijania co przy edycji technologii/zdjęć wyżej).
  const [expandedPortalBuildId, setExpandedPortalBuildId] = useState<
    string | null
  >(null);
  // Lista "Materiały dodatkowe" — ten sam wzorzec zwijania co Portal
  // klienta wyżej, żeby długa lista przypisanych materiałów nie musiała
  // stać zawsze rozwinięta pod spodem.
  const [expandedExtraMaterialsBuildId, setExpandedExtraMaterialsBuildId] =
    useState<string | null>(null);
  // Przypisanie/zmiana technologii (Faza 2) — jeden picker na raz, ten
  // sam wzorzec co edycja linku do zdjęć powyżej.
  // Edycja podstawowych danych budowy (numer/nazwa/odpowiedzialny/klient/
  // adres/wartość kontraktu) po jej utworzeniu — ten sam wzorzec zwijania
  // co reszta akordeonów na karcie budowy, jeden formularz na raz.
  const [editingBasicInfoBuildId, setEditingBasicInfoBuildId] = useState<
    string | null
  >(null);
  const [basicInfoDraft, setBasicInfoDraft] = useState({
    number: "",
    name: "",
    manager: "",
    clientName: "",
    address: "",
    contractValue: "",
  });
  const [basicInfoBusy, setBasicInfoBusy] = useState(false);
  // Edycja brygady/dni roboczych po utworzeniu budowy — wcześniej dało
  // się to ustawić WYŁĄCZNIE w wizardzie (krok 1), bez możliwości zmiany
  // ekipy w trakcie realizacji ani poprawki literówki w liczbie dni.
  const [editingLaborPlanBuildId, setEditingLaborPlanBuildId] = useState<
    string | null
  >(null);
  const [laborPlanDraft, setLaborPlanDraft] = useState({
    teamId: "",
    durationDays: "",
    plannedHoursPerDay: "8",
  });
  const [laborPlanBusy, setLaborPlanBusy] = useState(false);
  const [techEditBuildId, setTechEditBuildId] = useState<string | null>(null);
  // Materiały z planu technologii — zwinięte domyślnie razem z samą
  // technologią (jeden akordeon: zwinięta technologia = zwinięte
  // materiały), rozwijane osobnym kliknięciem od edycji/przypisania
  // technologii (techEditBuildId poniżej).
  const [techMaterialsExpandedBuildId, setTechMaterialsExpandedBuildId] =
    useState<string | null>(null);
  const [techPickerId, setTechPickerId] = useState<number | null>(null);
  const [techAreaInput, setTechAreaInput] = useState("");
  const [techBusy, setTechBusy] = useState(false);
  // Zamówienia z planu materiałowego (Faza 3) — jeden formularz przyjęcia
  // dostawy na raz (ten sam wzorzec co przypisanie technologii wyżej),
  // ilości/ceny per pozycja trzymane w mapie po id pozycji.
  const [orderGenerating, setOrderGenerating] = useState<string | null>(null);
  const [orderGeneratedFor, setOrderGeneratedFor] = useState<string | null>(null);
  // Lista zamówień z planu (Faza 3) w karcie budowy potrafi urosnąć —
  // zwinięta domyślnie, rozwijana pojedynczo per budowa, ten sam wzorzec
  // co reszta akordeonów na tym ekranie.
  // Zamówienia jako lista klikalnych wierszy (jedno rozwinięte naraz,
  // niezależnie od budowy — id zamówienia jest unikalne globalnie) zamiast
  // rozwijania/zwijania całej sekcji jednym przełącznikiem nad listą.
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  // Przypisywanie materiału dodatkowego (dawniej: globalny przycisk nad listą
  // budów, wymagający ręcznego wyboru budowy). Teraz otwierany z konkretnej
  // karty budowy — trzyma id tej budowy, więc formularz nie musi już pytać
  // o budowę (setSelectedBuildId dzieje się przy otwarciu).
  const [assignBuildId, setAssignBuildId] = useState<string | null>(null);
  // Filtr w wyszukiwarce partii przy przypisywaniu materiału do budowy —
  // pokazuje tylko materiały, których ta budowa jeszcze w ogóle nie ma
  // (żadnej partii), żeby szybko widzieć, czego jeszcze brakuje, zamiast
  // przewijać całą listę magazynu wymieszaną z tym, co już przypisane.
  const [onlyUnassignedInPicker, setOnlyUnassignedInPicker] = useState(false);
  // Wiersz materiału dodatkowego jest klikalny i rozwija swoje szczegóły
  // (cena, wartość) — jeden naraz, ten sam wzorzec co reszta akordeonów
  // na tym ekranie. Klucz: `${buildId}-${materialId}`.
  const [expandedAssignmentKey, setExpandedAssignmentKey] = useState<
    string | null
  >(null);
  const [orderReceivingId, setOrderReceivingId] = useState<number | null>(null);
  const [orderReceiveDrafts, setOrderReceiveDrafts] = useState<
    Record<number, { qty: string; price: string }>
  >({});
  const [orderReceiveBusy, setOrderReceiveBusy] = useState(false);
  // Zamknięcie budowy (Faza 9) — jeśli budowa ma pozostałość materiałową
  // (build_material_lots, przypisane a niezużyte), przed samym
  // zamknięciem Admin musi zdecydować per pozycja: zwrot na magazyn albo
  // do wyrzucenia (+ opcjonalny powód). Panel otwarty na jedną budowę
  // naraz, decyzje trzymane po kluczu wiersza `build_material_lots`.
  const [closingBuildId, setClosingBuildId] = useState<string | null>(null);
  // PIN zabezpieczający zamknięcie budowy (ustawiany w Admin → Ustawienia,
  // patrz closeBuildPin/updateCloseBuildPin) — gdy ustawiony, blokuje
  // "Zamknij i rozlicz budowę" dopóki nie zostanie wpisany poprawnie.
  // Pusty closeBuildPin (null) = zabezpieczenie wyłączone, przycisk działa
  // od razu jak wcześniej.
  const [pinGate, setPinGate] = useState<{ buildId: string; run: () => void } | null>(
    null,
  );
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [returnDecisions, setReturnDecisions] = useState<
    Record<number, { decision: "zwrot" | "wyrzucenie"; reason: string }>
  >({});
  const [closeBusy, setCloseBusy] = useState(false);
  // Dokument dostawy i dostawca (Faza 4) — jeden na całe przyjmowane
  // zamówienie (wiele pozycji, jedna dostawa).
  const [orderReceiveDocument, setOrderReceiveDocument] = useState("");
  const [orderReceiveSupplier, setOrderReceiveSupplier] = useState("");
  const [editingOrderItemId, setEditingOrderItemId] = useState<number | null>(null);
  const [orderQtyDraft, setOrderQtyDraft] = useState("");
  // Aktywne/Archiwum: zamknięte budowy trafiają do osobnego widoku, żeby
  // lista roboczych budów nie rosła bezterminowo o rozliczone pozycje.
  // Stan (buildsView) żyje w kontekście, bo na desktopie steruje nim
  // osobna pozycja w sidebarze (index.tsx), a nie ten ekran.
  const activeBuilds = builds.filter((b) => b.status !== "zamknięta");
  const archivedBuilds = builds
    .filter((b) => b.status === "zamknięta")
    .sort((x, y) =>
      (y.settlement?.closedAt || "").localeCompare(x.settlement?.closedAt || ""),
    );
  const buildsForView = buildsView === "active" ? activeBuilds : archivedBuilds;
  const buildQueryNormalized = buildQuery.trim().toLowerCase();
  const visibleBuilds = buildQueryNormalized
    ? buildsForView.filter(
        (b) =>
          b.number.toLowerCase().includes(buildQueryNormalized) ||
          b.name.toLowerCase().includes(buildQueryNormalized),
      )
    : buildsForView;

  return (
    <>
  <>
    <ScreenHeader
      title="Budowy"
      action={
        !isArchiveView ? (
          <Button
            label="+ Nowa"
            onPress={() => {
              if (showBuild) {
                closeWizard();
              } else {
                setWizardStep(1);
                setShowBuild(true);
              }
            }}
          />
        ) : undefined
      }
    />
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <View style={{ flex: 1 }}>
        <Field
          placeholder="🔍 Szukaj budowy…"
          value={buildQuery}
          onChangeText={setBuildQuery}
        />
      </View>
      <Pressable
        onPress={() => setBuildsView(isArchiveView ? "active" : "archive")}
        hitSlop={8}
        style={{ alignItems: "center", gap: 4 }}
      >
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: isArchiveView ? COLORS.primary : COLORS.border,
            backgroundColor: isArchiveView ? COLORS.primary : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isArchiveView && (
            <Text style={{ color: COLORS.background, fontSize: 12, fontWeight: "800" }}>✓</Text>
          )}
        </View>
        <Text style={{ color: COLORS.muted, fontSize: 11, fontWeight: "600" }}>Archiwum</Text>
      </Pressable>
    </View>
    {!isArchiveView && showBuild && (
      <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
        <WizardStepper steps={WIZARD_STEPS} current={wizardStep} />
        {wizardStep === 1 && (
        <>
        <Field
          placeholder="Nazwa budowy"
          value={newBuild.name}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, name: v })
          }
        />
        <Field
          placeholder="Numer budowy"
          value={newBuild.number}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, number: v })
          }
          style={{ marginTop: 10 }}
        />
        <Pressable
          onPress={() => setWizardManagerPickerOpen(true)}
          className="bg-surface border border-border rounded-2xl"
          style={{
            marginTop: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: newBuild.manager ? COLORS.foreground : COLORS.muted,
              fontSize: 14,
            }}
          >
            {newBuild.manager || "Osoba odpowiedzialna"}
          </Text>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 12 }}>Wybierz</Text>
        </Pressable>
        <SearchablePicker
          visible={wizardManagerPickerOpen}
          onClose={() => setWizardManagerPickerOpen(false)}
          query={wizardManagerQuery}
          onQueryChange={setWizardManagerQuery}
          placeholder="🔍 Szukaj pracownika…"
          selectedKey={newBuild.manager}
          onSelect={(key) => {
            setNewBuild({ ...newBuild, manager: key });
            setWizardManagerPickerOpen(false);
          }}
          emptyLabel="Brak pracowników pasujących do wyszukiwania."
          items={employees
            .filter((e) => e.active)
            .filter((e) =>
              e.name.toLowerCase().includes(wizardManagerQuery.trim().toLowerCase()),
            )
            .map((e) => ({ key: e.name, title: e.name, subtitle: e.role }))}
        />
        <Field
          placeholder="Klient (opcjonalnie)"
          value={newBuild.clientName}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, clientName: v })
          }
          style={{ marginTop: 10 }}
        />
        <Field
          placeholder="Adres (opcjonalnie)"
          value={newBuild.address}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, address: v })
          }
          style={{ marginTop: 10 }}
        />
        <Text className="text-xs text-muted uppercase mt-4 mb-2">
          Wartość kontraktu (PLN, opcjonalnie)
        </Text>
        <Field
          placeholder="np. 250 000"
          value={formatThousands(newBuild.contractValue)}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, contractValue: parseThousands(v) })
          }
          keyboardType="decimal-pad"
        />
        <Text className="text-xs text-muted uppercase mt-4">
          Data rozpoczęcia
        </Text>
        <DateField
          value={newBuild.startDate}
          onChange={(v: string) => setNewBuild({ ...newBuild, startDate: v })}
        />
        <Text className="text-xs text-muted uppercase mt-4">
          Czas trwania — dni robocze
        </Text>
        <QuantityStepper
          style={{ marginTop: 8 }}
          min={1}
          value={newBuild.durationDays}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, durationDays: v })
          }
        />
        {Number(newBuild.durationDays) > 0 && (
          <Text
            style={{
              color: COLORS.muted,
              fontSize: 12,
              marginTop: 8,
            }}
          >
            Planowane zakończenie:{" "}
            {addDaysISO(
              newBuild.startDate,
              Number(newBuild.durationDays),
            ) || "—"}{" "}
            · łącznie ok.{" "}
            {Number(newBuild.durationDays) * workdayHours} h przy
            dniówce {workdayHours} h
          </Text>
        )}

        {/* Brygada i planowana robocizna — patrz supabase/sql/040_
            planowany_koszt_robocizny.sql. Opcjonalne: budowę da się
            założyć bez przypisanej brygady, plan robocizny dochodzi
            wtedy zerowy, dopóki ktoś jej nie wybierze. */}
        <Text className="text-xs text-muted uppercase mt-4 mb-2">
          Brygada (opcjonalnie)
        </Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {teams.map((t) => (
            <Pressable
              key={t.id}
              onPress={() =>
                setNewBuild({
                  ...newBuild,
                  teamId: String(t.id) === newBuild.teamId ? "" : String(t.id),
                })
              }
              style={{
                backgroundColor:
                  String(t.id) === newBuild.teamId ? COLORS.primary : COLORS.background,
                borderRadius: 8,
                paddingHorizontal: 9,
                paddingVertical: 7,
                borderWidth: 1,
                borderColor:
                  String(t.id) === newBuild.teamId ? COLORS.primary : COLORS.border,
              }}
            >
              <Text
                style={{
                  color:
                    String(t.id) === newBuild.teamId ? COLORS.background : COLORS.foreground,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                {t.name}
              </Text>
            </Pressable>
          ))}
          {teams.length === 0 && (
            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
              Brak brygad — dodaj je w Admin → Zespół i dniówka.
            </Text>
          )}
        </View>
        {/* Dniówka NIE jest tu edytowalna per budowa — używamy globalnego
            ustawienia z Admin → Zespół i dniówka (workdayHours), tego
            samego, co w podglądzie "łącznie ok. Xh" wyżej. Osobne pole tu
            dublowało tamto ustawienie i myliło (dwie różne "dniówki" w
            jednym formularzu). */}
        {newBuild.teamId && Number(newBuild.durationDays) > 0 && (
          <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 8 }}>
            Planowany koszt robocizny (przy dniówce {workdayHours} h):{" "}
            <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
              {formatPLN(
                teamMembers
                  .filter((m) => m.teamId === Number(newBuild.teamId))
                  .reduce((sum, m) => {
                    const employee = employees.find((e) => e.id === String(m.employeeId));
                    return sum + (employee?.costRate || 0);
                  }, 0) *
                  workdayHours *
                  Number(newBuild.durationDays),
              )}
            </Text>
          </Text>
        )}
        <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button label="Anuluj" secondary onPress={closeWizard} />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              label="Zapisz i dalej"
              onPress={() =>
                saveBuild(
                  { ...newBuild, plannedHoursPerDay: String(workdayHours) },
                  (createdId) => {
                    setNewBuild(createEmptyNewBuild());
                    setWizardBuildId(createdId);
                    setWizardStep(2);
                  },
                )
              }
            />
          </View>
        </View>
        </>
        )}

        {wizardStep === 2 && wizardBuildId && (
          <>
            <Text className="text-xs text-muted uppercase mb-2">
              Technologia
            </Text>
            {technologies.length === 0 ? (
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                Brak technologii — dodaj ją najpierw w zakładce Technologie, albo pomiń ten krok
                i przypisz ją później z poziomu karty budowy.
              </Text>
            ) : (
              <>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  {technologies.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => setWizardTechId(t.id)}
                      style={{
                        backgroundColor:
                          wizardTechId === t.id ? COLORS.primary : COLORS.background,
                        borderRadius: 8,
                        paddingHorizontal: 9,
                        paddingVertical: 7,
                        borderWidth: 1,
                        borderColor: wizardTechId === t.id ? COLORS.primary : COLORS.border,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            wizardTechId === t.id ? COLORS.background : COLORS.foreground,
                          fontWeight: "700",
                          fontSize: 12,
                        }}
                      >
                        {t.name} · v{t.version}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text className="text-xs text-muted uppercase mb-2 mt-3">
                  Powierzchnia (m²)
                </Text>
                <Field
                  placeholder="np. 300"
                  value={wizardAreaInput}
                  onChangeText={setWizardAreaInput}
                  keyboardType="decimal-pad"
                />
              </>
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button label="Wstecz" secondary onPress={() => setWizardStep(1)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={wizardAssigning ? "Przypisywanie…" : "Dalej"}
                  disabled={wizardAssigning}
                  onPress={async () => {
                    // Technologia opcjonalna: bez wyboru "Dalej" po prostu
                    // przechodzi do kolejnego kroku — dopiero wybór
                    // konkretnej pozycji + m² uruchamia realne przypisanie.
                    if (!wizardTechId) {
                      setWizardStep(3);
                      return;
                    }
                    if (!Number(wizardAreaInput)) {
                      notify(
                        "Brak powierzchni",
                        "Wpisz powierzchnię (m²), żeby przypisać wybraną technologię.",
                      );
                      return;
                    }
                    setWizardAssigning(true);
                    try {
                      await assignBuildTechnology(
                        wizardBuildId,
                        wizardTechId,
                        Number(wizardAreaInput),
                      );
                      setWizardStep(3);
                    } finally {
                      setWizardAssigning(false);
                    }
                  }}
                />
              </View>
            </View>
          </>
        )}

        {wizardStep === 3 && wizardBuildId && (
          <>
            <Text className="text-xs text-muted uppercase mb-2">
              Materiały dodatkowe
            </Text>
            <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 10 }}>
              Materiały z magazynu spoza receptury technologii (np. sprzęt jednorazowy,
              zamienniki) — opcjonalne, da się dopisać też później z poziomu karty budowy.
            </Text>
            {(() => {
              const buildAssignments = assignments.filter(
                (a) => a.buildId === wizardBuildId,
              );
              const selectedBatch = warehouseBatches.find(
                (wb) => String(wb.id) === selectedBatchId,
              );
              const selectedMaterial = selectedBatch
                ? materials.find((m) => m.id === String(selectedBatch.materialId))
                : undefined;
              return (
                <View
                  style={{
                    backgroundColor: COLORS.background,
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <Text className="text-xs text-muted uppercase">Materiał / partia</Text>
                  <Pressable
                    onPress={() => {
                      setSelectedBuildId(wizardBuildId);
                      setPicker(picker === "material" ? null : "material");
                    }}
                    style={{
                      backgroundColor: COLORS.surface,
                      borderRadius: 10,
                      padding: 13,
                      marginTop: 8,
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <View>
                      <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
                        {selectedMaterial?.name || "Wybierz partię"}
                      </Text>
                      {selectedBatch && (
                        <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 3 }}>
                          {selectedBatch.receivedAt} ·{" "}
                          {formatPLN(Number(selectedBatch.unitPrice))} · dostępne{" "}
                          {selectedBatch.quantity} {selectedMaterial?.unit}
                        </Text>
                      )}
                    </View>
                    <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                      {picker === "material" ? "▲" : "▼"}
                    </Text>
                  </Pressable>
                  {picker === "material" && (
                    <View
                      style={{
                        backgroundColor: COLORS.surface,
                        borderRadius: 10,
                        padding: 10,
                        marginTop: 6,
                      }}
                    >
                      <Field
                        placeholder="Szukaj po nazwie lub indeksie"
                        value={pickerQuery}
                        onChangeText={setPickerQuery}
                      />
                      <ScrollView style={{ maxHeight: 220 }}>
                        {warehouseBatches
                          .map((wb) => ({
                            batch: wb,
                            material: materials.find((m) => m.id === String(wb.materialId)),
                          }))
                          .filter(({ material }) => material)
                          .filter(({ material }) =>
                            `${material!.name} ${material!.index}`
                              .toLowerCase()
                              .includes(pickerQuery.toLowerCase()),
                          )
                          .sort((x, y) => x.material!.name.localeCompare(y.material!.name))
                          .map(({ batch, material }) => (
                            <Pressable
                              key={batch.id}
                              onPress={() => {
                                setSelectedBatchId(String(batch.id));
                                setPicker(null);
                              }}
                              style={{
                                paddingVertical: 12,
                                borderBottomWidth: 1,
                                borderBottomColor: COLORS.border,
                              }}
                            >
                              <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
                                {material!.name}
                              </Text>
                              <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 3 }}>
                                {material!.index} · {batch.receivedAt} ·{" "}
                                {formatPLN(Number(batch.unitPrice))} · dostępne{" "}
                                {batch.quantity} {material!.unit}
                              </Text>
                            </Pressable>
                          ))}
                        {warehouseBatches.length === 0 && (
                          <Text style={{ color: COLORS.muted, fontSize: 12, padding: 10 }}>
                            Brak partii w magazynie.
                          </Text>
                        )}
                      </ScrollView>
                    </View>
                  )}
                  <Text className="text-xs text-muted uppercase mt-4">Ilość z tej partii</Text>
                  <QuantityStepper
                    style={{ marginTop: 8 }}
                    value={plannedAmount}
                    onChangeText={setPlannedAmount}
                  />
                  <View style={{ marginTop: 12 }}>
                    <Button label="+ Dodaj do listy" onPress={addToDraft} />
                  </View>
                  {draftAssignments.length > 0 && (
                    <View
                      style={{
                        backgroundColor: COLORS.surface,
                        borderRadius: 12,
                        padding: 12,
                        marginTop: 12,
                      }}
                    >
                      <Text className="text-xs text-muted uppercase">
                        Materiały oczekujące na zatwierdzenie
                      </Text>
                      {draftAssignments.map((draft) => {
                        const material = materials.find((m) => m.id === draft.materialId);
                        const batch = warehouseBatches.find(
                          (wb) => String(wb.id) === draft.batchId,
                        );
                        return (
                          <View
                            key={draft.batchId}
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              paddingVertical: 8,
                              borderBottomWidth: 1,
                              borderBottomColor: COLORS.border,
                            }}
                          >
                            <View>
                              <Text className="text-xs text-foreground">{material?.name}</Text>
                              {batch && (
                                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                                  {batch.receivedAt} · {formatPLN(Number(batch.unitPrice))}
                                </Text>
                              )}
                            </View>
                            <Text className="text-xs text-primary font-bold">
                              {draft.quantity} {material?.unit}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  {buildAssignments.length > 0 && (
                    <Text style={{ color: COLORS.success, fontSize: 12, marginTop: 10 }}>
                      Już przypisano: {buildAssignments.length}{" "}
                      {pluralPL(buildAssignments.length, "materiał", "materiały", "materiałów")}.
                    </Text>
                  )}
                </View>
              );
            })()}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button label="Wstecz" secondary onPress={() => setWizardStep(2)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Dalej"
                  onPress={async () => {
                    if (draftAssignments.length > 0) {
                      await commitAssignments();
                    }
                    setWizardStep(4);
                  }}
                />
              </View>
            </View>
          </>
        )}

        {wizardStep === 4 && wizardBuildId && (
          <>
            {(() => {
              const hasPlan = buildMaterialPlans.some(
                (p) => p.buildId === Number(wizardBuildId),
              );
              return hasPlan ? (
                <Pressable
                  onPress={() => setWizardGenerateOrder(!wizardGenerateOrder)}
                  style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
                >
                  <MaterialIcons
                    name={wizardGenerateOrder ? "check-box" : "check-box-outline-blank"}
                    size={20}
                    color={wizardGenerateOrder ? COLORS.primary : COLORS.muted}
                  />
                  <Text style={{ color: COLORS.foreground, fontSize: 13, flex: 1 }}>
                    Wygeneruj zamówienie z planu materiałowego technologii (ilość dobierze się
                    sama, do przejrzenia i zamówienia w zakładce Zamówienia).
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ color: COLORS.muted, fontSize: 13 }}>
                  Brak planu materiałowego (nie przypisano jeszcze technologii) — nie ma z czego
                  wygenerować zamówienia. Da się to zrobić później z poziomu karty budowy.
                </Text>
              );
            })()}
            {wizardOrderGenerated && (
              <Text style={{ color: COLORS.success, fontSize: 12, marginTop: 8 }}>
                Zamówienie wygenerowane — szczegóły znajdziesz w zakładce Zamówienia.
              </Text>
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button label="Wstecz" secondary onPress={() => setWizardStep(3)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={wizardOrderGenerating ? "Generuję…" : "Dalej"}
                  disabled={wizardOrderGenerating}
                  onPress={async () => {
                    const hasPlan = buildMaterialPlans.some(
                      (p) => p.buildId === Number(wizardBuildId),
                    );
                    if (!hasPlan || !wizardGenerateOrder) {
                      setWizardStep(5);
                      return;
                    }
                    setWizardOrderGenerating(true);
                    try {
                      await generateOrderFromPlan(wizardBuildId);
                      setWizardOrderGenerated(true);
                      setWizardStep(5);
                    } finally {
                      setWizardOrderGenerating(false);
                    }
                  }}
                />
              </View>
            </View>
          </>
        )}

        {wizardStep === 5 && wizardBuildId && (
          <>
            <Pressable
              onPress={() => setWizardCreateFolder(!wizardCreateFolder)}
              style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
            >
              <MaterialIcons
                name={wizardCreateFolder ? "check-box" : "check-box-outline-blank"}
                size={20}
                color={wizardCreateFolder ? COLORS.primary : COLORS.muted}
              />
              <Text style={{ color: COLORS.foreground, fontSize: 13, flex: 1 }}>
                Stwórz katalog na Google Drive na zdjęcia z postępu prac.
              </Text>
            </Pressable>
            {driveFolderError && (
              <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8 }}>
                {driveFolderError}
              </Text>
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button label="Wstecz" secondary onPress={() => setWizardStep(4)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={creatingDriveFolderId === wizardBuildId ? "Tworzenie…" : "Dalej"}
                  disabled={creatingDriveFolderId === wizardBuildId}
                  onPress={async () => {
                    if (!wizardCreateFolder) {
                      setWizardStep(6);
                      return;
                    }
                    setDriveFolderError(null);
                    setCreatingDriveFolderId(wizardBuildId);
                    try {
                      await createBuildDriveFolder(Number(wizardBuildId));
                      setWizardStep(6);
                    } catch (err) {
                      setDriveFolderError(
                        err instanceof Error ? err.message : "Nie udało się stworzyć katalogu.",
                      );
                    } finally {
                      setCreatingDriveFolderId(null);
                    }
                  }}
                />
              </View>
            </View>
          </>
        )}

        {wizardStep === 6 && wizardBuildId && (
          <>
            <Text style={{ color: COLORS.muted, fontSize: 13, marginBottom: 10 }}>
              Domyślnie portal jest wyłączony — włącz go tylko jeśli chcesz od razu przekazać
              klientowi link/QR.
            </Text>
            <BuildPortalSection buildId={Number(wizardBuildId)} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <Button label="Wstecz" secondary onPress={() => setWizardStep(5)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Zakończ" onPress={closeWizard} />
              </View>
            </View>
          </>
        )}
      </View>
    )}
    {isArchiveView && visibleBuilds.length > 0 && (
      <Text className="text-xs text-muted uppercase mb-3">
        Zamkniętych budów: {visibleBuilds.length}
      </Text>
    )}
    {visibleBuilds.length === 0 && (
      <View className="bg-surface border border-border rounded-2xl p-5 items-center">
        <Text className="text-sm text-muted">
          {buildQueryNormalized
            ? "Brak budów pasujących do wyszukiwania."
            : isArchiveView
              ? "Brak zamkniętych budów. Zamknięte budowy pojawią się tutaj."
              : "Brak aktywnych budów. Dodaj pierwszą budowę powyżej."}
        </Text>
      </View>
    )}
    {visibleBuilds.map((b) => {
      const buildReports = savedReports
        .filter((r) => r.buildId === b.id)
        .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
      const pendingCount = buildReports.filter(
        (r) => r.status !== "approved",
      ).length;
      const isClosed = b.status === "zamknięta";
      const reportsExpanded = !!expandedBuildReports[b.id];
      const isOpen = expandedBuildId === b.id;

      return (
        <View
          key={b.id}
          className="bg-surface border border-border rounded-2xl mb-3 overflow-hidden"
          style={isClosed ? { opacity: 0.85 } : undefined}
        >
          <Pressable
            onPress={() => setExpandedBuildId(isOpen ? null : b.id)}
            style={{ padding: 16 }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text className="text-xs text-primary font-bold">
                {b.number}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {/* Znacznik tylko dla stanu, który trzeba zasygnalizować —
                    "aktywna" to domyślny stan każdej budowy na tej liście,
                    więc pokazywanie go na każdym wierszu nic nie mówi i
                    dublował się wizualnie ze strzałką rozwijania. */}
                {isClosed && <StatusBadge status="ok" label="ZAMKNIĘTA" />}
                <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                  {isOpen ? "▲" : "▼"}
                </Text>
              </View>
            </View>
            <Text className="text-lg font-bold text-foreground mt-2">
              {b.name}
            </Text>
            <Text className="text-xs text-muted mt-2">
              Odpowiedzialny: {b.manager}
            </Text>
            {!isOpen && (
              <Text className="text-xs text-muted mt-1">
                {assignments.filter((a) => a.buildId === b.id).length} mat.
                przypisanych
                {b.startDate && b.durationDays
                  ? ` · ${b.startDate} → ${addDaysISO(b.startDate, b.durationDays)}`
                  : ""}
              </Text>
            )}
            {!isOpen && pendingCount > 0 && (
              <View style={{ marginTop: 10 }}>
                <StatusBadge
                  status="warning"
                  label={`${pendingCount} ${pendingCount === 1 ? "raport" : "raporty"} do sprawdzenia`}
                />
              </View>
            )}
          </Pressable>

          {isOpen && (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: COLORS.border,
                padding: 18,
                paddingTop: 16,
              }}
            >
          {(() => {
            const isEditingBasicInfo = editingBasicInfoBuildId === b.id;
            return (
              <View style={{ marginBottom: 12 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                      {b.clientName ? `Klient: ${b.clientName}` : "Klient nie podany"}
                    </Text>
                    {b.address && (
                      <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                        {b.address}
                      </Text>
                    )}
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                      {b.contractValue
                        ? `Kontrakt: ${formatPLN(Number(b.contractValue))}`
                        : "Wartość kontraktu nie podana"}
                    </Text>
                  </View>
                  {!isClosed && (
                    <Pressable
                      onPress={() => {
                        if (isEditingBasicInfo) {
                          setEditingBasicInfoBuildId(null);
                          return;
                        }
                        setBasicInfoDraft({
                          number: b.number,
                          name: b.name,
                          manager: b.manager,
                          clientName: b.clientName ?? "",
                          address: b.address ?? "",
                          contractValue: b.contractValue ? String(b.contractValue) : "",
                        });
                        setEditingBasicInfoBuildId(b.id);
                      }}
                    >
                      <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                        {isEditingBasicInfo ? "Anuluj" : "Edytuj"}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {isEditingBasicInfo && (
                  <View
                    style={{
                      backgroundColor: COLORS.background,
                      borderRadius: 12,
                      padding: 12,
                      marginTop: 10,
                    }}
                  >
                    <Text className="text-xs text-muted uppercase mb-2">Nazwa</Text>
                    <Field
                      value={basicInfoDraft.name}
                      onChangeText={(v: string) =>
                        setBasicInfoDraft({ ...basicInfoDraft, name: v })
                      }
                    />
                    <Text className="text-xs text-muted uppercase mt-3 mb-2">Numer budowy</Text>
                    <Field
                      value={basicInfoDraft.number}
                      onChangeText={(v: string) =>
                        setBasicInfoDraft({ ...basicInfoDraft, number: v })
                      }
                    />
                    <Text className="text-xs text-muted uppercase mt-3 mb-2">
                      Osoba odpowiedzialna
                    </Text>
                    <Pressable
                      onPress={() => {
                        setManagerPickerQuery("");
                        setManagerPickerBuildId(b.id);
                      }}
                      className="bg-surface border border-border rounded-2xl"
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <Text
                        style={{
                          color: basicInfoDraft.manager ? COLORS.foreground : COLORS.muted,
                          fontSize: 14,
                        }}
                      >
                        {basicInfoDraft.manager || "Wybierz osobę"}
                      </Text>
                      <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 12 }}>
                        Wybierz
                      </Text>
                    </Pressable>
                    <SearchablePicker
                      visible={managerPickerBuildId === b.id}
                      onClose={() => setManagerPickerBuildId(null)}
                      query={managerPickerQuery}
                      onQueryChange={setManagerPickerQuery}
                      placeholder="🔍 Szukaj pracownika…"
                      selectedKey={basicInfoDraft.manager}
                      onSelect={(key) => {
                        setBasicInfoDraft({ ...basicInfoDraft, manager: key });
                        setManagerPickerBuildId(null);
                      }}
                      emptyLabel="Brak pracowników pasujących do wyszukiwania."
                      items={employees
                        .filter((e) => e.active)
                        .filter((e) =>
                          e.name.toLowerCase().includes(managerPickerQuery.trim().toLowerCase()),
                        )
                        .map((e) => ({ key: e.name, title: e.name, subtitle: e.role }))}
                    />
                    <Text className="text-xs text-muted uppercase mt-3 mb-2">
                      Klient (opcjonalnie)
                    </Text>
                    <Field
                      value={basicInfoDraft.clientName}
                      onChangeText={(v: string) =>
                        setBasicInfoDraft({ ...basicInfoDraft, clientName: v })
                      }
                    />
                    <Text className="text-xs text-muted uppercase mt-3 mb-2">
                      Adres (opcjonalnie)
                    </Text>
                    <Field
                      value={basicInfoDraft.address}
                      onChangeText={(v: string) =>
                        setBasicInfoDraft({ ...basicInfoDraft, address: v })
                      }
                    />
                    <Text className="text-xs text-muted uppercase mt-3 mb-2">
                      Wartość kontraktu (PLN, opcjonalnie)
                    </Text>
                    <Field
                      placeholder="np. 250000"
                      value={basicInfoDraft.contractValue}
                      onChangeText={(v: string) =>
                        setBasicInfoDraft({ ...basicInfoDraft, contractValue: v })
                      }
                      keyboardType="decimal-pad"
                    />
                    <View style={{ marginTop: 12 }}>
                      <Button
                        label={basicInfoBusy ? "Zapisywanie…" : "Zapisz"}
                        disabled={basicInfoBusy}
                        onPress={async () => {
                          setBasicInfoBusy(true);
                          try {
                            await updateBuildBasicInfo(b.id, basicInfoDraft, () =>
                              setEditingBasicInfoBuildId(null),
                            );
                          } finally {
                            setBasicInfoBusy(false);
                          }
                        }}
                      />
                    </View>
                  </View>
                )}
              </View>
            );
          })()}
          {b.startDate && b.durationDays ? (
            <Text className="text-xs text-muted mt-2">
              Start: {b.startDate} · {b.durationDays} dni · zakończenie:{" "}
              {addDaysISO(b.startDate, b.durationDays)} ·{" "}
              {b.durationDays * workdayHours} h (dniówka {workdayHours}{" "}
              h)
            </Text>
          ) : null}
          {!isClosed &&
            (() => {
              const isEditingLaborPlan = editingLaborPlanBuildId === b.id;
              const currentTeam = teams.find((t) => String(t.id) === String(b.teamId));
              return (
                <View style={{ marginTop: 8 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text className="text-xs text-muted">
                      Brygada: {currentTeam?.name ?? "nie przypisano"}
                    </Text>
                    <Pressable
                      onPress={() => {
                        if (isEditingLaborPlan) {
                          setEditingLaborPlanBuildId(null);
                          return;
                        }
                        setLaborPlanDraft({
                          teamId: b.teamId ? String(b.teamId) : "",
                          durationDays: b.durationDays ? String(b.durationDays) : "",
                          plannedHoursPerDay: b.plannedHoursPerDay
                            ? String(b.plannedHoursPerDay)
                            : String(workdayHours),
                        });
                        setEditingLaborPlanBuildId(b.id);
                      }}
                    >
                      <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                        {isEditingLaborPlan ? "Anuluj" : "Edytuj"}
                      </Text>
                    </Pressable>
                  </View>
                  {isEditingLaborPlan && (
                    <View
                      style={{
                        backgroundColor: COLORS.background,
                        borderRadius: 12,
                        padding: 12,
                        marginTop: 8,
                      }}
                    >
                      <Text className="text-xs text-muted uppercase mb-2">Brygada</Text>
                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                        {teams.map((t) => (
                          <Pressable
                            key={t.id}
                            onPress={() =>
                              setLaborPlanDraft({
                                ...laborPlanDraft,
                                teamId:
                                  String(t.id) === laborPlanDraft.teamId ? "" : String(t.id),
                              })
                            }
                            style={{
                              backgroundColor:
                                String(t.id) === laborPlanDraft.teamId
                                  ? COLORS.primary
                                  : COLORS.surface,
                              borderRadius: 8,
                              paddingHorizontal: 9,
                              paddingVertical: 7,
                              borderWidth: 1,
                              borderColor:
                                String(t.id) === laborPlanDraft.teamId
                                  ? COLORS.primary
                                  : COLORS.border,
                            }}
                          >
                            <Text
                              style={{
                                color:
                                  String(t.id) === laborPlanDraft.teamId
                                    ? COLORS.background
                                    : COLORS.foreground,
                                fontWeight: "700",
                                fontSize: 12,
                              }}
                            >
                              {t.name}
                            </Text>
                          </Pressable>
                        ))}
                        {teams.length === 0 && (
                          <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                            Brak brygad — dodaj je w Admin → Zespół i dniówka.
                          </Text>
                        )}
                      </View>
                      <Text className="text-xs text-muted uppercase mt-3 mb-2">
                        Liczba dni roboczych
                      </Text>
                      <Field
                        value={laborPlanDraft.durationDays}
                        onChangeText={(v: string) =>
                          setLaborPlanDraft({ ...laborPlanDraft, durationDays: v })
                        }
                        keyboardType="number-pad"
                      />
                      <View style={{ marginTop: 12 }}>
                        <Button
                          label={laborPlanBusy ? "Zapisywanie…" : "Zapisz"}
                          disabled={laborPlanBusy}
                          onPress={async () => {
                            setLaborPlanBusy(true);
                            try {
                              await updateBuildLaborPlan(b.id, laborPlanDraft, () =>
                                setEditingLaborPlanBuildId(null),
                              );
                            } finally {
                              setLaborPlanBusy(false);
                            }
                          }}
                        />
                      </View>
                    </View>
                  )}
                </View>
              );
            })()}
          {/* Technologia (Faza 2) — plan materiałowy = m² budowy × zużycie
              z receptury, zamrożony w momencie przypisania (patrz
              build_technology_snapshot). Późniejsza zmiana/nowa wersja
              technologii NIE rusza już przypisanego planu. */}
          {(() => {
            const snapshot = buildTechnologySnapshots.find(
              (s) => s.buildId === Number(b.id),
            );
            const plan = buildMaterialPlans.filter(
              (p) => p.buildId === Number(b.id),
            );
            const stageOrder: string[] = [];
            const planByStage: Record<string, typeof plan> = {};
            for (const row of plan) {
              if (!planByStage[row.stageName]) {
                planByStage[row.stageName] = [];
                stageOrder.push(row.stageName);
              }
              planByStage[row.stageName].push(row);
            }
            const pickerOpen = techEditBuildId === b.id;
            return (
              <View
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTopWidth: 1,
                  borderTopColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 8 }}>
                  TECHNOLOGIA
                </Text>
                {/* Cały wiersz jest klikalny i prowadzi do zmiany/przypisania
                    technologii — bez osobnego przycisku "Zmień" obok, żeby nie
                    dublować tej samej akcji dwoma sposobami na raz. */}
                <Pressable
                  onPress={() => {
                    if (!snapshot) {
                      // Brak technologii — dotknięcie wiersza od razu
                      // otwiera przypisanie (nie ma czego "rozwijać").
                      if (pickerOpen) {
                        setTechEditBuildId(null);
                        return;
                      }
                      setTechEditBuildId(b.id);
                      setTechPickerId(null);
                      setTechAreaInput(b.areaM2 ?? "");
                      return;
                    }
                    // Technologia już przypisana — dotknięcie
                    // rozwija/zwija materiały, edycja/zmiana ma osobny
                    // link "Zmień technologię" w rozwiniętym widoku.
                    setTechMaterialsExpandedBuildId(
                      techMaterialsExpandedBuildId === b.id ? null : b.id,
                    );
                  }}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    {snapshot ? (
                      <>
                        <Text
                          style={{
                            color: COLORS.foreground,
                            fontWeight: "700",
                            fontSize: 13,
                          }}
                        >
                          {snapshot.technologyName}
                        </Text>
                        <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>
                          v{snapshot.technologyVersion} · {b.areaM2 ?? "—"} m²
                        </Text>
                      </>
                    ) : (
                      <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                        Brak przypisanej technologii — dotknij, żeby przypisać.
                      </Text>
                    )}
                  </View>
                  <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                    {(snapshot ? techMaterialsExpandedBuildId === b.id : pickerOpen) ? "▲" : "▼"}
                  </Text>
                </Pressable>

                {snapshot && techMaterialsExpandedBuildId === b.id && !pickerOpen && (
                  <Pressable
                    onPress={() => {
                      setTechEditBuildId(b.id);
                      setTechPickerId(null);
                      setTechAreaInput(b.areaM2 ?? "");
                    }}
                    style={{ marginTop: 8 }}
                  >
                    <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                      Zmień technologię
                    </Text>
                  </Pressable>
                )}

                {pickerOpen && (
                  <View style={{ marginTop: 10 }}>
                    {technologies.length === 0 ? (
                      <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                        Brak technologii — dodaj ją najpierw w zakładce Technologie.
                      </Text>
                    ) : (
                      <>
                        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                          {technologies.map((t) => (
                            <Pressable
                              key={t.id}
                              onPress={() => setTechPickerId(t.id)}
                              style={{
                                backgroundColor:
                                  techPickerId === t.id ? COLORS.primary : COLORS.background,
                                borderRadius: 8,
                                paddingHorizontal: 9,
                                paddingVertical: 7,
                                borderWidth: 1,
                                borderColor:
                                  techPickerId === t.id ? COLORS.primary : COLORS.border,
                              }}
                            >
                              <Text
                                style={{
                                  color:
                                    techPickerId === t.id
                                      ? COLORS.background
                                      : COLORS.foreground,
                                  fontWeight: "700",
                                  fontSize: 12,
                                }}
                              >
                                {t.name} · v{t.version}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        <Text className="text-xs text-muted uppercase mb-2 mt-3">
                          Powierzchnia (m²)
                        </Text>
                        <QuantityStepper value={techAreaInput} onChangeText={setTechAreaInput} />
                        <View style={{ marginTop: 10 }}>
                          {techBusy ? (
                            <Text style={{ color: COLORS.muted, fontSize: 12 }}>Zapisywanie…</Text>
                          ) : (
                            <Button
                              label="Zapisz plan materiałowy"
                              onPress={async () => {
                                if (!techPickerId) {
                                  notify("Brak technologii", "Wybierz technologię z listy powyżej.");
                                  return;
                                }
                                if (!Number(techAreaInput)) {
                                  notify(
                                    "Brak powierzchni",
                                    "Wpisz powierzchnię (m²), żeby wyliczyć plan materiałowy.",
                                  );
                                  return;
                                }
                                setTechBusy(true);
                                try {
                                  await assignBuildTechnology(
                                    b.id,
                                    techPickerId,
                                    Number(techAreaInput),
                                  );
                                  setTechEditBuildId(null);
                                  setTechMaterialsExpandedBuildId(b.id);
                                } finally {
                                  setTechBusy(false);
                                }
                              }}
                            />
                          )}
                        </View>
                      </>
                    )}
                  </View>
                )}

                {!pickerOpen && techMaterialsExpandedBuildId === b.id && plan.length > 0 && (() => {
                  // Koszt planowany = plannedQuantity × AKTUALNA cena
                  // materiału (materials.unitPrice — średnia ważona stanu,
                  // przeliczana przy każdej partii, patrz fn_recalc_material
                  // w supabase/sql/001_rpc_functions.sql/040_...sql). Brak
                  // powiązanego materiału (linkedMaterialId) = koszt
                  // nieznany, pomijany w sumie zamiast liczony jako 0.
                  const plannedCostFor = (row: (typeof plan)[number]) => {
                    if (!row.linkedMaterialId) return null;
                    const material = materials.find(
                      (m) => m.id === String(row.linkedMaterialId),
                    );
                    if (!material) return null;
                    return Number(row.plannedQuantity) * material.unitPrice;
                  };
                  const totalPlannedCost = plan.reduce((sum, row) => {
                    const cost = plannedCostFor(row);
                    return sum + (cost ?? 0);
                  }, 0);
                  // Realnie przypisana partia (z "MATERIAŁY DODATKOWE" wyżej
                  // w kodzie, tu wyłączona z tamtej sekcji, patrz
                  // extraAssignments) dopasowana po nazwie do pozycji planu —
                  // żeby ilość faktycznie przypisana z magazynu nie zniknęła
                  // po rozdzieleniu tych dwóch list.
                  const assignedByMaterialName = new Map<string, (typeof assignments)[number]>();
                  for (const a of assignments) {
                    if (a.buildId !== b.id) continue;
                    const name = materials.find((m) => m.id === a.materialId)?.name
                      ?.trim()
                      .toLowerCase();
                    if (name) assignedByMaterialName.set(name, a);
                  }
                  return (
                    <View style={{ marginTop: 10 }}>
                      {stageOrder.map((stageName) => (
                        <View key={stageName} style={{ marginBottom: 8 }}>
                          <Text
                            style={{ color: COLORS.muted, fontSize: 11, fontWeight: "700" }}
                          >
                            {stageName.toUpperCase()}
                          </Text>
                          {planByStage[stageName].map((row) => {
                            const cost = plannedCostFor(row);
                            const assigned = assignedByMaterialName.get(
                              row.materialName.trim().toLowerCase(),
                            );
                            return (
                              <View key={row.id} style={{ marginTop: 3 }}>
                                <View
                                  style={{
                                    flexDirection: "row",
                                    justifyContent: "space-between",
                                  }}
                                >
                                  <Text style={{ color: COLORS.foreground, fontSize: 12 }}>
                                    {row.materialName}
                                  </Text>
                                  <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                                    {row.consumptionPerM2} {row.unit}/m² ·{" "}
                                    <Text style={{ color: COLORS.primary, fontWeight: "700" }}>
                                      {row.plannedQuantity} {row.unit}
                                    </Text>
                                    {cost !== null && ` · ${formatPLN(cost)}`}
                                  </Text>
                                </View>
                                {assigned && (
                                  <Text
                                    style={{ color: COLORS.success, fontSize: 11, textAlign: "right" }}
                                  >
                                    przypisano z magazynu: {assigned.planned} {row.unit}
                                  </Text>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      ))}
                      {totalPlannedCost > 0 && (
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            marginTop: 4,
                            paddingTop: 6,
                            borderTopWidth: 1,
                            borderTopColor: COLORS.border,
                          }}
                        >
                          <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>
                            Koszt materiałowy planowany razem
                          </Text>
                          <Text
                            style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 13 }}
                          >
                            {formatPLN(totalPlannedCost)}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })()}
              </View>
            );
          })()}

          {/* Zamówienia z planu materiałowego (Faza 3) — jedno zamówienie
              (nagłówek+pozycje) generowane z build_material_plan wyżej;
              ilość zamawiana edytowalna dopóki "robocze", przyjęcie
              dostawy dopisuje partię per pozycja (własna cena). */}
          {(() => {
            const buildOrdersForBuild = buildOrders.filter(
              (o) => o.buildId === Number(b.id),
            );
            const hasPlan = buildMaterialPlans.some(
              (p) => p.buildId === Number(b.id),
            );
            const STATUS_LABEL: Record<string, string> = {
              robocze: "Robocze",
              zamówione: "Zamówione",
              przyjęte: "Przyjęte",
              anulowane: "Anulowane",
            };
            return (
              <View
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTopWidth: 1,
                  borderTopColor: COLORS.border,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                    ZAMÓWIENIA{buildOrdersForBuild.length > 0 ? ` (${buildOrdersForBuild.length})` : ""}
                  </Text>
                  {hasPlan && (
                    <Pressable
                      disabled={orderGenerating === b.id}
                      onPress={async () => {
                        setOrderGenerating(b.id);
                        setOrderGeneratedFor(null);
                        try {
                          await generateOrderFromPlan(b.id);
                          setOrderGeneratedFor(b.id);
                        } finally {
                          setOrderGenerating(null);
                        }
                      }}
                    >
                      <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}>
                        {orderGenerating === b.id ? "Generuję…" : "+ Z planu"}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {orderGeneratedFor === b.id && (
                  <Text style={{ color: COLORS.success, fontSize: 12, marginTop: 6 }}>
                    Zamówienie wygenerowane — status i przyjęcie dostawy znajdziesz też
                    w zakładce Zamówienia.
                  </Text>
                )}

                {!hasPlan && buildOrdersForBuild.length === 0 && (
                  <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
                    Przypisz technologię, żeby wygenerować zamówienie z planu.
                  </Text>
                )}

                {buildOrdersForBuild.map((order) => {
                  const isReceiving = orderReceivingId === order.id;
                  const isOrderOpen = expandedOrderId === order.id;
                  return (
                    <View
                      key={order.id}
                      style={{
                        marginTop: 10,
                        backgroundColor: COLORS.background,
                        borderRadius: 10,
                        padding: 10,
                      }}
                    >
                      {/* Wiersz zamówienia jest klikalny i prowadzi do jego
                          szczegółów (rozwinięcie pozycji/akcji poniżej) —
                          "+ Z planu" wyżej zostaje osobną, niezależną akcją. */}
                      <Pressable
                        onPress={() =>
                          setExpandedOrderId(isOrderOpen ? null : order.id)
                        }
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                          {order.orderNumber}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <StatusBadge
                            status={
                              order.status === "przyjęte"
                                ? "ok"
                                : order.status === "anulowane"
                                  ? "danger"
                                  : "warning"
                            }
                            label={STATUS_LABEL[order.status]}
                          />
                          <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                            {isOrderOpen ? "▲" : "▼"}
                          </Text>
                        </View>
                      </Pressable>

                      {isOrderOpen && (
                      <>
                      {order.order_items.map((item) => (
                        <View
                          key={item.id}
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 6,
                          }}
                        >
                          <Text style={{ color: COLORS.foreground, fontSize: 12, flex: 1 }}>
                            {item.materialName}
                          </Text>
                          {order.status === "robocze" && editingOrderItemId === item.id ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <QuantityStepper
                                value={orderQtyDraft}
                                onChangeText={setOrderQtyDraft}
                                unit={item.unit}
                              />
                              <Pressable
                                hitSlop={8}
                                onPress={async () => {
                                  const qty = Number(orderQtyDraft);
                                  if (qty > 0) await updateOrderItemQuantity(item.id, qty);
                                  setEditingOrderItemId(null);
                                }}
                              >
                                <Text style={{ color: COLORS.success, fontSize: 12, fontWeight: "700" }}>
                                  OK
                                </Text>
                              </Pressable>
                            </View>
                          ) : (
                            <Pressable
                              disabled={order.status !== "robocze"}
                              onPress={() => {
                                setEditingOrderItemId(item.id);
                                setOrderQtyDraft(item.orderedQuantity);
                              }}
                            >
                              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                                {item.orderedQuantity} {item.unit}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      ))}

                      {order.status === "robocze" && (
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Button
                              label="Złożono u dostawcy"
                              fullWidth
                              onPress={() => markBuildOrderOrdered(order.id)}
                            />
                          </View>
                          <Pressable
                            onPress={() =>
                              confirmAction(
                                "Anulować zamówienie?",
                                `${order.orderNumber} zostanie oznaczone jako anulowane.`,
                                "Anuluj zamówienie",
                                () => cancelBuildOrder(order.id),
                              )
                            }
                            style={{ justifyContent: "center", paddingHorizontal: 10 }}
                          >
                            <Text style={{ color: COLORS.danger, fontSize: 12, fontWeight: "700" }}>
                              Anuluj
                            </Text>
                          </Pressable>
                        </View>
                      )}

                      {order.status === "zamówione" && !isReceiving && (
                        <View style={{ marginTop: 10 }}>
                          <Button
                            label="Dostawa dotarła"
                            fullWidth
                            onPress={() => {
                              const drafts: Record<number, { qty: string; price: string }> = {};
                              for (const item of order.order_items) {
                                const material = materials.find(
                                  (m) => m.id === String(item.linkedMaterialId ?? ""),
                                );
                                drafts[item.id] = {
                                  qty: item.orderedQuantity,
                                  price: material ? String(material.unitPrice ?? "") : "",
                                };
                              }
                              setOrderReceiveDrafts(drafts);
                              setOrderReceiveDocument("");
                              setOrderReceiveSupplier("");
                              setOrderReceivingId(order.id);
                            }}
                          />
                        </View>
                      )}

                      {order.status === "zamówione" && isReceiving && (
                        <View style={{ marginTop: 10 }}>
                          {order.order_items.map((item) => (
                            <View key={item.id} style={{ marginTop: 8 }}>
                              <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                                {item.materialName}
                              </Text>
                              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                                    Ilość ({item.unit})
                                  </Text>
                                  <QuantityStepper
                                    value={orderReceiveDrafts[item.id]?.qty ?? ""}
                                    onChangeText={(v: string) =>
                                      setOrderReceiveDrafts({
                                        ...orderReceiveDrafts,
                                        [item.id]: { ...orderReceiveDrafts[item.id], qty: v },
                                      })
                                    }
                                  />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                                    Cena (PLN)
                                  </Text>
                                  <QuantityStepper
                                    value={orderReceiveDrafts[item.id]?.price ?? ""}
                                    onChangeText={(v: string) =>
                                      setOrderReceiveDrafts({
                                        ...orderReceiveDrafts,
                                        [item.id]: { ...orderReceiveDrafts[item.id], price: v },
                                      })
                                    }
                                  />
                                </View>
                              </View>
                            </View>
                          ))}
                          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                                Nr dokumentu (PZ)
                              </Text>
                              <Field
                                style={{ marginTop: 4 }}
                                placeholder="opcjonalnie"
                                value={orderReceiveDocument}
                                onChangeText={setOrderReceiveDocument}
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: COLORS.muted, fontSize: 10 }}>Dostawca</Text>
                              <Field
                                style={{ marginTop: 4 }}
                                placeholder="opcjonalnie"
                                value={orderReceiveSupplier}
                                onChangeText={setOrderReceiveSupplier}
                              />
                            </View>
                          </View>
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                            <View style={{ flex: 1 }}>
                              <Button
                                label="Anuluj"
                                secondary
                                fullWidth
                                onPress={() => setOrderReceivingId(null)}
                              />
                            </View>
                            <View style={{ flex: 2 }}>
                              <Button
                                label="Przyjmij na magazyn"
                                fullWidth
                                onPress={async () => {
                                  setOrderReceiveBusy(true);
                                  try {
                                    await receiveBuildOrder(
                                      order.id,
                                      order.order_items.map((item) => ({
                                        itemId: item.id,
                                        receivedQuantity:
                                          Number(orderReceiveDrafts[item.id]?.qty) || 0,
                                        receivedUnitPrice:
                                          Number(orderReceiveDrafts[item.id]?.price) || undefined,
                                      })),
                                      orderReceiveDocument,
                                      orderReceiveSupplier,
                                    );
                                    setOrderReceivingId(null);
                                  } finally {
                                    setOrderReceiveBusy(false);
                                  }
                                }}
                              />
                            </View>
                          </View>
                          {orderReceiveBusy && (
                            <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 6 }}>
                              Zapisywanie…
                            </Text>
                          )}
                        </View>
                      )}

                      {order.status === "anulowane" && (
                        <View style={{ marginTop: 10 }}>
                          <Button
                            label="Usuń zamówienie"
                            secondary
                            fullWidth
                            onPress={() =>
                              confirmAction(
                                "Skasować zamówienie?",
                                `${order.orderNumber} zostanie trwale usunięte z listy.`,
                                "Usuń",
                                () => deleteBuildOrder(order.id),
                              )
                            }
                          />
                        </View>
                      )}
                      </>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })()}

          {/* Materiały dodatkowe (pomocnicze, spoza planu technologii) —
              dawniej globalny przycisk "+ Przypisz materiał" nad listą
              budów (z ręcznym wyborem budowy) i lista przypisanych
              materiałów wymieszana z "Kosztami na bieżąco" niżej. Teraz:
              własna sekcja od razu pod Zamówieniami, budowa ustawiana
              automatycznie na tę, w której jesteśmy (setSelectedBuildId
              przy otwarciu), zanim dojdzie do Zdjęć i Kosztów. */}
          {!isClosed &&
            (() => {
              const buildAssignments = assignments.filter(
                (a) => a.buildId === b.id,
              );
              // Materiały technologiczne (z planu, patrz sekcja TECHNOLOGIA
              // niżej) dopasowane po nazwie — ten sam wzorzec co w raporcie
              // brygadzisty (report-screen.tsx: stageNameByMaterialName/
              // pomocniczeAssignments). Bez tego rozdzielenia "MATERIAŁY
              // DODATKOWE" pokazywało też materiały z planu technologii,
              // mimo że mają już swoją sekcję wyżej.
              const planMaterialNames = new Set(
                buildMaterialPlans
                  .filter((p) => p.buildId === Number(b.id))
                  .map((p) => p.materialName.trim().toLowerCase()),
              );
              const extraAssignments = buildAssignments.filter((a) => {
                const name = materials.find((m) => m.id === a.materialId)?.name
                  ?.trim()
                  .toLowerCase();
                return !name || !planMaterialNames.has(name);
              });
              const isAssigning = assignBuildId === b.id;
              const selectedBatch = warehouseBatches.find(
                (wb) => String(wb.id) === selectedBatchId,
              );
              const selectedMaterial = selectedBatch
                ? materials.find(
                    (m) => m.id === String(selectedBatch.materialId),
                  )
                : undefined;
              return (
                <View
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: COLORS.border,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Pressable
                      onPress={() =>
                        setExpandedExtraMaterialsBuildId(
                          expandedExtraMaterialsBuildId === b.id ? null : b.id,
                        )
                      }
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}
                    >
                      <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                        MATERIAŁY DODATKOWE
                        {extraAssignments.length > 0 ? ` (${extraAssignments.length})` : ""}
                      </Text>
                      {extraAssignments.length > 0 && (
                        <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                          {expandedExtraMaterialsBuildId === b.id ? "▲" : "▼"}
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (isAssigning) {
                          setAssignBuildId(null);
                          return;
                        }
                        setSelectedBuildId(b.id);
                        setPicker(null);
                        setPickerQuery("");
                        setSelectedBatchId("");
                        setPlannedAmount("");
                        setDraftAssignments([]);
                        setAssignBuildId(b.id);
                        setExpandedExtraMaterialsBuildId(b.id);
                      }}
                    >
                      <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}>
                        {isAssigning ? "Anuluj przypisywanie" : "+ Przypisz materiał"}
                      </Text>
                    </Pressable>
                  </View>

                  {isAssigning && (
                    <View
                      style={{
                        backgroundColor: COLORS.background,
                        borderRadius: 12,
                        padding: 12,
                        marginTop: 10,
                      }}
                    >
                      {/* Ręczny wybór partii (Faza 5) — wyszukiwarka po
                          nazwie pokazuje KAŻDĄ partię osobno (różne
                          daty/ceny tej samej pozycji), nie zblendowany
                          materiał; admin wybiera konkretną i ile z niej. */}
                      <Text className="text-xs text-muted uppercase">
                        Materiał / partia
                      </Text>
                      <Pressable
                        onPress={() => {
                          // Nie czyścimy pickerQuery przy otwarciu — po
                          // dodaniu jednej partii do listy (addToDraft
                          // zamyka picker, ale zostawia wyszukiwaną frazę)
                          // ponowne otwarcie ma pokazać ten sam
                          // przefiltrowany wynik, nie całą listę partii od
                          // nowa/od góry (zgłoszony problem: wybór "zaczynał
                          // się od początku" przy każdym kolejnym materiale).
                          setPicker(picker === "material" ? null : "material");
                        }}
                        style={{
                          backgroundColor: COLORS.surface,
                          borderRadius: 10,
                          padding: 13,
                          marginTop: 8,
                          flexDirection: "row",
                          justifyContent: "space-between",
                        }}
                      >
                        <View>
                          <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
                            {selectedMaterial?.name || "Wybierz partię"}
                          </Text>
                          {selectedBatch && (
                            <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 3 }}>
                              {selectedBatch.receivedAt} ·{" "}
                              {formatPLN(Number(selectedBatch.unitPrice))} · dostępne{" "}
                              {selectedBatch.quantity} {selectedMaterial?.unit}
                            </Text>
                          )}
                        </View>
                        <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                          {picker === "material" ? "▲" : "▼"}
                        </Text>
                      </Pressable>
                      {picker === "material" && (
                        <View
                          style={{
                            backgroundColor: COLORS.surface,
                            borderRadius: 10,
                            padding: 10,
                            marginTop: 6,
                          }}
                        >
                          <Field
                            placeholder="Szukaj po nazwie lub indeksie"
                            value={pickerQuery}
                            onChangeText={setPickerQuery}
                          />
                          <Pressable
                            onPress={() => setOnlyUnassignedInPicker(!onlyUnassignedInPicker)}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              marginTop: 8,
                              paddingVertical: 4,
                            }}
                          >
                            <MaterialIcons
                              name={onlyUnassignedInPicker ? "check-box" : "check-box-outline-blank"}
                              size={18}
                              color={onlyUnassignedInPicker ? COLORS.primary : COLORS.muted}
                            />
                            <Text
                              style={{
                                color: onlyUnassignedInPicker ? COLORS.foreground : COLORS.muted,
                                fontSize: 12,
                                fontWeight: "600",
                                marginLeft: 6,
                              }}
                            >
                              Tylko nieprzypisane do tej budowy
                            </Text>
                          </Pressable>
                          <ScrollView style={{ maxHeight: 260 }}>
                            {warehouseBatches
                              .map((wb) => ({
                                batch: wb,
                                material: materials.find(
                                  (m) => m.id === String(wb.materialId),
                                ),
                              }))
                              .filter(({ material }) => material)
                              .filter(({ material }) =>
                                `${material!.name} ${material!.index}`
                                  .toLowerCase()
                                  .includes(pickerQuery.toLowerCase()),
                              )
                              .filter(
                                ({ material }) =>
                                  !onlyUnassignedInPicker ||
                                  !buildAssignments.some(
                                    (a) => a.materialId === material!.id,
                                  ),
                              )
                              .sort((x, y) => x.material!.name.localeCompare(y.material!.name))
                              .map(({ batch, material }) => (
                                <Pressable
                                  key={batch.id}
                                  onPress={() => {
                                    setSelectedBatchId(String(batch.id));
                                    setPicker(null);
                                  }}
                                  style={{
                                    paddingVertical: 12,
                                    borderBottomWidth: 1,
                                    borderBottomColor: COLORS.border,
                                  }}
                                >
                                  <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
                                    {material!.name}
                                  </Text>
                                  <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 3 }}>
                                    {material!.index} · {batch.receivedAt} ·{" "}
                                    {formatPLN(Number(batch.unitPrice))} · dostępne{" "}
                                    {batch.quantity} {material!.unit}
                                    {batch.documentNumber ? ` · ${batch.documentNumber}` : ""}
                                    {batch.supplier ? ` · ${batch.supplier}` : ""}
                                  </Text>
                                </Pressable>
                              ))}
                            {warehouseBatches.length === 0 && (
                              <Text style={{ color: COLORS.muted, fontSize: 12, padding: 10 }}>
                                Brak partii w magazynie.
                              </Text>
                            )}
                          </ScrollView>
                        </View>
                      )}
                      <Text className="text-xs text-muted uppercase mt-4">
                        Ilość z tej partii
                      </Text>
                      <QuantityStepper
                        style={{ marginTop: 8 }}
                        value={plannedAmount}
                        onChangeText={setPlannedAmount}
                      />
                      <View style={{ marginTop: 12 }}>
                        <Button label="+ Dodaj do listy" onPress={addToDraft} />
                      </View>
                      {draftAssignments.length > 0 && (
                        <View
                          style={{
                            backgroundColor: COLORS.surface,
                            borderRadius: 12,
                            padding: 12,
                            marginTop: 12,
                          }}
                        >
                          <Text className="text-xs text-muted uppercase">
                            Materiały oczekujące na zatwierdzenie
                          </Text>
                          {draftAssignments.map((draft) => {
                            const material = materials.find(
                              (m) => m.id === draft.materialId,
                            );
                            const batch = warehouseBatches.find(
                              (wb) => String(wb.id) === draft.batchId,
                            );
                            return (
                              <View
                                key={draft.batchId}
                                style={{
                                  flexDirection: "row",
                                  justifyContent: "space-between",
                                  paddingVertical: 8,
                                  borderBottomWidth: 1,
                                  borderBottomColor: COLORS.border,
                                }}
                              >
                                <View>
                                  <Text className="text-xs text-foreground">
                                    {material?.name}
                                  </Text>
                                  {batch && (
                                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                                      {batch.receivedAt} · {formatPLN(Number(batch.unitPrice))}
                                    </Text>
                                  )}
                                </View>
                                <Text className="text-xs text-primary font-bold">
                                  {draft.quantity} {material?.unit}
                                </Text>
                              </View>
                            );
                          })}
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                            <View style={{ flex: 1 }}>
                              <Button
                                label="Anuluj przypisanie"
                                secondary
                                onPress={() => setDraftAssignments([])}
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Button
                                label={`Zatwierdź ${draftAssignments.length} materiałów`}
                                onPress={async () => {
                                  await commitAssignments();
                                  setAssignBuildId(null);
                                }}
                              />
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                  )}

                  {expandedExtraMaterialsBuildId === b.id &&
                    extraAssignments.map((a) => {
                    const material = materials.find((m) => m.id === a.materialId);
                    const key = `${b.id}-${a.materialId}`;
                    const isOpen = expandedAssignmentKey === key;
                    return (
                      <View
                        key={key}
                        style={{
                          marginTop: 10,
                          paddingTop: 10,
                          borderTopWidth: 1,
                          borderTopColor: COLORS.border,
                        }}
                      >
                        {/* Klikalny wiersz → szczegóły materiału (cena,
                            zużycie); "+ Przypisz materiał" wyżej to osobna,
                            niezależna akcja — nie duplikujemy jej tutaj. */}
                        <Pressable
                          onPress={() => setExpandedAssignmentKey(isOpen ? null : key)}
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Text
                            className="text-xs text-foreground"
                            numberOfLines={1}
                            style={{ flex: 1, marginRight: 8 }}
                          >
                            {material?.name || "Materiał usunięty z magazynu"}
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Text className="text-xs text-primary font-bold">
                              {a.planned} {material?.unit}
                            </Text>
                            <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                              {isOpen ? "▲" : "▼"}
                            </Text>
                          </View>
                        </Pressable>
                        {isOpen && (
                          <View style={{ marginTop: 8 }}>
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                paddingVertical: 2,
                              }}
                            >
                              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                                Cena jednostkowa
                              </Text>
                              <Text style={{ color: COLORS.foreground, fontSize: 12 }}>
                                {formatPLN(a.unitPrice)}
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                paddingVertical: 2,
                              }}
                            >
                              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                                Zużyto / przypisano
                              </Text>
                              <Text style={{ color: COLORS.foreground, fontSize: 12 }}>
                                {a.used} / {a.planned} {material?.unit}
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                paddingVertical: 2,
                              }}
                            >
                              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                                Wartość
                              </Text>
                              <Text style={{ color: COLORS.foreground, fontSize: 12, fontWeight: "700" }}>
                                {formatPLN(a.planned * a.unitPrice)}
                              </Text>
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })()}

          <View
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: COLORS.border,
            }}
          >
            <Pressable
              onPress={() =>
                setExpandedPortalBuildId(
                  expandedPortalBuildId === b.id ? null : b.id,
                )
              }
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                PORTAL KLIENTA
              </Text>
              <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                {expandedPortalBuildId === b.id ? "▲" : "▼"}
              </Text>
            </Pressable>
            {expandedPortalBuildId === b.id && (
              <View style={{ marginTop: 10 }}>
                <BuildPortalSection buildId={Number(b.id)} />
              </View>
            )}
          </View>

          {isClosed && b.settlement ? (
            <DetailSection
              label="Rozliczenie końcowe"
              count={`zamknięto ${b.settlement.closedAt.slice(0, 10)}`}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 4,
                }}
              >
                <Text className="text-sm text-foreground">
                  Godziny łącznie
                </Text>
                <Text className="text-sm font-bold text-foreground">
                  {b.settlement.totalHours.toFixed(2)} h
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 4,
                }}
              >
                <Text className="text-sm text-foreground">
                  Koszt robocizny
                </Text>
                <Text className="text-sm font-bold text-foreground">
                  {formatPLN(b.settlement.laborCost)}
                </Text>
              </View>
              <Text
                style={{
                  color: COLORS.muted,
                  fontSize: 11,
                  marginTop: 6,
                  marginBottom: 2,
                }}
              >
                Materiały (zużycie / plan)
              </Text>
              {b.settlement.materials.map((m) => {
                const material = materials.find((x) => x.id === m.materialId);
                const diff = m.used - m.planned;
                return (
                  <View
                    key={m.materialId}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingVertical: 4,
                    }}
                  >
                    <Text
                      className="text-sm text-foreground"
                      numberOfLines={1}
                      style={{ flex: 1, marginRight: 8 }}
                    >
                      {material?.name || "Materiał usunięty"}
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "700",
                        color: diff > 0 ? COLORS.warning : COLORS.foreground,
                      }}
                    >
                      {m.used} / plan {m.planned} {material?.unit} ·{" "}
                      {formatPLN(m.actualCost)}
                      {Math.abs(m.actualCost - m.used * m.unitPrice) > 0.01 && (
                        <Text style={{ color: COLORS.muted, fontWeight: "400" }}>
                          {" "}(plan {formatPLN(m.used * m.unitPrice)})
                        </Text>
                      )}
                    </Text>
                  </View>
                );
              })}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 4,
                  marginTop: 4,
                  borderTopWidth: 1,
                  borderTopColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>
                  Koszt materiałowy razem
                </Text>
                <Text style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 13 }}>
                  {formatPLN(b.settlement.materialsCost)}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 4,
                }}
              >
                <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>
                  Koszty dodatkowe razem
                </Text>
                <Text style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 13 }}>
                  {formatPLN(b.settlement.totalExtraCosts)}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingTop: 8,
                  marginTop: 4,
                  borderTopWidth: 1,
                  borderTopColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.muted, fontSize: 13, fontWeight: "800" }}>
                  Koszt całkowity budowy
                </Text>
                <Text style={{ color: COLORS.primary, fontWeight: "800", fontSize: 15 }}>
                  {formatPLN(b.settlement.totalCost)}
                </Text>
              </View>
            </DetailSection>
          ) : (
            (() => {
              const buildAssignmentsList = assignments.filter(
                (a) => a.buildId === b.id,
              );
              const materialsCostPlanned = buildAssignmentsList.reduce(
                (sum, a) => sum + a.planned * a.unitPrice,
                0,
              );
              const materialsCostActual = buildAssignmentsList.reduce(
                (sum, a) => {
                  const actual = buildMaterialActualCost[`${b.id}:${a.materialId}`];
                  return sum + (actual !== undefined ? actual : a.used * a.unitPrice);
                },
                0,
              );
              const buildTimeEntries = timeEntries.filter(
                (t) => t.buildId === b.id,
              );
              // Stawka ZAMROŻONA na wpisie (t.costRate), nie aktualna —
              // patrz supabase/sql/055_stawka_zamrozona_w_godzinach.sql.
              // Koszt budowy liczymy ze stawki KOSZTOWEJ (koszt pracodawcy),
              // nie ze stawki godzinowej (ta jest tylko do wypłaty).
              const laborCostActual = buildTimeEntries.reduce((sum, t) => {
                const employee = employees.find((e) => e.id === t.employeeId);
                const rate = t.costRate ?? employee?.costRate ?? 0;
                return sum + t.hours * rate;
              }, 0);
              // Planowany koszt robocizny — patrz settlement-screen.tsx
              // (ten sam wzorzec, ta sama logika, tu tylko podgląd na
              // liście budów zamiast pełnego ekranu Rozliczenia).
              const laborCostPlanned = b.teamId
                ? teamMembers
                    .filter((m) => m.teamId === Number(b.teamId))
                    .reduce((sum, m) => {
                      const employee = employees.find(
                        (e) => e.id === String(m.employeeId),
                      );
                      return sum + (employee?.costRate || 0);
                    }, 0) *
                  (b.plannedHoursPerDay || 0) *
                  (b.durationDays || 0)
                : 0;
              const buildExtraCosts = buildReports.flatMap(
                (r) => r.extraCosts || [],
              );
              const totalExtraCosts = buildExtraCosts.reduce(
                (sum, c) => sum + c.amount,
                0,
              );
              const totalCostSoFar =
                materialsCostActual + laborCostActual + totalExtraCosts;
              if (
                buildAssignmentsList.length === 0 &&
                buildTimeEntries.length === 0 &&
                buildExtraCosts.length === 0
              )
                return null;
              return (
                <DetailSection label="Koszty na bieżąco">
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingVertical: 3,
                    }}
                  >
                    <Text className="text-xs text-muted">
                      Materiały (plan {formatPLN(materialsCostPlanned)})
                    </Text>
                    <Text className="text-xs font-bold text-foreground">
                      {formatPLN(materialsCostActual)}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingVertical: 3,
                    }}
                  >
                    <Text className="text-xs text-muted">
                      Robocizna
                      {laborCostPlanned > 0 && ` (plan ${formatPLN(laborCostPlanned)})`}
                    </Text>
                    <Text className="text-xs font-bold text-foreground">
                      {formatPLN(laborCostActual)}
                    </Text>
                  </View>
                  {buildExtraCosts.length > 0 && (
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        paddingVertical: 3,
                      }}
                    >
                      <Text className="text-xs text-muted">
                        Koszty dodatkowe ({buildExtraCosts.length})
                      </Text>
                      <Text className="text-xs font-bold text-foreground">
                        {formatPLN(totalExtraCosts)}
                      </Text>
                    </View>
                  )}
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingTop: 6,
                      marginTop: 3,
                      borderTopWidth: 1,
                      borderTopColor: COLORS.border,
                    }}
                  >
                    <Text
                      style={{
                        color: COLORS.muted,
                        fontSize: 12,
                        fontWeight: "700",
                      }}
                    >
                      Razem dotychczas
                    </Text>
                    <Text
                      style={{
                        color: COLORS.primary,
                        fontWeight: "800",
                        fontSize: 13,
                      }}
                    >
                      {formatPLN(totalCostSoFar)}
                    </Text>
                  </View>
                </DetailSection>
              );
            })()
          )}

          {/* Zdjęcia budowy — katalog na Google Drive (utworzony przyciskiem
              niżej albo, dla starszych budów, wklejony ręcznie jako zwykły
              link) + dołączanie zdjęć wprost z apki (build-photos-section.tsx).
              Zwinięte domyślnie, ten sam wzorzec akordeonu co Portal klienta
              i Materiały dodatkowe wyżej. */}
          <View
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: COLORS.border,
            }}
          >
            <Pressable
              onPress={() =>
                setExpandedPhotosBuildId(
                  expandedPhotosBuildId === b.id ? null : b.id,
                )
              }
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                ZDJĘCIA{photoCounts[b.id] ? ` (${photoCounts[b.id]})` : ""}
              </Text>
              <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                {expandedPhotosBuildId === b.id ? "▲" : "▼"}
              </Text>
            </Pressable>
            {expandedPhotosBuildId === b.id && (
              <View style={{ marginTop: 10 }}>
                {/* Możliwość poprawienia linku zostaje, ale jako drobna,
                    drugorzędna akcja — nie "Zmień link" jako główny przycisk:
                    użytkownik nie chce "zmieniać linku", tylko otworzyć
                    zdjęcia (patrz duża karta z BuildPhotosSection niżej). */}
                {b.photosUrl && (
                  <Pressable
                    onPress={() => {
                      const isEditing = editingPhotosBuildId === b.id;
                      setEditingPhotosBuildId(isEditing ? null : b.id);
                      setPhotosUrlInput(isEditing ? "" : b.photosUrl || "");
                    }}
                    style={{ alignSelf: "flex-end", marginBottom: 8 }}
                  >
                    <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>
                      {editingPhotosBuildId === b.id ? "Zwiń" : "Edytuj link"}
                    </Text>
                  </Pressable>
                )}
                {!b.photosUrl && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                    <Pressable
                      disabled={creatingDriveFolderId === b.id}
                      onPress={async () => {
                        setDriveFolderError(null);
                        setCreatingDriveFolderId(b.id);
                        try {
                          await createBuildDriveFolder(Number(b.id));
                          // Realtime na "builds" (use-realtime-sync.ts)
                          // odświeży photosUrl/driveFolderId za chwilę same —
                          // nie trzeba tu ręcznie invalidować.
                        } catch (err) {
                          setDriveFolderError(
                            err instanceof Error ? err.message : "Nie udało się stworzyć katalogu.",
                          );
                        } finally {
                          setCreatingDriveFolderId(null);
                        }
                      }}
                    >
                      <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}>
                        {creatingDriveFolderId === b.id
                          ? "Tworzenie katalogu…"
                          : "Stwórz katalog na zdjęcia"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        const isEditing = editingPhotosBuildId === b.id;
                        setEditingPhotosBuildId(isEditing ? null : b.id);
                        setPhotosUrlInput(isEditing ? "" : b.photosUrl || "");
                      }}
                    >
                      <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>
                        {editingPhotosBuildId === b.id ? "Zwiń" : "…lub wklej link ręcznie"}
                      </Text>
                    </Pressable>
                  </View>
                )}
                {driveFolderError && (
                  <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8 }}>
                    {driveFolderError}
                  </Text>
                )}
                {editingPhotosBuildId === b.id && (
                  <View style={{ marginTop: 10 }}>
                    <Field
                      placeholder="https://drive.google.com/..."
                      value={photosUrlInput}
                      onChangeText={setPhotosUrlInput}
                      autoCapitalize="none"
                    />
                    <View style={{ marginTop: 10 }}>
                      <Button
                        label="Zapisz link"
                        onPress={() => {
                          updateBuildPhotosUrl(b.id, photosUrlInput.trim());
                          setEditingPhotosBuildId(null);
                        }}
                      />
                    </View>
                  </View>
                )}
                <View style={{ marginTop: 10 }}>
                  <BuildPhotosSection
                    buildId={Number(b.id)}
                    driveFolderUrl={b.photosUrl ?? null}
                    variant="admin"
                    onCountChange={(count) =>
                      setPhotoCounts((prev) =>
                        prev[b.id] === count ? prev : { ...prev, [b.id]: count },
                      )
                    }
                  />
                </View>
              </View>
            )}
          </View>

          {/* Raporty tej konkretnej budowy — pojedyncze źródło prawdy,
              zamiast rozjeżdżania się z ekranem "Raporty". */}
          <Pressable
            onPress={() =>
              setExpandedBuildReports((prev) => ({
                ...prev,
                [b.id]: !prev[b.id],
              }))
            }
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 18,
              paddingTop: 16,
              borderTopWidth: 1,
              borderTopColor: COLORS.border,
            }}
          >
            <Text className="text-xs text-muted uppercase">
              Raporty ({buildReports.length}
              {pendingCount > 0 ? ` · ${pendingCount} do sprawdzenia` : ""})
            </Text>
            <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
              {reportsExpanded ? "▲" : "▼"}
            </Text>
          </Pressable>

          {reportsExpanded && (
            <View style={{ marginTop: 12 }}>
              {buildReports.length === 0 ? (
                <View className="items-center py-4">
                  <IconBadge name="description" size={18} badgeSize={36} />
                  <Text className="text-xs text-muted mt-2">
                    Brak raportów z tej budowy.
                  </Text>
                </View>
              ) : (
                buildReports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    build={b}
                    materials={materials}
                    assignments={assignments}
                    employees={employees}
                    expanded={expandedReportId === report.id}
                    onToggle={() =>
                      setExpandedReportId(
                        expandedReportId === report.id ? null : report.id,
                      )
                    }
                    onApprove={() => approveReport(report.id)}
                    showBuildInfo={false}
                    showClientNoteStatus
                  />
                ))
              )}
            </View>
          )}

          {!isClosed &&
            (() => {
              // Pozostałość materiałowa (Faza 9): build_material_lots trzyma
              // na żywo dostępną, jeszcze nie zużytą ilość per partia
              // przypisana do tej budowy (patrz fn_consume_build_lot_fifo,
              // 009_faza5_reczny_wybor_partii.sql) — dokładnie to, o czym
              // Admin musi zdecydować przed zamknięciem.
              const remainingLots = buildMaterialLots.filter(
                (l) => l.buildId === Number(b.id) && Number(l.quantity) > 0.0001,
              );
              const isClosingThis = closingBuildId === b.id;
              const allDecided = remainingLots.every((l) => {
                const d = returnDecisions[l.id];
                return (
                  d &&
                  (d.decision === "zwrot" ||
                    (d.decision === "wyrzucenie" && d.reason.trim().length > 0))
                );
              });
              const submitClose = async () => {
                const items = remainingLots.map((l) => ({
                  materialId: l.materialId,
                  batchId: l.sourceBatchId,
                  quantity: Number(l.quantity),
                  decision: returnDecisions[l.id]?.decision ?? "zwrot",
                  reason: returnDecisions[l.id]?.reason || undefined,
                }));
                setCloseBusy(true);
                try {
                  await closeBuild(b.id, items);
                  setClosingBuildId(null);
                  setReturnDecisions({});
                } finally {
                  setCloseBusy(false);
                }
              };
              return (
                <View style={{ marginTop: 18 }}>
                  {isClosingThis ? (
                    <View
                      style={{
                        borderTopWidth: 1,
                        borderTopColor: COLORS.border,
                        paddingTop: 14,
                      }}
                    >
                      <Text
                        style={{
                          color: COLORS.foreground,
                          fontWeight: "800",
                          fontSize: 13,
                          marginBottom: 4,
                        }}
                      >
                        Pozostałość materiałowa
                      </Text>
                      <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 10 }}>
                        Dla każdej partii zdecyduj: zwrot na magazyn albo do wyrzucenia
                        (zostaje kosztem budowy).
                      </Text>
                      {remainingLots.map((l) => {
                        const material = materials.find(
                          (m) => m.id === String(l.materialId),
                        );
                        const batch = warehouseBatches.find(
                          (wb) => wb.id === l.sourceBatchId,
                        );
                        const d = returnDecisions[l.id] ?? {
                          decision: "zwrot" as const,
                          reason: "",
                        };
                        return (
                          <View
                            key={l.id}
                            style={{
                              marginBottom: 12,
                              paddingBottom: 12,
                              borderBottomWidth: 1,
                              borderBottomColor: COLORS.border,
                            }}
                          >
                            <Text
                              style={{
                                color: COLORS.foreground,
                                fontSize: 13,
                                fontWeight: "700",
                              }}
                            >
                              {material?.name ?? "Materiał usunięty"} · {l.quantity}{" "}
                              {material?.unit ?? ""}
                            </Text>
                            {batch && (
                              <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                                Partia z {batch.receivedAt.slice(0, 10)}
                                {batch.supplier ? ` · ${batch.supplier}` : ""}
                              </Text>
                            )}
                            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                              <Pressable
                                onPress={() =>
                                  setReturnDecisions((prev) => ({
                                    ...prev,
                                    [l.id]: { decision: "zwrot", reason: prev[l.id]?.reason ?? "" },
                                  }))
                                }
                                style={{
                                  flex: 1,
                                  paddingVertical: 8,
                                  borderRadius: 8,
                                  borderWidth: 1,
                                  borderColor:
                                    d.decision === "zwrot" ? COLORS.success : COLORS.border,
                                  backgroundColor:
                                    d.decision === "zwrot" ? COLORS.successBg : "transparent",
                                  alignItems: "center",
                                }}
                              >
                                <Text
                                  style={{
                                    color: d.decision === "zwrot" ? COLORS.success : COLORS.muted,
                                    fontSize: 12,
                                    fontWeight: "700",
                                  }}
                                >
                                  Zwrot na magazyn
                                </Text>
                              </Pressable>
                              <Pressable
                                onPress={() =>
                                  setReturnDecisions((prev) => ({
                                    ...prev,
                                    [l.id]: {
                                      decision: "wyrzucenie",
                                      reason: prev[l.id]?.reason ?? "",
                                    },
                                  }))
                                }
                                style={{
                                  flex: 1,
                                  paddingVertical: 8,
                                  borderRadius: 8,
                                  borderWidth: 1,
                                  borderColor:
                                    d.decision === "wyrzucenie" ? COLORS.danger : COLORS.border,
                                  backgroundColor:
                                    d.decision === "wyrzucenie" ? COLORS.dangerBg : "transparent",
                                  alignItems: "center",
                                }}
                              >
                                <Text
                                  style={{
                                    color:
                                      d.decision === "wyrzucenie" ? COLORS.danger : COLORS.muted,
                                    fontSize: 12,
                                    fontWeight: "700",
                                  }}
                                >
                                  Do wyrzucenia
                                </Text>
                              </Pressable>
                            </View>
                            {d.decision === "wyrzucenie" && (
                              <View style={{ marginTop: 8 }}>
                                <Field
                                  placeholder="Powód (wymagany)"
                                  value={d.reason}
                                  onChangeText={(v: string) =>
                                    setReturnDecisions((prev) => ({
                                      ...prev,
                                      [l.id]: { decision: "wyrzucenie", reason: v },
                                    }))
                                  }
                                />
                              </View>
                            )}
                          </View>
                        );
                      })}
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Anuluj"
                            secondary
                            onPress={() => {
                              setClosingBuildId(null);
                              setReturnDecisions({});
                            }}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            label={closeBusy ? "Zamykanie…" : "Zamknij budowę"}
                            disabled={!allDecided || closeBusy}
                            onPress={submitClose}
                          />
                        </View>
                      </View>
                    </View>
                  ) : pinGate?.buildId === b.id ? (
                    <View className="bg-surface border border-border rounded-2xl p-4">
                      <Text style={{ color: COLORS.foreground, fontWeight: "700", marginBottom: 8 }}>
                        Podaj PIN, żeby zamknąć budowę
                      </Text>
                      <Field
                        placeholder="PIN"
                        value={pinInput}
                        onChangeText={setPinInput}
                        keyboardType="number-pad"
                        secureTextEntry
                      />
                      {pinError && (
                        <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8 }}>
                          {pinError}
                        </Text>
                      )}
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Anuluj"
                            secondary
                            onPress={() => {
                              setPinGate(null);
                              setPinInput("");
                              setPinError(null);
                            }}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Zatwierdź"
                            onPress={() => {
                              if (pinInput !== closeBuildPin) {
                                setPinError("Nieprawidłowy PIN.");
                                return;
                              }
                              const run = pinGate.run;
                              setPinGate(null);
                              setPinInput("");
                              setPinError(null);
                              run();
                            }}
                          />
                        </View>
                      </View>
                    </View>
                  ) : (
                    <>
                      <Button
                        label="Zamknij i rozlicz budowę"
                        secondary
                        disabled={pendingCount > 0}
                        onPress={() => {
                          const proceed = () => {
                            if (remainingLots.length === 0) {
                              confirmAction(
                                "Zamknąć budowę?",
                                `Budowa ${b.number} zostanie oznaczona jako zamknięta i policzone zostanie jej finalne rozliczenie. Tej operacji nie da się cofnąć w prosty sposób.`,
                                "Zamknij budowę",
                                () => closeBuild(b.id, []),
                              );
                              return;
                            }
                            // Domyślnie "zwrot" dla każdej pozycji — wypisane
                            // wprost do stanu, a nie tylko pokazane jako
                            // podświetlenie w renderze, inaczej allDecided
                            // niżej zostaje false, dopóki ktoś nie kliknie
                            // każdej pozycji osobno (mimo że wygląda na już
                            // wybraną).
                            setReturnDecisions(
                              Object.fromEntries(
                                remainingLots.map((l) => [l.id, { decision: "zwrot" as const, reason: "" }]),
                              ),
                            );
                            setClosingBuildId(b.id);
                          };
                          if (closeBuildPin) {
                            setPinInput("");
                            setPinError(null);
                            setPinGate({ buildId: b.id, run: proceed });
                          } else {
                            proceed();
                          }
                        }}
                      />
                      {pendingCount > 0 && (
                        <Text
                          style={{
                            color: COLORS.muted,
                            fontSize: 11,
                            marginTop: 6,
                            textAlign: "center",
                          }}
                        >
                          Zatwierdź wszystkie raporty tej budowy, żeby móc ją zamknąć.
                        </Text>
                      )}
                    </>
                  )}
                </View>
              );
            })()}
          {isClosed && (
            <View style={{ marginTop: 18 }}>
              <Button
                label="Wznów budowę"
                secondary
                onPress={() =>
                  confirmAction(
                    "Wznowić budowę?",
                    `Budowa ${b.number} wróci do aktywnych. Zapisane rozliczenie końcowe zostanie usunięte — po ponownym zamknięciu budowy zostanie policzone od nowa na podstawie aktualnych danych.`,
                    "Wznów budowę",
                    () => reopenBuild(b.id),
                  )
                }
              />
            </View>
          )}
            </View>
          )}
        </View>
      );
    })}
  </>
    </>
  );
}
