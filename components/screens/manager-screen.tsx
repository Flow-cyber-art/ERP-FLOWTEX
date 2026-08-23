import { useState } from "react";
import { Pressable, Text, View } from "react-native";
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
export function ManagerScreen() {
  const { builds, assignments, savedReports, approveReport, employees, materials } =
    useAppData();

  const [reportsTab, setReportsTab] = useState<"pending" | "approved">(
    "pending",
  );
  const [expandedReportId, setExpandedReportId] = useState<string | null>(
    null,
  );

  const pendingReports = [...savedReports]
    .filter((r) => r.status !== "approved")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const approvedReports = [...savedReports]
    .filter((r) => r.status === "approved")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const reportsToShow =
    reportsTab === "pending" ? pendingReports : approvedReports;

  return (
    <>
      <ScreenHeader
        title="Raporty"
        description="Raporty ze wszystkich budów spływają tu automatycznie — zatwierdź je tutaj. Szczegóły materiałowe konkretnej budowy oraz jej zamknięcie znajdziesz w zakładce Budowy."
      />

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
              showBuildInfo
            />
          ))}
        </View>
      )}
    </>
  );
}
