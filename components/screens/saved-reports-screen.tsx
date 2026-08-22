import { Pressable, Text, View } from "react-native";

import {
  COLORS,
  IconBadge,
  StatusBadge,
  ScreenHeader,
} from "@/components/report-ui";
import { useAppData } from "@/contexts/app-data";

export function SavedReportsScreen() {
  const { savedReports, openSavedReport } = useAppData();

  const sorted = [...savedReports].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const approvedCount = savedReports.filter(
    (r) => r.status === "approved",
  ).length;
  const pendingCount = savedReports.length - approvedCount;

  return (
    <>
      <ScreenHeader
        eyebrow="BRYGADZISTA / MOJE RAPORTY"
        title="Moje raporty"
        description="Zapisane raporty dzienne i ich aktualny stan."
      />

      {savedReports.length > 0 && (
        <View
          className="bg-surface border border-border rounded-2xl mb-5"
          style={{ flexDirection: "row", overflow: "hidden" }}
        >
          <View style={{ flex: 1, padding: 16 }}>
            <Text className="text-xs text-muted uppercase">Wszystkich</Text>
            <Text className="text-3xl font-bold text-foreground mt-1">
              {savedReports.length}
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
            Zapisane raporty pojawią się tutaj po zakończeniu raportu
            dziennego.
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
