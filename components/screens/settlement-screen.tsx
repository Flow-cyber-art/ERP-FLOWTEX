import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { COLORS, formatPLN, ScreenHeader, SearchablePicker } from "@/components/report-ui";
import { ComparisonBarChart, DonutChart, KpiTile } from "@/components/charts";
import { useAppData } from "@/contexts/app-data";
import { normalizeMaterialName } from "@/lib/material-name-match";

/**
 * Faza 8 modułu Technologia — Rozliczenie budowy. Spina Fazy 0–7 w
 * jeden widok: plan / przypisano / zużyto / pozostało / koszt per etap
 * technologii (z zamrożonego snapshotu, Faza 2), plus materiały spoza
 * planu (Faza 5), kilometrówka (Faza 7) i koszty dodatkowe z raportów
 * (Faza 6) — razem koszt budowy, a naprzeciw kontrakt => zysk/marża.
 *
 * Do zamknięcia budowy (Faza 9) liczy się na żywo z bieżących danych.
 * Po zamknięciu budowa ma już zamrożone `build.settlement` (patrz
 * `close_build`, supabase/sql/001_rpc_functions.sql) — ten widok
 * wtedy pokazuje te zamrożone liczby zamiast przeliczać na nowo.
 */
export function SettlementScreen() {
  const {
    builds,
    materials,
    assignments,
    buildMaterialPlans,
    savedReports,
    employees,
    teamMembers,
    timeEntries,
    buildMaterialReturns,
  } = useAppData();

  const sortedBuilds = useMemo(
    () =>
      [...builds].sort((a, b) => {
        if (a.status !== b.status) return a.status === "aktywna" ? -1 : 1;
        return b.startDate.localeCompare(a.startDate);
      }),
    [builds],
  );

  // Ten sam picker co w Raportach Admina (manager-screen.tsx) — szukajka
  // + checkbox "Pokaż zarchiwizowane" zamiast rzędu chipów, który przy
  // większej liczbie budów trzeba przewijać w bok.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [buildQuery, setBuildQuery] = useState("");
  const [showArchivedBuilds, setShowArchivedBuilds] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visibleBuilds = useMemo(
    () => sortedBuilds.filter((b) => showArchivedBuilds || b.status !== "zamknięta"),
    [sortedBuilds, showArchivedBuilds],
  );
  const filteredBuilds = useMemo(() => {
    const q = buildQuery.trim().toLowerCase();
    if (!q) return visibleBuilds;
    return visibleBuilds.filter(
      (b) => b.number.toLowerCase().includes(q) || b.name.toLowerCase().includes(q),
    );
  }, [visibleBuilds, buildQuery]);

  const build =
    visibleBuilds.find((b) => b.id === selectedId) ?? visibleBuilds[0] ?? null;

  // Koszt materiału na budowie = RZECZYWISTY, skumulowany koszt FIFO
  // doliczony przez submit_daily_report przy raportach dziennych
  // (build_materials."actualCost", patrz Assignment.actualCost w
  // components/report-ui.tsx) — NIE wartość partii aktualnie
  // przypisanych/leżących na budowie (build_material_lots), która rosła
  // już przy samym PRZYPISANIU materiału, zanim ktokolwiek go zużył —
  // stąd wcześniej "Koszt" potrafił pokazywać wartość, mimo że "Zużyto"
  // było wciąż zerowe (materiał trafił na budowę, ale nie było jeszcze
  // żadnego raportu, który by go rozliczył).
  const materialCostFor = (materialId: string) => {
    if (!build) return 0;
    const a = assignments.find(
      (x) => x.buildId === build.id && x.materialId === materialId,
    );
    return a?.actualCost ?? 0;
  };

  // Dopasowanie planu (build_material_plan) do realnego zużycia
  // (assignments/build_materials): najpierw po linked_material_id (gdy
  // ustawione — np. przez naprawę danych 041 albo ręcznie), a w
  // przeciwnym razie po znormalizowanej nazwie materiału (trim +
  // lowercase) — ten sam wzorzec co stageNameForMaterial w
  // contexts/app-data.tsx i assignmentByMaterialName w report-screen.tsx.
  // Technologia jest definiowana zanim materiał fizycznie istnieje w
  // magazynie (dopiero receive_order() go tworzy/dopasowuje po nazwie),
  // więc linked_material_id zwykle jest null — dopasowanie po nazwie
  // jest normalnym przypadkiem, nie wyjątkiem.
  const resolveMaterialIdForPlanRow = (
    r: { linkedMaterialId: number | string | null; materialName: string },
  ): string | null => {
    if (r.linkedMaterialId != null) return String(r.linkedMaterialId);
    if (!build) return null;
    const name = normalizeMaterialName(r.materialName);
    if (!name) return null;
    const a = assignments.find(
      (x) =>
        x.buildId === build.id &&
        normalizeMaterialName(materials.find((m) => m.id === x.materialId)?.name ?? "") === name,
    );
    return a ? a.materialId : null;
  };

  const stages = useMemo(() => {
    if (!build) return [];
    const plans = buildMaterialPlans.filter((p) => p.buildId === Number(build.id));
    const byStage = new Map<string, typeof plans>();
    plans.forEach((p) => {
      const list = byStage.get(p.stageName) ?? [];
      list.push(p);
      byStage.set(p.stageName, list);
    });
    return Array.from(byStage.entries()).map(([stageName, rows]) => {
      const items = rows.map((r) => {
        const materialId = resolveMaterialIdForPlanRow(r);
        const material = materialId ? materials.find((m) => m.id === materialId) : null;
        const a = materialId
          ? assignments.find((x) => x.buildId === build.id && x.materialId === materialId)
          : undefined;
        const plan = Number(r.plannedQuantity) || 0;
        const przypisano = a?.planned ?? 0;
        const zuzyto = a?.used ?? 0;
        const koszt = materialId ? materialCostFor(materialId) : 0;
        return {
          key: `${r.id}`,
          name: material?.name ?? r.materialName,
          unit: r.unit,
          plan,
          przypisano,
          zuzyto,
          pozostalo: przypisano - zuzyto,
          koszt,
        };
      });
      return {
        stageName,
        items,
        koszt: items.reduce((sum, i) => sum + i.koszt, 0),
      };
    });
  }, [build, buildMaterialPlans, materials, assignments]);

  // Zbiór materialId dopasowanych do planu (po ID lub po nazwie) — używany
  // do wykluczenia tych materiałów z sekcji "pomocnicze spoza planu", żeby
  // ta sama pozycja nie pojawiła się w obu tabelach naraz.
  const planMaterialIds = useMemo(() => {
    if (!build) return new Set<string>();
    const plans = buildMaterialPlans.filter((p) => p.buildId === Number(build.id));
    return new Set(
      plans
        .map((p) => resolveMaterialIdForPlanRow(p))
        .filter((id): id is string => id != null),
    );
  }, [build, buildMaterialPlans, assignments, materials]);

  const auxAssignments = useMemo(
    () =>
      build
        ? assignments.filter(
            (a) => a.buildId === build.id && !planMaterialIds.has(a.materialId),
          )
        : [],
    [build, assignments, planMaterialIds],
  );

  const buildReports = useMemo(
    () => (build ? savedReports.filter((r) => r.buildId === build.id) : []),
    [build, savedReports],
  );

  const buildTimeEntries = useMemo(
    () => (build ? timeEntries.filter((t) => t.buildId === build.id) : []),
    [build, timeEntries],
  );

  const isClosed = build?.status === "zamknięta";
  const frozen = isClosed ? build?.settlement : undefined;

  const materialsCostTech = stages.reduce((sum, s) => sum + s.koszt, 0);
  const materialsCostAux = auxAssignments.reduce(
    (sum, a) => sum + materialCostFor(a.materialId),
    0,
  );
  const kmCost = buildReports.reduce((sum, r) => sum + (r.kmCost ?? 0), 0);
  const extraCostsTotal = buildReports.reduce(
    (sum, r) => sum + r.extraCosts.reduce((s, c) => s + c.amount, 0),
    0,
  );
  const laborCost = buildTimeEntries.reduce((sum, t) => {
    const employee = employees.find((e) => e.id === t.employeeId);
    return sum + t.hours * (employee?.hourlyRate || 0);
  }, 0);
  // Planowany koszt robocizny (patrz supabase/sql/040_planowany_koszt_
  // robocizny.sql) — suma stawek godzinowych CZŁONKÓW brygady
  // przypisanej do budowy × planowane godziny/dzień × planowane dni
  // robocze (durationDays, ISTNIEJĄCE pole, ten sam sens co dotąd).
  // Zero, gdy budowa nie ma jeszcze przypisanej brygady.
  const plannedLaborCost = useMemo(() => {
    if (!build?.teamId) return 0;
    const memberRateSum = teamMembers
      .filter((m) => m.teamId === Number(build.teamId))
      .reduce((sum, m) => {
        const employee = employees.find((e) => e.id === String(m.employeeId));
        return sum + (employee?.hourlyRate || 0);
      }, 0);
    return memberRateSum * (build.plannedHoursPerDay || 0) * (build.durationDays || 0);
  }, [build, teamMembers, employees]);
  // Straty materiałowe (§6, docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md) —
  // pozycje pozostałości oznaczone przy zamknięciu budowy jako "Do
  // wyrzucenia" (nie zwrócone na magazyn). Liczone na żywo z trwałego
  // logu build_material_returns, po realnej cenie tej partii — zero
  // przed zamknięciem budowy (decyzja zapada dopiero wtedy), a po
  // zamknięciu zostaje na stałe (kolejne zamknięcie po wznowieniu
  // dopisze nowe wiersze, nie nadpisze starych).
  const wasteCost = build
    ? buildMaterialReturns
        .filter((r) => r.buildId === Number(build.id) && r.decision === "wyrzucenie")
        .reduce((sum, r) => sum + Number(r.quantity) * Number(r.unitPrice), 0)
    : 0;

  const totalCost = frozen
    ? frozen.totalCost
    : materialsCostTech + materialsCostAux + kmCost + laborCost + extraCostsTotal + wasteCost;
  const contractValue = Number(build?.contractValue) || 0;
  const profit = contractValue - totalCost;
  const margin = contractValue > 0 ? (profit / contractValue) * 100 : null;

  const areaM2 = Number(build?.areaM2) || 0;
  const costPerM2 = areaM2 > 0 ? totalCost / areaM2 : null;
  const durationDays = build?.durationDays ?? 0;
  const costPerDay = durationDays > 0 ? totalCost / durationDays : null;

  const costBreakdown = useMemo(
    () =>
      [
        { key: "tech", label: "Materiały technologiczne", value: materialsCostTech, color: COLORS.primary },
        { key: "aux", label: "Materiały pomocnicze", value: materialsCostAux, color: "#7BA6D9" },
        { key: "labor", label: "Robocizna", value: laborCost, color: "#9C7BD9" },
        { key: "km", label: "Kilometrówka", value: kmCost, color: COLORS.success },
        { key: "extra", label: "Koszty dodatkowe", value: extraCostsTotal, color: COLORS.warning },
        { key: "waste", label: "Straty materiałowe", value: wasteCost, color: COLORS.danger },
      ].filter((seg) => seg.value > 0),
    [materialsCostTech, materialsCostAux, laborCost, kmCost, extraCostsTotal, wasteCost],
  );

  return (
    <>
      <ScreenHeader title="Rozliczenie budowy" />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Pressable
          onPress={() => setPickerOpen(true)}
          className="bg-surface border border-border rounded-2xl p-4"
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
            <Text style={{ color: COLORS.muted, fontSize: 11 }}>Budowa</Text>
            <Text
              style={{ color: COLORS.foreground, fontWeight: "700", marginTop: 2 }}
              numberOfLines={1}
            >
              {build ? `${build.number} · ${build.name}` : "Brak budów"}
            </Text>
          </View>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
            Zmień
          </Text>
        </Pressable>
        {/* Mały przełącznik zamiast pełnowymiarowego wiersza tekstu — ten
            sam wzorzec co "Archiwum" w warehouse-screen.tsx/manager-screen.tsx. */}
        <Pressable
          onPress={() => setShowArchivedBuilds(!showArchivedBuilds)}
          hitSlop={8}
          style={{ alignItems: "center", gap: 4 }}
        >
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 5,
              borderWidth: 1,
              borderColor: showArchivedBuilds ? COLORS.primary : COLORS.border,
              backgroundColor: showArchivedBuilds ? COLORS.primary : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {showArchivedBuilds && (
              <Text style={{ color: COLORS.background, fontSize: 12, fontWeight: "800" }}>
                ✓
              </Text>
            )}
          </View>
          <Text style={{ color: COLORS.muted, fontSize: 11, fontWeight: "600" }}>Archiwum</Text>
        </Pressable>
      </View>

      <SearchablePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        query={buildQuery}
        onQueryChange={setBuildQuery}
        placeholder="🔍 Szukaj budowy…"
        selectedKey={build?.id}
        onSelect={(key) => {
          setSelectedId(key);
          setPickerOpen(false);
        }}
        emptyLabel="Brak budów pasujących do wyszukiwania."
        items={filteredBuilds.map((b) => ({
          key: b.id,
          title: `${b.number} · ${b.name}`,
        }))}
      />

      {!build ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center">
          <Text className="text-sm text-muted">Brak budów do rozliczenia.</Text>
        </View>
      ) : (
        <>
          {isClosed && (
            <View
              style={{
                backgroundColor: COLORS.warningBg,
                borderRadius: 10,
                paddingVertical: 8,
                paddingHorizontal: 12,
                marginBottom: 14,
              }}
            >
              <Text style={{ color: COLORS.warning, fontSize: 12, fontWeight: "700" }}>
                Budowa zamknięta {frozen ? `· ${frozen.closedAt.slice(0, 10)}` : ""} — rozliczenie
                statyczne, nie przelicza się już na żywo.
              </Text>
            </View>
          )}

          {stages.length === 0 ? (
            <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-4">
              <Text className="text-sm text-muted">
                Brak przypisanej technologii — plan materiałowy per etap pojawi się po
                przypisaniu technologii do budowy (Faza 2).
              </Text>
            </View>
          ) : (
            stages.map((stage) => (
              <View
                key={stage.stageName}
                className="bg-surface border border-border rounded-2xl p-4 mb-3"
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 14 }}>
                    {stage.stageName}
                  </Text>
                  <Text style={{ color: COLORS.primary, fontWeight: "800", fontSize: 14 }}>
                    {formatPLN(stage.koszt)}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    paddingBottom: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.border,
                  }}
                >
                  <Text style={{ flex: 2, color: COLORS.muted, fontSize: 11 }}>Materiał</Text>
                  <Text style={{ flex: 1, color: COLORS.muted, fontSize: 11, textAlign: "right" }}>
                    Plan
                  </Text>
                  <Text style={{ flex: 1, color: COLORS.muted, fontSize: 11, textAlign: "right" }}>
                    Zużyto
                  </Text>
                  <Text style={{ flex: 1, color: COLORS.muted, fontSize: 11, textAlign: "right" }}>
                    Koszt
                  </Text>
                </View>
                {stage.items.map((item) => (
                  <View key={item.key} style={{ flexDirection: "row", paddingVertical: 6 }}>
                    <Text
                      style={{ flex: 2, color: COLORS.foreground, fontSize: 12 }}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text style={{ flex: 1, color: COLORS.muted, fontSize: 12, textAlign: "right" }}>
                      {item.plan} {item.unit}
                    </Text>
                    <Text style={{ flex: 1, color: COLORS.foreground, fontSize: 12, textAlign: "right" }}>
                      {item.zuzyto}
                    </Text>
                    <Text style={{ flex: 1, color: COLORS.foreground, fontSize: 12, textAlign: "right", fontWeight: "700" }}>
                      {formatPLN(item.koszt)}
                    </Text>
                  </View>
                ))}
              </View>
            ))
          )}

          {auxAssignments.length > 0 && (
            <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
              <Text style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 14, marginBottom: 8 }}>
                Materiały pomocnicze (spoza planu technologii)
              </Text>
              {auxAssignments.map((a) => {
                const material = materials.find((m) => m.id === a.materialId);
                return (
                  <View
                    key={a.materialId}
                    style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}
                  >
                    <Text style={{ color: COLORS.foreground, fontSize: 12 }} numberOfLines={1}>
                      {material?.name ?? "Materiał usunięty"}
                    </Text>
                    <Text style={{ color: COLORS.foreground, fontSize: 12, fontWeight: "700" }}>
                      {a.used} {material?.unit ?? ""} · {formatPLN(materialCostFor(a.materialId))}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          <View className="bg-surface border border-border rounded-2xl p-4">
            <Text
              style={{
                color: COLORS.muted,
                fontSize: 11,
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Podsumowanie
            </Text>
            <SummaryRow label="Materiały technologiczne" value={formatPLN(materialsCostTech)} />
            <SummaryRow label="Materiały pomocnicze" value={formatPLN(materialsCostAux)} />
            <SummaryRow label="Kilometrówka" value={formatPLN(kmCost)} />
            <SummaryRow
              label={
                plannedLaborCost > 0
                  ? `Robocizna (plan ${formatPLN(plannedLaborCost)})`
                  : "Robocizna"
              }
              value={formatPLN(laborCost)}
            />
            <SummaryRow label="Koszty dodatkowe" value={formatPLN(extraCostsTotal)} />
            {wasteCost > 0 && (
              <SummaryRow label="Straty materiałowe" value={formatPLN(wasteCost)} />
            )}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingTop: 10,
                marginTop: 6,
                borderTopWidth: 1,
                borderTopColor: COLORS.border,
              }}
            >
              <Text style={{ color: COLORS.foreground, fontSize: 13, fontWeight: "800" }}>
                Koszt budowy
              </Text>
              <Text style={{ color: COLORS.primary, fontSize: 15, fontWeight: "800" }}>
                {formatPLN(totalCost)}
              </Text>
            </View>

            <View style={{ marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border }}>
              <SummaryRow label="Kontrakt" value={formatPLN(contractValue)} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>Zysk</Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "800",
                    color: profit < 0 ? COLORS.danger : COLORS.success,
                  }}
                >
                  {formatPLN(profit)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>Marża</Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "800",
                    color: margin != null && margin < 0 ? COLORS.danger : COLORS.success,
                  }}
                >
                  {margin != null ? `${margin.toFixed(1)}%` : "—"}
                </Text>
              </View>
            </View>
          </View>

          <View className="bg-surface border border-border rounded-2xl p-4 mt-3">
            <Text style={{ color: COLORS.foreground, fontWeight: "800", fontSize: 16, marginBottom: 2 }}>
              Raport domknięcia budowy
            </Text>
            <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 16 }}>
              {isClosed
                ? "Podsumowanie dla właściciela / zarządu na podstawie zamrożonego rozliczenia."
                : "Podgląd na żywo — ostateczne liczby po zamknięciu budowy."}
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
              <KpiTile label="Kontrakt" value={formatPLN(contractValue)} />
              <KpiTile label="Koszt budowy" value={formatPLN(totalCost)} color={COLORS.primary} />
              <KpiTile
                label="Zysk"
                value={formatPLN(profit)}
                color={profit < 0 ? COLORS.danger : COLORS.success}
              />
              <KpiTile
                label="Marża"
                value={margin != null ? `${margin.toFixed(1)}%` : "—"}
                color={margin != null && margin < 0 ? COLORS.danger : COLORS.success}
              />
              <KpiTile
                label="Koszt / m²"
                value={costPerM2 != null ? formatPLN(costPerM2) : "—"}
              />
              <KpiTile
                label="Koszt / dzień"
                value={costPerDay != null ? formatPLN(costPerDay) : "—"}
              />
              <KpiTile label="Czas trwania" value={durationDays > 0 ? `${durationDays} dni` : "—"} />
              <KpiTile label="Powierzchnia" value={areaM2 > 0 ? `${areaM2} m²` : "—"} />
            </View>

            {costBreakdown.length > 0 && (
              <>
                <Text
                  style={{
                    color: COLORS.muted,
                    fontSize: 11,
                    textTransform: "uppercase",
                    marginBottom: 10,
                  }}
                >
                  Struktura kosztów
                </Text>
                <DonutChart
                  data={costBreakdown}
                  centerLabel="koszt"
                  centerValue={formatPLN(totalCost)}
                />
              </>
            )}

            <View style={{ marginTop: 20 }}>
              <Text
                style={{
                  color: COLORS.muted,
                  fontSize: 11,
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Kontrakt vs koszt
              </Text>
              <ComparisonBarChart
                items={[
                  {
                    key: "budget",
                    label: build.number,
                    a: { key: "contract", label: "Kontrakt", value: contractValue, color: COLORS.primary },
                    b: {
                      key: "cost",
                      label: "Koszt budowy",
                      value: totalCost,
                      color: totalCost > contractValue ? COLORS.danger : COLORS.success,
                    },
                  },
                ]}
              />
            </View>
          </View>
        </>
      )}
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
      <Text style={{ color: COLORS.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: COLORS.foreground, fontSize: 13, fontWeight: "700" }}>{value}</Text>
    </View>
  );
}
