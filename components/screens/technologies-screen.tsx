import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Button,
  COLORS,
  confirmAction,
  Field,
  QuantityStepper,
  ScreenHeader,
  UNIT_OPTIONS,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import {
  type SaveTechnologyStageInput,
  type TechnologyRow,
  listAllTechnologies,
  saveTechnology,
  updateTechnologyMeta,
} from "@/lib/data/technologies";
import { parseTechnologySql } from "@/lib/data/technology-sql-import";
import { matchMaterialNames } from "@/lib/material-name-match";

// Panel Admina — Technologie (receptury posadzek), Faza 1 modułu
// Technologia. "Edytuj" NIGDY nie nadpisuje istniejącej technologii —
// zawsze zapisuje nową wersję tej samej rodziny (ten sam kod, wersja+1)
// i dezaktywuje starą (patrz save_technology() w supabase/sql). Dzięki
// temu budowa, która ma już przypisaną technologię, nigdy nie zobaczy
// późniejszej zmiany receptury — plan pozostaje historyczny.

type DraftMaterial = {
  key: string;
  name: string;
  unit: string;
  consumptionPerM2: string;
  linkedMaterialId: string;
};

type DraftStage = {
  key: string;
  name: string;
  materials: DraftMaterial[];
};

let keySeq = 0;
const nextKey = () => String(++keySeq);

const emptyMaterial = (): DraftMaterial => ({
  key: nextKey(),
  name: "",
  unit: "kg",
  consumptionPerM2: "",
  linkedMaterialId: "",
});

const emptyStage = (): DraftStage => ({
  key: nextKey(),
  name: "",
  materials: [emptyMaterial()],
});

