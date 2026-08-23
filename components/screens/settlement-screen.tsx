import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { COLORS, formatPLN, ScreenHeader } from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

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
    buildMaterialLots,
    savedReports,
    employees,
    timeEntries,
  } = useAppData();

  const sortedBuilds = useMemo(
    () =>
      [...builds].sort((a, b) => {
        if (a.status !== b.status) return a.status === "aktywna" ? -1 : 1;
        return b.startDate.localeCompare(a.startDate);
      }),
    [builds],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const build =
    sortedBuilds.find((b) => b.id === selectedId) ?? sortedBuilds[0] ?? null;

  const materialCostFor = (materialId: string) => {
    if (!build) return 0;
    const lots = buildMaterialLots.filter(
      (l) => l.buildId === Number(build.id) && String(l.materialId) === materialId,
    );
    if (lots.length > 0) {
      return lots.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
    }
    const a = assignments.find(
      (x) => x.buildId === build.id && x.materialId === materialId,
    );
    return a ? a.used * a.unitPrice : 0;
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
        const materialId = r.linkedMaterialId != null ? String(r.linkedMaterialId) : null;
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
  }, [build, buildMaterialPlans, materials, assignments, buildMaterialLots]);

  const planMaterialIds = useMemo(
    () =>
      new Set(
        buildMaterialPlans
          .filter((p) => build && p.buildId === Number(build.id) && p.linkedMaterialId != null)
          .map((p) => String(p.linkedMaterialId)),
      ),
    [build, buildMaterialPlans],
  );

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

  const totalCost = frozen
    ? frozen.totalCost
    : materialsCostTech + materialsCostAux + kmCost + laborCost + extraCostsTotal;
  const contractValue = Number(build?.contractValue) || 0;
  const profit = contractValue - totalCost;
  const margin = contractValue > 0 ? (profit / contractValue) * 100 : null;

  return (
    <>
      <ScreenHeader
        eyebrow="BUDOWA / ROZLICZENIE"
        title="Rozliczenie budowy"
        description="Plan, przypisano, zużyto, koszt i marża — spięte z faz 0–7."
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {sortedBuilds.map((b) => {
            const active = build?.id === b.id;
            return (
              <Pressable
                key={b.id}
                onPress={() => setSelectedId(b.id)}
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
                  {b.number} · {b.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

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
                    Przypisano
                  </Text>
                  <Text style={{ flex: 1, color: COLORS.muted, fontSize: 11, textAlign: "right" }}>
                    Zużyto
                  </Text>
                  <Text style={{ flex: 1, color: COLORS.muted, fontSize: 11, textAlign: "right" }}>
                    Pozostało
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
                      {item.przypisano}
                    </Text>
                    <Text style={{ flex: 1, color: COLORS.foreground, fontSize: 12, textAlign: "right" }}>
                      {item.zuzyto}
                    </Text>
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 12,
                        textAlign: "right",
                        color: item.pozostalo < 0 ? COLORS.danger : COLORS.muted,
                      }}
                    >
                      {item.pozostalo}
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
                      {a.used} / plan {a.planned} · {formatPLN(materialCostFor(a.materialId))}
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
            <SummaryRow label="Robocizna" value={formatPLN(laborCost)} />
            <SummaryRow label="Koszty dodatkowe" value={formatPLN(extraCostsTotal)} />
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
