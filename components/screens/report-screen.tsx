import AsyncStorage from "@react-native-async-storage/async-storage";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  COLORS,
  todayLabelPL,
  Button,
  confirmAction,
  Field,
  IconBadge,
  notify,
  QuantityStepper,
  ExtraCostsSection,
  ReportStepper,
  ScreenHeader,
  TimeOptionsList,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import { BuildPhotosSection } from "@/components/build-photos-section";

export function ReportScreen() {
  const {
    devRole,
    materials,
    builds,
    picker,
    reportValues,
    reasons,
    reportSaved,
    reportStep,
    editingReportId,
    savedReports,
    employees,
    selectedEmployeeId,
    employeePickerOpen,
    personStart,
    personEnd,
    timePicker,
    draftPeople,
    draftExtraCosts,
    draftKm,
    kmRate,
    setSelectedBuildId,
    setPicker,
    setReportValues,
    setReasons,
    setReportSaved,
    setReportStep,
    setSelectedEmployeeId,
    setEmployeePickerOpen,
    setPersonStart,
    setPersonEnd,
    setTimePicker,
    setDraftExtraCosts,
    setDraftKm,
    activeBuild,
    buildAssignments,
    buildMaterialPlans,
    saveDailyReport,
    addPersonToDraft,
    addExtraCostToDraft,
    removeExtraCostFromDraft,
    updateBuildPhotosUrl,
    setTab,
    warehouseBatches,
    setSelectedBatchId,
    setPlannedAmount,
    draftAssignments,
    addMaterialToDraft,
    updateDraftQuantity,
    removeFromDraft,
    commitAssignments,
    removeBuildAssignment,
  } = useAppData();

  const editingReport = editingReportId
    ? savedReports.find((report) => report.id === editingReportId)
    : undefined;
  const reportApproved = editingReport?.status === "approved";

  // Po pomyślnym zapisie raportu (reportSaved: false -> true, patrz
  // saveDailyReportUnsafe w app-data.tsx) wracamy do panelu głównego z
  // listą wszystkich raportów, zamiast zostawiać brygadzistę na ekranie
  // podsumowania. Efekt (nie samo onPress) celowo — saveDailyReport bywa
  // synchronicznie przerywane wcześniejszymi walidacjami (budowa
  // zamknięta, raport zatwierdzony), które NIE ustawiają reportSaved, więc
  // w tych przypadkach nawigacja się nie odpala.
  useEffect(() => {
    if (reportSaved) {
      setTab("savedReports");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportSaved]);

  // Edycja linku do zdjęć wybranej budowy (np. folder Google Drive) —
  // ten sam wzorzec co w builds-screen.tsx (Admin), tu dostępny dla
  // brygadzisty przy budowie, na której właśnie raportuje.
  const [editingPhotos, setEditingPhotos] = useState(false);
  const [photosUrlInput, setPhotosUrlInput] = useState("");

  // Ostrzeżenie o pustym kroku (materiały/zespół) przy próbie przejścia
  // dalej: pierwsze wciśnięcie "Dalej" na pustym kroku tylko pokazuje
  // komunikat i NIE przechodzi dalej — dopiero drugie wciśnięcie (mimo że
  // krok nadal jest pusty) przepuszcza. Flaga resetuje się przy każdym
  // wejściu na dany krok (patrz useEffect niżej), więc jeśli ktoś wróci
  // "Wstecz" i znowu wejdzie w ten sam krok, ostrzeżenie może się pojawić
  // ponownie.
  const [materialsWarningShown, setMaterialsWarningShown] = useState(false);
  const [teamWarningShown, setTeamWarningShown] = useState(false);
  useEffect(() => {
    if (reportStep === 1) setMaterialsWarningShown(false);
    if (reportStep === 2) setTeamWarningShown(false);
  }, [reportStep]);

  // Etapy technologii (Faza 6) — materiały budowy grupowane po etapie, na
  // podstawie dopasowania nazwy do build_material_plan (Faza 2); to samo
  // dopasowanie robi saveDailyReport w contexts/app-data.tsx przy zapisie
  // stage_name. Materiał bez dopasowania = "materiały pomocnicze".
  const [pomocniczeQuery, setPomocniczeQuery] = useState("");
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>({});
  // Dodawanie materiału pomocniczego z magazynu (np. tarcze, wałki) —
  // wyszukiwarka po partiach magazynowych, ten sam mechanizm co przy
  // ręcznym przypisywaniu materiałów do budowy w panelu Admina
  // (builds-screen.tsx: addToDraft/commitAssignments/warehouseBatches),
  // udostępniony tu brygadziście. Cenę partii (unitPrice) pomijamy w
  // widoku brygadzisty — tak samo jak reszta ekranu (renderMaterialRow)
  // pokazuje mu ilości, nie ceny.
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [addMaterialQuery, setAddMaterialQuery] = useState("");
  const planForActiveBuild = activeBuild
    ? buildMaterialPlans.filter((p) => p.buildId === Number(activeBuild.id))
    : [];
  const stageNameByMaterialName = new Map<string, string>();
  const stageOrder: string[] = [];
  const planByStage = new Map<string, typeof planForActiveBuild>();
  for (const p of planForActiveBuild) {
    const key = p.materialName.trim().toLowerCase();
    if (!stageNameByMaterialName.has(key)) stageNameByMaterialName.set(key, p.stageName);
    if (!stageOrder.includes(p.stageName)) stageOrder.push(p.stageName);
    if (!planByStage.has(p.stageName)) planByStage.set(p.stageName, []);
    planByStage.get(p.stageName)!.push(p);
  }
  const assignmentByMaterialName = new Map<string, (typeof buildAssignments)[number]>();
  for (const a of buildAssignments) {
    const name = materials.find((m) => m.id === a.materialId)?.name?.trim().toLowerCase();
    if (name) assignmentByMaterialName.set(name, a);
  }
  const pomocniczeAssignments: typeof buildAssignments = [];
  for (const a of buildAssignments) {
    const materialName = materials.find((m) => m.id === a.materialId)?.name?.trim().toLowerCase();
    const stage = materialName ? stageNameByMaterialName.get(materialName) : undefined;
    if (!stage) pomocniczeAssignments.push(a);
  }
  const filteredPomocnicze = pomocniczeAssignments.filter((a) => {
    if (!pomocniczeQuery.trim()) return true;
    const m = materials.find((x) => x.id === a.materialId);
    return `${m?.name ?? ""} ${m?.index ?? ""}`
      .toLowerCase()
      .includes(pomocniczeQuery.trim().toLowerCase());
  });

  // removable: tylko materiały pomocnicze (dodane ręcznie z magazynu w tym
  // raporcie) mają "✕" do cofnięcia pomyłki — materiały z planu technologii
  // przypisują się automatycznie przy przyjęciu zamówienia i nie da się ich
  // tak po prostu odpiąć od budowy.
  const renderMaterialRow = (
    a: (typeof buildAssignments)[number],
    i: number,
    removable: boolean,
  ) => {
    const m = materials.find((x) => x.id === a.materialId);
    const currentValue = Number(reportValues[a.materialId] || 0);
    const different =
      devRole === "Admin" &&
      reportValues[a.materialId] !== undefined &&
      currentValue !== a.planned;
    return (
      <View key={a.materialId}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 12,
            borderTopWidth: i > 0 ? 1 : 0,
            borderTopColor: COLORS.border,
          }}
        >
          {/* lewa kolumna — elastyczna, może się zwężać */}
          <View
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              paddingRight: 8,
            }}
          >
            <IconBadge name="layers" size={16} badgeSize={32} />
            <View
              style={{
                marginLeft: 8,
                flex: 1,
                minWidth: 0,
              }}
            >
              <Text className="text-sm font-semibold text-foreground" numberOfLines={2}>
                {m?.name || "Materiał usunięty z magazynu"}
              </Text>
              <Text className="text-xs text-muted mt-0.5" numberOfLines={2}>
                {!m
                  ? `ID: ${a.materialId}`
                  : devRole === "Admin"
                    ? `plan ${a.planned} ${m.unit} · pozostało ${Math.max(0, a.planned - currentValue)} ${m.unit}`
                    : "Materiał przypisany do budowy"}
              </Text>
            </View>
          </View>

          {/* prawa kolumna — sztywna szerokość steppera */}
          <QuantityStepper
            disabled={reportApproved}
            value={reportValues[a.materialId] || "0"}
            unit={m?.unit}
            onChangeText={(v) =>
              setReportValues({
                ...reportValues,
                [a.materialId]: v,
              })
            }
          />
          {removable && !reportApproved && (
            <Pressable
              onPress={() =>
                confirmAction(
                  "Usunąć materiał?",
                  `Materiał "${m?.name ?? ""}" zostanie odpięty od budowy, a przydzielona ilość wróci do magazynu.`,
                  "Usuń",
                  () => {
                    if (activeBuild) removeBuildAssignment(activeBuild.id, a.materialId);
                  },
                )
              }
              hitSlop={8}
              style={{ marginLeft: 8 }}
            >
              <MaterialIcons name="close" size={18} color={COLORS.muted} />
            </Pressable>
          )}
        </View>
        {devRole === "Admin" && currentValue > a.planned && (
          // Ostrzeżenie tylko dla Admina — Brygadzista i tak wpisuje
          // realne zużycie z budowy, zna założony plan i nie potrzebuje
          // appki oceniającej, czy się w nim zmieścił (dotyczy zarówno
          // materiałów z technologii, jak i pomocniczych — obie sekcje
          // renderują się przez tę samą funkcję).
          <Text
            style={{
              color: COLORS.warning,
              fontSize: 11,
              marginTop: -4,
              marginBottom: 8,
            }}
          >
            ⚠ Przekracza plan o {(currentValue - a.planned).toFixed(2)} {m?.unit}
          </Text>
        )}
        {different && (
          <Field
            editable={!reportApproved}
            placeholder="Dlaczego wystąpiła różnica?"
            value={reasons[a.materialId] || ""}
            onChangeText={(v: string) => setReasons({ ...reasons, [a.materialId]: v })}
          />
        )}
      </View>
    );
  };

  return (
    <>
      <ScreenHeader
        title="Zużycie dzienne"
        action={
          !reportApproved ? (
            <Button
              label="Anuluj"
              secondary
              onPress={() =>
                confirmAction(
                  "Anulować raport?",
                  "Niezapisane zmiany w tym raporcie zostaną utracone.",
                  "Anuluj raport",
                  () => setTab("savedReports"),
                )
              }
            />
          ) : undefined
        }
      />

      <ReportStepper step={reportStep} />

      <View className="bg-surface border border-border rounded-2xl overflow-hidden">
        {reportApproved && (
          <View
            style={{
              backgroundColor: COLORS.successBg,
              borderRadius: 12,
              padding: 13,
              margin: 16,
              marginBottom: 0,
            }}
          >
            <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
              Raport zatwierdzony przez administratora — edycja zablokowana.
            </Text>
          </View>
        )}

        {reportStep === 1 && (
          <>
            <View className="p-4 flex-row items-center gap-3">
              <IconBadge name="business" />
              <Pressable
                disabled={reportApproved}
                onPress={() => {
                  if (reportApproved) return;
                  setPicker(picker === "build" ? null : "build");
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                    Budowa
                  </Text>
                  <Text
                    style={{
                      color: COLORS.foreground,
                      fontWeight: "700",
                      marginTop: 2,
                    }}
                  >
                    {activeBuild?.number}
                  </Text>
                  <Text
                    style={{
                      color: COLORS.muted,
                      fontSize: 12,
                      marginTop: 1,
                    }}
                    numberOfLines={2}
                  >
                    {activeBuild?.name}
                  </Text>
                </View>
                <MaterialIcons
                  name={picker === "build" ? "expand-less" : "chevron-right"}
                  size={22}
                  color={COLORS.primary}
                />
              </Pressable>
            </View>

            {picker === "build" && (
              <View
                style={{
                  backgroundColor: COLORS.background,
                  borderRadius: 10,
                  padding: 10,
                  marginHorizontal: 16,
                  marginBottom: 16,
                }}
              >
                <ScrollView
                  style={{ maxHeight: 180 }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  {builds
                    .filter((b) => b.status !== "zamknięta")
                    .map((b) => (
                    <Pressable
                      disabled={reportApproved}
                      key={b.id}
                      onPress={() => {
                        setSelectedBuildId(b.id);
                        setPicker(null);
                        setReportValues({});
                        setDraftExtraCosts([]);
                        setReportSaved(false);
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

            {/* Zdjęcia budowy — zwykły link (np. Google Drive), wklejany
                ręcznie. Kliknięcie otwiera go poza aplikacją. */}
            <View
              className="border-t border-border p-4"
              style={{ paddingBottom: editingPhotos ? 16 : 14 }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: COLORS.muted, fontSize: 11 }}>ZDJĘCIA BUDOWY</Text>
                {/* Link do zewnętrznego katalogu (Drive) i jego zmiana są
                    tylko dla Admina — Brygadzista dołącza zdjęcia z poziomu
                    apki (BuildPhotosSection niżej) i nie musi ani nie
                    powinien widzieć/zmieniać samego folderu. */}
                {devRole !== "Brygadzista" && (
                  <Pressable
                    disabled={reportApproved || !activeBuild}
                    onPress={() => {
                      setEditingPhotos(!editingPhotos);
                      setPhotosUrlInput(activeBuild?.photosUrl || "");
                    }}
                  >
                    <Text
                      style={{
                        color: reportApproved ? COLORS.muted : COLORS.primary,
                        fontSize: 13,
                        fontWeight: "700",
                      }}
                    >
                      {editingPhotos
                        ? "Zwiń"
                        : activeBuild?.photosUrl
                          ? "Zmień"
                          : "+ Dodaj link"}
                    </Text>
                  </Pressable>
                )}
              </View>
              {devRole !== "Brygadzista" && editingPhotos && (
                <View style={{ marginTop: 10 }}>
                  <Field
                    placeholder="https://drive.google.com/..."
                    value={photosUrlInput}
                    onChangeText={setPhotosUrlInput}
                    autoCapitalize="none"
                  />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Anuluj"
                        secondary
                        onPress={() => setEditingPhotos(false)}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Zapisz link"
                        onPress={() => {
                          if (!activeBuild) return;
                          updateBuildPhotosUrl(
                            activeBuild.id,
                            photosUrlInput.trim(),
                          );
                          setEditingPhotos(false);
                        }}
                      />
                    </View>
                  </View>
                </View>
              )}
              {/* Dołączanie i przeglądanie zdjęć budowy — w całości w apce
                  (lib/data/drive-photos.ts + components/build-photos-section.tsx),
                  bez logowania do Google Drive. Wymaga, żeby Admin wcześniej
                  stworzył katalog (builds-screen.tsx), inaczej komponent
                  pokaże czytelny komunikat zamiast przycisków. */}
              {activeBuild && !reportApproved && (
                <View style={{ marginTop: 12 }}>
                  <BuildPhotosSection
                    buildId={Number(activeBuild.id)}
                    driveFolderUrl={activeBuild.photosUrl ?? null}
                    showFolderLink={devRole !== "Brygadzista"}
                  />
                </View>
              )}
            </View>

            {/* Etapy technologii (Faza 6) — rozwijana lista, materiały etapu
                z pełnego planu (nie tylko już dostarczone), plan vs
                zużyto dzisiaj. Bez oznaczania "zakończenia" etapu — to
                raportowanie zużycia, nie postępu; budowę zamyka Admin
                (Faza 9). */}
            {stageOrder.length > 0 && (
              <View className="border-t border-border p-4">
                <Text className="text-xs text-muted uppercase mb-2">Technologia</Text>
                {stageOrder.map((stageName) => {
                  const stagePlan = planByStage.get(stageName) ?? [];
                  const isCollapsed = collapsedStages[stageName] ?? true;
                  return (
                    <View
                      key={stageName}
                      style={{
                        backgroundColor: COLORS.background,
                        borderRadius: 12,
                        padding: 12,
                        marginTop: 8,
                      }}
                    >
                      <Pressable
                        onPress={() =>
                          setCollapsedStages({
                            ...collapsedStages,
                            [stageName]: !isCollapsed,
                          })
                        }
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}>
                          {stageName}
                        </Text>
                        <Text style={{ color: COLORS.primary }}>{isCollapsed ? "▼" : "▲"}</Text>
                      </Pressable>

                      {!isCollapsed && (
                        <View style={{ marginTop: 8 }}>
                          {stagePlan.map((p, i) => {
                            const assignment = assignmentByMaterialName.get(
                              p.materialName.trim().toLowerCase(),
                            );
                            if (assignment) return renderMaterialRow(assignment, i, false);
                            return (
                              <View
                                key={p.id}
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  paddingVertical: 12,
                                  borderTopWidth: i > 0 ? 1 : 0,
                                  borderTopColor: COLORS.border,
                                }}
                              >
                                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                  <Text
                                    className="text-sm font-semibold text-foreground"
                                    numberOfLines={2}
                                  >
                                    {p.materialName}
                                  </Text>
                                  <Text className="text-xs text-muted mt-0.5">
                                    plan {p.plannedQuantity} {p.unit} · oczekuje na dostawę
                                  </Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Materiały pomocnicze — spoza planu technologii (przypisane
                ręcznie, Faza 5); wyszukiwarka przydaje się, gdy lista
                urośnie. */}
            <View className="border-t border-border p-4">
              <Text className="text-xs text-muted uppercase mb-2">
                {stageOrder.length > 0 ? "Materiały pomocnicze" : "Materiały"}
              </Text>
              {pomocniczeAssignments.length > 3 && (
                <Field
                  placeholder="Szukaj po nazwie lub indeksie"
                  value={pomocniczeQuery}
                  onChangeText={setPomocniczeQuery}
                  style={{ marginBottom: 8 }}
                />
              )}
              {filteredPomocnicze.map((a, i) => renderMaterialRow(a, i, true))}
              {pomocniczeAssignments.length === 0 && (
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                  Brak materiałów pomocniczych przypisanych do budowy.
                </Text>
              )}

              {!reportApproved && (
                <View style={{ marginTop: 12 }}>
                  <Pressable
                    onPress={() => {
                      setAddMaterialOpen(!addMaterialOpen);
                      setAddMaterialQuery("");
                      setSelectedBatchId(null);
                      setPlannedAmount("");
                    }}
                    style={{
                      borderWidth: 1,
                      borderColor: COLORS.primary,
                      borderRadius: 10,
                      paddingVertical: 11,
                      alignItems: "center",
                      flexDirection: "row",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <MaterialIcons
                      name={addMaterialOpen ? "expand-less" : "add-circle-outline"}
                      size={18}
                      color={COLORS.primary}
                    />
                    <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
                      Dodaj materiał z magazynu
                    </Text>
                  </Pressable>

                  {addMaterialOpen && (
                    <View
                      style={{
                        backgroundColor: COLORS.background,
                        borderRadius: 10,
                        padding: 10,
                        marginTop: 8,
                      }}
                    >
                      <Field
                        placeholder="Szukaj po nazwie lub indeksie (np. tarcze, wałki)"
                        value={addMaterialQuery}
                        onChangeText={setAddMaterialQuery}
                      />
                      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                        {warehouseBatches
                          .map((b) => ({
                            batch: b,
                            material: materials.find(
                              (m) => m.id === String(b.materialId),
                            ),
                          }))
                          .filter(({ material }) => material)
                          .filter(({ material }) =>
                            `${material!.name} ${material!.index}`
                              .toLowerCase()
                              .includes(addMaterialQuery.trim().toLowerCase()),
                          )
                          .sort((a, b) =>
                            a.material!.name.localeCompare(b.material!.name),
                          )
                          .map(({ batch, material }) => {
                            const alreadyAdded = draftAssignments.some(
                              (a) => a.batchId === String(batch.id),
                            );
                            return (
                              <Pressable
                                key={batch.id}
                                disabled={alreadyAdded}
                                onPress={() => addMaterialToDraft(String(batch.id))}
                                style={{
                                  paddingVertical: 12,
                                  borderBottomWidth: 1,
                                  borderBottomColor: COLORS.border,
                                  backgroundColor: alreadyAdded
                                    ? COLORS.successBg
                                    : "transparent",
                                  borderRadius: alreadyAdded ? 8 : 0,
                                  paddingHorizontal: alreadyAdded ? 8 : 0,
                                  opacity: alreadyAdded ? 0.6 : 1,
                                }}
                              >
                                <Text
                                  style={{ color: COLORS.foreground, fontWeight: "700" }}
                                >
                                  {material!.name}
                                  {alreadyAdded ? " · dodano" : ""}
                                </Text>
                                <Text
                                  style={{
                                    color: COLORS.muted,
                                    fontSize: 12,
                                    marginTop: 3,
                                  }}
                                >
                                  {material!.index} · dostępne {batch.quantity}{" "}
                                  {material!.unit}
                                </Text>
                              </Pressable>
                            );
                          })}
                        {warehouseBatches.length === 0 && (
                          <Text
                            style={{ color: COLORS.muted, fontSize: 12, padding: 10 }}
                          >
                            Brak partii w magazynie.
                          </Text>
                        )}
                      </ScrollView>

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
                            return (
                              <View
                                key={draft.batchId}
                                style={{
                                  flexDirection: "row",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  paddingVertical: 8,
                                  borderBottomWidth: 1,
                                  borderBottomColor: COLORS.border,
                                  gap: 8,
                                }}
                              >
                                <Text
                                  className="text-xs text-foreground"
                                  style={{ flex: 1 }}
                                  numberOfLines={1}
                                >
                                  {material?.name}
                                </Text>
                                <QuantityStepper
                                  value={draft.quantity ? String(draft.quantity) : ""}
                                  onChangeText={(v) => updateDraftQuantity(draft.batchId, v)}
                                  unit={material?.unit}
                                />
                                <Pressable
                                  onPress={() => removeFromDraft(draft.batchId)}
                                  hitSlop={8}
                                >
                                  <MaterialIcons
                                    name="close"
                                    size={18}
                                    color={COLORS.muted}
                                  />
                                </Pressable>
                              </View>
                            );
                          })}
                          <View style={{ marginTop: 12 }}>
                            <Button
                              label={`Przypisz ${draftAssignments.length} do budowy`}
                              onPress={async () => {
                                await commitAssignments();
                                setAddMaterialOpen(false);
                              }}
                            />
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>

            <View className="border-t border-border p-4">
              <Text className="text-xs text-muted uppercase mb-2">
                Kilometrówka
              </Text>
              <Field
                placeholder="Liczba km"
                keyboardType="numeric"
                value={draftKm}
                editable={!reportApproved}
                onChangeText={setDraftKm}
                style={{ marginTop: 0 }}
              />
              {!!draftKm && kmRate > 0 && (
                <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>
                  {(Number(draftKm.replace(",", ".")) || 0).toString()} km ×{" "}
                  {kmRate.toFixed(2)} zł/km ≈{" "}
                  {((Number(draftKm.replace(",", ".")) || 0) * kmRate).toFixed(2)} zł
                </Text>
              )}
            </View>

            <View className="border-t border-border p-4">
              <Text className="text-xs text-muted uppercase mb-2">
                Dodatkowe koszty
              </Text>
              <ExtraCostsSection
                costs={draftExtraCosts}
                disabled={reportApproved}
                onAdd={addExtraCostToDraft}
                onRemove={removeExtraCostFromDraft}
              />
            </View>
          </>
        )}

        {reportStep === 2 && (
          <View className="p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-muted uppercase">
                Osoby pracujące
              </Text>
              {draftPeople.length > 0 && (
                <Text className="text-xs text-primary font-bold">
                  {draftPeople.length}
                </Text>
              )}
            </View>

            {draftPeople.length > 0 && (
              <View style={{ marginTop: 10 }}>
                {draftPeople.map((person, i) => {
                  const employee = employees.find(
                    (item) => item.id === person.employeeId,
                  );
                  return (
                    <View
                      key={person.employeeId}
                      className={`flex-row items-center justify-between py-2 ${i > 0 ? "border-t border-border" : ""}`}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          flex: 1,
                          minWidth: 0,
                          paddingRight: 8,
                        }}
                      >
                        <IconBadge name="person" size={18} badgeSize={32} />
                        <Text
                          className="text-sm text-foreground"
                          numberOfLines={1}
                          style={{
                            marginLeft: 10,
                            fontWeight: "700",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {employee?.name}
                        </Text>
                      </View>
                      <Text
                        className="text-sm text-muted"
                        style={{ flexShrink: 0 }}
                      >
                        {person.start}–{person.end}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={{ marginTop: draftPeople.length ? 14 : 10 }}>
              <Pressable
                disabled={reportApproved}
                onPress={() => setEmployeePickerOpen(!employeePickerOpen)}
                style={{
                  backgroundColor: COLORS.background,
                  borderRadius: 10,
                  padding: 12,
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Text
                  style={{
                    color: COLORS.foreground,
                    fontWeight: "600",
                    fontSize: 13,
                    flex: 1,
                    minWidth: 0,
                  }}
                  numberOfLines={1}
                >
                  {employees.find(
                    (employee) => employee.id === selectedEmployeeId,
                  )?.name || "Wybierz pracownika"}
                </Text>
                <Text style={{ color: COLORS.primary, marginLeft: 8 }}>
                  {employeePickerOpen ? "▲" : "▼"}
                </Text>
              </Pressable>

              {employeePickerOpen && (
                <View
                  style={{
                    backgroundColor: COLORS.background,
                    borderRadius: 10,
                    padding: 8,
                    marginTop: 6,
                  }}
                >
                  {employees.map((employee) => (
                    <Pressable
                      disabled={reportApproved}
                      key={employee.id}
                      onPress={() => {
                        setSelectedEmployeeId(employee.id);
                        setEmployeePickerOpen(false);
                      }}
                      style={{
                        paddingVertical: 11,
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
                        {employee.name}
                      </Text>
                      <Text
                        style={{
                          color: COLORS.muted,
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {employee.role}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Pressable
                    disabled={reportApproved}
                    onPress={() =>
                      setTimePicker(timePicker === "start" ? null : "start")
                    }
                    style={{
                      backgroundColor: COLORS.background,
                      borderRadius: 10,
                      padding: 11,
                      borderWidth: 1,
                      borderColor:
                        timePicker === "start"
                          ? COLORS.primary
                          : COLORS.background,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View>
                      <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                        OD
                      </Text>
                      <Text
                        style={{
                          color: personStart ? COLORS.foreground : COLORS.muted,
                          fontWeight: "700",
                          marginTop: 2,
                        }}
                      >
                        {personStart || "— : —"}
                      </Text>
                    </View>
                    <MaterialIcons
                      name="schedule"
                      size={18}
                      color={COLORS.primary}
                    />
                  </Pressable>
                  {timePicker === "start" && (
                    <TimeOptionsList
                      disabled={reportApproved}
                      value={personStart}
                      onSelect={(time) => {
                        setPersonStart(time);
                        setTimePicker(null);
                        AsyncStorage.setItem(
                          "lastPersonTime",
                          JSON.stringify({
                            start: time,
                            end: personEnd,
                          }),
                        );
                      }}
                    />
                  )}
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Pressable
                    disabled={reportApproved}
                    onPress={() =>
                      setTimePicker(timePicker === "end" ? null : "end")
                    }
                    style={{
                      backgroundColor: COLORS.background,
                      borderRadius: 10,
                      padding: 11,
                      borderWidth: 1,
                      borderColor:
                        timePicker === "end"
                          ? COLORS.primary
                          : COLORS.background,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View>
                      <Text style={{ color: COLORS.muted, fontSize: 10 }}>
                        DO
                      </Text>
                      <Text
                        style={{
                          color: personEnd ? COLORS.foreground : COLORS.muted,
                          fontWeight: "700",
                          marginTop: 2,
                        }}
                      >
                        {personEnd || "— : —"}
                      </Text>
                    </View>
                    <MaterialIcons
                      name="schedule"
                      size={18}
                      color={COLORS.primary}
                    />
                  </Pressable>
                  {timePicker === "end" && (
                    <TimeOptionsList
                      disabled={reportApproved}
                      value={personEnd}
                      onSelect={(time) => {
                        setPersonEnd(time);
                        setTimePicker(null);
                        AsyncStorage.setItem(
                          "lastPersonTime",
                          JSON.stringify({
                            start: personStart,
                            end: time,
                          }),
                        );
                      }}
                    />
                  )}
                </View>
              </View>

              {!reportApproved && (
                <Pressable
                  onPress={addPersonToDraft}
                  style={({ pressed }) => ({
                    borderWidth: 1,
                    borderColor: COLORS.primary,
                    borderRadius: 12,
                    paddingVertical: 13,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    opacity: pressed ? 0.7 : 1,
                    marginTop: 10,
                  })}
                >
                  <MaterialIcons
                    name="add-circle-outline"
                    size={20}
                    color={COLORS.primary}
                  />
                  <Text style={{ color: COLORS.primary, fontWeight: "700" }}>
                    Dodaj osobę
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {reportStep === 3 && (
          <View className="p-4">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <IconBadge name="business" size={18} badgeSize={32} />
              <View style={{ marginLeft: 12, flex: 1, minWidth: 0 }}>
                <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                  Budowa
                </Text>
                <Text
                  style={{
                    color: COLORS.foreground,
                    fontWeight: "700",
                    marginTop: 2,
                  }}
                  numberOfLines={2}
                >
                  {activeBuild?.number} · {activeBuild?.name}
                </Text>
              </View>
            </View>

            <Text className="text-xs text-muted uppercase mt-5 mb-1">
              Materiały
            </Text>
            {buildAssignments.map((a, i) => {
              const m = materials.find((x) => x.id === a.materialId);
              return (
                <View
                  key={a.materialId}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 8,
                    borderTopWidth: i > 0 ? 1 : 0,
                    borderTopColor: COLORS.border,
                  }}
                >
                  <Text
                    className="text-sm text-foreground"
                    numberOfLines={2}
                    style={{ flex: 1, minWidth: 0, marginRight: 8 }}
                  >
                    {m?.name || "Materiał usunięty z magazynu"}
                  </Text>
                  <Text
                    className="text-sm font-bold text-foreground"
                    style={{ flexShrink: 0 }}
                  >
                    {reportValues[a.materialId] || "0"} {m?.unit}
                  </Text>
                </View>
              );
            })}

            {!!draftKm && (
              <>
                <Text className="text-xs text-muted uppercase mt-5 mb-1">
                  Kilometrówka
                </Text>
                <Text className="text-sm text-foreground">
                  {draftKm} km
                  {kmRate > 0
                    ? ` × ${kmRate.toFixed(2)} zł/km ≈ ${(
                        (Number(draftKm.replace(",", ".")) || 0) * kmRate
                      ).toFixed(2)} zł`
                    : ""}
                </Text>
              </>
            )}

            {draftExtraCosts.length > 0 && (
              <>
                <Text className="text-xs text-muted uppercase mt-5 mb-1">
                  Dodatkowe koszty
                </Text>
                <ExtraCostsSection
                  costs={draftExtraCosts}
                  disabled
                  onAdd={() => {}}
                  onRemove={() => {}}
                />
              </>
            )}

            <Text className="text-xs text-muted uppercase mt-5 mb-1">
              Zespół
            </Text>
            {draftPeople.length === 0 ? (
              <Text className="text-sm text-muted py-2">
                Nie dodano jeszcze osób.
              </Text>
            ) : (
              draftPeople.map((person, i) => {
                const employee = employees.find(
                  (item) => item.id === person.employeeId,
                );
                return (
                  <View
                    key={person.employeeId}
                    className={`flex-row items-center justify-between py-2 ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <Text
                      className="text-sm text-foreground"
                      numberOfLines={1}
                      style={{ flex: 1, minWidth: 0, marginRight: 8 }}
                    >
                      {employee?.name}
                    </Text>
                    <Text
                      className="text-sm text-muted"
                      style={{ flexShrink: 0 }}
                    >
                      {person.start}–{person.end}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>

      {reportSaved && (
        <View
          style={{
            backgroundColor: COLORS.successBg,
            borderRadius: 12,
            padding: 13,
            marginTop: 16,
          }}
        >
          <Text
            style={{
              color: COLORS.foreground,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            Raport zapisany — materiały zdjęte z magazynu, godziny zapisane
          </Text>
        </View>
      )}

      {reportStep === 3 && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginTop: 16,
          }}
        >
          <MaterialIcons
            name="check-circle"
            size={18}
            color={COLORS.success}
          />
          <Text
            style={{ color: COLORS.muted, fontSize: 13, flex: 1, minWidth: 0 }}
          >
            Gotowe do zapisania · {draftPeople.length}{" "}
            {draftPeople.length === 1 ? "osoba" : "osoby"} ·{" "}
            {buildAssignments.length}{" "}
            {buildAssignments.length === 1 ? "materiał" : "materiały"}
          </Text>
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
        {reportStep > 1 && (
          <View style={{ flex: 1 }}>
            <Button
              label="Wstecz"
              secondary
              fullWidth
              onPress={() => setReportStep((reportStep - 1) as 1 | 2)}
            />
          </View>
        )}
        <View style={{ flex: 2 }}>
          {reportStep < 3 ? (
            <Button
              label="Dalej"
              fullWidth
              onPress={() => {
                if (reportStep === 1) {
                  const anyMaterialFilled = buildAssignments.some(
                    (a) => Number(reportValues[a.materialId] || 0) > 0,
                  );
                  if (
                    buildAssignments.length > 0 &&
                    !anyMaterialFilled &&
                    !materialsWarningShown
                  ) {
                    setMaterialsWarningShown(true);
                    notify(
                      "Brak wpisanych materiałów",
                      "Nie wpisano zużycia żadnego materiału. Wciśnij „Dalej” ponownie, aby mimo to przejść dalej.",
                    );
                    return;
                  }
                } else if (
                  reportStep === 2 &&
                  draftPeople.length === 0 &&
                  !teamWarningShown
                ) {
                  setTeamWarningShown(true);
                  notify(
                    "Brak dodanych osób",
                    "Nie dodano nikogo do zespołu. Wciśnij „Dalej” ponownie, aby mimo to przejść dalej.",
                  );
                  return;
                }
                setReportStep((reportStep + 1) as 2 | 3);
              }}
            />
          ) : reportApproved ? (
            <Text
              style={{
                color: COLORS.success,
                fontWeight: "700",
                textAlign: "center",
                paddingVertical: 14,
              }}
            >
              Raport zatwierdzony
            </Text>
          ) : (
            <Button
              label={
                reportSaved
                  ? "Zapisano raport"
                  : editingReportId
                    ? "Zapisz zmiany"
                    : "Zapisz raport dzienny"
              }
              fullWidth
              onPress={saveDailyReport}
            />
          )}
        </View>
      </View>
    </>
  );
}
