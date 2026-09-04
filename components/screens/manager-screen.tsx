import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  COLORS,
  IconBadge,
  ReportCard,
  ScreenHeader,
  SearchablePicker,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

// Skrzynka robocza managera: WSZYSTKIE raporty ze WSZYSTKICH budów w jednym
// miejscu (żeby nie trzeba było klikać budowa po budowie żeby znaleźć to,
// co czeka na zatwierdzenie). Widok pojedynczej budowy — materiały,
// zamknięcie/rozliczenie — mieszka teraz w ekranie "Budowy", żeby dane nie
// były liczone i pokazywane w dwóch miejscach naraz.
//
// Wybór budowy PRZED listą raportów (zamiast jednej wspólnej listy
// wszystkich budów naraz) — z czasem raportów są setki, więc "wszystkie
// naraz" przestaje być użyteczne. "Wszystkie budowy" zostaje jako
// pierwsza, zawsze widoczna opcja dla managera, który faktycznie chce
// widzieć wszystko na raz (np. skrzynkę "do zatwierdzenia" ze wszystkich
// budów). Rozwijany picker z wyszukiwarką (jak w Raporcie brygadzisty),
// nie rząd chipów — przy kilkudziesięciu budowach chipy przestają się
// mieścić i trzeba je przewijać w bok, żeby cokolwiek znaleźć.
//
// Bez zakładek "Do zatwierdzenia / Zatwierdzone" — raportów dziennie jest
// niewiele (jeden, może dwa na budowę), więc jedna lista z nie
// zatwierdzonymi u góry i zatwierdzonymi u dołu jest czytelniejsza niż
// przełączanie między dwoma widokami. Zatwierdzenie po prostu przenosi
// raport do dolnej sekcji przy najbliższym odświeżeniu danych.
export function ManagerScreen() {
  const {
    builds,
    assignments,
    buildMaterialPlans,
    buildStageStatuses,
    savedReports,
    approveReport,
    employees,
    materials,
  } = useAppData();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [buildQuery, setBuildQuery] = useState("");
  const [showArchivedBuilds, setShowArchivedBuilds] = useState(false);
  const [selectedBuildId, setSelectedBuildId] = useState<string | "all">(
    "all",
  );
  const [expandedReportId, setExpandedReportId] = useState<string | null>(
    null,
  );

  const visibleBuilds = useMemo(
    () => builds.filter((b) => showArchivedBuilds || b.status !== "zamknięta"),
    [builds, showArchivedBuilds],
  );
  const filteredBuilds = useMemo(() => {
    const q = buildQuery.trim().toLowerCase();
    if (!q) return visibleBuilds;
    return visibleBuilds.filter(
      (b) =>
        b.number.toLowerCase().includes(q) || b.name.toLowerCase().includes(q),
    );
  }, [visibleBuilds, buildQuery]);

  const selectedBuild = builds.find((b) => b.id === selectedBuildId);

  const reportsForBuilds =
    selectedBuildId === "all"
      ? savedReports.filter((r) => visibleBuilds.some((b) => b.id === r.buildId))
      : savedReports.filter((r) => r.buildId === selectedBuildId);

  const pendingReports = [...reportsForBuilds]
    .filter((r) => r.status !== "approved")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const approvedReports = [...reportsForBuilds]
    .filter((r) => r.status === "approved")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <>
      <ScreenHeader title="Raporty" />

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
              {selectedBuildId === "all"
                ? "Wszystkie budowy"
                : `${selectedBuild?.number ?? ""} · ${selectedBuild?.name ?? ""}`}
            </Text>
          </View>
          <Text style={{ color: COLORS.primary, fontWeight: "700", fontSize: 13 }}>
            Zmień
          </Text>
        </Pressable>
        {/* Mały przełącznik zamiast pełnowymiarowego wiersza tekstu — rzadko
            używana opcja (czy budowa jest w wyszukiwarce budowy do wyboru
            wyżej), ten sam wzorzec co "Archiwum" w warehouse-screen.tsx. */}
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
        selectedKey={selectedBuildId}
        onSelect={(key) => {
          setSelectedBuildId(key as string | "all");
          setPickerOpen(false);
        }}
        emptyLabel="Brak budów pasujących do wyszukiwania."
        items={[
          { key: "all", title: "Wszystkie budowy" },
          ...filteredBuilds.map((b) => ({
            key: b.id,
            title: `${b.number} · ${b.name}`,
            subtitle: `${savedReports.filter((r) => r.buildId === b.id).length} raportów`,
          })),
        ]}
      />

      {pendingReports.length === 0 && approvedReports.length === 0 ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <IconBadge name="description" />
          <Text className="text-sm text-muted mt-3 text-center">
            Brak raportów dla tego wyboru.
          </Text>
        </View>
      ) : (
        <View className="mb-5">
          {pendingReports.length > 0 && (
            <>
              <Text className="text-xs text-muted uppercase mb-2">
                Do zatwierdzenia ({pendingReports.length})
              </Text>
              {pendingReports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  build={builds.find((b) => b.id === report.buildId)}
                  materials={materials}
                  assignments={assignments}
                  buildMaterialPlans={buildMaterialPlans}
                  buildStageStatuses={buildStageStatuses}
                  employees={employees}
                  expanded={expandedReportId === report.id}
                  onToggle={() =>
                    setExpandedReportId(
                      expandedReportId === report.id ? null : report.id,
                    )
                  }
                  onApprove={() => approveReport(report.id)}
                  showBuildInfo={selectedBuildId === "all"}
                />
              ))}
            </>
          )}

          {approvedReports.length > 0 && (
            <>
              <Text
                className="text-xs text-muted uppercase mb-2"
                style={{ marginTop: pendingReports.length > 0 ? 20 : 0 }}
              >
                Zatwierdzone ({approvedReports.length})
              </Text>
              {approvedReports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  build={builds.find((b) => b.id === report.buildId)}
                  materials={materials}
                  assignments={assignments}
                  buildMaterialPlans={buildMaterialPlans}
                  buildStageStatuses={buildStageStatuses}
                  employees={employees}
                  expanded={expandedReportId === report.id}
                  onToggle={() =>
                    setExpandedReportId(
                      expandedReportId === report.id ? null : report.id,
                    )
                  }
                  onApprove={() => approveReport(report.id)}
                  showBuildInfo={selectedBuildId === "all"}
                />
              ))}
            </>
          )}
        </View>
      )}
    </>
  );
}
