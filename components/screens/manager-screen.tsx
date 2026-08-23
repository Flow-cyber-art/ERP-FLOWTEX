import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  COLORS,
  IconBadge,
  ReportCard,
  ScreenHeader,
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
// pierwsza opcja dla managera, który faktycznie chce widzieć wszystko na
// raz (np. skrzynkę "do zatwierdzenia" ze wszystkich budów).
export function ManagerScreen() {
  const { builds, assignments, savedReports, approveReport, employees, materials } =
    useAppData();

  const [buildsFilter, setBuildsFilter] = useState<"active" | "archived">(
    "active",
  );
  const [selectedBuildId, setSelectedBuildId] = useState<string | "all">(
    "all",
  );
  const [reportsTab, setReportsTab] = useState<"pending" | "approved">(
    "pending",
  );
  const [expandedReportId, setExpandedReportId] = useState<string | null>(
    null,
  );

  const visibleBuilds = useMemo(
    () =>
      builds.filter((b) =>
        buildsFilter === "active" ? b.status !== "zamknięta" : b.status === "zamknięta",
      ),
    [builds, buildsFilter],
  );

  // Zmiana filtra aktywne/zarchiwizowane: jeśli wybrana budowa zniknęła z
  // nowej listy (np. została właśnie zamknięta), wracamy do "Wszystkie",
  // zamiast pokazywać pusty widok bez wyjaśnienia.
  const switchBuildsFilter = (next: "active" | "archived") => {
    setBuildsFilter(next);
    setSelectedBuildId("all");
  };

  const reportsForBuilds =
    selectedBuildId === "all"
      ? savedReports.filter((r) =>
          visibleBuilds.some((b) => b.id === r.buildId),
        )
      : savedReports.filter((r) => r.buildId === selectedBuildId);

  const pendingReports = [...reportsForBuilds]
    .filter((r) => r.status !== "approved")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const approvedReports = [...reportsForBuilds]
    .filter((r) => r.status === "approved")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const reportsToShow =
    reportsTab === "pending" ? pendingReports : approvedReports;

  return (
    <>
      <ScreenHeader
        title="Raporty"
        description="Wybierz budowę, żeby zobaczyć jej raporty — albo zostaw „Wszystkie budowy”, żeby zatwierdzać ze wszystkich naraz."
      />

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

      <View
        className="bg-surface border border-border rounded-2xl overflow-hidden mb-3"
        style={{ flexDirection: "row" }}
      >
        <Pressable
          onPress={() => setReportsTab("pending")}
          style={{
            flex: 1,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor:
              reportsTab === "pending" ? COLORS.primary : "transparent",
          }}
        >
          <Text
            style={{
              color:
                reportsTab === "pending" ? COLORS.background : COLORS.muted,
              fontWeight: "700",
              fontSize: 13,
            }}
          >
            Do zatwierdzenia ({pendingReports.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setReportsTab("approved")}
          style={{
            flex: 1,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor:
              reportsTab === "approved" ? COLORS.primary : "transparent",
          }}
        >
          <Text
            style={{
              color:
                reportsTab === "approved" ? COLORS.background : COLORS.muted,
              fontWeight: "700",
              fontSize: 13,
            }}
          >
            Zatwierdzone ({approvedReports.length})
          </Text>
        </Pressable>
      </View>

      {reportsToShow.length === 0 ? (
        <View className="bg-surface border border-border rounded-2xl p-5 items-center mb-5">
          <IconBadge name="description" />
          <Text className="text-sm text-muted mt-3 text-center">
            {reportsTab === "pending"
              ? "Brak raportów oczekujących na zatwierdzenie."
              : "Brak zatwierdzonych raportów."}
          </Text>
        </View>
      ) : (
        <View className="mb-5">
          {reportsToShow.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              build={builds.find((b) => b.id === report.buildId)}
              materials={materials}
              assignments={assignments}
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
        </View>
      )}
    </>
  );
}