export function TechnologiesScreen() {
  const { materials } = useAppData();
  const queryClient = useQueryClient();

  const [technologies, setTechnologies] = useState<TechnologyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [thicknessMinMm, setThicknessMinMm] = useState("");
  const [thicknessMaxMm, setThicknessMaxMm] = useState("");
  // Zdecydowana większość technologii ma JEDNĄ grubość, nie zakres —
  // domyślnie jedno pole, "do" tylko po rozwinięciu (patrz "+ Zakres
  // grubości" w formularzu). thicknessMaxMm i tak zawsze istnieje w
  // bazie (patrz save niżej) — tryb pojedynczej wartości po prostu
  // ustawia min = max zamiast pokazywać drugie, prawie zawsze puste pole.
  const [thicknessRangeMode, setThicknessRangeMode] = useState(false);
  const [stages, setStages] = useState<DraftStage[]>([emptyStage()]);
  const [busy, setBusy] = useState(false);
  // Etapy jako accordion — jeden rozwinięty na raz, domyślnie pierwszy
  // (patrz startNew/startEdit/handleParseSql niżej). Przy 5-8 etapach to
  // różnica między krótką, przewidywalną listą a ekranem-ścianą, przez
  // którą trzeba bez końca scrollować.
  const [expandedStageKey, setExpandedStageKey] = useState<string | null>(null);
  // Wyszukiwarka materiału magazynowego zamiast ściany przycisków — jeden
  // wspólny picker (modal) na cały formularz, otwierany dla konkretnej
  // pozycji (stageKey+materialKey). Skaluje się do setek pozycji w
  // magazynie, w odróżnieniu od wypisywania każdej jako osobny Pressable.
  const [materialPicker, setMaterialPicker] = useState<{
    stageKey: string;
    materialKey: string;
  } | null>(null);
  const [materialPickerQuery, setMaterialPickerQuery] = useState("");

  // Tryb wpisywania nowej technologii: formularz krok po kroku albo wklejony
  // SQL. SQL nigdy nie jest wykonywany na bazie — jest tylko parsowany
  // (patrz lib/data/technology-sql-import.ts) i wypełnia te same pola co
  // tryb tradycyjny, żeby dało się je sprawdzić/poprawić przed zapisem.
  const [formMode, setFormMode] = useState<"traditional" | "sql">("traditional");
  const [sqlInput, setSqlInput] = useState("");
  const [sqlError, setSqlError] = useState<string | null>(null);

  // Filtry listy (nie edytora) — firma i zakres grubości. Do uzupełnienia
  // ręcznie w istniejących technologiach przez "Edytuj", stąd oba pola
  // metadanych żyją też w formularzu wyżej.
  const [filterCompany, setFilterCompany] = useState<string | "all">("all");
  const [filterThicknessFrom, setFilterThicknessFrom] = useState("");
  const [filterThicknessTo, setFilterThicknessTo] = useState("");

  const reload = () => {
    setLoadError(null);
    listAllTechnologies()
      .then(setTechnologies)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Błąd."));
  };

  useEffect(reload, []);

  const activeByCode = new Map<string, TechnologyRow[]>();
  for (const t of technologies ?? []) {
    if (!activeByCode.has(t.code)) activeByCode.set(t.code, []);
    activeByCode.get(t.code)!.push(t);
  }
  const families = [...activeByCode.values()].sort((a, b) =>
    a[0].name.localeCompare(b[0].name),
  );

  // Filtry listy — firma (chipy z tego, co faktycznie wypełnione) i
  // zakres grubości (mm). Filtrują po aktywnej (najnowszej) wersji
  // rodziny — to jej dotyczą pola company/thicknessMinMm/thicknessMaxMm
  // w praktyce. Grubość technologii to sam ZAKRES (od-do), w jakim się
  // stosuje — dopasowanie to nakładanie się przedziałów: pokazujemy
  // technologię, jeśli szukany zakres i jej zakres mają część wspólną
  // (a nie tylko gdy szukana wartość mieści się dokładnie w środku).
  const companies = [...new Set(
    (technologies ?? [])
      .map((t) => t.company?.trim())
      .filter((c): c is string => !!c),
  )].sort((a, b) => a.localeCompare(b));
  const thicknessFrom = filterThicknessFrom ? Number(filterThicknessFrom) : null;
  const thicknessTo = filterThicknessTo ? Number(filterThicknessTo) : null;
  const filteredFamilies = families.filter(([active]) => {
    if (filterCompany !== "all" && (active.company?.trim() || "") !== filterCompany) {
      return false;
    }
    const techMin = active.thicknessMinMm != null ? Number(active.thicknessMinMm) : null;
    const techMax = active.thicknessMaxMm != null ? Number(active.thicknessMaxMm) : null;
    if (thicknessFrom != null || thicknessTo != null) {
      // Brak zdefiniowanego zakresu u technologii = nie da się ocenić
      // dopasowania — nie pokazujemy przy aktywnym filtrze grubości
      // (uzupełnij "Edytuj", żeby technologia zaczęła się pojawiać).
      if (techMin == null || techMax == null) return false;
      if (thicknessTo != null && techMin > thicknessTo) return false;
      if (thicknessFrom != null && techMax < thicknessFrom) return false;
    }
    return true;
  });

  const startNew = () => {
    setEditingSourceId(null);
    setCode("");
    setName("");
    setCompany("");
    setThicknessMinMm("");
    setThicknessMaxMm("");
    setThicknessRangeMode(false);
    const initialStage = emptyStage();
    setStages([initialStage]);
    setExpandedStageKey(initialStage.key);
    setFormMode("traditional");
    setSqlInput("");
    setSqlError(null);
    setEditorOpen(true);
  };

  const handleParseSql = () => {
    try {
      const parsed = parseTechnologySql(sqlInput);
      setCode(parsed.code);
      setName(parsed.name);
      setCompany(parsed.company ?? "");
      setThicknessMinMm(parsed.thicknessMinMm != null ? String(parsed.thicknessMinMm) : "");
      setThicknessMaxMm(parsed.thicknessMaxMm != null ? String(parsed.thicknessMaxMm) : "");
      setThicknessRangeMode(
        parsed.thicknessMinMm != null &&
          parsed.thicknessMaxMm != null &&
          parsed.thicknessMinMm !== parsed.thicknessMaxMm,
      );
      const parsedStages = parsed.stages.map((s) => ({
        key: nextKey(),
        name: s.name,
        materials: s.materials.length
          ? s.materials.map((m) => ({
              key: nextKey(),
              name: m.name,
              unit: m.unit,
              consumptionPerM2: String(m.consumptionPerM2),
              linkedMaterialId: "",
            }))
          : [emptyMaterial()],
      }));
      setStages(parsedStages);
      setExpandedStageKey(parsedStages[0]?.key ?? null);
      setSqlError(null);
      // Przełącz na widok formularza — to jest podgląd do sprawdzenia i
      // ewentualnej poprawki, zanim cokolwiek trafi do Supabase.
      setFormMode("traditional");
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : "Nie udało się odczytać SQL.");
    }
  };

  const startEdit = (t: TechnologyRow) => {
    setEditingSourceId(t.id);
    setCode(t.code);
    setName(t.name);
    setCompany(t.company ?? "");
    setThicknessMinMm(t.thicknessMinMm ?? "");
    setThicknessMaxMm(t.thicknessMaxMm ?? "");
    // Autodetekcja: jeśli min i max już się różnią, otwórz od razu w
    // trybie zakresu — inaczej edycja czegoś innego mogłaby po cichu
    // "spłaszczyć" istniejący zakres do jednej wartości przy zapisie.
    setThicknessRangeMode(
      t.thicknessMinMm != null &&
        t.thicknessMaxMm != null &&
        t.thicknessMinMm !== t.thicknessMaxMm,
    );
    const editStages = t.technology_stages.length
      ? [...t.technology_stages]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((s) => ({
            key: nextKey(),
            name: s.name,
            materials: s.technology_materials.length
              ? s.technology_materials.map((m) => ({
                  key: nextKey(),
                  name: m.materialName,
                  unit: m.unit,
                  consumptionPerM2: m.consumptionPerM2,
                  linkedMaterialId: m.linkedMaterialId != null ? String(m.linkedMaterialId) : "",
                }))
              : [emptyMaterial()],
          }))
      : [emptyStage()];
    setStages(editStages);
    setExpandedStageKey(editStages[0]?.key ?? null);
    // Import SQL ma sens tylko dla zupełnie nowej technologii — edycja
    // istniejącej zawsze zaczyna się od pełnego, wypełnionego formularza.
    setFormMode("traditional");
    setSqlInput("");
    setSqlError(null);
    setEditorOpen(true);
  };

  const save = async () => {
    if (!code.trim() || !name.trim()) {
      setLoadError("Kod i nazwa technologii są wymagane.");
      return;
    }
    const payload: SaveTechnologyStageInput[] = stages
      .filter((s) => s.name.trim())
      .map((s, orderIndex) => ({
        name: s.name.trim(),
        orderIndex,
        materials: s.materials
          .filter((m) => m.name.trim() && m.consumptionPerM2)
          .map((m) => ({
            name: m.name.trim(),
            unit: m.unit || "kg",
            consumptionPerM2: Number(m.consumptionPerM2) || 0,
            linkedMaterialId: m.linkedMaterialId ? Number(m.linkedMaterialId) : null,
          })),
      }));
    if (payload.length === 0) {
      setLoadError("Dodaj przynajmniej jeden etap z jednym materiałem.");
      return;
    }
    // Tryb pojedynczej wartości (domyślny — patrz thicknessRangeMode):
    // "do" nie jest w ogóle pokazywane, więc przy zapisie kopiuje "od" —
    // w bazie zakres i tak zawsze ma obie granice (min = max = ta sama
    // wartość dla technologii bez realnego zakresu).
    const effectiveThicknessMaxMm = thicknessRangeMode ? thicknessMaxMm : thicknessMinMm;
    if (
      thicknessMinMm &&
      effectiveThicknessMaxMm &&
      Number(thicknessMinMm) > Number(effectiveThicknessMaxMm)
    ) {
      setLoadError('Grubość "od" nie może być większa niż "do".');
      return;
    }
    const persist = async () => {
      setBusy(true);
      setLoadError(null);
      try {
        const newId = await saveTechnology(editingSourceId, code.trim(), name.trim(), payload);
        // Firma/grubość to metadane, nie część receptury (patrz komentarz
        // przy company/thicknessMinMm/thicknessMaxMm w lib/data/technologies.ts)
        // — zapisywane osobnym wywołaniem na ŚWIEŻO utworzonej wersji
        // (newId), nie na editingSourceId (ten zaraz zostanie zdezaktywowany).
        await updateTechnologyMeta(
          newId,
          company.trim() || null,
          thicknessMinMm ? Number(thicknessMinMm) : null,
          effectiveThicknessMaxMm ? Number(effectiveThicknessMaxMm) : null,
        );
        setEditorOpen(false);
        reload();
        // Ten ekran ma własną, niezależną listę (listAllTechnologies +
        // reload() wyżej) — bez tego appka (m.in. picker przypisywania
        // technologii do budowy w Budowach) korzysta z osobnego,
        // cache'owanego zapytania React Query (`useAppData().technologies`,
        // staleTime: Infinity), które realtime i tak w końcu odświeży, ale
        // nie natychmiast w tej samej sesji.
        await queryClient.invalidateQueries({ queryKey: ["technologies"] });
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Błąd.");
      } finally {
        setBusy(false);
      }
    };
    // Materiał bez "Powiązanego materiału magazynowego" (opcjonalne pole
    // w formularzu materiału) idzie dalej w łańcuchu (plan budowy →
    // zamówienie → przyjęcie dostawy) po zawodnym dopasowaniu po nazwie
    // zamiast po jednoznacznym ID — źródło niejednego "materiał #4"/
    // duplikatu w magazynie. Nie blokujemy zapisu (czasem receptura
    // powstaje na materiał, którego jeszcze nie ma w magazynie), tylko
    // ostrzegamy i dajemy jawnie potwierdzić.
    const unlinkedCount = payload.reduce(
      (sum, stage) => sum + stage.materials.filter((m) => !m.linkedMaterialId).length,
      0,
    );
    if (unlinkedCount > 0) {
      confirmAction(
        "Materiały bez powiązania z magazynem",
        `${unlinkedCount} ${unlinkedCount === 1 ? "materiał w recepturze nie jest powiązany" : "materiałów w recepturze nie jest powiązanych"} z konkretnym materiałem w magazynie (pole "Powiązany materiał magazynowy" przy materiale). Dalej w łańcuchu (plan budowy, zamówienie, przyjęcie dostawy) taki materiał dopasowuje się po nazwie — literówka albo inna nazwa w magazynie może utworzyć duplikat zamiast dopisać do istniejącego materiału.\n\nZapisać mimo to?`,
        "Zapisz mimo to",
        persist,
      );
      return;
    }
    await persist();
  };

  const updateStage = (key: string, patch: Partial<DraftStage>) =>
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const updateMaterial = (stageKey: string, materialKey: string, patch: Partial<DraftMaterial>) =>
    setStages((prev) =>
      prev.map((s) =>
        s.key !== stageKey
          ? s
          : {
              ...s,
              materials: s.materials.map((m) =>
                m.key === materialKey ? { ...m, ...patch } : m,
              ),
            },
      ),
    );

  return (
    <>
      <ScreenHeader
        title="Technologie"
        description="Receptury posadzek — etapy, materiały, zużycie na m²."
        action={
          <Button
            label={editorOpen ? "Anuluj" : "+ Nowa"}
            onPress={editorOpen ? () => setEditorOpen(false) : startNew}
          />
        }
      />

      {editorOpen && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
          {/* Zapisz też na górze — przy 5-8 etapach formularz jest długi,
              bez tego trzeba by scrollować do samego dołu za każdym razem,
              żeby zapisać. */}
          {!(editingSourceId == null && formMode === "sql") && (
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                marginBottom: 14,
                paddingBottom: 14,
                borderBottomWidth: 1,
                borderBottomColor: COLORS.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Button label="Anuluj" secondary onPress={() => setEditorOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                {busy ? (
                  <ActivityIndicator color={COLORS.primary} />
                ) : (
                  <Button
                    label={editingSourceId != null ? "Zapisz jako nową wersję" : "Utwórz technologię"}
                    onPress={save}
                  />
                )}
              </View>
            </View>
          )}
          {editingSourceId != null && (
            <Text style={{ color: COLORS.warning, fontSize: 12, marginBottom: 10 }}>
              Zapis utworzy nową wersję tej technologii — poprzednia zostaje w historii,
              budowy które już ją mają przypisaną się nie zmienią.
            </Text>
          )}

          {editingSourceId == null && (
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
              {(
                [
                  { key: "traditional", label: "Tradycyjnie" },
                  { key: "sql", label: "Przez SQL" },
                ] as const
              ).map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => setFormMode(opt.key)}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    borderRadius: 10,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: formMode === opt.key ? COLORS.primary : COLORS.border,
                    backgroundColor: formMode === opt.key ? COLORS.primary : COLORS.background,
                  }}
                >
                  <Text
                    style={{
                      color: formMode === opt.key ? COLORS.background : COLORS.foreground,
                      fontWeight: "700",
                      fontSize: 13,
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {editingSourceId == null && formMode === "sql" ? (
            <View>
              <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 10 }}>
                Wklej SQL w formacie: insert into technologies (...) values (...) returning id,
                dalej etapy (cross join values ... as stage_data) i materiały (join values ...
                as material_data). Nic nie zostanie wysłane do bazy — wczytanie tylko wypełni
                formularz poniżej do sprawdzenia i akceptacji.
              </Text>
              <TextInput
                multiline
                numberOfLines={14}
                value={sqlInput}
                onChangeText={setSqlInput}
                placeholder="begin;&#10;&#10;with new_technology as (...)"
                placeholderTextColor={COLORS.muted}
                textAlignVertical="top"
                style={{
                  backgroundColor: COLORS.background,
                  color: COLORS.foreground,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  padding: 12,
                  minHeight: 220,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              />
              {sqlError && (
                <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 10 }}>
                  {sqlError}
                </Text>
              )}
              <View style={{ marginTop: 12 }}>
                <Button label="Wczytaj i pokaż podgląd" onPress={handleParseSql} />
              </View>
            </View>
          ) : (
            <>
          <Text className="text-xs text-muted uppercase mb-2">Kod (rodzina technologii)</Text>
          <Field placeholder="np. ST/PU/2" value={code} onChangeText={setCode} />
          <Text className="text-xs text-muted uppercase mb-2 mt-3">Nazwa</Text>
          <Field
            placeholder="np. Posadzka przemysłowa PU"
            value={name}
            onChangeText={setName}
          />
          <Text className="text-xs text-muted uppercase mb-2 mt-3">Firma</Text>
          <Field
            placeholder="np. Sika"
            value={company}
            onChangeText={setCompany}
          />
          <Text className="text-xs text-muted uppercase mb-2 mt-3">
            Grubość posadzki (mm)
          </Text>
          {thicknessRangeMode ? (
            <>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <QuantityStepper
                    value={thicknessMinMm}
                    onChangeText={setThicknessMinMm}
                    step={0.5}
                  />
                </View>
                <Text style={{ color: COLORS.muted }}>—</Text>
                <View style={{ flex: 1 }}>
                  <QuantityStepper
                    value={thicknessMaxMm}
                    onChangeText={setThicknessMaxMm}
                    step={0.5}
                  />
                </View>
              </View>
              <Pressable onPress={() => setThicknessRangeMode(false)} style={{ marginTop: 8 }}>
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                  − Jedna wartość zamiast zakresu
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <QuantityStepper
                value={thicknessMinMm}
                onChangeText={setThicknessMinMm}
                step={0.5}
              />
              <Pressable
                onPress={() => setThicknessRangeMode(true)}
                style={{ marginTop: 8 }}
              >
                <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                  + Zakres grubości
                </Text>
              </Pressable>
            </>
          )}

          <Text className="text-xs text-muted uppercase mb-2 mt-4">Etapy technologii</Text>
          <View
            style={{
              borderRadius: 12,
              borderWidth: 1,
              borderColor: COLORS.border,
              overflow: "hidden",
            }}
          >
            {stages.map((stage, stageIdx) => {
              const isExpanded = expandedStageKey === stage.key;
              const materialCount = stage.materials.filter((m) => m.name.trim()).length;
              return (
                <View
                  key={stage.key}
                  style={{
                    borderTopWidth: stageIdx > 0 ? 1 : 0,
                    borderTopColor: COLORS.border,
                  }}
                >
                  <Pressable
                    onPress={() => setExpandedStageKey(isExpanded ? null : stage.key)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      backgroundColor: isExpanded ? COLORS.background : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        color: COLORS.muted,
                        fontSize: 12,
                        fontWeight: "700",
                        width: 24,
                      }}
                    >
                      {String(stageIdx + 1).padStart(2, "0")}
                    </Text>
                    <Text
                      style={{
                        flex: 1,
                        color: COLORS.foreground,
                        fontWeight: "700",
                        fontSize: 14,
                      }}
                      numberOfLines={1}
                    >
                      {stage.name.trim() || "Nowy etap"}
                    </Text>
                    <Text style={{ color: COLORS.muted, fontSize: 12, marginRight: 10 }}>
                      {materialCount} {materialCount === 1 ? "materiał" : "materiały"}
                    </Text>
                    <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: "700" }}>
                      {isExpanded ? "▲" : "▼"}
                    </Text>
                  </Pressable>

                  {isExpanded && (
                    <View style={{ paddingHorizontal: 14, paddingBottom: 16 }}>
                      <Text className="text-xs text-muted uppercase mb-2">Nazwa etapu</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Field
                            placeholder="np. Gruntowanie"
                            value={stage.name}
                            onChangeText={(v: string) => updateStage(stage.key, { name: v })}
                          />
                        </View>
                        {stages.length > 1 && (
                          <Pressable
                            onPress={() => {
                              setStages((prev) => prev.filter((s) => s.key !== stage.key));
                              if (expandedStageKey === stage.key) setExpandedStageKey(null);
                            }}
                          >
                            <Text style={{ color: COLORS.danger, fontSize: 12, fontWeight: "700" }}>
                              Usuń etap
                            </Text>
                          </Pressable>
                        )}
                      </View>

                      {stage.materials.map((mat) => (
                        <View
                          key={mat.key}
                          style={{
                            marginTop: 12,
                            paddingLeft: 12,
                            borderLeftWidth: 2,
                            borderLeftColor: COLORS.border,
                          }}
                        >
                          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                            <View style={{ flex: 1 }}>
                              <Text className="text-xs text-muted uppercase mb-2">
                                Materiał (receptura)
                              </Text>
                              <Field
                                placeholder="Nazwa materiału (np. Flowfresh Primer)"
                                value={mat.name}
                                onChangeText={(v: string) =>
                                  updateMaterial(stage.key, mat.key, { name: v })
                                }
                              />
                            </View>
                            {stage.materials.length > 1 && (
                              <Pressable
                                onPress={() =>
                                  updateStage(stage.key, {
                                    materials: stage.materials.filter((m) => m.key !== mat.key),
                                  })
                                }
                                style={{ paddingTop: 30 }}
                              >
                                <Text style={{ color: COLORS.danger, fontSize: 12 }}>Usuń</Text>
                              </Pressable>
                            )}
                          </View>
                          <View
                            style={{
                              flexDirection: "row",
                              gap: 16,
                              marginTop: 10,
                              alignItems: "flex-end",
                              flexWrap: "wrap",
                            }}
                          >
                            <View>
                              <Text className="text-xs text-muted uppercase mb-2">Zużycie / m²</Text>
                              <QuantityStepper
                                value={mat.consumptionPerM2}
                                onChangeText={(v: string) =>
                                  updateMaterial(stage.key, mat.key, { consumptionPerM2: v })
                                }
                              />
                            </View>
                            <View style={{ flex: 1, minWidth: 180 }}>
                              <Text className="text-xs text-muted uppercase mb-2">Jednostka</Text>
                              <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
                                {UNIT_OPTIONS.map((u) => (
                                  <Pressable
                                    key={u}
                                    onPress={() => updateMaterial(stage.key, mat.key, { unit: u })}
                                    style={{
                                      backgroundColor: mat.unit === u ? COLORS.primary : COLORS.background,
                                      borderRadius: 8,
                                      paddingHorizontal: 8,
                                      paddingVertical: 6,
                                      borderWidth: 1,
                                      borderColor: mat.unit === u ? COLORS.primary : COLORS.border,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        color: mat.unit === u ? COLORS.background : COLORS.foreground,
                                        fontWeight: "700",
                                        fontSize: 12,
                                      }}
                                    >
                                      {u}
                                    </Text>
                                  </Pressable>
                                ))}
                              </View>
                            </View>
                          </View>
                          {(
                            <View style={{ marginTop: 10 }}>
                              <Text className="text-xs text-muted uppercase mb-2">
                                Powiązany materiał magazynowy (opcjonalnie)
                              </Text>
                              <Pressable
                                onPress={() => {
                                  setMaterialPickerQuery("");
                                  setMaterialPicker({ stageKey: stage.key, materialKey: mat.key });
                                }}
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  backgroundColor: COLORS.background,
                                  borderRadius: 10,
                                  borderWidth: 1,
                                  borderColor: COLORS.border,
                                  paddingHorizontal: 13,
                                  paddingVertical: 11,
                                }}
                              >
                                <Text
                                  style={{
                                    color: mat.linkedMaterialId
                                      ? COLORS.foreground
                                      : COLORS.muted,
                                    fontSize: 13,
                                    fontWeight: mat.linkedMaterialId ? "600" : "400",
                                  }}
                                  numberOfLines={1}
                                >
                                  {mat.linkedMaterialId
                                    ? materials.find((wm) => wm.id === mat.linkedMaterialId)?.name ??
                                      "Materiał usunięty"
                                    : "Nie przypisano"}
                                </Text>
                                <Text style={{ color: COLORS.muted, fontSize: 12 }}>Zmień ⌄</Text>
                              </Pressable>
                            </View>
                          )}
                        </View>
                      ))}

                      <Pressable
                        onPress={() =>
                          updateStage(stage.key, { materials: [...stage.materials, emptyMaterial()] })
                        }
                        style={{ marginTop: 14 }}
                      >
                        <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                          + Dodaj materiał
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          <Pressable
            onPress={() => {
              const stage = emptyStage();
              setStages((prev) => [...prev, stage]);
              setExpandedStageKey(stage.key);
            }}
            style={{ marginTop: 12 }}
          >
            <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
              + Dodaj etap
            </Text>
          </Pressable>

          {loadError && (
            <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 12 }}>{loadError}</Text>
          )}
          <View style={{ marginTop: 14 }}>
            {busy ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Button
                label={editingSourceId != null ? "Zapisz jako nową wersję" : "Utwórz technologię"}
                onPress={save}
              />
            )}
          </View>
          </>
          )}
        </View>
      )}

      {!editorOpen && loadError && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
          <Text style={{ color: COLORS.danger, fontSize: 12 }}>{loadError}</Text>
        </View>
      )}

      {technologies === null && !loadError && (
        <View className="items-center py-6">
          <ActivityIndicator color={COLORS.primary} />
        </View>
      )}

      {technologies?.length === 0 && (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <Text className="text-sm text-muted">Brak technologii — dodaj pierwszą.</Text>
        </View>
      )}

      {families.length > 0 && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 10 }}
          >
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => setFilterCompany("all")}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: filterCompany === "all" ? COLORS.primary : COLORS.border,
                  backgroundColor: filterCompany === "all" ? COLORS.primary : COLORS.surface,
                }}
              >
                <Text
                  style={{
                    color: filterCompany === "all" ? COLORS.background : COLORS.foreground,
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  Wszystkie firmy
                </Text>
              </Pressable>
              {companies.map((c) => {
                const active = filterCompany === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setFilterCompany(active ? "all" : c)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: active ? COLORS.primary : COLORS.border,
                      backgroundColor: active ? COLORS.primary : COLORS.surface,
                    }}
                  >
                    <Text
                      style={{
                        color: active ? COLORS.background : COLORS.foreground,
                        fontSize: 13,
                        fontWeight: "700",
                      }}
                    >
                      {c}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View
            className="bg-surface border border-border rounded-2xl p-3 mb-5"
            style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>
              Grubość (mm)
            </Text>
            <View style={{ flex: 1 }}>
              <Field
                placeholder="od"
                value={filterThicknessFrom}
                onChangeText={setFilterThicknessFrom}
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={{ color: COLORS.muted }}>—</Text>
            <View style={{ flex: 1 }}>
              <Field
                placeholder="do"
                value={filterThicknessTo}
                onChangeText={setFilterThicknessTo}
                keyboardType="decimal-pad"
              />
            </View>
            {(filterThicknessFrom || filterThicknessTo) && (
              <Pressable
                onPress={() => {
                  setFilterThicknessFrom("");
                  setFilterThicknessTo("");
                }}
              >
                <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                  Wyczyść
                </Text>
              </Pressable>
            )}
          </View>
        </>
      )}

      {filteredFamilies.length === 0 && families.length > 0 && (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <Text className="text-sm text-muted">
            Żadna technologia nie pasuje do wybranych filtrów.
          </Text>
        </View>
      )}

      {filteredFamilies.length > 0 && (
        <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-5">
          {filteredFamilies.map(([active, ...history], i) => (
            <View
              key={active.code}
              style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: COLORS.border }}
            >
              <Pressable
                onPress={() => setExpandedId(expandedId === active.id ? null : active.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              >
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                    {active.name}
                  </Text>
                  <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                    {active.code} · v{active.version}
                    {history.length > 0 ? ` · ${history.length} starszych wersji` : ""}
                    {active.company ? ` · ${active.company}` : ""}
                    {active.thicknessMinMm && active.thicknessMaxMm
                      ? active.thicknessMinMm === active.thicknessMaxMm
                        ? ` · ${active.thicknessMinMm} mm`
                        : ` · ${active.thicknessMinMm}–${active.thicknessMaxMm} mm`
                      : ""}
                  </Text>
                </View>
                <Pressable
                  onPress={() => startEdit(active)}
                  style={{
                    backgroundColor: COLORS.primary,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    marginRight: 10,
                  }}
                >
                  <Text style={{ color: COLORS.background, fontWeight: "700", fontSize: 12 }}>
                    Edytuj
                  </Text>
                </Pressable>
                <Text style={{ color: COLORS.muted, fontSize: 16, fontWeight: "700" }}>
                  {expandedId === active.id ? "▲" : "▼"}
                </Text>
              </Pressable>
              {expandedId === active.id && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  {/* Tabela Warstwa/Materiał/Dawka zamiast stackowanych
                      etykiet — warstwa pokazana tylko przy pierwszym
                      wierszu grupy (jak scalona komórka), reszta wierszy
                      tej samej warstwy zostaje pusta w tej kolumnie. */}
                  <View
                    style={{
                      flexDirection: "row",
                      paddingBottom: 6,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.border,
                    }}
                  >
                    <Text style={{ flex: 1, color: COLORS.muted, fontSize: 11 }}>Warstwa</Text>
                    <Text style={{ flex: 2, color: COLORS.muted, fontSize: 11 }}>Materiał</Text>
                    <Text style={{ color: COLORS.muted, fontSize: 11, textAlign: "right" }}>
                      Dawka
                    </Text>
                  </View>
                  {[...active.technology_stages]
                    .sort((a, b) => a.orderIndex - b.orderIndex)
                    .map((s) =>
                      s.technology_materials.map((m, mi) => (
                        <View
                          key={m.id}
                          style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6 }}
                        >
                          <Text style={{ flex: 1, color: COLORS.muted, fontSize: 12 }}>
                            {mi === 0 ? s.name : ""}
                          </Text>
                          <Text style={{ flex: 2, color: COLORS.foreground, fontSize: 12 }}>
                            {m.materialName}
                          </Text>
                          <Text
                            style={{
                              color: COLORS.foreground,
                              fontWeight: "700",
                              fontSize: 12,
                              textAlign: "right",
                            }}
                          >
                            {m.consumptionPerM2} {m.unit}/m²
                          </Text>
                        </View>
                      )),
                    )}
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      <Modal
        visible={materialPicker != null}
        animationType="slide"
        transparent
        onRequestClose={() => setMaterialPicker(null)}
      >
        <Pressable
          onPress={() => setMaterialPicker(null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: COLORS.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 16,
              maxHeight: "75%",
            }}
          >
            <Text style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 15, marginBottom: 12 }}>
              Wybierz materiał magazynowy
            </Text>
            <Field
              placeholder="🔍 Szukaj materiału…"
              value={materialPickerQuery}
              onChangeText={setMaterialPickerQuery}
              autoCapitalize="none"
            />
            <ScrollView style={{ marginTop: 12 }} keyboardShouldPersistTaps="handled">
              <Pressable
                onPress={() => {
                  if (materialPicker) {
                    updateMaterial(materialPicker.stageKey, materialPicker.materialKey, {
                      linkedMaterialId: "",
                    });
                  }
                  setMaterialPicker(null);
                }}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 4,
                  borderBottomWidth: 1,
                  borderBottomColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.muted, fontSize: 13, fontWeight: "700" }}>
                  Nie przypisuj (brak)
                </Text>
              </Pressable>
              {(materialPickerQuery.trim()
                ? matchMaterialNames(materialPickerQuery, materials, 50).map((m) => m.candidate)
                : materials
              ).map((wm) => {
                const full = materials.find((m) => m.id === wm.id)!;
                return (
                  <Pressable
                    key={wm.id}
                    onPress={() => {
                      if (materialPicker) {
                        updateMaterial(materialPicker.stageKey, materialPicker.materialKey, {
                          linkedMaterialId: wm.id,
                        });
                      }
                      setMaterialPicker(null);
                    }}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 4,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.border,
                    }}
                  >
                    <Text style={{ color: COLORS.foreground, fontSize: 13, fontWeight: "600" }}>
                      {full.name}
                    </Text>
                    <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                      {full.index} · na magazynie: {full.stock ?? 0} {full.unit}
                    </Text>
                  </Pressable>
                );
              })}
              {materials.length === 0 && (
                <Text style={{ color: COLORS.muted, fontSize: 12, paddingVertical: 10 }}>
                  Brak materiałów w magazynie — dodaj materiał w zakładce Magazyn, żeby móc go tu
                  powiązać.
                </Text>
              )}
            </ScrollView>
            <View style={{ marginTop: 12 }}>
              <Button label="Zamknij" secondary onPress={() => setMaterialPicker(null)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
