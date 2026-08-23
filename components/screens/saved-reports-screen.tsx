import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
  COLORS,
  IconBadge,
  StatusBadge,
  ScreenHeader,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

export function SavedReportsScreen() {
  const { builds, savedReports, openSavedReport, startNewReport } = useAppData();

  // Wybór budowy PRZED listą — z czasem raportów robi się sporo, więc
  // jedna wspólna lista wszystkich budów naraz przestaje być użyteczna.
  // "Wszystkie budowy" zostaje jako domyślna opcja.
  const [buildsFilter, setBuildsFilter] = useState<"active" | "archived">(
    "active",
  );
  const [selectedBuildId, setSelectedBuildId] = useState<string | "all">(
    "all",
  );
  const visibleBuilds = useMemo(
    () =>
      builds.filter((b) =>
        buildsFilter === "active" ? b.status !== "zamknięta" : b.status === "zamknięta",
      ),
    [builds, buildsFilter],
  );
  const switchBuildsFilter = (next: "active" | "archived") => {
    setBuildsFilter(next);
    setSelectedBuildId("all");
  };

  const reportsInScope =
    selectedBuildId === "all"
      ? savedReports.filter((r) => visibleBuilds.some((b) => b.id === r.buildId))
      : savedReports.filter((r) => r.buildId === selectedBuildId);

  const sorted = [...reportsInScope].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const approvedCount = reportsInScope.filter(
    (r) => r.status === "approved",
  ).length;
  const pendingCount = reportsInScope.length - approvedCount;

  return (
    <>
      <ScreenHeader
        title="Raporty"
        description="Zapisane raporty dzienne i ich aktualny stan."
        action={
          <Pressable
            onPress={() => startNewReport()}
            style={({ pressed }) => ({
              backgroundColor: COLORS.primary,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 10,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text
              style={{ color: COLORS.background, fontWeight: "800", fontSize: 13 }}
            >
              + Nowy raport
            </Text>
          </Pressable>
        }
      />

      {builds.length > 0 && (
        <>
          <View
            className="bg-surface border border-border rounded-2xl overflow-hidden mb-3"
            style={{ flexDirection: "row" }}
          >
            <Pressable
              onPress={() => switchBuildsFilter("active")}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor:
                  buildsFilter === "active" ? COLORS.primary : "transparent",
              }}
            >
              <Text
                style={{
                  color: buildsFilter === "active" ? COLORS.background : COLORS.muted,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                Aktywne budowy
              </Text>
            </Pressable>
            <Pressable
              onPress={() => switchBuildsFilter("archived")}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor:
                  buildsFilter === "archived" ? COLORS.primary : "transparent",
              }}
            >
              <Text
                style={{
                  color: buildsFilter === "archived" ? COLORS.background : COLORS.muted,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                Zarchiwizowane
              </Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 16 }}
          >
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => setSelectedBuildId("all")}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: selectedBuildId === "all" ? COLORS.primary : COLORS.border,
                  backgroundColor: selectedBuildId === "all" ? COLORS.primary : COLORS.surface,
                }}
              >
                <Text
                  style={{
                    color: selectedBuildId === "all" ? COLORS.background : COLORS.foreground,
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  Wszystkie budowy
                </Text>
              </Pressable>
              {visibleBuilds.map((b) => {
                const active = selectedBuildId === b.id;
                const count = savedReports.filter((r) => r.buildId === b.id).length;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setSelectedBuildId(b.id)}
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
                      {b.number} · {b.name} ({count})
                    </Text>
                  </Pressable>
                );
              })}
              {visibleBuilds.length === 0 && (
                <Text style={{ color: COLORS.muted, fontSize: 13, alignSelf: "center" }}>
                  Brak budów w tym widoku.
                </Text>
              )}
            </View>
          </ScrollView>
        </>
      )}

      {reportsInScope.length > 0 && (
        <View
          className="bg-surface border border-border rounded-2xl mb-5"
          style={{ flexDirection: "row", overflow: "hidden" }}
        >
          <View style={{ flex: 1, padding: 16 }}>
            <Text className="text-xs text-muted uppercase">Wszystkich</Text>
            <Text className="text-3xl font-bold text-foreground mt-1">
              {reportsInScope.length}
            </Text>
          </View>
          <View style={{ width: 1, backgroundColor: COLORS.border }} />
          <View style={{ flex: 1, padding: 16 }}>
            <Text className="text-xs text-muted uppercase">Do edycji</Text>
            <Text
              style={{ color: COLORS.primary }}
              className="text-3xl font-bold mt-1"
            >
              {pendingCount}
            </Text>
          </View>
          <View style={{ width: 1, backgroundColor: COLORS.border }} />
          <View style={{ flex: 1, padding: 16 }}>
            <Text className="text-xs text-muted uppercase">Zatwierdzone</Text>
            <Text
              style={{ color: COLORS.success }}
              className="text-3xl font-bold mt-1"
            >
              {approvedCount}
            </Text>
          </View>
        </View>
      )}

      {sorted.length === 0 ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center">
          <IconBadge name="description" />
          <Text className="text-base font-bold text-foreground mt-3">
            Brak zapisanych raportów
          </Text>
          <Text className="text-sm text-muted mt-2 text-center">
            {selectedBuildId === "all"
              ? "Zapisane raporty pojawią się tutaj po zakończeniu raportu dziennego."
              : "Ta budowa nie ma jeszcze żadnych raportów."}
          </Text>
        </View>
      ) : (
        sorted.map((report) => {
          const approved = report.status === "approved";
          const materialsCount = Object.keys(report.materialValues).length;
          const peopleCount = report.people.length;
          return (
            <Pressable
              key={report.id}
              onPress={() => openSavedReport(report.id)}
              style={({ pressed }) => ({
                backgroundColor: COLORS.surface,
                borderWidth: 1,
                borderColor: approved ? COLORS.success : COLORS.border,
                borderRadius: 16,
                padding: 14,
                marginBottom: 12,
                opacity: pressed ? 0.75 : 1,
                flexDirection: "row",
                alignItems: "center",
              })}
            >
              <IconBadge name={approved ? "lock" : "edit-note"} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text className="text-lg font-bold text-foreground">
                    {report.buildNumber}
                  </Text>
                  <Text className="text-xs text-muted">{report.date}</Text>
                </View>
                <Text className="text-sm text-muted mt-0.5" numberOfLines={1}>
                  {report.buildName}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 10,
                  }}
                >
                  <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                    {peopleCount} {peopleCount === 1 ? "osoba" : "osoby"} ·{" "}
                    {materialsCount}{" "}
                    {materialsCount === 1 ? "materiał" : "materiały"}
                  </Text>
                  <StatusBadge
                    status={approved ? "ok" : "warning"}
                    label={approved ? "Zatwierdzony" : "Do edycji"}
                  />
                </View>
              </View>
            </Pressable>
          );
        })
      )}
    </>
  );
}
