import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  Button,
  COLORS,
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
} from "@/lib/data/technologies";

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

  const [technologies, setTechnologies] = useState<TechnologyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [stages, setStages] = useState<DraftStage[]>([emptyStage()]);
  const [busy, setBusy] = useState(false);

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

  const startNew = () => {
    setEditingSourceId(null);
    setCode("");
    setName("");
    setStages([emptyStage()]);
    setEditorOpen(true);
  };

  const startEdit = (t: TechnologyRow) => {
    setEditingSourceId(t.id);
    setCode(t.code);
    setName(t.name);
    setStages(
      t.technology_stages.length
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
        : [emptyStage()],
    );
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
    setBusy(true);
    setLoadError(null);
    try {
      await saveTechnology(editingSourceId, code.trim(), name.trim(), payload);
      setEditorOpen(false);
      reload();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Błąd.");
    } finally {
      setBusy(false);
    }
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
      <View className="flex-row justify-between items-start mb-5">
        <ScreenHeader
          eyebrow="KONFIGURACJA / TECHNOLOGIE"
          title="Technologie"
          description="Receptury posadzek — etapy, materiały, zużycie na m²."
        />
        <Button
          label={editorOpen ? "Anuluj" : "+ Nowa"}
          onPress={editorOpen ? () => setEditorOpen(false) : startNew}
        />
      </View>

      {editorOpen && (
        <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
          {editingSourceId != null && (
            <Text style={{ color: COLORS.warning, fontSize: 12, marginBottom: 10 }}>
              Zapis utworzy nową wersję tej technologii — poprzednia zostaje w historii,
              budowy które już ją mają przypisaną się nie zmienią.
            </Text>
          )}
          <Text className="text-xs text-muted uppercase mb-2">Kod (rodzina technologii)</Text>
          <Field placeholder="np. ST/PU/2" value={code} onChangeText={setCode} />
          <Text className="text-xs text-muted uppercase mb-2 mt-3">Nazwa</Text>
          <Field
            placeholder="np. Posadzka przemysłowa PU"
            value={name}
            onChangeText={setName}
          />

          {stages.map((stage, stageIdx) => (
            <View
              key={stage.key}
              style={{
                marginTop: 16,
                borderTopWidth: 1,
                borderTopColor: COLORS.border,
                paddingTop: 14,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: COLORS.muted, fontSize: 12, fontWeight: "700" }}>
                  ETAP {stageIdx + 1}
                </Text>
                <View style={{ flex: 1 }}>
                  <Field
                    placeholder="np. Gruntowanie"
                    value={stage.name}
                    onChangeText={(v: string) => updateStage(stage.key, { name: v })}
                  />
                </View>
                {stages.length > 1 && (
                  <Pressable
                    onPress={() => setStages((prev) => prev.filter((s) => s.key !== stage.key))}
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
                    marginTop: 10,
                    marginLeft: 14,
                    paddingLeft: 12,
                    borderLeftWidth: 2,
                    borderLeftColor: COLORS.border,
                  }}
                >
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
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
                        style={{ paddingTop: 12 }}
                      >
                        <Text style={{ color: COLORS.danger, fontSize: 12 }}>Usuń</Text>
                      </Pressable>
                    )}
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 16,
                      marginTop: 8,
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
                  {materials.length > 0 && (
                    <View style={{ marginTop: 8 }}>
                      <Text className="text-xs text-muted uppercase mb-2">
                        Powiąż z magazynem (opcjonalnie)
                      </Text>
                      <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
                        <Pressable
                          onPress={() =>
                            updateMaterial(stage.key, mat.key, { linkedMaterialId: "" })
                          }
                          style={{
                            backgroundColor:
                              mat.linkedMaterialId === "" ? COLORS.primary : COLORS.background,
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                            borderWidth: 1,
                            borderColor:
                              mat.linkedMaterialId === "" ? COLORS.primary : COLORS.border,
                          }}
                        >
                          <Text
                            style={{
                              color:
                                mat.linkedMaterialId === ""
                                  ? COLORS.background
                                  : COLORS.foreground,
                              fontWeight: "700",
                              fontSize: 12,
                            }}
                          >
                            Brak
                          </Text>
                        </Pressable>
                        {materials.map((wm) => (
                          <Pressable
                            key={wm.id}
                            onPress={() =>
                              updateMaterial(stage.key, mat.key, { linkedMaterialId: wm.id })
                            }
                            style={{
                              backgroundColor:
                                mat.linkedMaterialId === wm.id
                                  ? COLORS.primary
                                  : COLORS.background,
                              borderRadius: 8,
                              paddingHorizontal: 8,
                              paddingVertical: 6,
                              borderWidth: 1,
                              borderColor:
                                mat.linkedMaterialId === wm.id ? COLORS.primary : COLORS.border,
                            }}
                          >
                            <Text
                              style={{
                                color:
                                  mat.linkedMaterialId === wm.id
                                    ? COLORS.background
                                    : COLORS.foreground,
                                fontWeight: "700",
                                fontSize: 12,
                              }}
                            >
                              {wm.name}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              ))}

              <Pressable
                onPress={() =>
                  updateStage(stage.key, { materials: [...stage.materials, emptyMaterial()] })
                }
                style={{ marginTop: 10, marginLeft: 14 }}
              >
                <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                  + Dodaj materiał
                </Text>
              </Pressable>
            </View>
          ))}

          <Pressable
            onPress={() => setStages((prev) => [...prev, emptyStage()])}
            style={{ marginTop: 16 }}
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
        <View className="bg-surface border border-border rounded-2xl overflow-hidden mb-5">
          {families.map(([active, ...history], i) => (
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
                  </Text>
                </View>
                <Pressable onPress={() => startEdit(active)} style={{ marginRight: 14 }}>
                  <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 12 }}>
                    Edytuj
                  </Text>
                </Pressable>
                <Text style={{ color: COLORS.muted, fontSize: 13, fontWeight: "700" }}>
                  {expandedId === active.id ? "Zwiń" : "Szczegóły"}
                </Text>
              </Pressable>
              {expandedId === active.id && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                  {[...active.technology_stages]
                    .sort((a, b) => a.orderIndex - b.orderIndex)
                    .map((s) => (
                      <View key={s.id} style={{ marginBottom: 10 }}>
                        <Text
                          style={{ color: COLORS.foreground, fontWeight: "700", fontSize: 13 }}
                        >
                          {s.name}
                        </Text>
                        {s.technology_materials.map((m) => (
                          <Text
                            key={m.id}
                            style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}
                          >
                            {m.materialName} — {m.consumptionPerM2} {m.unit}/m²
                          </Text>
                        ))}
                      </View>
                    ))}
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </>
  );
}
