import {
  Pressable,
  Text,
  View,
} from "react-native";
import { useMemo, useState } from "react";
import {
  Button,
  COLORS,
  DetailSection,
  Field,
  formatPLN,
  QuantityStepper,
  ScreenHeader,
  UNIT_OPTIONS,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";
import { matchMaterialNames, normalizeMaterialName } from "@/lib/material-name-match";

export function WarehouseScreen() {
  const {
    query,
    showMaterial,
    newMaterial,
    showArchivedMaterials,
    setQuery,
    setShowMaterial,
    setShowArchivedMaterials,
    setNewMaterial,
    filtered,
    materials,
    warehouseBatches,
    saveMaterial,
    updateMaterialPrice,
    updateMaterialStock,
    setMaterialActive,
  } = useAppData();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [stockInput, setStockInput] = useState("");
  // Podpowiedzi przy dodawaniu NOWEGO materiału — ten sam mechanizm co w
  // Zamówieniach (orders-screen.tsx), żeby nie powstał cichy duplikat pod
  // nieco inną nazwą/literówką tego, co już jest w magazynie.
  const [newNameFocused, setNewNameFocused] = useState(false);
  const newMaterialSuggestions = useMemo(() => {
    const matches = matchMaterialNames(
      newMaterial.name,
      materials.map((m) => ({ id: m.id, name: m.name })),
    );
    const byId = new Map(materials.map((m) => [m.id, m]));
    return matches.map((m) => byId.get(m.candidate.id)).filter((m): m is (typeof materials)[number] => !!m);
  }, [newMaterial.name, materials]);
  const showNewMaterialSuggestions =
    newNameFocused && newMaterial.name.trim().length > 0;
  const exactNewMaterialMatch = materials.find(
    (m) => normalizeMaterialName(m.name) === normalizeMaterialName(newMaterial.name),
  );

  return (
    <>
  <>
    <ScreenHeader
      title="Materiały"
      action={<Button label="+ Dodaj" onPress={() => setShowMaterial(!showMaterial)} />}
    />
    {showMaterial && (
      <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
        <Field
          placeholder="Nazwa materiału"
          value={newMaterial.name}
          onChangeText={(v: string) =>
            setNewMaterial({ ...newMaterial, name: v })
          }
          onFocus={() => setNewNameFocused(true)}
          onBlur={() => {
            // Małe opóźnienie, żeby tapnięcie w podpowiedź zdążyło się
            // zarejestrować zanim lista zniknie (ten sam wzorzec co w
            // orders-screen.tsx).
            setTimeout(() => setNewNameFocused(false), 150);
          }}
        />
        {showNewMaterialSuggestions && newMaterialSuggestions.length > 0 && (
          <View
            style={{
              backgroundColor: COLORS.background,
              borderRadius: 10,
              marginTop: 6,
              overflow: "hidden",
            }}
          >
            {newMaterialSuggestions.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => {
                  setNewMaterial({ ...newMaterial, name: m.name, unit: m.unit });
                  setNewNameFocused(false);
                }}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.foreground, fontSize: 13, fontWeight: "600" }}>
                  {m.name}
                </Text>
                <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                  {m.index} · na magazynie: {m.stock ?? 0} {m.unit}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {exactNewMaterialMatch && (
          <Text style={{ color: COLORS.warning, fontSize: 11, marginTop: 4 }}>
            Materiał o tej nazwie już jest w magazynie ({exactNewMaterialMatch.index}) —
            może lepiej dopisać do niego partię/skorygować stan, zamiast tworzyć duplikat?
          </Text>
        )}
        <Field
          placeholder="Indeks"
          value={newMaterial.index}
          onChangeText={(v: string) =>
            setNewMaterial({ ...newMaterial, index: v })
          }
        />
        <View style={{ marginTop: 10 }}>
          <Text className="text-xs text-muted uppercase mb-2">Jednostka</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {UNIT_OPTIONS.map((unit) => (
              <Pressable
                key={unit}
                onPress={() => setNewMaterial({ ...newMaterial, unit })}
                style={{
                  backgroundColor:
                    newMaterial.unit === unit ? COLORS.primary : COLORS.background,
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor:
                    newMaterial.unit === unit ? COLORS.primary : COLORS.border,
                }}
              >
                <Text
                  style={{
                    color:
                      newMaterial.unit === unit ? COLORS.background : COLORS.foreground,
                    fontWeight: "700",
                  }}
                >
                  {unit}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field
            placeholder="albo wpisz własną jednostkę"
            value={newMaterial.unit}
            onChangeText={(v: string) => setNewMaterial({ ...newMaterial, unit: v })}
            style={{ marginTop: 8 }}
          />
        </View>
        <View style={{ marginTop: 10 }}>
          <Text className="text-xs text-muted uppercase">
            Ilość początkowa ({newMaterial.unit || "szt."})
          </Text>
          <QuantityStepper
            style={{ marginTop: 8 }}
            value={newMaterial.stock}
            onChangeText={(v: string) =>
              setNewMaterial({ ...newMaterial, stock: v })
            }
          />
        </View>
        <View style={{ marginTop: 10 }}>
          <Text className="text-xs text-muted uppercase">
            Stan minimalny ({newMaterial.unit || "szt."})
          </Text>
          <Text className="text-xs text-muted mt-0.5 mb-2">
            Poziom, który powinien być utrzymywany na magazynie — spadek
            poniżej niego oznaczy materiał jako brakujący.
          </Text>
          <QuantityStepper
            value={newMaterial.min}
            onChangeText={(v: string) =>
              setNewMaterial({ ...newMaterial, min: v })
            }
          />
        </View>
        <View style={{ marginTop: 10 }}>
          <Text className="text-xs text-muted uppercase">
            Cena jednostkowa (PLN)
          </Text>
          <QuantityStepper
            style={{ marginTop: 8 }}
            value={newMaterial.unitPrice}
            onChangeText={(v: string) =>
              setNewMaterial({ ...newMaterial, unitPrice: v })
            }
          />
        </View>
        <View style={{ marginTop: 12 }}>
          <Button label="Zapisz materiał" onPress={saveMaterial} />
        </View>
      </View>
    )}
    <Field
      placeholder="Szukaj po nazwie lub indeksie"
      value={query}
      onChangeText={setQuery}
    />
    <Pressable
      onPress={() => setShowArchivedMaterials(!showArchivedMaterials)}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: showArchivedMaterials ? COLORS.primary : COLORS.border,
          backgroundColor: showArchivedMaterials ? COLORS.primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {showArchivedMaterials && (
          <Text style={{ color: COLORS.background, fontSize: 12, fontWeight: "800" }}>✓</Text>
        )}
      </View>
      <Text style={{ color: COLORS.foreground, fontSize: 13 }}>
        Pokaż zarchiwizowane materiały
      </Text>
    </Pressable>
    <View className="mt-4 rounded-2xl border border-border overflow-hidden">
      {filtered.map((m, i) => {
        const batchCount = warehouseBatches.filter(
          (b) => String(b.materialId) === m.id,
        ).length;
        return (
        <View
          key={m.id}
          className={i > 0 ? "border-t border-border" : ""}
        >
          <Pressable
            onPress={() => {
              if (editingId === m.id) {
                setEditingId(null);
              } else {
                setEditingId(m.id);
                setPriceInput(String(m.unitPrice || ""));
                setStockInput(String(m.stock ?? ""));
              }
            }}
            className="flex-row items-center justify-between px-4 py-3"
            style={{ opacity: m.active ? 1 : 0.55 }}
          >
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-foreground">
                {m.name}
                {!m.active ? " · zarchiwizowany" : ""}
              </Text>
              <Text className="text-xs text-muted mt-0.5">
                {m.index} · {m.unit} · min {m.min} · śr.{" "}
                {formatPLN(m.unitPrice || 0)}/{m.unit}
                {batchCount > 1 ? ` · ${batchCount} partie` : ""}
              </Text>
            </View>
            <Text
              className={`text-lg font-bold ${m.stock <= m.min ? "text-warning" : "text-foreground"}`}
            >
              {m.stock}
            </Text>
          </Pressable>
          {editingId === m.id && (
            <View className="px-4 pb-4">
              {(() => {
                // Faza 4 — realne partie z bazy (data, ilość dostępna,
                // cena, dokument, dostawca), zamiast wcześniejszej
                // odtworzonej z samego stanu jednej fikcyjnej pozycji.
                const batches = warehouseBatches
                  .filter((b) => String(b.materialId) === m.id)
                  .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
                if (batches.length === 0) return null;
                const prices = batches.map((b) => Number(b.unitPrice));
                const minPrice = Math.min(...prices);
                return (
                  <DetailSection
                    label="Partie w magazynie"
                    count={batches.length}
                    style={{ marginTop: 0, marginBottom: 14 }}
                  >
                    {batches.map((b) => {
                      const price = Number(b.unitPrice);
                      return (
                        <View
                          key={b.id}
                          style={{
                            paddingVertical: 6,
                            borderBottomWidth: 1,
                            borderBottomColor: COLORS.border,
                          }}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text style={{ color: COLORS.foreground, fontSize: 13 }}>
                              {b.quantity} {m.unit} · {b.source} · {b.receivedAt}
                            </Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              {price > minPrice && (
                                <View
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: 3,
                                    backgroundColor: COLORS.warning,
                                  }}
                                />
                              )}
                              <Text
                                style={{
                                  color: price > minPrice ? COLORS.warning : COLORS.muted,
                                  fontWeight: "700",
                                  fontSize: 13,
                                }}
                              >
                                {formatPLN(price)}
                              </Text>
                            </View>
                          </View>
                          {(b.documentNumber || b.supplier) && (
                            <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                              {[b.documentNumber, b.supplier].filter(Boolean).join(" · ")}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </DetailSection>
                );
              })()}
              <Text className="text-xs text-muted uppercase mb-2">
                Popraw stan i cenę (np. w razie pomyłki)
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 6 }}>
                    Stan magazynowy
                  </Text>
                  <QuantityStepper value={stockInput} onChangeText={setStockInput} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 6 }}>
                    Cena jednostkowa (PLN)
                  </Text>
                  <QuantityStepper value={priceInput} onChangeText={setPriceInput} />
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                <Button
                  label="Zapisz zmiany"
                  onPress={async () => {
                    // Sekwencyjnie, nie równolegle: korekta stanu w górę
                    // dopisuje partię i przelicza materials.unitPrice jako
                    // średnią ważoną partii (fn_recalc_material) — gdyby
                    // updateMaterialPrice leciał w tym samym czasie,
                    // wynik wyścigu dwóch zapisów do tej samej kolumny był
                    // nieprzewidywalny. Cena wpisana ręcznie ma być
                    // ostateczna, więc idzie DRUGA, po zakończeniu korekty
                    // stanu.
                    await updateMaterialStock(m.id, Number(stockInput) || 0);
                    await updateMaterialPrice(m.id, Number(priceInput) || 0);
                    setEditingId(null);
                  }}
                />
              </View>
              {/* Archiwizacja zamiast usuwania — materiał zostaje w bazie
                  (historia go referencjuje), tylko znika z domyślnej listy;
                  wciąż podpowiadany przy dopasowaniu nazwy przy zamawianiu/
                  dodawaniu, żeby nie powstał duplikat indeksu/nazwy.
                  Tylko przy stanie zero — inaczej dałoby się ukryć z
                  widoku materiał, który wciąż fizycznie jest na magazynie
                  (zablokowane też w bazie, set_material_active). */}
              {m.active && m.stock !== 0 && (
                <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 10 }}>
                  Archiwizacja możliwa tylko przy stanie magazynowym równym
                  zero (skoryguj stan wyżej).
                </Text>
              )}
              <View style={{ marginTop: 10 }}>
                <Button
                  label={m.active ? "Archiwizuj materiał" : "Przywróć materiał"}
                  secondary
                  disabled={m.active && m.stock !== 0}
                  onPress={() => {
                    setMaterialActive(m.id, !m.active);
                    setEditingId(null);
                  }}
                />
              </View>
            </View>
          )}
        </View>
        );
      })}
      {filtered.length === 0 && (
        <View className="px-4 py-6">
          <Text className="text-sm text-muted text-center">
            Brak materiałów pasujących do wyszukiwania.
          </Text>
        </View>
      )}
    </View>
  </>
    </>
  );
}
