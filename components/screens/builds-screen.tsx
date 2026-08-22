import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { DateField } from "@/components/date-field";
import {
  COLORS,
  addDaysISO,
  Button,
  confirmAction,
  Field,
  formatPLN,
  IconBadge,
  QuantityStepper,
  ReportCard,
  ScreenHeader,
  StatusBadge,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

export function BuildsScreen() {
  const {
    materials,
    builds,
    technologies,
    buildTechnologySnapshots,
    buildMaterialPlans,
    assignBuildTechnology,
    assignments,
    savedReports,
    employees,
    timeEntries,
    buildMaterialActualCost,
    showBuild,
    showAssignment,
    selectedBuildId,
    selectedMaterialId,
    plannedAmount,
    picker,
    pickerQuery,
    draftAssignments,
    newBuild,
    workdayHours,
    setShowBuild,
    setShowAssignment,
    setSelectedBuildId,
    setSelectedMaterialId,
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
  } = useAppData();

  const isArchiveView = buildsView === "archive";

  // Które budowy mają rozwiniętą sekcję raportów, i który konkretny raport
  // (w obrębie dowolnej budowy) jest rozwinięty — jeden na raz wystarcza.
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
  // Przypisanie/zmiana technologii (Faza 2) — jeden picker na raz, ten
  // sam wzorzec co edycja linku do zdjęć powyżej.
  const [techEditBuildId, setTechEditBuildId] = useState<string | null>(null);
  const [techPickerId, setTechPickerId] = useState<number | null>(null);
  const [techAreaInput, setTechAreaInput] = useState("");
  const [techBusy, setTechBusy] = useState(false);
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
  const visibleBuilds = buildsView === "active" ? activeBuilds : archivedBuilds;

  return (
    <>
  <>
    <View className="flex-row justify-between items-start mb-5">
      <ScreenHeader
        eyebrow={isArchiveView ? "REALIZACJA / ARCHIWUM" : "REALIZACJA / BUDOWY"}
        title={isArchiveView ? "Archiwum budów" : "Budowy"}
      />
      {!isArchiveView && (
        <Button label="+ Nowa" onPress={() => setShowBuild(!showBuild)} />
      )}
    </View>
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
        <QuantityStepper
          value={newBuild.contractValue}
          onChangeText={(v: string) =>
            setNewBuild({ ...newBuild, contractValue: v })
          }
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
        <Text className="text-xs text-muted uppercase mt-4">
          Materiał
        </Text>
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
            <Text
              style={{ color: COLORS.foreground, fontWeight: "700" }}
            >
              {materials.find((m) => m.id === selectedMaterialId)
                ?.name || "Wybierz materiał"}
            </Text>
            <Text
              style={{
                color: COLORS.muted,
                fontSize: 12,
                marginTop: 3,
              }}
            >
              {
                materials.find((m) => m.id === selectedMaterialId)
                  ?.index
              }
            </Text>
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
            <ScrollView style={{ maxHeight: 220 }}>
              {materials
                .filter((m) =>
                  `${m.name} ${m.index}`
                    .toLowerCase()
                    .includes(pickerQuery.toLowerCase()),
                )
                .map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      setSelectedMaterialId(m.id);
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
                      {m.name}
                    </Text>
                    <Text
                      style={{
                        color: COLORS.muted,
                        fontSize: 12,
                        marginTop: 3,
                      }}
                    >
                      {m.index} · stan: {m.stock} {m.unit}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        )}
        <Text className="text-xs text-muted uppercase mt-4">
          Ilość planowana
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
              return (
                <View
                  key={draft.materialId}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.border,
                  }}
                >
                  <Text className="text-xs text-foreground">
                    {material?.name}
                  </Text>
                  <Text className="text-xs text-primary font-bold">
                    {draft.planned} {material?.unit}
                  </Text>
                </View>
              );
            })}
            <View style={{ marginTop: 12 }}>
              <Button
                label={`Zatwierdź ${draftAssignments.length} materiałów`}
                onPress={commitAssignments}
              />
            </View>
          </View>
        )}
      </View>
    )}
    {isArchiveView && archivedBuilds.length > 0 && (
      <Text className="text-xs text-muted uppercase mb-3">
        Zamkniętych budów: {archivedBuilds.length}
      </Text>
    )}
    {visibleBuilds.length === 0 && (
      <View className="bg-surface border border-border rounded-2xl p-5 items-center">
        <Text className="text-sm text-muted">
          {isArchiveView
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

          {/* Zdjęcia budowy — na razie zwykły link (np. do udostępnionego
              folderu na Google Drive), wklejany ręcznie. Kliknięcie
              otwiera go w przeglądarce/apce Drive, nie w ERP. */}
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
              {b.photosUrl ? (
                <Pressable
                  onPress={() => Linking.openURL(b.photosUrl!)}
                  style={{ flex: 1, marginRight: 8 }}
                >
                  <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                    ZDJĘCIA
                  </Text>
                  <Text
                    style={{
                      color: COLORS.primary,
                      fontWeight: "700",
                      fontSize: 13,
                      marginTop: 2,
                    }}
                    numberOfLines={1}
                  >
                    Otwórz folder ↗
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ color: COLORS.muted, fontSize: 12, flex: 1 }}>
                  Brak linku do zdjęć.
                </Text>
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
                      ? "Zmień"
                      : "+ Dodaj link"}
                </Text>
              </Pressable>
            </View>
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
          </View>

          {isClosed && b.settlement ? (
            <View
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTopWidth: 1,
                borderTopColor: COLORS.border,
              }}
            >
              <Text className="text-xs text-muted uppercase mb-3">
                Rozliczenie końcowe · zamknięto{" "}
                {b.settlement.closedAt.slice(0, 10)}
              </Text>
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
            </View>
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
                <View
                  style={{
                    marginTop: 16,
                    paddingTop: 16,
                    borderTopWidth: 1,
                    borderTopColor: COLORS.border,
                  }}
                >
                  <Text className="text-xs text-muted uppercase mb-3">
                    Koszty na bieżąco
                  </Text>
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
                </View>
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

          {!isClosed && (
            <View style={{ marginTop: 18 }}>
              <Button
                label="Zamknij i rozlicz budowę"
                secondary
                disabled={pendingCount > 0}
                onPress={() =>
                  confirmAction(
                    "Zamknąć budowę?",
                    `Budowa ${b.number} zostanie oznaczona jako zamknięta i policzone zostanie jej finalne rozliczenie. Tej operacji nie da się cofnąć w prosty sposób.`,
                    "Zamknij budowę",
                    () => closeBuild(b.id),
                  )
                }
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
            </View>
          )}
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
