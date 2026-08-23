import {
  Pressable,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import {
  Button,
  COLORS,
  Field,
  formatPLN,
  QuantityStepper,
  ScreenHeader,
  UNIT_OPTIONS,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

export function WarehouseScreen() {
  const {
    query,
    showMaterial,
    newMaterial,
    setQuery,
    setShowMaterial,
    setNewMaterial,
    filtered,
    warehouseBatches,
    saveMaterial,
    updateMaterialPrice,
    updateMaterialStock,
  } = useAppData();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [stockInput, setStockInput] = useState("");

  return (
    <>
  <>
    <View className="flex-row justify-between items-start mb-5">
      <ScreenHeader eyebrow="MAGAZYN / STAN" title="Materiały" />
      <Button
        label="+ Dodaj"
        onPress={() => setShowMaterial(!showMaterial)}
      />
    </View>
    {showMaterial && (
      <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
        <Field
          placeholder="Nazwa materiału"
          value={newMaterial.name}
          onChangeText={(v: string) =>
            setNewMaterial({ ...newMaterial, name: v })
          }
        />
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
          >
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-foreground">
                {m.name}
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
                  <View style={{ marginBottom: 14 }}>
                    <Text className="text-xs text-muted uppercase mb-2">
                      Partie w magazynie ({batches.length})
                    </Text>
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
                  </View>
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
                  onPress={() => {
                    updateMaterialStock(m.id, Number(stockInput) || 0);
                    updateMaterialPrice(m.id, Number(priceInput) || 0);
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
