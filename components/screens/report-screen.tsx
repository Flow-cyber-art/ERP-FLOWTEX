import AsyncStorage from "@react-native-async-storage/async-storage";
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
  pluralPL,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import { BuildPhotosSection } from "@/components/build-photos-section";
import { BuildStockSection } from "@/components/build-stock-section";
import { materialReportKey } from "@/lib/material-report-key";
import { RADIUS } from "@/constants/radius";
import { Icon } from "@/components/icon";
import { TECHNOLOGY_UNIT_LABEL } from "@/lib/data/technologies";

export function ReportScreen() {
  const [stockOpen, setStockOpen] = useState(false);
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
    addAllEmployeesToDraft,
    draftExtraCosts,
    draftKm,
    draftNote,
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
    setDraftNote,
    activeBuild,
    buildAssignments,
    buildMaterialPlans,
    buildStageStatuses,
    completeBuildStage,
    reopenBuildStage,
    saveDailyReport,
    getReportDefaults,
    addPersonToDraft,
    removePersonFromDraft,
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
    isSubcontractorLead,
    mySubcontractorBuildTeam,
    buildTechnologySnapshots,
    draftStageProgress,
    setDraftStageProgress,
    isAdminAccount,
    draftReportTeamId,
    setDraftReportTeamId,
    buildTeams,
    teams,
    teamSubcontractorMap,
  } = useAppData();

  // Tryb podwykonawcy (supabase/sql/112_podwykonawcy_raport_i_brygady_
  // budowy.sql): brygadzista brygady podwykonawcy raportuje tylko na
  // budowach, do których jego brygada jest przypisana, tylko etapy ze
  // swojego zakresu, bez osób/godzin, kilometrówki i kosztów dodatkowych
  // — za to z wykonaną dziś ilością per etap (krok 2 "Wykonane").
  // Admin (w widoku brygadzisty) może też raportować ZA podwykonawcę bez
  // konta w aplikacji — wybór "Raport za" niżej (115).
  const adminForSub = isAdminAccount && !isSubcontractorLead && draftReportTeamId != null;
  const subMode = isSubcontractorLead || adminForSub;
  const subBuildTeam = isSubcontractorLead
    ? mySubcontractorBuildTeam(activeBuild?.id)
    : adminForSub
      ? buildTeams.find(
          (bt) => String(bt.buildId) === String(activeBuild?.id) && bt.teamId === draftReportTeamId,
        ) ?? null
      : null;
  // Ekipy podwykonawców przypisane do wybranej budowy — do wyboru "Raport za".
  const subTeamsOnBuild = buildTeams
    .filter((bt) => String(bt.buildId) === String(activeBuild?.id) && teamSubcontractorMap.get(bt.teamId) != null)
    .map((bt) => ({ teamId: bt.teamId, name: teams.find((t) => t.id === bt.teamId)?.name ?? `Brygada #${bt.teamId}` }));
  const subScope = subBuildTeam?.stageNames ?? null;
  const stageInScope = (stageName: string) =>
    !subMode || !subScope || subScope.includes(stageName);
  const activeSnapshot = buildTechnologySnapshots.find(
    (s) => String(s.buildId) === String(activeBuild?.id),
  );
  const buildUnitLabel = TECHNOLOGY_UNIT_LABEL[activeSnapshot?.unit ?? "m2"];
  const reportableBuilds = builds.filter(
    (b) =>
      b.status !== "zamknięta" && (!isSubcontractorLead || mySubcontractorBuildTeam(b.id) !== null),
  );
  // Podwykonawca nie może zostać na budowie spoza swojego przydziału
  // (domyślnie wybrana jest pierwsza budowa z listy) — przeskok na
  // pierwszą przypisaną, o ile nie edytuje już zapisanego raportu.
  useEffect(() => {
    if (!isSubcontractorLead || subBuildTeam || editingReportId) return;
    const first = reportableBuilds[0];
    if (first && first.id !== activeBuild?.id) {
      setSelectedBuildId(first.id);
      setReportValues(getReportDefaults(first.id));
      setDraftStageProgress({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubcontractorLead, subBuildTeam, editingReportId, reportableBuilds.length]);
  // Zmiana budowy przez Admina: wybrana ekipa podwykonawcy może nie być na
  // nowej budowie — wtedy wracamy do raportu brygady własnej.
  useEffect(() => {
    if (adminForSub && !subBuildTeam) setDraftReportTeamId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBuild?.id]);

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
  // Jeden wiersz per (materiał, etap) — dokładnie te same klucze, co
  // faktyczne pola na ekranie (renderMaterialRow) — do kroku 3
  // (podsumowanie) i walidacji "czy coś wpisano". Bez tego materiał
  // rozbity na dwa etapy zlewałby się w jeden wiersz/klucz podsumowania.
  // Etapy do wpisania wykonanej ilości (podwykonawca): wszystkie etapy
  // zamrożonej receptury (także te bez materiałów), zawężone do zakresu
  // jego brygady; awaryjnie etapy z planu materiałowego.
  const progressStages = (
    activeSnapshot?.stageNames.length ? activeSnapshot.stageNames : stageOrder
  ).filter(stageInScope);
  const progressRows = progressStages
    .map((stageName) => ({ stageName, quantity: (draftStageProgress[stageName] ?? "").trim() }))
    .filter((row) => Number(row.quantity.replace(",", ".")) > 0);
  const materialSummaryRows: { key: string; name: string; unit?: string }[] = [];
  for (const a of buildAssignments) {
    const m = materials.find((x) => x.id === a.materialId);
    const name = m?.name?.trim().toLowerCase();
    const stagesForMaterial = name
      ? planForActiveBuild.filter((p) => p.materialName.trim().toLowerCase() === name)
      : [];
    if (stagesForMaterial.length === 0) {
      materialSummaryRows.push({
        key: materialReportKey(a.materialId, null),
        name: m?.name ?? a.materialId,
        unit: m?.unit,
      });
    } else {
      for (const p of stagesForMaterial) {
        materialSummaryRows.push({
          key: materialReportKey(a.materialId, p.stageName),
          name: m?.name ?? a.materialId,
          unit: p.unit,
        });
      }
    }
  }

  // removable: tylko materiały pomocnicze (dodane ręcznie z magazynu w tym
  // raporcie) mają "✕" do cofnięcia pomyłki — materiały z planu technologii
  // przypisują się automatycznie przy przyjęciu zamówienia i nie da się ich
  // tak po prostu odpiąć od budowy.
  // stageName/stagePlan: gdy materiał należy do etapu technologii, ta
  // konkretna karta odpowiada TEMU etapowi (materiał, który występuje w
  // dwóch etapach, renderuje się jako DWIE osobne karty — patrz pętla po
  // stageOrder niżej) — bez tego oba pola pisałyby do tego samego wiersza
  // report_materials (zgłoszony problem: "piasek w dwóch miejscach").
  const renderMaterialRow = (
    a: (typeof buildAssignments)[number],
    i: number,
    removable: boolean,
    stageName?: string | null,
    stagePlan?: { plannedQuantity: number; unit: string } | null,
  ) => {
    const m = materials.find((x) => x.id === a.materialId);
    const key = materialReportKey(a.materialId, stageName ?? null);
    // reportValues trzyma DZISIEJSZE zużycie (od zera), nie stan
    // całkowity — do porównania z planem (Admin: "plan/pozostało") trzeba
    // doliczyć życiowe zużycie TEGO KLUCZA (materiał × etap), nie całego
    // materiału (a.used miesza etapy razem) — sumowane z zapisanych
    // raportów budowy, pomijając akurat otwarty (editingReport), żeby nie
    // policzyć dzisiejszej wartości podwójnie.
    const lifeToDateBeforeToday = savedReports
      .filter((r) => r.buildId === activeBuild?.id && r.id !== editingReport?.id)
      .reduce((sum, r) => sum + Number(r.materialValues[key] || 0), 0);
    const dailyValue = Number(reportValues[key] || 0);
    const currentValue = lifeToDateBeforeToday + dailyValue;
    const planQty = stagePlan?.plannedQuantity ?? a.planned;
    const planUnit = stagePlan?.unit ?? m?.unit;
    const different =
      devRole === "Admin" &&
      reportValues[key] !== undefined &&
      currentValue !== planQty;
    return (
      <View key={key}>
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
                    ? `plan ${planQty} ${planUnit} · pozostało ${Math.max(0, planQty - currentValue)} ${planUnit}`
                    : "Materiał przypisany do budowy"}
              </Text>
            </View>
          </View>

          {/* prawa kolumna — sztywna szerokość steppera */}
          <QuantityStepper
            disabled={reportApproved}
            value={reportValues[key] || "0"}
            unit={m?.unit}
            onChangeText={(v) =>
              setReportValues({
                ...reportValues,
                [key]: v,
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
              <Icon name="x" size={18} color={COLORS.muted} />
            </Pressable>
          )}
        </View>
        {devRole === "Admin" && currentValue > planQty && (
          // Ostrzeżenie tylko dla Admina — Brygadzista i tak wpisuje
          // realne zużycie z budowy, zna założony plan i nie potrzebuje
          // appki oceniającej, czy się w nim zmieścił (dotyczy zarówno
          // materiałów z technologii, jak i pomocniczych — obie sekcje
          // renderują się przez tę samą funkcję).
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
<Icon name="alert-triangle" size={14} color={COLORS.warning} />
<Text style={{
              color: COLORS.warning,
              fontSize: 11,
              marginTop: -4,
              
            }}>Przekracza plan o {(currentValue - planQty).toFixed(2)} {planUnit}</Text>
</View>
        )}
        {different && (
          <Field
            editable={!reportApproved}
            placeholder="Dlaczego wystąpiła różnica?"
            value={reasons[key] || ""}
            onChangeText={(v: string) => setReasons({ ...reasons, [key]: v })}
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

      <ReportStepper
        step={reportStep}
        labels={subMode ? ["Zużycie", "Wykonane", "Podsumowanie"] : undefined}
      />

      {isAdminAccount && !isSubcontractorLead && subTeamsOnBuild.length > 0 && !reportApproved && (
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderWidth: 1,
            borderColor: COLORS.border,
            borderRadius: RADIUS.card,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text className="text-xs text-muted uppercase mb-2">Raport za</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {[{ teamId: null as number | null, name: "Nasza brygada" }, ...subTeamsOnBuild].map((opt) => {
              const selected = (draftReportTeamId ?? null) === opt.teamId;
              return (
                <Pressable
                  key={opt.teamId ?? "own"}
                  disabled={!!editingReportId}
                  onPress={() => {
                    setDraftReportTeamId(opt.teamId);
                    setDraftStageProgress({});
                  }}
                  style={{
                    backgroundColor: selected ? COLORS.primary : COLORS.background,
                    borderRadius: RADIUS.control,
                    paddingHorizontal: 9,
                    paddingVertical: 7,
                    borderWidth: 1,
                    borderColor: selected ? COLORS.primary : COLORS.border,
                    opacity: editingReportId && !selected ? 0.4 : 1,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? COLORS.background : COLORS.foreground,
                      fontWeight: "700",
                      fontSize: 12,
                    }}
                  >
                    {opt.teamId == null ? opt.name : `Podwykonawca: ${opt.name}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 6 }}>
            Dla podwykonawcy bez konta w aplikacji — raport zapisze się jako raport jego ekipy.
          </Text>
        </View>
      )}

      {isSubcontractorLead && !subBuildTeam && (
        <View
          style={{
            backgroundColor: COLORS.warningBg,
            borderRadius: RADIUS.card,
            padding: 13,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: COLORS.foreground, fontWeight: "700" }}>
            {reportableBuilds.length === 0
              ? "Twoja brygada nie jest jeszcze przypisana do żadnej budowy."
              : "Twoja brygada nie jest przypisana do tej budowy — wybierz inną."}
          </Text>
          <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
            Przypisanie robi administrator na karcie budowy (Brygady na budowie).
          </Text>
        </View>
      )}

      <View className="bg-surface border border-border rounded-card overflow-hidden">
        {reportApproved && (
          <View
            style={{
              backgroundColor: COLORS.successBg,
              borderRadius: RADIUS.card,
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
              <IconBadge name="briefcase" />
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
                <Icon
                  name={picker === "build" ? "chevron-up" : "chevron-right"}
                  size={22}
                  color={COLORS.primary}
                />
              </Pressable>
            </View>

            {picker === "build" && (
              <View
                style={{
                  backgroundColor: COLORS.background,
                  borderRadius: RADIUS.control,
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
                  {reportableBuilds
                    .map((b) => (
                    <Pressable
                      disabled={reportApproved}
                      key={b.id}
                      onPress={() => {
                        setSelectedBuildId(b.id);
                        setPicker(null);
                        // Zmiana budowy w trakcie zaczynania nowego
                        // raportu — pola "zużyto dziś" i tak startują puste
                        // (patrz getReportDefaults w app-data.tsx).
                        setReportValues(getReportDefaults(b.id));
                        setDraftExtraCosts([]);
                        setDraftNote("");
                        setDraftStageProgress({});
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
                zużyto dzisiaj. Zakończenie etapu Brygadzista potwierdza
                checkboxem — insert/delete w `build_stage_status`
                (lib/data/build-stages.ts, tabela istniała od Fazy 6, ale
                nigdy nie miała UI do klikania), niezależnie od
                procentowego rozliczenia materiału. Portal Klienta
                pokazuje wtedy dla etapu 100% i przechodzi na kolejny
                (patrz get_public_build, supabase/sql/072_...). Rząd
                nadal rozwija się po dotknięciu paska z nazwą etapu. */}
            {stageOrder.length > 0 && (
              <View className="border-t border-border p-4">
                <Text className="text-xs text-muted uppercase mb-2">Technologia</Text>
                {stageOrder.filter(stageInScope).map((stageName) => {
                  const stagePlan = planByStage.get(stageName) ?? [];
                  const isCollapsed = collapsedStages[stageName] ?? true;
                  const isStageCompleted = buildStageStatuses.some(
                    (s) => s.buildId === Number(activeBuild?.id) && s.stageName === stageName,
                  );
                  return (
                    <View
                      key={stageName}
                      style={{
                        backgroundColor: COLORS.background,
                        borderRadius: RADIUS.card,
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
                        <Pressable
                          disabled={reportApproved || !activeBuild}
                          onPress={() => {
                            if (!activeBuild) return;
                            if (isStageCompleted) {
                              reopenBuildStage(activeBuild.id, stageName);
                            } else {
                              completeBuildStage(activeBuild.id, stageName);
                            }
                          }}
                          hitSlop={8}
                          style={{
                            width: 21,
                            height: 21,
                            borderRadius: RADIUS.chip,
                            borderWidth: 2,
                            borderColor: isStageCompleted ? COLORS.primary : COLORS.border,
                            backgroundColor: isStageCompleted ? COLORS.primary : "transparent",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {isStageCompleted && (
                            <Icon name="check" size={14} color={COLORS.background} />
                          )}
                        </Pressable>
                      </Pressable>

                      {!isCollapsed && (
                        <View style={{ marginTop: 8 }}>
                          {stagePlan.map((p, i) => {
                            const assignment = assignmentByMaterialName.get(
                              p.materialName.trim().toLowerCase(),
                            );
                            if (assignment)
                              return renderMaterialRow(assignment, i, false, stageName, {
                                plannedQuantity: Number(p.plannedQuantity),
                                unit: p.unit,
                              });
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
                      borderRadius: RADIUS.control,
                      paddingVertical: 11,
                      alignItems: "center",
                      flexDirection: "row",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <Icon
                      name={addMaterialOpen ? "chevron-up" : "plus-circle"}
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
                        borderRadius: RADIUS.control,
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
                            borderRadius: RADIUS.card,
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
                                  <Icon
                                    name="x"
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

            {/* Magazyn v2: saldo budowy, niedobory i zgłoszenie straty
                (rozdarty worek, przeterminowany materiał) — brygadzista nie
                widzi karty budowy, więc dostęp jest stąd. */}
            {activeBuild && (
              <View className="border-t border-border p-4">
                <Pressable onPress={() => setStockOpen(!stockOpen)}>
                  <Text className="text-xs text-muted uppercase">
                    {stockOpen ? "▾" : "▸"} Stan materiałów na budowie · zgłoś stratę
                  </Text>
                </Pressable>
                {stockOpen && <BuildStockSection buildId={activeBuild.id} isClosed={false} />}
              </View>
            )}

            {!subMode && (
            <>
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
          </>
        )}

        {reportStep === 2 && subMode && (
          <View className="p-4">
            <Text className="text-xs text-muted uppercase mb-1">
              Wykonane dziś — szacunkowo ({buildUnitLabel})
            </Text>
            <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 10 }}>
              Wpisz szacunkowo, ile zrobiliście dziś na każdym etapie. Administrator
              zatwierdza raport i może poprawić metry.
            </Text>
            {progressStages.length === 0 ? (
              <Text className="text-sm text-muted py-2">
                Ta budowa nie ma jeszcze etapów technologii.
              </Text>
            ) : (
              progressStages.map((stageName, i) => {
                const done = buildStageStatuses.some(
                  (s) => s.buildId === Number(activeBuild?.id) && s.stageName === stageName,
                );
                return (
                  <View
                    key={stageName}
                    className={`flex-row items-center py-2 ${i > 0 ? "border-t border-border" : ""}`}
                    style={{ gap: 10 }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text className="text-sm text-foreground" numberOfLines={2}>
                        {stageName}
                      </Text>
                      {done && (
                        <Text style={{ color: COLORS.success, fontSize: 11, marginTop: 2 }}>
                          Etap zakończony
                        </Text>
                      )}
                    </View>
                    <QuantityStepper
                      value={draftStageProgress[stageName] ?? ""}
                      onChangeText={(v) =>
                        setDraftStageProgress({ ...draftStageProgress, [stageName]: v })
                      }
                      unit={buildUnitLabel}
                    />
                  </View>
                );
              })
            )}
          </View>
        )}

        {reportStep === 2 && !subMode && (
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
                        <IconBadge name="user" size={18} badgeSize={32} />
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
                      {!reportApproved && (
                        <Pressable
                          onPress={() => removePersonFromDraft(person.employeeId)}
                          hitSlop={8}
                          style={{ marginLeft: 8 }}
                        >
                          <Icon name="x" size={18} color={COLORS.muted} />
                        </Pressable>
                      )}
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
                  borderRadius: RADIUS.control,
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
                <Icon name={employeePickerOpen ? "chevron-up" : "chevron-down"} size={18} color={COLORS.muted} />
              </Pressable>

              {employeePickerOpen && (
                <View
                  style={{
                    backgroundColor: COLORS.background,
                    borderRadius: RADIUS.control,
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
                      borderRadius: RADIUS.control,
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
                    <Icon
                      name="clock"
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
                      borderRadius: RADIUS.control,
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
                    <Icon
                      name="clock"
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
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Pressable
                    onPress={addPersonToDraft}
                    style={({ pressed }) => ({
                      flex: 1,
                      borderWidth: 1,
                      borderColor: COLORS.primary,
                      borderRadius: RADIUS.card,
                      paddingVertical: 13,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Icon
                      name="plus-circle"
                      size={20}
                      color={COLORS.primary}
                    />
                    <Text style={{ color: COLORS.primary, fontWeight: "700" }}>
                      Dodaj osobę
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={addAllEmployeesToDraft}
                    style={({ pressed }) => ({
                      flex: 1,
                      backgroundColor: COLORS.primary,
                      borderRadius: RADIUS.card,
                      paddingVertical: 13,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Icon name="users" size={20} color={COLORS.background} />
                    <Text style={{ color: COLORS.background, fontWeight: "700" }}>
                      Dodaj wszystkich
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        )}

        {reportStep === 3 && (
          <View className="p-4">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <IconBadge name="briefcase" size={18} badgeSize={32} />
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
            {materialSummaryRows.map((row, i) => (
              <View
                key={row.key}
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
                  {row.name}
                </Text>
                <Text
                  className="text-sm font-bold text-foreground"
                  style={{ flexShrink: 0 }}
                >
                  {reportValues[row.key] || "0"} {row.unit}
                </Text>
              </View>
            ))}

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

            {subMode && (
              <>
                <Text className="text-xs text-muted uppercase mt-5 mb-1">
                  Wykonane dziś
                </Text>
                {progressRows.length === 0 ? (
                  <Text className="text-sm text-muted py-2">
                    Nie wpisano wykonanych ilości.
                  </Text>
                ) : (
                  progressRows.map((row, i) => (
                    <View
                      key={row.stageName}
                      className={`flex-row items-center justify-between py-2 ${i > 0 ? "border-t border-border" : ""}`}
                    >
                      <Text
                        className="text-sm text-foreground"
                        numberOfLines={1}
                        style={{ flex: 1, minWidth: 0, marginRight: 8 }}
                      >
                        {row.stageName}
                      </Text>
                      <Text className="text-sm font-bold text-foreground">
                        {row.quantity} {buildUnitLabel}
                      </Text>
                    </View>
                  ))
                )}
              </>
            )}

            {!subMode && (
            <>
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
                    {!reportApproved && (
                      <Pressable
                        onPress={() => removePersonFromDraft(person.employeeId)}
                        hitSlop={8}
                        style={{ marginLeft: 8 }}
                      >
                        <Icon name="x" size={18} color={COLORS.muted} />
                      </Pressable>
                    )}
                  </View>
                );
              })
            )}
            </>
            )}

            {/* Notatka do raportu (Decyzja B) — jedna, dowolna notatka na
                cały dzień, czysto informacyjna dla Admina (np. "deszcz do
                11, brygada 2h krócej"). Świadomie na końcu podsumowania,
                nie osobny krok — to nie jest formalna ścieżka odrzucenia
                raportu, tylko miejsce na kontekst do rozmowy telefonicznej. */}
            <Text className="text-xs text-muted uppercase mt-5 mb-1">
              Notatka do raportu
            </Text>
            <Field
              editable={!reportApproved}
              placeholder="Coś, co warto zapamiętać do tego dnia (opcjonalnie)"
              value={draftNote}
              onChangeText={setDraftNote}
              multiline
              numberOfLines={4}
              style={{ marginTop: 0, minHeight: 96 }}
            />
          </View>
        )}
      </View>

      {reportSaved && (
        <View
          style={{
            backgroundColor: COLORS.successBg,
            borderRadius: RADIUS.card,
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
            {subMode
              ? "Raport zapisany — materiały zdjęte z magazynu, wykonane ilości zapisane"
              : "Raport zapisany — materiały zdjęte z magazynu, godziny zapisane"}
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
          <Icon
            name="check-circle"
            size={18}
            color={COLORS.success}
          />
          <Text
            style={{ color: COLORS.muted, fontSize: 13, flex: 1, minWidth: 0 }}
          >
            Gotowe do zapisania ·{" "}
            {subMode
              ? `${progressRows.length} ${pluralPL(progressRows.length, "etap", "etapy", "etapów")}`
              : `${draftPeople.length} ${pluralPL(draftPeople.length, "osoba", "osoby", "osób")}`}{" "}
            ·{" "}
            {materialSummaryRows.length}{" "}
            {pluralPL(materialSummaryRows.length, "materiał", "materiały", "materiałów")}
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
                  const anyMaterialFilled = Object.values(reportValues).some(
                    (v) => Number(v || 0) > 0,
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
                  !subMode &&
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
