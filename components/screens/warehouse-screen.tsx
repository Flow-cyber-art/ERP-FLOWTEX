import {
  Pressable,
  Text,
  View,
} from "react-native";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  COLORS,
  DetailSection,
  Field,
  formatPLN,
  QuantityStepper,
  ScreenHeader,
  SearchField,
  SearchablePicker,
  SegmentedControl,
  ToggleChip,
  UNIT_OPTIONS,
} from "@/components/report-ui";
import { useAppData, type NewMaterialInput } from "@/contexts/app-data";
import { useWideLayout } from "@/hooks/use-wide-layout";
import { matchMaterialNames, normalizeMaterialName } from "@/lib/material-name-match";
import { RADIUS } from "@/constants/radius";
import { listMaterialCorrections } from "@/lib/data/materials";
import { Icon } from "@/components/icon";

const EMPTY_NEW_MATERIAL: NewMaterialInput = {
  name: "",
  index: "",
  unit: "szt.",
  stock: "0",
  min: "5",
  unitPrice: "0",
};

export function WarehouseScreen() {
  const {
    materials,
    builds,
    realRole,
    warehouseBatches,
    buildMaterialLots,
    saveMaterial,
    correctMaterial,
    updateMaterialIndex,
    setMaterialActive,
    transferMaterialBetweenBuilds,
  } = useAppData();

  const [query, setQuery] = useState("");
  const isWide = useWideLayout();
  // Domyślnie ukrywa zarchiwizowane materiały na liście Magazynu (ten sam
  // wzorzec co showArchivedBuilds w settlement-screen.tsx) — wciąż
  // podpowiadane przy dopasowaniu nazwy (materials pozostaje pełną listą),
  // tylko nie zaśmiecają widoku do codziennej pracy.
  const [showArchivedMaterials, setShowArchivedMaterials] = useState(false);
  // Budowy są podmagazynami. Ten sam indeks może mieć jednocześnie część
  // zapasu w magazynie głównym i część na jednej lub wielu budowach.
  // materiał może mieć CZĘŚĆ ilości przypisaną do budowy i CZĘŚĆ nadal
  // wolną w głównym magazynie naraz (np. partia 5 szt., 2 poszły na
  // budowę, 3 zostały wolne) — to NIE jest stan wykluczający się.
  // "Nieprzypisane" = materiał ma jeszcze wolną ilość w magazynie
  // (materials.stock > 0 — suma NIEZUŻYTYCH partii, fn_recalc_material w
  // supabase/sql/001_rpc_functions.sql; ilość przypisana do budowy
  // przechodzi do build_material_lots i przestaje liczyć się do stock).
  // "Przypisane" patrzy na build_material_lots (partie FIZYCZNIE leżące
  // dziś w podmagazynie jakiejś budowy), NIE na build_materials —
  // build_materials to trwały, historyczny rekord (planned/used/koszt do
  // rozliczeń), który zostaje na zawsze nawet po zwrocie/zamknięciu
  // budowy. Filtrowanie po build_materials pokazywało materiał jako
  // "Przypisany" na zawsze, mimo że po zamknięciu budowy realnie wrócił
  // do magazynu głównego i nie ma już żadnej partii na żadnej budowie.
  const [assignmentFilter, setAssignmentFilter] = useState<
    "all" | "assigned" | "unassigned"
  >("all");
  const [selectedSiteBuildId, setSelectedSiteBuildId] = useState<string | "all">("all");
  const [buildPickerOpen, setBuildPickerOpen] = useState(false);
  const [buildPickerQuery, setBuildPickerQuery] = useState("");
  const activeBuilds = useMemo(
    () => builds.filter((b) => b.status !== "zamknięta"),
    [builds],
  );
  const siteQuantityByMaterial = useMemo(() => {
    const totals = new Map<string, number>();
    for (const lot of buildMaterialLots) {
      if (Number(lot.quantity) <= 0) continue;
      if (selectedSiteBuildId !== "all" && String(lot.buildId) !== selectedSiteBuildId) continue;
      const materialId = String(lot.materialId);
      totals.set(materialId, (totals.get(materialId) ?? 0) + Number(lot.quantity));
    }
    return totals;
  }, [buildMaterialLots, selectedSiteBuildId]);
  const [transferSource, setTransferSource] = useState<{
    buildId: string;
    materialId: string;
  } | null>(null);
  const [transferTargetBuildId, setTransferTargetBuildId] = useState<string | null>(null);
  const [transferQuantity, setTransferQuantity] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferPickerOpen, setTransferPickerOpen] = useState(false);
  const [transferPickerQuery, setTransferPickerQuery] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [showMaterial, setShowMaterial] = useState(false);
  const [newMaterial, setNewMaterial] = useState<NewMaterialInput>(EMPTY_NEW_MATERIAL);
  const filtered = useMemo(
    () =>
      materials
        .filter((m) => showArchivedMaterials || m.active)
        .filter((m) =>
          `${m.name} ${m.index}`.toLowerCase().includes(query.toLowerCase()),
        )
        .filter((m) => {
          if (assignmentFilter === "all") return true;
          if (assignmentFilter === "assigned") return (siteQuantityByMaterial.get(m.id) ?? 0) > 0;
          return m.stock > 0;
        }),
    [materials, query, showArchivedMaterials, assignmentFilter, siteQuantityByMaterial],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [stockInput, setStockInput] = useState("");
  const [indexInput, setIndexInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  // Historia korekt rozwiniętego materiału (kto, kiedy, było → jest) —
  // tylko dla Admina, bo tylko on może korygować i widzieć ceny.
  const editingMaterialId = editingId ? Number(editingId) : null;
  const { data: corrections = [], refetch: refetchCorrections } = useQuery({
    queryKey: ["materialCorrections", editingMaterialId],
    queryFn: () => listMaterialCorrections(editingMaterialId as number),
    enabled: editingMaterialId !== null && realRole === "Admin",
  });
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
      <View className="bg-surface border border-border rounded-card p-4 mb-4">
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
              borderRadius: RADIUS.control,
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
                  borderRadius: RADIUS.control,
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
          <Button
            label="Zapisz materiał"
            onPress={() =>
              saveMaterial(newMaterial, () => {
                setNewMaterial(EMPTY_NEW_MATERIAL);
                setShowMaterial(false);
              })
            }
          />
        </View>
      </View>
    )}
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <SearchField
          placeholder="Szukaj po nazwie lub indeksie"
          value={query}
          onChangeText={setQuery}
          style={{ marginTop: 0 }}
        />
      </View>
      {/* Mały przełącznik obok wyszukiwarki, nie osobny wiersz na pełną
          szerokość — to rzadko używana opcja (archiwum), nie jedno z
          głównych pytań, na które ekran ma odpowiadać (patrz filtr
          przypisania niżej), więc nie zasługuje na tyle samo miejsca. */}
      <ToggleChip label="Archiwum" value={showArchivedMaterials} onChange={setShowArchivedMaterials} />
    </View>
    <View style={{ marginTop: 10 }}>
      <SegmentedControl
        options={[
          { key: "all", label: "Wszystkie" },
          { key: "unassigned", label: "W magazynie" },
          { key: "assigned", label: "Na budowach" },
        ] as const}
        value={assignmentFilter}
        onChange={setAssignmentFilter}
      />
    </View>
    {assignmentFilter === "assigned" && (
      <>
        <Pressable
          onPress={() => {
            setBuildPickerQuery("");
            setBuildPickerOpen(true);
          }}
          className="bg-surface border border-border rounded-card"
          style={{
            marginTop: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
            <Text style={{ color: COLORS.muted, fontSize: 11 }}>Budowa</Text>
            <Text style={{ color: COLORS.foreground, fontWeight: "700", marginTop: 2 }} numberOfLines={1}>
              {selectedSiteBuildId === "all"
                ? "Wszystkie aktywne budowy"
                : (() => {
                    const build = builds.find((b) => b.id === selectedSiteBuildId);
                    return build ? `${build.number} · ${build.name}` : "Wszystkie aktywne budowy";
                  })()}
            </Text>
          </View>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>Zmień</Text>
        </Pressable>
        <SearchablePicker
          visible={buildPickerOpen}
          onClose={() => setBuildPickerOpen(false)}
          query={buildPickerQuery}
          onQueryChange={setBuildPickerQuery}
          placeholder="Szukaj budowy..."
          selectedKey={selectedSiteBuildId}
          onSelect={(key) => {
            setSelectedSiteBuildId(key as string | "all");
            setBuildPickerOpen(false);
          }}
          items={[
            { key: "all", title: "Wszystkie aktywne budowy" },
            ...activeBuilds
              .filter((b) => {
                const q = buildPickerQuery.trim().toLowerCase();
                return !q || `${b.number} ${b.name} ${b.address ?? ""}`.toLowerCase().includes(q);
              })
              .map((b) => ({
                key: b.id,
                title: `${b.number} · ${b.name}`,
                subtitle: b.address ?? undefined,
              })),
          ]}
        />
      </>
    )}
    {isWide && filtered.length > 0 && (
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Text style={{ flex: 1, color: COLORS.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>
          Materiał
        </Text>
        {[
          assignmentFilter === "assigned" ? "Budowy" : "Minimum",
          "Cena",
          assignmentFilter === "assigned" ? "Na budowach" : "Stan",
        ].map((h) => (
          <Text
            key={h}
            style={{ width: 110, textAlign: "right", color: COLORS.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}
          >
            {h}
          </Text>
        ))}
        <View style={{ width: 36 }} />
      </View>
    )}
    <View className={isWide ? "rounded-card border border-border overflow-hidden" : "mt-4 rounded-card border border-border overflow-hidden"}>
      {filtered.map((m, i) => {
        const batchCount = warehouseBatches.filter(
          (b) => String(b.materialId) === m.id,
        ).length;
        const displayedQuantity = assignmentFilter === "assigned"
          ? siteQuantityByMaterial.get(m.id) ?? 0
          : m.stock;
        const belowMinimum = assignmentFilter !== "assigned" && m.stock <= m.min;
        const siteRows = builds
          .filter((b) => b.status !== "zamknięta")
          .map((build) => ({
            build,
            quantity: buildMaterialLots
              .filter(
                (lot) =>
                  String(lot.buildId) === build.id &&
                  String(lot.materialId) === m.id &&
                  Number(lot.quantity) > 0,
              )
              .reduce((sum, lot) => sum + Number(lot.quantity), 0),
          }))
          .filter(
            ({ build, quantity }) =>
              quantity > 0 &&
              (selectedSiteBuildId === "all" || build.id === selectedSiteBuildId),
          );
        const scopedSiteLots = buildMaterialLots.filter(
          (lot) =>
            String(lot.materialId) === m.id &&
            Number(lot.quantity) > 0 &&
            (selectedSiteBuildId === "all" || String(lot.buildId) === selectedSiteBuildId),
        );
        const siteValue = scopedSiteLots.reduce(
          (sum, lot) => sum + Number(lot.quantity) * Number(lot.unitPrice),
          0,
        );
        const siteAveragePrice = displayedQuantity > 0 ? siteValue / displayedQuantity : 0;
        // Materiał bez ceny zaniża koszty budów — wyraźnie oznaczony na liście.
        const missingPrice =
          assignmentFilter === "assigned" ? displayedQuantity > 0 && siteAveragePrice <= 0 : (m.unitPrice || 0) <= 0;
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
                setIndexInput(m.index || "");
                setReasonInput("");
                setReasonError(false);
              }
            }}
            className="flex-row items-center justify-between px-4 py-3"
            style={{ opacity: m.active ? 1 : 0.55 }}
          >
            {isWide ? (
              <>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                    {m.name}
                    {!m.active ? " · zarchiwizowany" : ""}
                  </Text>
                  <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                    {m.index}
                    {batchCount > 1 ? ` · ${batchCount} partie` : ""}
                  </Text>
                </View>
                <Text style={{ width: 110, textAlign: "right", color: COLORS.muted, fontSize: 13 }}>
                  {assignmentFilter === "assigned"
                    ? `${siteRows.length} ${siteRows.length === 1 ? "budowa" : "budowy"}`
                    : `${m.min} ${m.unit}`}
                </Text>
                <Text
                  style={{
                    width: 110,
                    textAlign: "right",
                    color: missingPrice ? COLORS.warning : COLORS.foreground,
                    fontSize: 13,
                    fontWeight: missingPrice ? "700" : "400",
                  }}
                >
                  {missingPrice
                    ? "brak ceny"
                    : `${formatPLN(assignmentFilter === "assigned" ? siteAveragePrice : m.unitPrice || 0)}/${m.unit}`}
                </Text>
                {/* Kolor ostrzeżenia = konkretny sygnał "stan na/poniżej
                    minimum", nie dekoracja; złoto zostaje dla akcji. */}
                <Text
                  style={{
                    width: 110,
                    textAlign: "right",
                    fontSize: 15,
                    fontWeight: "700",
                    color: belowMinimum ? COLORS.warning : COLORS.foreground,
                  }}
                >
                  {displayedQuantity} {m.unit}
                </Text>
                <View style={{ width: 36, alignItems: "flex-end" }}>
                  <Icon
                    name={editingId === m.id ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={COLORS.muted}
                  />
                </View>
              </>
            ) : (
              <>
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-foreground">
                {m.name}
                {!m.active ? " · zarchiwizowany" : ""}
              </Text>
              <Text className="text-xs text-muted mt-0.5">
                {m.index}
                {batchCount > 1 ? ` · ${batchCount} partie` : ""}
              </Text>
            </View>
            {/* Metadane w stałej kolumnie zamiast jednej zbitej linijki ze
                zmienną długością — łatwiej porównać min/cenę między
                pozycjami, bo są zawsze w tym samym miejscu. */}
            <View className="items-end pr-3">
              <Text className="text-xs text-muted">
                {assignmentFilter === "assigned"
                  ? `${siteRows.length} ${siteRows.length === 1 ? "budowa" : "budowy"}`
                  : `min ${m.min} ${m.unit}`}
              </Text>
              <Text
                className="text-xs mt-0.5"
                style={{
                  color: missingPrice ? COLORS.warning : COLORS.muted,
                  fontWeight: missingPrice ? "700" : "400",
                }}
              >
                {missingPrice
                  ? "brak ceny"
                  : `${formatPLN(assignmentFilter === "assigned" ? siteAveragePrice : m.unitPrice || 0)}/${m.unit}`}
              </Text>
            </View>
            <View className="items-end" style={{ minWidth: 44 }}>
              {/* Pomarańczowy = konkretny sygnał "stan na/poniżej minimum",
                  nie dekoracja — standardowy kolor, gdy stan jest OK. */}
              <Text
                className="text-lg font-bold"
                style={{ color: belowMinimum ? COLORS.warning : COLORS.foreground }}
              >
                {displayedQuantity}
              </Text>
              <Text className="text-xs text-muted">{m.unit}</Text>
            </View>
              </>
            )}
          </Pressable>
          {editingId === m.id && (
            <View className="px-4 pb-4">
              {assignmentFilter === "assigned" && (
                <DetailSection
                  label="Stan na budowach"
                  count={siteRows.length}
                  style={{ marginTop: 0, marginBottom: 14 }}
                >
                  {siteRows.map(({ build, quantity }) => {
                    const transferOpen =
                      transferSource?.buildId === build.id &&
                      transferSource.materialId === m.id;
                    const targetBuild = builds.find((b) => b.id === transferTargetBuildId);
                    return (
                      <View
                        key={build.id}
                        style={{
                          paddingVertical: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: COLORS.border,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: COLORS.foreground, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>
                              {build.number} · {build.name}
                            </Text>
                            <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>
                              {quantity} {m.unit}
                            </Text>
                          </View>
                          {realRole === "Admin" && (
                            <Pressable
                              onPress={() => {
                                if (transferOpen) {
                                  setTransferSource(null);
                                } else {
                                  setTransferSource({ buildId: build.id, materialId: m.id });
                                  setTransferTargetBuildId(null);
                                  setTransferQuantity("");
                                  setTransferNote("");
                                }
                              }}
                              style={({ pressed }) => ({
                                borderWidth: 1,
                                borderColor: COLORS.border,
                                borderRadius: RADIUS.control,
                                paddingHorizontal: 10,
                                paddingVertical: 7,
                                opacity: pressed ? 0.7 : 1,
                              })}
                            >
                              <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: "700" }}>
                                {transferOpen ? "Anuluj" : "Przenieś"}
                              </Text>
                            </Pressable>
                          )}
                        </View>

                        {transferOpen && (
                          <View
                            style={{
                              marginTop: 12,
                              padding: 12,
                              backgroundColor: COLORS.background,
                              borderRadius: RADIUS.control,
                            }}
                          >
                            <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 6 }}>
                              Do budowy
                            </Text>
                            <Pressable
                              onPress={() => {
                                setTransferPickerQuery("");
                                setTransferPickerOpen(true);
                              }}
                              style={{
                                borderWidth: 1,
                                borderColor: COLORS.border,
                                borderRadius: RADIUS.control,
                                paddingHorizontal: 12,
                                paddingVertical: 11,
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <Text style={{ color: targetBuild ? COLORS.foreground : COLORS.muted, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
                                {targetBuild
                                  ? `${targetBuild.number} · ${targetBuild.name}`
                                  : "Wybierz budowę docelową"}
                              </Text>
                              <Icon name="chevron-down" size={18} color={COLORS.muted} />
                            </Pressable>
                            <SearchablePicker
                              visible={transferPickerOpen}
                              onClose={() => setTransferPickerOpen(false)}
                              query={transferPickerQuery}
                              onQueryChange={setTransferPickerQuery}
                              placeholder="Szukaj budowy docelowej..."
                              selectedKey={transferTargetBuildId ?? undefined}
                              onSelect={(key) => {
                                setTransferTargetBuildId(key);
                                setTransferPickerOpen(false);
                              }}
                              items={activeBuilds
                                .filter((candidate) => candidate.id !== build.id)
                                .filter((candidate) => {
                                  const q = transferPickerQuery.trim().toLowerCase();
                                  return !q || `${candidate.number} ${candidate.name} ${candidate.address ?? ""}`.toLowerCase().includes(q);
                                })
                                .map((candidate) => ({
                                  key: candidate.id,
                                  title: `${candidate.number} · ${candidate.name}`,
                                  subtitle: candidate.address ?? undefined,
                                }))}
                            />

                            <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 12, marginBottom: 6 }}>
                              Ilość · dostępne {quantity} {m.unit}
                            </Text>
                            <QuantityStepper
                              value={transferQuantity}
                              onChangeText={setTransferQuantity}
                              min={0}
                              unit={m.unit}
                            />
                            <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 12, marginBottom: 6 }}>
                              Uwaga opcjonalna
                            </Text>
                            <Field
                              value={transferNote}
                              onChangeText={setTransferNote}
                              placeholder="Np. nadwyżka po zakończeniu etapu"
                            />
                            <View style={{ marginTop: 12 }}>
                              <Button
                                label={transferSubmitting ? "Przenoszenie..." : "Przenieś materiał"}
                                fullWidth
                                disabled={
                                  transferSubmitting ||
                                  !transferTargetBuildId ||
                                  Number(transferQuantity) <= 0 ||
                                  Number(transferQuantity) > quantity
                                }
                                onPress={async () => {
                                  if (!transferTargetBuildId) return;
                                  setTransferSubmitting(true);
                                  const success = await transferMaterialBetweenBuilds({
                                    sourceBuildId: build.id,
                                    targetBuildId: transferTargetBuildId,
                                    materialId: m.id,
                                    quantity: Number(transferQuantity),
                                    note: transferNote,
                                  });
                                  setTransferSubmitting(false);
                                  if (success) {
                                    setTransferSource(null);
                                    setTransferTargetBuildId(null);
                                    setTransferQuantity("");
                                    setTransferNote("");
                                  }
                                }}
                              />
                            </View>
                            <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 8 }}>
                              Partie zostaną pobrane automatycznie według FIFO.
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </DetailSection>
              )}
              {assignmentFilter !== "assigned" && (
                <>
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
                Korekta indeksu, stanu i ceny
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.muted, fontSize: 11, marginBottom: 6 }}>
                    Indeks
                  </Text>
                  <Field value={indexInput} onChangeText={setIndexInput} />
                </View>
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
              {(() => {
                const newStock = Number(stockInput);
                const newPrice = Number(priceInput);
                const stockChanged =
                  stockInput.trim() !== "" && Math.abs(newStock - (m.stock ?? 0)) >= 0.0001;
                const priceChanged =
                  priceInput.trim() !== "" && Math.abs(newPrice - (m.unitPrice || 0)) >= 0.005;
                const indexChanged = !!indexInput.trim() && indexInput.trim() !== m.index;
                const needsReason = stockChanged || priceChanged;
                const numbersInvalid =
                  (stockInput.trim() !== "" && (Number.isNaN(newStock) || newStock < 0)) ||
                  (priceInput.trim() !== "" && (Number.isNaN(newPrice) || newPrice < 0));
                return (
                  <>
                    {needsReason && (
                      <View style={{ marginTop: 10 }}>
                        <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                          Powód korekty (wymagany, trafi do historii ruchów)
                        </Text>
                        <Field
                          value={reasonInput}
                          onChangeText={(v: string) => {
                            setReasonInput(v);
                            if (v.trim().length >= 3) setReasonError(false);
                          }}
                          placeholder="Np. inwentaryzacja 23.11, pomyłka przy przyjęciu"
                          style={reasonError ? { borderWidth: 1, borderColor: COLORS.danger } : null}
                        />
                        {reasonError && (
                          <Text style={{ color: COLORS.danger, fontSize: 11, marginTop: 4 }}>
                            Podaj powód korekty (min. 3 znaki).
                          </Text>
                        )}
                        {stockChanged && (
                          <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 4 }}>
                            Stan: {m.stock ?? 0} → {newStock} {m.unit}
                            {newStock > (m.stock ?? 0)
                              ? " (nowa partia „korekta”)"
                              : " (zdjęcie z najstarszych partii)"}
                          </Text>
                        )}
                        {priceChanged && (
                          <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                            Cena: {formatPLN(m.unitPrice || 0)} → {formatPLN(newPrice)} (dla wszystkich
                            partii w magazynie głównym; partie na budowach bez zmian)
                          </Text>
                        )}
                      </View>
                    )}
                    {numbersInvalid && (
                      <Text style={{ color: COLORS.danger, fontSize: 11, marginTop: 8 }}>
                        Stan i cena muszą być liczbami nieujemnymi.
                      </Text>
                    )}
                    <View style={{ marginTop: 12 }}>
                      <Button
                        label={correctionSaving ? "Zapisywanie..." : "Zapisz korektę"}
                        disabled={
                          correctionSaving || numbersInvalid || (!needsReason && !indexChanged)
                        }
                        onPress={async () => {
                          if (needsReason && reasonInput.trim().length < 3) {
                            setReasonError(true);
                            return;
                          }
                          setCorrectionSaving(true);
                          try {
                            if (indexChanged) {
                              await updateMaterialIndex(m.id, indexInput.trim());
                            }
                            if (needsReason) {
                              const ok = await correctMaterial(m.id, {
                                newStock: stockChanged ? newStock : null,
                                newPrice: priceChanged ? newPrice : null,
                                reason: reasonInput.trim(),
                              });
                              if (!ok) return;
                              await refetchCorrections();
                            }
                            setReasonInput("");
                            setReasonError(false);
                            setEditingId(null);
                          } finally {
                            setCorrectionSaving(false);
                          }
                        }}
                      />
                    </View>
                  </>
                );
              })()}
              {corrections.length > 0 && (
                <DetailSection
                  label="Ostatnie korekty"
                  count={corrections.length}
                  style={{ marginTop: 14 }}
                >
                  {corrections.map((c) => (
                    <View
                      key={c.id}
                      style={{
                        paddingVertical: 6,
                        borderBottomWidth: 1,
                        borderBottomColor: COLORS.border,
                      }}
                    >
                      <Text style={{ color: COLORS.foreground, fontSize: 12 }}>{c.note}</Text>
                      <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 2 }}>
                        {c.createdByName} · {new Date(c.createdAt).toLocaleString("pl-PL")}
                      </Text>
                    </View>
                  ))}
                </DetailSection>
              )}
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
                </>
              )}
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
