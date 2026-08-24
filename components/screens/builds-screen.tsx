import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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
  QuantityStepper,
  ReportCard,
  ScreenHeader,
  StatusBadge,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import { createBuildDriveFolder } from "@/lib/data/drive-photos";
import { BuildPhotosSection } from "@/components/build-photos-section";

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
    timeEntries,
    buildMaterialActualCost,
    buildOrders,
    generateOrderFromPlan,
    updateOrderItemQuantity,
    markBuildOrderOrdered,
    cancelBuildOrder,
    deleteBuildOrder,
    receiveBuildOrder,
    showBuild,
    showAssignment,
    selectedBuildId,
    selectedBatchId,
    warehouseBatches,
    plannedAmount,
    picker,
    pickerQuery,
    draftAssignments,
    setDraftAssignments,
    newBuild,
    workdayHours,
    setShowBuild,
    setShowAssignment,
    setSelectedBuildId,
    setSelectedBatchId,
    setPlannedAmount,
    setPicker,
    setPickerQuery,
    setNewBuild,
    addToDraft,
    commitAssignments,
    saveBuild,
    approveReport,
    closeBuild,
    reopenBuild,
    updateBuildPhotosUrl,
    buildsView,
    closeBuildPin,
  } = useAppData();

  const isArchiveView = buildsView === "archive";

  // Które budowy mają rozwiniętą sekcję raportów, i który konkretny raport
  // (w obrębie dowolnej budowy) jest rozwinięty — jeden na raz wystarcza.
  // Szukajka po numerze/nazwie budowy — ten sam mechanizm co w Raportach
  // Admina (manager-screen.tsx). Aktywne/Archiwum zostają osobnymi
  // zakładkami nawigacji (sterowanymi z index.tsx), więc bez osobnego
  // checkboxa "pokaż zarchiwizowane" — to już robi przełączenie zakładki.
  const [buildQuery, setBuildQuery] = useState("");
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
  // Przypisanie/zmiana technologii (Faza 2) — jeden picker na raz, ten
  // sam wzorzec co edycja linku do zdjęć powyżej.
  const [techEditBuildId, setTechEditBuildId] = useState<string | null>(null);
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
  const [expandedOrdersBuildId, setExpandedOrdersBuildId] = useState<string | null>(
    null,
  );
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
      title={isArchiveView ? "Archiwum budów" : "Budowy"}
      action={
        !isArchiveView ? (
          <Button label="+ Nowa" onPress={() => setShowBuild(!showBuild)} />
        ) : undefined
      }
    />
    <Field
      placeholder="🔍 Szukaj budowy…"
      value={buildQuery}
      onChangeText={setBuildQuery}
      style={{ marginBottom: 16 }}
    />
    {!isArchiveView && showBuild && (
      <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
        <Field
          placeholder="Numer budowy"
          value={newBuild.number}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, number: v })
          }
        />
        <Field
          placeholder="Nazwa budowy"
          value={newBuild.name}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, name: v })
          }
        />
        <Field
          placeholder="Osoba odpowiedzialna"
          value={newBuild.manager}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, manager: v })
          }
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
          placeholder="np. 250000"
          value={newBuild.contractValue}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, contractValue: v.replace(",", ".") })
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
          Czas trwania (dni)
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
        <View style={{ marginTop: 12 }}>
          <Button label="Zapisz budowę" onPress={saveBuild} />
        </View>
      </View>
    )}
    {!isArchiveView && (
    <View style={{ marginBottom: 16 }}>
      <Button
        label={
          showAssignment
            ? "Anuluj przypisywanie"
            : "+ Przypisz materiał"
        }
        onPress={() => setShowAssignment(!showAssignment)}
        secondary={showAssignment}
      />
    </View>
    )}
    {!isArchiveView && showAssignment && (
      <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
        <Text className="text-xs text-muted uppercase">Budowa</Text>
        <Pressable
          onPress={() => {
            setPicker(picker === "build" ? null : "build");
            setPickerQuery("");
          }}
          style={{
            backgroundColor: COLORS.background,
            borderRadius: 10,
            padding: 13,
            marginTop: 8,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{ color: COLORS.foreground, fontWeight: "700" }}
          >
            {builds.find((b) => b.id === selectedBuildId)?.number ||
              "Wybierz budowę"}
          </Text>
          <Text style={{ color: COLORS.primary }}>
            {picker === "build" ? "▲" : "▼"}
          </Text>
        </Pressable>
        {picker === "build" && (
          <View
            style={{
              backgroundColor: COLORS.background,
              borderRadius: 10,
              padding: 10,
              marginTop: 6,
            }}
          >
            <Field
              placeholder="Szukaj po numerze lub nazwie"
              value={pickerQuery}
              onChangeText={setPickerQuery}
            />
            <ScrollView style={{ maxHeight: 180 }}>
              {builds
                .filter((b) => b.status !== "zamknięta")
                .filter((b) =>
                  `${b.number} ${b.name}`
                    .toLowerCase()
                    .includes(pickerQuery.toLowerCase()),
                )
                .map((b) => (
                  <Pressable
                    key={b.id}
                    onPress={() => {
                      setSelectedBuildId(b.id);
                      setPicker(null);
                      setPickerQuery("");
                    }}
                    style={{
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.border,
                    }}
                  >
                    <Text
                      style={{
                        color: COLORS.foreground,
                        fontWeight: "700",
                      }}
                    >
                      {b.number}
                    </Text>
                    <Text
                      style={{
                        color: COLORS.muted,
                        fontSize: 12,
                        marginTop: 3,
                      }}
                    >
                      {b.name}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        )}
        {/* Ręczny wybór partii (Faza 5) — wyszukiwarka po nazwie pokazuje
            KAŻDĄ partię osobno (różne daty/ceny tej samej pozycji), nie
            zblendowany materiał; admin wybiera konkretną i ile z niej. */}
        <Text className="text-xs text-muted uppercase mt-4">
          Materiał / partia
        </Text>
        {(() => {
          const selectedBatch = warehouseBatches.find(
            (b) => String(b.id) === selectedBatchId,
          );
          const selectedMaterial = selectedBatch
            ? materials.find((m) => m.id === String(selectedBatch.materialId))
            : undefined;
          return (
            <>
              <Pressable
                onPress={() => {
                  setPicker(picker === "material" ? null : "material");
                  setPickerQuery("");
                }}
                style={{
                  backgroundColor: COLORS.background,
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
                      {selectedBatch.receivedAt} · {formatPLN(Number(selectedBatch.unitPrice))} ·
                      dostępne {selectedBatch.quantity} {selectedMaterial?.unit}
                    </Text>
                  )}
                </View>
                <Text style={{ color: COLORS.primary }}>
                  {picker === "material" ? "▲" : "▼"}
                </Text>
              </Pressable>
              {picker === "material" && (
                <View
                  style={{
                    backgroundColor: COLORS.background,
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
                  <ScrollView style={{ maxHeight: 260 }}>
                    {warehouseBatches
                      .map((b) => ({
                        batch: b,
                        material: materials.find((m) => m.id === String(b.materialId)),
                      }))
                      .filter(({ material }) => material)
                      .filter(({ material }) =>
                        `${material!.name} ${material!.index}`
                          .toLowerCase()
                          .includes(pickerQuery.toLowerCase()),
                      )
                      .sort((a, b) => a.material!.name.localeCompare(b.material!.name))
                      .map(({ batch, material }) => (
                        <Pressable
                          key={batch.id}
                          onPress={() => {
                            setSelectedBatchId(String(batch.id));
                            setPicker(null);
                            setPickerQuery("");
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
                            {formatPLN(Number(batch.unitPrice))} · dostępne {batch.quantity}{" "}
                            {material!.unit}
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
            </>
          );
        })()}
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
              backgroundColor: COLORS.background,
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
                (b) => String(b.id) === draft.batchId,
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
                  onPress={commitAssignments}
                />
              </View>
            </View>
          </View>
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
                <Text style={{ color: COLORS.primary, fontSize: 16 }}>
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
          {b.startDate && b.durationDays ? (
            <Text className="text-xs text-muted mt-2">
              Start: {b.startDate} · {b.durationDays} dni · zakończenie:{" "}
              {addDaysISO(b.startDate, b.durationDays)} ·{" "}
              {b.durationDays * workdayHours} h (dniówka {workdayHours}{" "}
              h)
            </Text>
          ) : null}
          <Text className="text-xs text-muted mt-3">
            Materiały przypisane:{" "}
            {assignments.filter((a) => a.buildId === b.id).length}
          </Text>

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
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                      TECHNOLOGIA
                    </Text>
                    {snapshot ? (
                      <Text
                        style={{
                          color: COLORS.foreground,
                          fontWeight: "700",
                          fontSize: 13,
                          marginTop: 2,
                        }}
                      >
                        {snapshot.technologyName} · v{snapshot.technologyVersion} ·{" "}
                        {b.areaM2 ?? "?"} m²
                      </Text>
                    ) : (
                      <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>
                        Brak przypisanej technologii.
                      </Text>
                    )}
                  </View>
                  <Pressable
                    onPress={() => {
                      if (pickerOpen) {
                        setTechEditBuildId(null);
                        return;
                      }
                      setTechEditBuildId(b.id);
                      setTechPickerId(null);
                      setTechAreaInput(b.areaM2 ?? "");
                    }}
                  >
                    <Text
                      style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}
                    >
                      {pickerOpen ? "Zwiń" : snapshot ? "Zmień" : "Przypisz"}
                    </Text>
                  </Pressable>
                </View>

                {pickerOpen && (
                  <View style={{ marginTop: 10 }}>
                    {technologies.length === 0 ? (
                      <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                        Brak technologii — dodaj ją najpierw w Zespół → Technologie.
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
                                if (!techPickerId || !Number(techAreaInput)) return;
                                setTechBusy(true);
                                try {
                                  await assignBuildTechnology(
                                    b.id,
                                    techPickerId,
                                    Number(techAreaInput),
                                  );
                                  setTechEditBuildId(null);
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

                {!pickerOpen && plan.length > 0 && (
                  <View style={{ marginTop: 10 }}>
                    {stageOrder.map((stageName) => (
                      <View key={stageName} style={{ marginBottom: 8 }}>
                        <Text
                          style={{ color: COLORS.muted, fontSize: 11, fontWeight: "700" }}
                        >
                          {stageName.toUpperCase()}
                        </Text>
                        {planByStage[stageName].map((row) => (
                          <View
                            key={row.id}
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              marginTop: 3,
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
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
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
                  <Pressable
                    disabled={buildOrdersForBuild.length === 0}
                    onPress={() =>
                      setExpandedOrdersBuildId(
                        expandedOrdersBuildId === b.id ? null : b.id,
                      )
                    }
                    style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                  >
                    <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                      ZAMÓWIENIA{buildOrdersForBuild.length > 0 ? ` (${buildOrdersForBuild.length})` : ""}
                    </Text>
                    {buildOrdersForBuild.length > 0 && (
                      <Text style={{ color: COLORS.primary, fontSize: 11 }}>
                        {expandedOrdersBuildId === b.id ? "▲" : "▼"}
                      </Text>
                    )}
                  </Pressable>
                  {hasPlan && (
                    <Pressable
                      disabled={orderGenerating === b.id}
                      onPress={async () => {
                        setOrderGenerating(b.id);
                        setOrderGeneratedFor(null);
                        try {
                          await generateOrderFromPlan(b.id);
                          setOrderGeneratedFor(b.id);
                          setExpandedOrdersBuildId(b.id);
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

                {expandedOrdersBuildId === b.id && buildOrdersForBuild.map((order) => {
                  const isReceiving = orderReceivingId === order.id;
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
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                          {order.orderNumber}
                        </Text>
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
                      </View>

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
                              <View style={{ width: 90 }}>
                                <QuantityStepper
                                  value={orderQtyDraft}
                                  onChangeText={setOrderQtyDraft}
                                />
                              </View>
                              <Pressable
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
                    </View>
                  );
                })}
              </View>
            );
          })()}

          {/* Zdjęcia budowy — katalog na Google Drive (utworzony przyciskiem
              niżej albo, dla starszych budów, wklejony ręcznie jako zwykły
              link) + dołączanie zdjęć wprost z apki (build-photos-section.tsx). */}
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
              <Text style={{ color: COLORS.muted, fontSize: 11 }}>ZDJĘCIA</Text>
              {!b.photosUrl && (
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
                  style={{ marginRight: 12 }}
                >
                  <Text
                    style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}
                  >
                    {creatingDriveFolderId === b.id
                      ? "Tworzenie katalogu…"
                      : "Stwórz katalog na zdjęcia"}
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  const isEditing = editingPhotosBuildId === b.id;
                  setEditingPhotosBuildId(isEditing ? null : b.id);
                  setPhotosUrlInput(isEditing ? "" : b.photosUrl || "");
                }}
              >
                <Text
                  style={{ color: COLORS.primary, fontSize: 13, fontWeight: "700" }}
                >
                  {editingPhotosBuildId === b.id
                    ? "Zwiń"
                    : b.photosUrl
                      ? "Zmień link"
                      : "…lub wklej link ręcznie"}
                </Text>
              </Pressable>
            </View>
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
              <BuildPhotosSection buildId={Number(b.id)} driveFolderUrl={b.photosUrl ?? null} />
            </View>
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
              const laborCostActual = buildTimeEntries.reduce((sum, t) => {
                const employee = employees.find((e) => e.id === t.employeeId);
                return sum + t.hours * (employee?.hourlyRate || 0);
              }, 0);
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
                    <Text className="text-xs text-muted">Robocizna</Text>
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

          {!isClosed &&
            assignments
              .filter((a) => a.buildId === b.id)
              .map((a) => {
                const material = materials.find(
                  (m) => m.id === a.materialId,
                );
                return (
                  <View
                    key={`${b.id}-${a.materialId}`}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginTop: 12,
                      paddingTop: 12,
                      borderTopWidth: 1,
                      borderTopColor: COLORS.border,
                    }}
                  >
                    <Text
                      className="text-xs text-foreground"
                      numberOfLines={1}
                      style={{ flex: 1, marginRight: 8 }}
                    >
                      {material?.name || "Materiał usunięty z magazynu"}
                    </Text>
                    <Text
                      className="text-xs text-primary font-bold"
                      style={{ flexShrink: 0 }}
                    >
                      {a.planned} {material?.unit}
                    </Text>
                  </View>
                );
              })}

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
            <Text style={{ color: COLORS.primary, fontSize: 14 }}>
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
